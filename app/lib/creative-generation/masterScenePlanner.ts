import type { MasterCreativeDirection, MasterSceneConcept, MasterSceneGenerationMode, MasterSceneSpec, HookCreativeBrief, PlacementBox, ProductReferenceProfile } from "./types.ts";
import { matchBenchmarkPatterns } from "../creative/benchmarkPatternMatcher.ts";

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function union(left: PlacementBox, right: PlacementBox): PlacementBox {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  return {
    x,
    y,
    width: Math.max(left.x + left.width, right.x + right.width) - x,
    height: Math.max(left.y + left.height, right.y + right.height) - y,
  };
}

function conceptFor(master: MasterCreativeDirection, profile: ProductReferenceProfile): MasterSceneConcept {
  const variant = master.categoryVariant;
  if (/ingredient|origin|harvest|fresh/.test(variant)) return "ingredient-origin";
  if (/problem|function/.test(variant)) return "problem-solution";
  if (/offer|set/.test(variant)) return "price-impact";
  if (/usage|cooked|table|outfit/.test(variant)) return "usage-moment";
  if (profile.verifiedClaims.some((claim) => /후기|리뷰|평점/.test(claim))) return "review-trust";
  if (/editorial|detail|silhouette/.test(`${master.layoutFamily} ${variant}`)) return "premium-editorial";
  return "target-lifestyle";
}

function automaticMode(profile: ProductReferenceProfile, preference: "auto" | "actual-product" | "ai-full-scene"): MasterSceneGenerationMode {
  if (preference === "actual-product") return "protected-product-composite";
  if (preference === "ai-full-scene") return "reference-guided-full-scene";
  const hasStrongRealScene = profile.referenceImages.some((image) => image.usableForGeneration && image.importance >= 75 && ["lifestyle", "usage", "worn", "cooked"].includes(image.role));
  if (hasStrongRealScene) return "real-photo-adaptation";
  if (profile.referenceSufficiency !== "low") return "reference-guided-full-scene";
  return "protected-product-composite";
}

function benchmarkArchetype(master: MasterCreativeDirection, concept: MasterSceneConcept) {
  if (concept === "price-impact") return "price-event";
  if (concept === "review-trust" || master.layoutFamily === "chat-ugc") return "community-review";
  const byLayout: Record<MasterCreativeDirection["layoutFamily"], string> = {
    "problem-solution-split": "problem-solution",
    "editorial-story": "lifestyle-context",
    "chat-ugc": "community-review",
    "comparison-versus": "problem-solution",
    "product-hero-lifestyle": "product-hero",
    "proof-data": "numeric-proof",
  };
  return byLayout[master.layoutFamily] || "product-hero";
}

function sceneDirection(category: string, concept: MasterSceneConcept, variation: number) {
  const value = category.toLowerCase();
  const variant = Math.max(0, variation % 3);
  if (/육류|한우|고기|수산|생선/.test(value))
    return {
      environment: ["프리미엄 다이닝 조리대", "야외 그릴 테이블", "따뜻한 가정식 식탁"][variant],
      lighting: "따뜻한 측면 키라이트와 부드러운 필라이트, 음식 표면의 자연스러운 윤기",
      grounding: "원근이 보이는 그릴·팬·도마 또는 식기 표면",
      camera: "45도 상단 근접 상업 사진 구도",
      depth: "전경 질감은 선명하고 배경은 얕은 심도로 정리",
    };
  if (/농산|과일|채소/.test(value))
    return {
      environment: ["자연광이 드는 산지 포장 테이블", "깨끗한 주방 식탁", "수확 직후의 농장 작업대"][variant],
      lighting: "신선한 색을 유지하는 확산 자연광",
      grounding: "나무·패브릭·포장지의 실제 접촉면",
      camera: "상품 단면과 포장 구성이 함께 읽히는 35mm 구도",
      depth: "산지 분위기는 배경으로 두고 상품 질감을 전경에 유지",
    };
  if (/패션|의류|신발|가방/.test(value))
    return {
      environment: ["자연광의 미니멀 스튜디오", "도시 일상 착용 공간", "정돈된 에디토리얼 세트"][variant],
      lighting: "원단 질감과 실루엣을 살리는 큰 소프트박스 조명",
      grounding: "신체·행거·바닥과 자연스럽게 연결된 접촉면",
      camera: "왜곡이 적은 50mm 패션 에디토리얼 구도",
      depth: "핏이 읽히는 중간 심도와 정돈된 배경",
    };
  if (/화장|뷰티|샤워|바디|세정/.test(value))
    return {
      environment: ["물기와 타일이 있는 프리미엄 욕실", "성분을 연상시키는 젖은 아크릴 스튜디오", "운동 후 샤워 사용 맥락"][variant],
      lighting: "용기 가장자리와 물방울을 분리하는 차가운 키라이트와 부드러운 림라이트",
      grounding: "젖은 선반·세면대·손과 실제로 맞닿는 표면",
      camera: "제품 라벨 정면이 읽히는 낮은 시점의 상업 사진",
      depth: "제품은 선명하고 욕실·원료 단서는 얕은 심도로 제한",
    };
  if (/생활|수납|청소|리빙|가구/.test(value))
    return {
      environment: ["실제 사용 전후가 이해되는 정돈된 집", "기능을 보여주는 생활 공간", "미니멀 제품 데모 스튜디오"][variant],
      lighting: "제품 크기와 소재를 오해하지 않게 하는 균일한 자연광",
      grounding: "바닥·선반·벽과 실제 비례가 유지되는 접촉면",
      camera: "기능과 사용 위치가 함께 보이는 눈높이 구도",
      depth: "사용 맥락은 유지하되 제품 외곽을 분명하게 분리",
    };
  if (/식품|음료|간식|소스/.test(value))
    return {
      environment: ["내용물과 패키지가 함께 보이는 식탁", "먹는 순간을 연상시키는 주방", "재료 질감이 보이는 상업 촬영대"][variant],
      lighting: "내용물 색과 패키지 인쇄를 정확히 유지하는 부드러운 음식 사진 조명",
      grounding: "실제 접시·식탁·조리대 접촉면",
      camera: "패키지와 내용물 구성이 함께 읽히는 40도 제품 사진",
      depth: "제품과 내용물은 선명하고 배경은 광고 여백으로 정리",
    };
  return {
    environment: concept === "premium-editorial" ? "절제된 프리미엄 제품 스튜디오" : "실제 사용 맥락의 상업 사진 세트",
    lighting: "제품 형태와 재질을 정확히 읽을 수 있는 한 방향 키라이트와 소프트 필",
    grounding: "원근과 접촉 그림자가 분명한 실제 표면",
    camera: "왜곡이 적은 상업 제품 사진 구도",
    depth: "제품은 선명하고 배경은 광고 여백을 남기며 정리",
  };
}

export function planMasterScene(params: { productId: string; profile: ProductReferenceProfile; masterDesign: MasterCreativeDirection; generationModePreference?: "auto" | "actual-product" | "ai-full-scene"; aiBackgroundOnly?: boolean; aiFullCreative?: boolean; strategyVariation?: number; creativeBrief?: HookCreativeBrief }): MasterSceneSpec {
  const concept = conceptFor(params.masterDesign, params.profile);
  const strategyVariation = Math.max(0, Math.floor(params.strategyVariation || 0));
  const direction = sceneDirection(params.profile.category, concept, strategyVariation);
  const mode: MasterSceneGenerationMode = params.aiFullCreative ? "ai-reference-full-creative" : params.aiBackgroundOnly ? "ai-background-composite" : automaticMode(params.profile, params.generationModePreference || "auto");
  const referenceArchetype = benchmarkArchetype(params.masterDesign, concept);
  const benchmarkPatterns = matchBenchmarkPatterns({
    category: params.profile.category,
    archetypeId: referenceArchetype,
    limit: 3,
  });
  const usableReferences = params.profile.referenceImages
    .filter((image) => image.usableForGeneration && !image.duplicateOf)
    .sort((left, right) => right.importance - left.importance)
    .slice(0, 4);
  const copySafeZone = union(params.masterDesign.headlineBox, params.masterDesign.subCopyBox);
  const seed = JSON.stringify({
    profile: params.profile.id,
    master: params.masterDesign.designFingerprint,
    concept,
    mode,
    referenceArchetype,
    strategyVariation,
    creativeBrief: params.creativeBrief,
    references: usableReferences.map((image) => image.contentHash || image.url),
  });
  return {
    sceneId: `master-scene-${stableHash(seed)}`,
    productId: params.productId,
    category: params.profile.category,
    concept,
    generationMode: mode,
    productPlacement: {
      position: params.masterDesign.productPosition.x > 600 ? "center-right" : "center",
      scale: params.masterDesign.productScale,
      angle: strategyVariation % 2 ? "정면 기준 3~6도 자연스러운 회전" : "정면 중심",
      groundingSurface: direction.grounding,
    },
    lighting: params.creativeBrief?.lightingDirection ? `${params.creativeBrief.lightingDirection}. ${direction.lighting}` : direction.lighting,
    environment: params.creativeBrief ? `${params.creativeBrief.sceneDescription}. ${params.creativeBrief.visualStory}. ${direction.environment}` : direction.environment,
    colorDirection: [params.creativeBrief?.colorDirection, params.masterDesign.palette.background, params.masterDesign.palette.accent, params.masterDesign.palette.secondary].filter(Boolean).join(", "),
    cameraDirection: params.creativeBrief?.cameraDirection ? `${params.creativeBrief.cameraDirection}. ${direction.camera}` : direction.camera,
    depthDirection: direction.depth,
    copySafeZone,
    productSafeZone: params.masterDesign.productPosition,
    forbiddenElements: ["임의의 글자·숫자·가격·CTA·워터마크", "새 상품명·새 로고·새 라벨·새 인증마크", "확인되지 않은 구성품·색상·옵션", "제품이 떠 보이는 접촉면과 불일치한 그림자", ...(params.creativeBrief?.forbidPromotionalBannerCutouts ? ["판촉 배너·기존 광고 썸네일·문구가 박힌 참고 이미지를 배경처럼 잘라 붙이는 구성"] : []), ...(params.creativeBrief?.forbiddenElements || []), ...params.profile.visualIdentity.mustNotGenerate],
    referenceImageUrls: usableReferences.map((image) => image.url),
    referenceArchetype,
    benchmarkPatterns,
    designFingerprint: params.masterDesign.designFingerprint,
    strategyVariation,
  };
}
