import "server-only";

import { Codex } from "@openai/codex-sdk";
import { codexLocalAuthenticated, codexLocalEnvironment, resolveCodexLocalExecutable } from "./codexLocalRuntime.server";
import { inferNativeReferenceCategoryFromText, type NativeReferenceCompatibility, type NativeReferenceCategoryGroup } from "./referenceLibraryManagement";

const classificationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["categoryGroup", "productForm", "compositionType", "productSlotCount", "productSlotShape", "photographyType", "textDensity", "supportsPackagedProduct", "supportsNaturalFood", "supportsHumanModel", "supportsMultipleProducts", "compatibilityConfidence"],
  properties: {
    categoryGroup: { type: "string", enum: ["fashion", "food", "beauty"] },
    productForm: { type: "string", enum: ["bottle", "tube", "pouch", "box", "tray", "jar", "can", "fashion-item", "natural-food", "meat-cut", "produce", "bundle", "universal-packshot"] },
    compositionType: { type: "string", enum: ["product-packshot", "price-card", "product-lineup", "lifestyle-scene", "before-after", "comparison", "review-card", "sensory-closeup", "human-use", "natural-food-scene"] },
    productSlotCount: { type: "integer", minimum: 1, maximum: 6 },
    productSlotShape: { type: "string", enum: ["tall", "wide", "square", "flexible"] },
    photographyType: { type: "string", enum: ["packshot", "editorial", "lifestyle", "human-model", "natural-food"] },
    textDensity: { type: "string", enum: ["light", "medium", "dense"] },
    supportsPackagedProduct: { type: "boolean" },
    supportsNaturalFood: { type: "boolean" },
    supportsHumanModel: { type: "boolean" },
    supportsMultipleProducts: { type: "boolean" },
    compatibilityConfidence: { type: "string", enum: ["low", "medium", "high"] },
  },
} as const;

export async function classifyNativeReferenceImage(input: { imagePath: string; sourceFile: string }): Promise<{
  categoryGroup: NativeReferenceCategoryGroup;
  classificationMethod: "codex-local" | "filename-rule";
  compatibility?: Partial<NativeReferenceCompatibility>;
}> {
  const fallback = inferNativeReferenceCategoryFromText(input.sourceFile);
  try {
    if (!(await codexLocalAuthenticated())) {
      return { categoryGroup: fallback, classificationMethod: "filename-rule" };
    }
    const codex = new Codex({
      env: codexLocalEnvironment(),
      codexPathOverride: resolveCodexLocalExecutable(),
    });
    const thread = codex.startThread({
      workingDirectory: process.cwd(),
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      networkAccessEnabled: false,
      model: process.env.ADATLAS_CODEX_MODEL?.trim() || "gpt-5.6-sol",
      modelReasoningEffort: "low",
    });
    const response = await thread.run(
      [
        {
          type: "text" as const,
          text: `이 광고 레퍼런스에서 실제로 판매하는 상품과 교체 가능한 레이아웃을 보고 제작 호환 태그를 분류한다.
- fashion: 의류, 신발, 가방, 패션 잡화
- food: 일반 식품, 음료, 농수축산물, 간식
- beauty: 화장품, 스킨케어, 헤어·바디·퍼스널케어, 건강·웰니스·건강기능식품
애매한 생활 상품은 beauty로 분류한다. productSlotCount는 실제 교체 대상 상품 자리 수다. 포장 상품, 자연 식품, 사람 모델, 복수 상품 지원 여부를 보수적으로 판단하고 신뢰도가 낮으면 compatibilityConfidence=low로 둔다. JSON만 반환한다.`,
        },
        { type: "local_image" as const, path: input.imagePath },
      ],
      {
        outputSchema: classificationSchema,
        signal: AbortSignal.timeout(Number(process.env.ADATLAS_CODEX_REFERENCE_CLASSIFY_TIMEOUT_MS || 90_000)),
      }
    );
    const parsed = JSON.parse(response.finalResponse) as { categoryGroup?: string } & Partial<NativeReferenceCompatibility>;
    const categoryGroup = ["fashion", "food", "beauty"].includes(parsed.categoryGroup || "") ? (parsed.categoryGroup as NativeReferenceCategoryGroup) : fallback;
    const compatibility = { ...parsed };
    delete compatibility.categoryGroup;
    return { categoryGroup, classificationMethod: "codex-local", compatibility };
  } catch {
    return { categoryGroup: fallback, classificationMethod: "filename-rule" };
  }
}
