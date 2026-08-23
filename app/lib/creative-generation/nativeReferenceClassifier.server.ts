import "server-only";

import { Codex } from "@openai/codex-sdk";
import {
  codexLocalAuthenticated,
  codexLocalEnvironment,
  resolveCodexLocalExecutable,
} from "./codexLocalRuntime.server";
import {
  inferNativeReferenceCategoryFromText,
  type NativeReferenceCategoryGroup,
} from "./referenceLibraryManagement";

const classificationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["categoryGroup"],
  properties: {
    categoryGroup: { type: "string", enum: ["fashion", "food", "beauty"] },
  },
} as const;

export async function classifyNativeReferenceImage(input: {
  imagePath: string;
  sourceFile: string;
}): Promise<{
  categoryGroup: NativeReferenceCategoryGroup;
  classificationMethod: "codex-local" | "filename-rule";
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
    const response = await thread.run([
      {
        type: "text" as const,
        text: `이 광고 레퍼런스에서 실제로 판매하는 상품을 보고 categoryGroup 하나만 분류한다.
- fashion: 의류, 신발, 가방, 패션 잡화
- food: 일반 식품, 음료, 농수축산물, 간식
- beauty: 화장품, 스킨케어, 헤어·바디·퍼스널케어, 건강·웰니스·건강기능식품
애매하거나 위 분류에 정확히 들어가지 않는 생활 상품은 beauty로 분류한다. JSON만 반환한다.`,
      },
      { type: "local_image" as const, path: input.imagePath },
    ], {
      outputSchema: classificationSchema,
      signal: AbortSignal.timeout(Number(process.env.ADATLAS_CODEX_REFERENCE_CLASSIFY_TIMEOUT_MS || 90_000)),
    });
    const parsed = JSON.parse(response.finalResponse) as { categoryGroup?: string };
    const categoryGroup = ["fashion", "food", "beauty"].includes(parsed.categoryGroup || "")
      ? parsed.categoryGroup as NativeReferenceCategoryGroup
      : fallback;
    return { categoryGroup, classificationMethod: "codex-local" };
  } catch {
    return { categoryGroup: fallback, classificationMethod: "filename-rule" };
  }
}

