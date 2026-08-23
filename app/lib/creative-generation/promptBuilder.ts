import type { MasterSceneSpec, ProductReferenceProfile } from "./types.ts";
import { buildBenchmarkQualityContract } from "../creative/benchmarkPatternMatcher.ts";

export const MASTER_SCENE_PROMPT_VERSION = "reference-master-scene-v1";
export const AI_BACKGROUND_PROMPT_VERSION = "ai-hook-background-v2-quality-benchmark";
export const AI_FULL_CREATIVE_PROMPT_VERSION = "ai-reference-full-creative-v2-quality-benchmark";

function list(values: string[]) {
  return values.filter(Boolean).join("; ");
}

function roleNotes(profile: ProductReferenceProfile, spec: MasterSceneSpec) {
  const purpose: Record<string, string> = {
    "primary-product": "제품 정면, 실루엣, 실제 판매 상품 정체성 기준",
    "front-package": "패키지 형태, 대표 색상, 라벨·로고 위치 기준",
    "side-package": "제품 깊이와 측면 구조 기준",
    "back-package": "후면 구조와 용기 비율 참고",
    "product-detail": "고유 디테일과 구성 확인 기준",
    texture: "실제 내용물·재질·표면 질감 기준",
    lifestyle: "실제 연출과 사용 환경 기준",
    usage: "실제 사용 방법과 접촉 관계 기준",
    worn: "실제 착용 핏·길이·원단 기준",
    cooked: "실제 조리 상태·부위·표면 질감 기준",
    ingredient: "확인된 원료의 색과 형태 참고",
    "size-reference": "실제 크기와 비례 기준",
    option: "선택된 실제 옵션 기준",
    "brand-logo": "브랜드 색상과 로고 위치 기준",
    unknown: "상세페이지 보조 시각 참고",
  };
  return spec.referenceImageUrls.map((url, index) => {
    const reference = profile.referenceImages.find((image) => image.url === url);
    return `reference ${index + 1}: ${purpose[reference?.role || "unknown"]} (${reference?.description || url})`;
  });
}

export function buildMasterScenePrompt(profile: ProductReferenceProfile, spec: MasterSceneSpec, options: { retryFailures?: string[] } = {}) {
  const immutable = Object.entries(profile.immutableFacts)
    .filter(([, value]) => value !== undefined && (!Array.isArray(value) || value.length))
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`);
  const adaptation = spec.generationMode === "real-photo-adaptation" ? "첫 번째 실제 사용·착용·조리·연출 사진을 기반으로 배경을 자연스럽게 확장하고 광고 구도와 여백만 조정하라. 사진 속 실제 제품의 핵심 특징은 바꾸지 마라." : "레퍼런스에 있는 동일 제품이 실제 상업 촬영 현장에 놓인 것처럼 제품을 포함한 전체 장면을 새로 구성하라.";
  return [
    "Create one photorealistic, text-free, 1:1 commercial advertising master visual for Korean performance advertising.",
    "첨부된 제품 이미지는 생성할 상품의 실제 레퍼런스다. 새로운 상품을 디자인하지 말고 동일한 상품이 실제 촬영 현장에 놓인 것처럼 표현하라. 제품의 형태, 비율, 대표 색상, 패키지 구조, 로고 위치, 구성 수량과 고유 특징을 유지하라.",
    adaptation,
    `상품: ${profile.productName}. 브랜드: ${profile.brandName || "확인된 브랜드 정보 없음"}. 카테고리: ${profile.category}.`,
    immutable.length ? `확인된 불변 사실: ${immutable.join("; ")}.` : "확인된 시각 레퍼런스만 사용하라.",
    `반드시 보존: ${list(profile.visualIdentity.mustPreserve)}.`,
    `생성 금지: ${list(profile.visualIdentity.mustNotGenerate)}.`,
    ...roleNotes(profile, spec),
    `광고 컨셉: ${spec.concept}. 환경: ${spec.environment}. 조명: ${spec.lighting}. 카메라: ${spec.cameraDirection}. 심도: ${spec.depthDirection}. 컬러 방향: ${spec.colorDirection}.`,
    `제품 배치: ${spec.productPlacement.position}, ${spec.productPlacement.angle}, 실제 접촉면: ${spec.productPlacement.groundingSurface}. 제품 안전 영역은 1200 기준 x=${spec.productSafeZone.x}, y=${spec.productSafeZone.y}, width=${spec.productSafeZone.width}, height=${spec.productSafeZone.height}.`,
    `카피 안전 영역은 1200 기준 x=${spec.copySafeZone.x}, y=${spec.copySafeZone.y}, width=${spec.copySafeZone.width}, height=${spec.copySafeZone.height}이며 낮은 디테일과 충분한 명암 여백을 유지하라.`,
    "상세페이지에서 확인되지 않은 문구, 인증마크, 원산지, 등급, 효능, 용량, 할인율, 가격, 후기 수를 새로 만들지 마라.",
    "광고 문구와 가격 텍스트는 후처리로 삽입하므로 배경 또는 빈 공간에 임의의 글자, 숫자, 로고, 워터마크를 생성하지 마라.",
    "제품이 바닥·테이블·피부·신체·공간과 자연스럽게 접촉하도록 그림자, 반사, 원근, 조명 방향을 일치시켜라.",
    "제품을 장면의 핵심 주제로 유지하되 카피가 들어갈 명확한 여백을 확보하라.",
    `추가 금지 요소: ${list(spec.forbiddenElements)}.`,
    options.retryFailures?.length ? `이전 후보의 실패 원인을 수정하라: ${options.retryFailures.join("; ")}` : "",
    "OUTPUT CONTRACT: one edge-to-edge opaque master visual, no typography, no letters, no numbers, no price, no CTA, no badge, no caption, no watermark. Do not invent a new product or a new brand.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildAiBackgroundPrompt(profile: ProductReferenceProfile, spec: MasterSceneSpec, options: { retryFailures?: string[] } = {}) {
  const qualityContract = buildBenchmarkQualityContract();
  return [
    "Create one premium, photorealistic, text-free square advertising BACKGROUND PLATE for a Korean performance ad.",
    "This is a finished commercial art-directed scene, not a generic stock photo and not a simple gradient backdrop.",
    `Product context: ${profile.productName}. Brand mood: ${profile.brandName || "brand-safe commercial"}. Category: ${profile.category}.`,
    `Hook-specific visual story: ${spec.environment}. Concept: ${spec.concept}.`,
    `Reference composition archetype: ${spec.referenceArchetype || "product-hero"}. Reusable benchmark patterns: ${(spec.benchmarkPatterns || []).join("; ") || "one dominant focal story; quiet copy surface; category-specific scene"}.`,
    `Approved-reference quality contract (principles only, never copy): ${qualityContract.join(" ")}`,
    "Choose a fresh composition for this product and hook. Reach comparable polish through hierarchy, scale, material realism, purposeful contrast, lighting and finish—not by imitating a reference image.",
    `Lighting: ${spec.lighting}. Camera: ${spec.cameraDirection}. Depth: ${spec.depthDirection}. Color direction: ${spec.colorDirection}.`,
    `Reserve an intentional empty photographed product stage at 1200-grid x=${spec.productSafeZone.x}, y=${spec.productSafeZone.y}, width=${spec.productSafeZone.width}, height=${spec.productSafeZone.height}. The stage needs coherent perspective, contact surface, local light and enough contrast for a real product cutout to be composited later.`,
    `Reserve a lower-detail copy area at 1200-grid x=${spec.copySafeZone.x}, y=${spec.copySafeZone.y}, width=${spec.copySafeZone.width}, height=${spec.copySafeZone.height}.`,
    "Use scene depth, foreground details, water, foam, ingredients, human context or motion only when they directly prove the hook. Keep the reserved product stage unobstructed.",
    "Do not create any product, package, bottle, tube, label, logo, badge, price, letters, numbers, watermark, UI screenshot or isolated hero object. The real verified product and all Korean copy are added after generation.",
    "Fill every pixel and all four corners with one continuous opaque environment. Avoid black empty fields, flat color placeholders, cutout holes and template-looking panels.",
    `Additional forbidden elements: ${list(spec.forbiddenElements)}.`,
    options.retryFailures?.length ? `Repair all previous quality failures: ${options.retryFailures.join("; ")}.` : "",
    "Quality target: agency-ready ecommerce key visual, believable material detail, intentional art direction, clean separation between copy zone and product stage, suitable for an advertiser meeting.",
    "OUTPUT CONTRACT: exactly one edge-to-edge opaque 1:1 background plate with no typography and no sold product.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildAiFullCreativePrompt(profile: ProductReferenceProfile, spec: MasterSceneSpec, options: { retryFailures?: string[] } = {}) {
  const qualityContract = buildBenchmarkQualityContract();
  return [
    "Create one finished, premium, photorealistic square advertising KEY VISUAL for a Korean performance ad.",
    "The attached images are authoritative product-page references. Use the first image as the exact sold product identity reference and the remaining images for verified shape, package, material, usage, ingredient and lifestyle context.",
    `Product: ${profile.productName}. Brand: ${profile.brandName || "use only the brand visible in the references"}. Category: ${profile.category}.`,
    `Hook-specific visual story: ${spec.environment}. Concept: ${spec.concept}.`,
    `Reference composition archetype: ${spec.referenceArchetype || "product-hero"}. Proven benchmark patterns: ${(spec.benchmarkPatterns || []).join("; ") || "dominant product hero; one visual story; quiet copy area"}.`,
    `Approved-reference quality contract (principles only, never copy): ${qualityContract.join(" ")}`,
    "Design a fresh hook-specific scene for this verified product. Match the benchmark's level of polish through hierarchy, product scale, material realism, purposeful contrast, lighting and finish—not its exact composition or visual identity.",
    `Art direction — lighting: ${spec.lighting}. Camera: ${spec.cameraDirection}. Depth: ${spec.depthDirection}. Color: ${spec.colorDirection}.`,
    `The real sold product must be the unmistakable hero around the 1200-grid zone x=${spec.productSafeZone.x}, y=${spec.productSafeZone.y}, width=${spec.productSafeZone.width}, height=${spec.productSafeZone.height}. Preserve its product type, silhouette, proportions, package structure, count, cap, label placement, dominant colors and signature details.`,
    `Mandatory identity details: ${list(profile.visualIdentity.mustPreserve)}.`,
    `Never invent: ${list(profile.visualIdentity.mustNotGenerate)}.`,
    "Integrate the product naturally into the complete scene with coherent hands or usage context, contact shadow, reflections, water, foam, motion, ingredients and depth only when they support the hook. The result must look like an art-directed campaign key visual, not a pasted cutout and not a template.",
    `Reserve a visually quiet copy zone at 1200-grid x=${spec.copySafeZone.x}, y=${spec.copySafeZone.y}, width=${spec.copySafeZone.width}, height=${spec.copySafeZone.height}. Keep the product and important faces outside this area.`,
    "Do not add advertising headline, Korean copy, price, discount, CTA, badge, graph, review count, watermark or extra brand logo. Exact Korean typography, verified price and the original logo are added after generation.",
    "Text that is physically printed on the actual product package may remain only as part of the referenced product identity. Do not redesign, rewrite or hallucinate the package label.",
    `Additional forbidden elements: ${list(spec.forbiddenElements)}.`,
    options.retryFailures?.length ? `Regenerate and repair every previous failure: ${options.retryFailures.join("; ")}.` : "",
    "Quality target: advertiser-meeting-ready campaign key visual, polished commercial photography, intentional hierarchy, product hero occupying approximately 35–60% of the useful visual area, believable materials and no generic stock-photo look.",
    "OUTPUT CONTRACT: one edge-to-edge opaque 1:1 finished key visual, with the referenced sold product integrated into the scene, but no added advertising typography.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
