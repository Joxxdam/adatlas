import type { GenerationJob, GenerationResult } from "./types";
import type { AdvertiserBrandMemory } from "./codexRegistry.server";
import { performanceTemplateRegistry } from "./performanceTemplateRegistry.ts";

export const NATIVE_FINAL_PROMPT_VERSION = "text-free-scene-v1-local-composition";

/** Backward-compatible name: providers now create only a text-free scene plate. */
export function buildNativeFinalCreativePrompt(
  job: GenerationJob,
  result: GenerationResult,
  outputPath: string,
  feedback?: string,
  brandMemory?: AdvertiserBrandMemory
) {
  const brief = result.hookPlan.creativeBrief;
  const template = performanceTemplateRegistry.find((item) => item.id === result.hookPlan.performanceTemplateId);
  const category = job.creativePlan?.categoryCreativeProfile;
  const reusableTraits = (brandMemory?.goldenReferences || [])
    .flatMap((reference) => reference.reusableStyleTraits || [])
    .map((trait) => trait.trim())
    .filter(Boolean)
    .slice(-6);
  const hasReviewEvidence = job.productTruth.facts.some((fact) =>
    fact.usableInCopy && fact.verification !== "unverified" && /review|후기|평점/u.test(`${fact.key} ${fact.label} ${fact.evidenceType || ""}`)
  );
  return `Use the image generation skill to create one commercially polished, text-free square advertising scene plate.

OUTPUT
- Save exactly one raster image to: ${outputPath}
- Square 1:1 composition, suitable for a 1200 x 1200 final export.
- Generate only the environment, people, hands, ingredients, props, lighting and atmosphere.
- Reserve deliberate negative space for the later headline, supporting copy, price module and original product cutout.

ABSOLUTE EXCLUSIONS
- No product package, bottle, box, pouch, tray or branded sales unit.
- No letters, Korean text, English text, numbers, price, discount, CTA, logo, watermark, label, sign, UI or caption.
- No fake packaging and no imitation of the source product.
- No baked-in border, ad card, mockup frame or poster typography.
- 확인되지 않은 효능·가격·구성·후기·수치를 이미지나 장면 소품으로 암시하지 말 것.
- 실제 후기 근거 존재: ${hasReviewEvidence ? "예" : "아니오"}.
${hasReviewEvidence ? "" : "- 후기 문장, 댓글, 닉네임, 별점, 댓글 수, 커뮤니티 캡처를 생성하지 말 것."}

ART DIRECTION
- Category: ${category?.category || job.productTruth.product.category || "general consumer product"}
- Template grammar: ${template?.label || "product hero"}; zones: ${template?.zones.join(", ") || "headline and product safe zones"}
- Customer tension: ${brief?.customerSituation || brief?.customerInsight || result.hookPlan.hypothesis}
- Scene intent: ${brief?.sceneDescription || result.scenePlan.sceneAsset.scene}
- Visual story: ${brief?.visualStory || result.hookPlan.sceneIntent}
- Human role: ${brief?.humanRole || "Only include a natural person or hand when it communicates the use moment."}
- Camera: ${brief?.cameraAngle || brief?.cameraDirection || "commercial editorial camera, natural perspective"}
- Lighting: ${brief?.lighting || brief?.lightingDirection || "premium commercial lighting"}
- Mood and palette: ${brief?.colorPalette || brief?.colorDirection || "high contrast and category appropriate"}
- Product safe area: keep the intended hero area visually calm and unobstructed so an original product cutout can be placed later.
- Copy safe area: keep the intended headline side readable with simple contrast and low visual noise.
- Make this scene clearly different from the other five hook scenes in setting, camera, human action and dominant color.
${reusableTraits.length ? `- Approved abstract style traits only: ${reusableTraits.join("; ")}` : ""}
- 골든 레퍼런스의 메인/서브 문구를 현재 광고에 쓰지 않는다.

QUALITY
- Photorealistic unless the selected grammar explicitly calls for a crafted illustration.
- Natural anatomy, hands, food texture, bathroom surfaces and shadows.
- Client-meeting-ready Korean performance-ad visual quality, while remaining completely text-free.
${feedback ? `\nREVISION DIRECTION\n${feedback}\nChange the scene itself while keeping it text-free and product-free.` : ""}`;
}

/** Retained only for explicit diagnostic tools; fast generation never calls per-image AI QA. */
export function buildNativeValidationPrompt(job: GenerationJob, result: GenerationResult) {
  return `Inspect this advertising scene for decode quality, natural anatomy, category fit and usable empty space. Product: ${job.productTruth.product.productName}. Intended scene: ${result.hookPlan.creativeBrief?.sceneDescription || result.hookPlan.sceneIntent}. Return the configured JSON schema.`;
}

/** Retained for the opt-in group QA switch. It is off by default. */
export function buildNativeGroupValidationPrompt(job: GenerationJob) {
  const hooks = job.results.map((result) => ({
    hookCode: result.hookPlan.hookCode,
    intendedScene: result.hookPlan.creativeBrief?.sceneDescription || result.hookPlan.sceneIntent,
  }));
  return `Compare the six scene plates for meaningful diversity in environment, camera, product-safe area, palette and human action. 문구만 다르고 배경·제품 배치가 사실상 같으면 실패로 판정한다. ${JSON.stringify(hooks)}`;
}
