import "server-only";

import { Codex } from "@openai/codex-sdk";
import { codexLocalAuthenticated, codexLocalEnvironment, resolveCodexLocalExecutable } from "./codexLocalRuntime.server";
import { inferNativeReferenceBeautySubcategory, inferNativeReferenceCategoryFromText, inferNativeReferenceFoodSubcategoryFromText, normalizeNativeReferenceBeautySubcategory, type NativeReferenceBeautySubcategory, type NativeReferenceCompatibility, type NativeReferenceCategoryGroup, type NativeReferenceFoodSubcategory } from "./referenceLibraryManagement";

type ClassifiedReferenceCompatibility = Partial<NativeReferenceCompatibility> & {
  foodSubcategory?: NativeReferenceFoodSubcategory;
  beautySubcategory?: NativeReferenceBeautySubcategory;
};

const classificationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["categoryGroup", "foodSubcategory", "beautySubcategory", "productForm", "productPresentation", "compositionType", "productSlotCount", "productSlotShape", "photographyType", "textDensity", "supportsPackagedProduct", "supportsNaturalFood", "supportsHumanModel", "supportsMultipleProducts", "compatibilityConfidence"],
  properties: {
    categoryGroup: { type: "string", enum: ["fashion", "food", "beauty", "service"] },
    foodSubcategory: { type: "string", enum: ["meat", "snack", "none"] },
    beautySubcategory: { type: "string", enum: ["design", "hook", "none"] },
    productForm: { type: "string", enum: ["bottle", "tube", "pouch", "box", "tray", "jar", "can", "fashion-item", "natural-food", "meat-cut", "produce", "bundle", "universal-packshot"] },
    productPresentation: { type: "string", enum: ["packaged", "unpackaged", "mixed"] },
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
  compatibility?: ClassifiedReferenceCompatibility;
}> {
  const fallback = inferNativeReferenceCategoryFromText(input.sourceFile);
  const fallbackFoodSubcategory = fallback === "food" ? inferNativeReferenceFoodSubcategoryFromText(input.sourceFile) : undefined;
  const fallbackBeautySubcategory = fallback === "beauty" ? inferNativeReferenceBeautySubcategory({ sourceFile: input.sourceFile }) : undefined;
  const fallbackCompatibility = {
    ...(fallbackFoodSubcategory ? { foodSubcategory: fallbackFoodSubcategory } : {}),
    ...(fallbackBeautySubcategory ? { beautySubcategory: fallbackBeautySubcategory } : {}),
  };
  try {
    if (!(await codexLocalAuthenticated({ force: true }))) {
      return { categoryGroup: fallback, classificationMethod: "filename-rule", compatibility: fallbackCompatibility };
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
- food: 육류, 간식, 그 밖의 일반 식품·음료·농수산물
- beauty: 화장품, 스킨케어, 헤어·바디·퍼스널케어, 건강·웰니스·건강기능식품
- service: 교육·강의·취업·컨설팅·코칭·대행·소프트웨어·플랫폼처럼 실물 상품이 아니라 서비스 이용을 광고하며, 화면·성과·과정·기능을 보여주는 소재
foodSubcategory는 두 경우에만 지정한다.
- meat: 정육·한우·소고기·돼지고기·닭고기·갈비·등뼈·안창살·삼겹살뿐 아니라 불고기·제육·바베큐·닭가슴살처럼 고기가 판매 상품과 화면의 주인공인 조리 장면
- snack: 과일·건과·과자·디저트·빵·떡·견과처럼 식사 사이에 먹는 상품. 육포처럼 상품 형태가 명백한 간식이면 snack 우선
반찬·김치·국·밀키트·볶음밥·음료·소스·일반 조리식품처럼 육류와 간식 어느 쪽도 주인공이 아니면 none으로 두어 식품 대분류에만 둔다. food가 아닌 상품도 none이다. 프라이팬·냄비·김치통·고기 불판만 보고 meat나 snack으로 분류하지 않는다.
beautySubcategory는 화장품일 때 반드시 다음 둘 중 하나로 지정하고, 화장품이 아니면 none으로 둔다.
- design: 제품 또는 패키지가 화면의 명확한 주인공인 브랜드 키비주얼·에디토리얼. 브랜드명·상품명 정도의 아주 적은 문구만 있고, 가격·할인·혜택·CTA·문제 제기·후기·비교·전후·인물 사용 전개가 없어야 한다.
- hook: 강한 헤드라인·문제 제기·가격·할인·혜택·후기·비교·CTA가 중심인 판매형. 인물이나 신체 부위, 여러 색상·상태를 나란히 보여주는 비교, 사용법·효능 설명, 구매 유도 문구가 하나라도 있으면 hook이다.
화장품 디자인은 흰색이나 단색 배경에 제품을 조형적으로 크게 보여주는 고급 제품 광고처럼 비주얼 자체가 중심인 경우로 매우 좁게 판정한다. 예쁜 색감이나 제품 사진이 있어도 판매 문구와 비교 구조가 함께 있으면 hook이다. 애매하면 반드시 hook으로 둔다.
중앙 VS, 좌우 대조, 불만족 대안→우수한 판매 상품처럼 두 편을 비교하는 광고는 가격 영역이 커도 compositionType=comparison이다. 이때 productSlotCount는 좌우 의미 상품 자리까지 포함해 최소 2이며, supportsMultipleProducts는 실제 세트·여러 판매 상품을 뜻할 때만 true다. productSlotCount는 실제 교체 대상 또는 비교 역할 상품 자리 수다.
productPresentation은 이 레퍼런스 화면에 실제로 보이는 판매 상품 표현만 관찰해 지정한다. 패키지·라벨 상품만 보이면 packaged, 내용물·원물·조리/서빙 상품만 보이면 unpackaged, 패키지와 내용물·원물이 동시에 보이면 mixed다. '지원 가능성'을 추측해 mixed로 지정하지 않는다. 포장 상품, 자연 식품, 사람 모델, 복수 상품 지원 여부를 보수적으로 판단하고 신뢰도가 낮으면 compatibilityConfidence=low로 둔다. JSON만 반환한다.`,
        },
        { type: "local_image" as const, path: input.imagePath },
      ],
      {
        outputSchema: classificationSchema,
        signal: AbortSignal.timeout(Number(process.env.ADATLAS_CODEX_REFERENCE_CLASSIFY_TIMEOUT_MS || 90_000)),
      }
    );
    const parsed = JSON.parse(response.finalResponse) as Omit<Partial<NativeReferenceCompatibility>, "beautySubcategory"> & { categoryGroup?: string; foodSubcategory?: "meat" | "snack" | "none"; beautySubcategory?: "design" | "hook" | "none" };
    const categoryGroup = ["fashion", "food", "beauty", "service"].includes(parsed.categoryGroup || "") ? (parsed.categoryGroup as NativeReferenceCategoryGroup) : fallback;
    const { categoryGroup: _parsedCategory, foodSubcategory: parsedFoodSubcategory, beautySubcategory: parsedBeautySubcategory, ...parsedCompatibility } = parsed;
    void _parsedCategory;
    const compatibility: ClassifiedReferenceCompatibility = {
      ...parsedCompatibility,
      foodSubcategory: categoryGroup === "food" && parsedFoodSubcategory !== "none"
        ? inferNativeReferenceFoodSubcategoryFromText(parsedFoodSubcategory || "")
        : undefined,
      beautySubcategory: categoryGroup === "beauty" && parsedBeautySubcategory !== "none"
        ? normalizeNativeReferenceBeautySubcategory(parsedBeautySubcategory) || inferNativeReferenceBeautySubcategory(parsedCompatibility)
        : undefined,
    };
    return { categoryGroup, classificationMethod: "codex-local", compatibility };
  } catch {
    return { categoryGroup: fallback, classificationMethod: "filename-rule", compatibility: fallbackCompatibility };
  }
}
