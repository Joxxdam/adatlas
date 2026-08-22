import type { GenerationJob, GenerationResult } from "./types";
import type { AdvertiserBrandMemory } from "./codexRegistry.server";
import { buildAdaptiveLayoutPlan, referenceCreativeGrammars } from "./referenceCreativeGrammar.ts";

export const NATIVE_FINAL_PROMPT_VERSION = "ai-native-complete-ad-v3-reference-grammar";

function verifiedFacts(job: GenerationJob, result: GenerationResult) {
  const selected = new Set(result.hookPlan.factIds || []);
  return job.productTruth.facts
    .filter((fact) => fact.usableInCopy && fact.verification !== "unverified")
    .filter((fact) => !selected.size || selected.has(fact.id))
    .slice(0, 8)
    .map((fact) => `${fact.label}: ${fact.value}`);
}

function hasVerifiedReviewEvidence(job: GenerationJob, result: GenerationResult) {
  const selected = new Set(result.hookPlan.factIds || []);
  return job.productTruth.facts.some((fact) =>
    fact.evidenceType === "review" &&
    fact.usableInCopy &&
    fact.verification !== "unverified" &&
    (!selected.size || selected.has(fact.id))
  );
}

/** Native generation creates the complete advertisement, never a background plate. */
export function buildNativeFinalCreativePrompt(
  job: GenerationJob,
  result: GenerationResult,
  outputPath: string,
  feedback?: string,
  brandMemory?: AdvertiserBrandMemory
) {
  const brief = result.hookPlan.creativeBrief;
  const layout = buildAdaptiveLayoutPlan({ truth: job.productTruth, result, groupResults: job.results });
  const grammar = referenceCreativeGrammars.find((item) => item.id === layout.grammarId);
  const category = job.creativePlan?.categoryCreativeProfile;
  const reusableTraits = (brandMemory?.goldenReferences || [])
    .flatMap((reference) => reference.reusableStyleTraits || [])
    .map((trait) => trait.trim())
    .filter(Boolean)
    .slice(-6);
  const facts = verifiedFacts(job, result);
  const verifiedReviewEvidence = hasVerifiedReviewEvidence(job, result);
  const exactCopy = [
    `MAIN HOOK: ${result.hookPlan.headline}`,
    result.hookPlan.body ? `SUB COPY: ${result.hookPlan.body}` : "",
    result.hookPlan.proof ? `PROOF: ${result.hookPlan.proof}` : "",
    result.hookPlan.offer ? `OFFER: ${result.hookPlan.offer}` : "",
    result.hookPlan.cta ? `CTA: ${result.hookPlan.cta}` : "",
  ].filter(Boolean).join("\n");

  return `Use the image generation skill to create ONE FINAL, COMPLETE, READY-TO-RUN Korean square performance advertisement.

NON-NEGOTIABLE OUTPUT
- Save exactly one raster image to: ${outputPath}
- Square 1:1 composition for a final 1200 x 1200 export.
- The generated raster itself must already contain the real product depiction, hook-specific scene, exact Korean advertising copy, typography, graphic emphasis and verified offer/CTA.
- This is NOT a background plate. Do not reserve an empty product slot or copy-safe placeholder for later compositing.
- No template renderer, cutout overlay, SVG text layer, canvas text layer or post-render copy panel will be added after generation.

AUTHORITATIVE PRODUCT REFERENCE
- The FIRST attached product-page image is the authoritative product identity and sales unit.
- Faithfully preserve the product's package geometry, dominant colors, label hierarchy, logo placement, material, count and recognizable silhouette.
- Integrate the product naturally into the hook-specific scene with coherent perspective, contact shadow, lighting and scale. It must not look like a floating cutout pasted over a stock background.
- Additional attached product-page images are evidence for texture, use, ingredients, context and alternate views. They are not ads to copy.
- Never copy old reference-ad wording, prices, badges, logos or layouts. Never place an ad screenshot, poster fragment or a second pre-made ad inside the new ad.
- Repeat or overlap the same product only when the verified composition and this hook genuinely need quantity/lineup emphasis. Otherwise use one dominant product hero.

EXACT KOREAN COPY TO RENDER
${exactCopy}

COPY RULES
- Render the exact strings above in Korean; do not translate, paraphrase, duplicate or invent extra claims.
- Main hook: dominant 1-2 lines, immediately readable on mobile. Sub copy/proof: at most 1-2 compact supporting lines.
- Offer and price may appear only when supplied above. Never invent discounts, review counts, ratings, temperature changes, efficacy figures, origin, grade, quantity, urgency or endorsements.
- Prefer fewer, larger text groups. Do not cover the scene with a giant pale/white translucent UI panel.
- Do not create tiny disclaimer walls, broken Hangul, random glyphs, repeated characters or fake interface controls.
- If the exact text is difficult to fit, simplify the scene and decoration rather than changing the text.
- 확인되지 않은 효능·가격·구성·후기·수치 근거는 생성 프롬프트와 이미지에 사용하지 않는다.
- 실제 후기 근거 존재: ${verifiedReviewEvidence ? "예. 위의 검증된 사실과 정확한 광고 문구 범위 안에서만 사용할 것." : "아니오. 후기 문장, 댓글, 닉네임, 별점, 댓글 수, 커뮤니티 캡처를 생성하지 말 것."}

REFERENCE-DERIVED PERFORMANCE-AD GRAMMAR
- The supplied quality references were analyzed for reusable principles, not for 1:1 imitation.
- One dominant visual story per card: product/food/use moment should occupy roughly 45-70% of the visual attention.
- Clear hierarchy: hook first, product/use proof second, verified offer or CTA third. Keep secondary decoration restrained.
- Use strong contrast and one category/brand accent plus at most one urgency color.
- A scene must prove the hook: price hooks show the verified sales unit/value; sensory hooks show texture, water, foam, steam, marbling or motion; situation hooks show the actual customer moment; evidence hooks connect one verified fact to the product; reversal hooks create a clean objection/payoff tension.
- 국대한우·육류: natural marbling and food color, appetizing raw/cooked detail, grill/table/serving action or verified pack composition; never plastic-looking meat or an unrelated cut.
- 오리지널소스·퍼스널케어: package label remains recognizable; use water, foam, mint/citrus ingredients, post-workout/shower/customer-tension scenes only when they support this hook; do not repeat the same ice background across hooks.
- Client-meeting-ready finish: clean edges, natural hands/anatomy, credible food and surface texture, intentional typography, balanced negative space, no accidental overlaps or clipping.

HOOK-SPECIFIC ART DIRECTION
- Hook: ${result.hookPlan.hookCode} / ${grammar?.label || layout.grammarId}
- Hook logic: ${grammar?.hookPattern || result.hookPlan.hypothesis}
- Product: ${job.productTruth.normalized.cleanProductName || job.productTruth.product.productName}
- Category: ${category?.label || category?.category || job.productTruth.product.category || "general consumer product"}
- Verified facts: ${facts.length ? facts.join("; ") : "Only the supplied copy and visually confirmed product identity may be used."}
- Customer tension: ${brief?.customerSituation || brief?.customerInsight || result.hookPlan.hypothesis}
- Visual story: ${brief?.visualStory || result.hookPlan.sceneIntent}
- Scene: ${brief?.sceneDescription || result.scenePlan.sceneAsset.scene}
- Human role: ${brief?.humanRole || "Include a person or hand only when it explains the use moment."}
- Camera: ${brief?.cameraAngle || brief?.cameraDirection || "commercial editorial camera with natural perspective"}
- Lighting: ${brief?.lighting || brief?.lightingDirection || "premium commercial lighting"}
- Mood/palette: ${brief?.colorPalette || brief?.colorDirection || grammar?.preferredPalettes.join(", ") || "category appropriate high contrast"}
- Semantic composition: headline ${layout.copyAnchor}; product ${layout.productAnchor}; visual scale ${layout.productScale}; motif ${layout.graphicMotif}; scene ${layout.sceneAnchor}. Treat this as art direction, not fixed coordinates.
- Make this card meaningfully different from the other five in setting, camera distance, human action, dominant color, product role and typography rhythm. Do not merely swap the wording.
${category?.avoidList?.length ? `- Category exclusions: ${category.avoidList.join("; ")}` : ""}
${reusableTraits.length ? `- Approved abstract style traits only: ${reusableTraits.join("; ")}` : ""}
- 과거 골든 레퍼런스의 메인/서브 문구를 현재 광고에 쓰지 않는다. 승인된 추상 스타일 특성만 참고한다.

ABSOLUTE EXCLUSIONS
- No text-free background, blank template, mockup frame, safe-zone guide or placeholder card.
- No locally composited-looking product, detached drop shadow, duplicated label, fake packaging, deformed logo or changed sales unit.
- No huge white copy sheet covering the central product/scene, no receipt roll unless the verified hook specifically requires a price-receipt visual, and no prior-ad fragments.
- No unsupported scientific dashboard, thermal image, review screenshot, chat identity or rating graphic.

${feedback ? `REVISION DIRECTION\n${feedback}\nRegenerate the ENTIRE final advertisement. Do not patch only the background or overlay only the copy.` : ""}`;
}

export function buildNativeValidationPrompt(job: GenerationJob, result: GenerationResult) {
  return `Inspect the attached COMPLETE Korean performance advertisement against the attached authoritative product reference images.
Product: ${job.productTruth.normalized.cleanProductName || job.productTruth.product.productName}
Required main hook: ${result.hookPlan.headline}
Required sub copy: ${result.hookPlan.body}
Required offer: ${result.hookPlan.offer || "none"}
Required CTA: ${result.hookPlan.cta || "none"}
Intended scene: ${result.hookPlan.creativeBrief?.sceneDescription || result.hookPlan.sceneIntent}
Check product/package identity, exact Korean copy, factual safety, mobile readability, hook-scene alignment, natural anatomy/food texture, and whether this is one coherent finished ad rather than a background plus pasted product/text panel. A giant translucent copy panel, detached cutout, prior-ad fragment, fake label, broken Hangul or invented claim requires revise. Return the configured JSON schema.`;
}

export function buildNativeGroupValidationPrompt(job: GenerationJob) {
  const hooks = job.results.map((result) => ({
    hookCode: result.hookPlan.hookCode,
    mainHook: result.hookPlan.headline,
    grammar: result.hookPlan.creativeGrammarId,
    intendedScene: result.hookPlan.creativeBrief?.sceneDescription || result.hookPlan.sceneIntent,
  }));
  return `Compare the six COMPLETE advertisements for meaningful diversity in hook, scene, product role, camera, palette, typography and customer story. 문구만 다르고 배경·제품 배치가 사실상 같으면 실패로 판정한다. 이전 광고 조각을 재사용한 경우, 또는 배경 위에 상품·큰 문구 패널을 붙인 것처럼 보이는 경우에도 실패로 판정한다. ${JSON.stringify(hooks)}`;
}
