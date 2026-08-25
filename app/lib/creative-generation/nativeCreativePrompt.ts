import type { GenerationJob, GenerationResult } from "./types";
import type { AdvertiserBrandMemory } from "./codexRegistry.server";
import type { NativeCreativeGenerationStage } from "./providers/CreativeGenerationProvider.ts";
import { buildAdaptiveLayoutPlan, referenceCreativeGrammars } from "./referenceCreativeGrammar.ts";
import { productRenderingPromptContract, resolveProductRenderingPolicy } from "./productRenderingPolicy.ts";

export const NATIVE_FINAL_PROMPT_VERSION = "reference-native-copy-v8-human-meat-realism";

function materialLabel(result: GenerationResult) {
  return `소재 ${String(result.order).padStart(2, "0")}`;
}

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
  return job.productTruth.facts.some((fact) => fact.evidenceType === "review" && fact.usableInCopy && fact.verification !== "unverified" && (!selected.size || selected.has(fact.id)));
}

function humanReferenceIdentityContract() {
  return `HUMAN REFERENCE IDENTITY POLICY
- When the selected advertisement reference contains a person, preserve only the person's compositional function: approximate position, body pose, gaze direction, action, framing, lighting and product interaction.
- Replace that source person with a clearly different fictional adult. Change facial structure, eyes, nose, mouth, hairstyle, hair color or texture, wardrobe details and accessories together; a minor face retouch is not enough.
- Never reproduce, identify or preserve the source person's recognizable face or biometric likeness. The result should feel like the same art direction photographed with a different model.
- Keep anatomy, hands, product grip, occlusion, perspective and contact physically natural. Do not change the macro layout merely to change identity.
- When the source reference has no person, do not add one unless the inherited composition and verified usage story clearly require it.`;
}

/** Native generation creates the complete advertisement, never a background plate. */
export function buildNativeFinalCreativePrompt(job: GenerationJob, result: GenerationResult, outputPath: string, feedback?: string, brandMemory?: AdvertiserBrandMemory) {
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
  const productContract = productRenderingPromptContract(job, result);
  const humanContract = humanReferenceIdentityContract();
  const exactCopy = [`MAIN COPY: ${result.hookPlan.headline}`, result.hookPlan.body ? `SUB COPY: ${result.hookPlan.body}` : "", result.hookPlan.proof ? `PROOF: ${result.hookPlan.proof}` : "", result.hookPlan.offer ? `OFFER: ${result.hookPlan.offer}` : "", result.hookPlan.cta ? `CTA: ${result.hookPlan.cta}` : ""].filter(Boolean).join("\n");

  return `Use the image generation skill to create ONE FINAL, COMPLETE, READY-TO-RUN Korean square performance advertisement.

NON-NEGOTIABLE OUTPUT
- Save exactly one raster image to: ${outputPath}
- Square 1:1 composition for a final 1200 x 1200 export.
- The generated raster itself must already contain the real product depiction, hook-specific scene, exact Korean advertising copy, typography, graphic emphasis and verified offer/CTA.
- This is NOT a background plate. Do not reserve an empty product slot or copy-safe placeholder for later compositing.
- No template renderer, SVG text layer, canvas text layer, product cutout or post-render copy panel will be added after generation.
- URL product images are authoritative AI references only. No source-product pixels will be extracted, cut out, pasted or restored after generation.

AUTHORITATIVE PRODUCT REFERENCE
- The FIRST attached product-page image is the authoritative product identity and sales unit.
- Faithfully preserve the product's package geometry, dominant colors, label hierarchy, logo placement, material, count and recognizable silhouette.
- Integrate the product naturally into the hook-specific scene with coherent perspective, contact shadow, lighting and scale. It must not look like a floating cutout pasted over a stock background.
- Additional attached product-page images are evidence for texture, use, ingredients, context and alternate views. They are not ads to copy.
- The selected reference advertisement's composition and non-product/non-copy pixels are locked. Its source product and source advertiser identity must be replaced, not retained.
- Repeat or overlap the same product only when the verified composition and this hook genuinely need quantity/lineup emphasis. Otherwise use one dominant product hero.

${productContract}

${humanContract}

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

REFERENCE-PRESERVING PERFORMANCE-AD EDIT
- The selected quality reference is the source raster to preserve, not an abstract style suggestion.
- One dominant visual story per card: product/food/use moment should occupy roughly 45-70% of the visual attention.
- Clear hierarchy: hook first, product/use proof second, verified offer or CTA third. Keep secondary decoration restrained.
- Use strong contrast and one category/brand accent plus at most one urgency color.
- A scene must prove the hook: price hooks show the verified sales unit/value; sensory hooks show texture, water, foam, steam, marbling or motion; situation hooks show the actual customer moment; evidence hooks connect one verified fact to the product; reversal hooks create a clean objection/payoff tension.
- 국대한우·육류: natural marbling and food color, appetizing raw/cooked detail, grill/table/serving action or verified pack composition; never plastic-looking meat or an unrelated cut.
- 오리지널소스·퍼스널케어: package label remains recognizable; use water, foam, mint/citrus ingredients, post-workout/shower/customer-tension scenes only when they support this hook; do not repeat the same ice background across hooks.
- Client-meeting-ready finish: clean edges, natural hands/anatomy, credible food and surface texture, intentional typography, balanced negative space, no accidental overlaps or clipping.

REFERENCE-ADAPTED MATERIAL DIRECTION
- Material: ${materialLabel(result)}
- Reference copy structure: ${result.referenceAdaptedCopyPlan?.referenceCopyProfileId || result.nativeCreative?.adReference?.layoutFamily || grammar?.label || layout.grammarId}
- Product: ${job.productTruth.normalized.cleanProductName || job.productTruth.product.productName}
- Category: ${category?.label || category?.category || job.productTruth.product.category || "general consumer product"}
- Verified facts: ${facts.length ? facts.join("; ") : "Only the supplied copy and visually confirmed product identity may be used."}
- Copy tone: ${result.referenceAdaptedCopyPlan?.tone || "match the selected reference's rhythm without copying its literal wording"}
- Visual structure: preserve the selected reference's macro layout and product-slot grammar.
- Scene: ${brief?.sceneDescription || result.scenePlan.sceneAsset.scene}
- Human role: ${brief?.humanRole || "Include a person or hand only when it explains the use moment."}
- Camera: ${brief?.cameraAngle || brief?.cameraDirection || "commercial editorial camera with natural perspective"}
- Lighting: ${brief?.lighting || brief?.lightingDirection || "premium commercial lighting"}
- Mood/palette: ${brief?.colorPalette || brief?.colorDirection || grammar?.preferredPalettes.join(", ") || "category appropriate high contrast"}
- Semantic composition: headline ${layout.copyAnchor}; product ${layout.productAnchor}; visual scale ${layout.productScale}; motif ${layout.graphicMotif}; scene ${layout.sceneAnchor}. Treat this as art direction, not fixed coordinates.
- This card is an independent finished material assigned to its own reference. Do not force a separate hook concept that conflicts with the reference.
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

/**
 * Builds one explicit edit instruction for the staged native-AI pipeline.
 * Each stage produces a complete raster that becomes the first source image of
 * the next stage. Product-page images are AI references only; neither product
 * pixels nor text are overlaid, restored or composited locally afterward.
 */
export function buildNativeStagePrompt(stage: NativeCreativeGenerationStage, job: GenerationJob, result: GenerationResult, outputPath: string, feedback?: string, brandMemory?: AdvertiserBrandMemory) {
  const productName = job.productTruth.normalized.cleanProductName || job.productTruth.product.productName;
  const facts = verifiedFacts(job, result);
  const productPolicy = resolveProductRenderingPolicy(job);
  const productContract = productRenderingPromptContract(job, result);
  const humanContract = humanReferenceIdentityContract();
  const referenceRawCopy = result.referenceAdaptedCopyPlan?.referenceRawCopy || result.nativeCreative?.adReference?.nativeCopy?.rawText || "";
  const referenceRawLines = result.referenceAdaptedCopyPlan?.referenceRawLines || result.nativeCreative?.adReference?.nativeCopy?.rawLines || [];
  const adaptedLines = result.referenceAdaptedCopyPlan?.adaptedLines || [result.hookPlan.headline, result.hookPlan.body, result.hookPlan.proof, result.hookPlan.offer, result.hookPlan.cta].filter(Boolean);
  const copySlotContract = result.referenceAdaptedCopyPlan?.copySlots?.length
    ? result.referenceAdaptedCopyPlan.copySlots
        .map((slot) => `${slot.index + 1}. [${slot.role}/${slot.emphasis}] ${slot.sourceText.trim() ? JSON.stringify(slot.sourceText) : "[read the visually corresponding source zone directly from the reference]"} → ${JSON.stringify(slot.targetText)}`)
        .join("\n")
    : referenceRawLines.map((line, index) => `${index + 1}. [원본 역할 유지] ${JSON.stringify(line)} → ${JSON.stringify(adaptedLines[index] || "")}`).join("\n");
  const exactCopy = [
    `줄별 최종 문구(JSON 배열, 각 원소가 한 줄): ${JSON.stringify(adaptedLines)}`,
    `메인 문구: ${result.hookPlan.headline}`,
    result.hookPlan.body ? `서브 문구: ${result.hookPlan.body}` : "",
    result.hookPlan.proof ? `근거 문구: ${result.hookPlan.proof}` : "",
    result.hookPlan.offer ? `가격·혜택: ${result.hookPlan.offer}` : "",
    result.hookPlan.cta ? `CTA: ${result.hookPlan.cta}` : "",
  ].filter(Boolean).join("\n");
  const shared = `
OUTPUT CONTRACT
- Use the image generation skill to EDIT or CREATE exactly one complete square raster and save it to: ${outputPath}
- Work on the full raster with AI. Do not return a background plate, blank template, SVG, HTML, Canvas instructions or a plan.
- Final composition target is a Korean performance advertisement for ${productName}, exported later as 1200x1200 JPEG.
- Never invent price, discount, origin, grade, quantity, review, efficacy, certification or urgency. Verified facts: ${facts.length ? facts.join("; ") : "none beyond the supplied copy and visible product identity"}.
- Keep all important content inside a generous square safe area. No clipping, broken anatomy, fake UI, illegible Hangul or accidental overlaps.
- ${materialLabel(result)} uses its own randomly assigned ZIP reference. H01-H06 is only an internal ordering code; do not invent or impose a separate hook concept.

${productContract}

${humanContract}
`;

  if (stage === "structure-recreation") {
    return `STAGE 1 OF 4 — COPY THE FIXED REFERENCE LOSSLESSLY
${shared}
SOURCE ORDER
- The FIRST and only required attachment is a curated high-quality advertisement reference.

TASK
- New reference-first jobs copy the curated source file byte-for-byte into 01-structure and must never call image generation for this stage.
- This prompt remains available so persisted stage names and old jobs stay readable.
`;
  }

  if (stage === "product-replacement") {
    return `STAGE 2 OF 4 — REPLACE THE PRODUCT WITH AUTHORITATIVE PRODUCT REFERENCES
${shared}
SOURCE ORDER
- FIRST attachment: the structure raster created in stage 1. Preserve its macro composition and commercial polish.
- FOLLOWING attachments: authoritative product-page images. They define the real sales unit and product identity.

TASK
- Change the source product instances into ${productName} using the attached product references. When a source person is visible, regenerate that person as the clearly different fictional adult required by HUMAN REFERENCE IDENTITY POLICY in the same compositional role.
- Preserve exact package geometry, material, dominant color, cap/container shape, label hierarchy, brand/logo placement, sales-unit count and recognizable product details.
- Match the original reference product positions, count, perspective, scale, shadows, reflections, contact, depth and lighting so the replacement belongs in exactly the same design.
- Treat the entire region outside the old product and visible source-person regions as locked pixels: do not change the background, typography, source wording, price, badges, colors, graphic shapes, borders, spacing or layout in this stage.
- If the reference repeats one product visually, repeat the same verified target product cleanly without implying a bundle or changing the verified sales unit.
- Do not invent variants, flavors, package counts or labels. Do not add new marketing copy, price or offer yet.
- LOCKED REGIONS: every pixel outside the old product region(s) and any visible source-person region(s), including all original copy, typography, background, unrelated props, graphic shapes, badges and spacing.
- EDITABLE REGIONS: the old product region(s), plus visible source-person region(s) solely for replacing identity while preserving pose, action, scale, lighting and product interaction.
`;
  }

  if (stage === "copy-replacement") {
    const packagedCopyLock = productPolicy === "ai-packaged-product-reference"
      ? "- Preserve the AI-integrated package created in stage 2. Do not repaint, recolor, move, cover or relabel it while changing copy; if it is damaged, regenerate this complete raster from the authoritative product references."
      : "- Never regenerate, deform, recolor, move or relabel the target product in this stage.";
    return `STAGE 3 OF 4 — REPLACE ALL COPY WITH PRODUCTTRUTH-BACKED KOREAN COPY
${shared}
SOURCE ORDER
- FIRST attachment: the stage-2 raster containing the correct real product.
- FOLLOWING attachments: authoritative product references for identity checking only.

EXACT COPY TO RENDER
${exactCopy}

REFERENCE NATIVE COPY — SOURCE TEXT TO ADAPT, NOT A GENERIC BLUEPRINT
${referenceRawCopy || "No reliable OCR text was stored; read the visible source text directly from the stage-2 raster."}

SOURCE LINE ORDER
${referenceRawLines.length ? referenceRawLines.map((line, index) => `${index + 1}. ${line}`).join("\n") : "Read the visible source lines in their original order."}

TARGET ADAPTED LINE ORDER
${adaptedLines.map((line, index) => `${index + 1}. ${line}`).join("\n")}

SOURCE → TARGET COPY SLOT CONTRACT
${copySlotContract || "Read every visible source text block and replace it one-for-one with the exact target copy above."}

TASK
- LOCKED REGIONS: the stage-2 target product, background, people, props, lighting, colors, borders, shapes and every non-copy pixel.
- EDITABLE REGIONS: only the source copy, source price/offer, source advertiser logo and source-specific text badges.
- Change ONLY the source advertisement's copy, price/offer text, advertiser logo and source-specific text badges inside those editable regions. Preserve the stage-2 product pixels and every unrelated design pixel.
- Remove every source-ad phrase, old price, old logo, unsupported badge and stray glyph so no prior advertiser identity survives.
- Render the exact Korean strings above without paraphrasing, duplication or unsupported additions.
- Replace every visible source text block one-for-one according to the slot contract. Keep the same number of headline, support, proof, offer/label, CTA and badge zones, the same reading order and approximately the same visual text mass. Do not delete a source callout merely because its old price or offer is unsupported; render its assigned verified target line in that zone without preserving the old offer meaning.
- When a slot's source text says to read the corresponding zone directly, OCR that visible reference zone yourself and replace it with the assigned target. It is never permission to erase the zone or leave an empty panel.
- Preserve rhetorical force as well as typography. If the source headline is a question, reversal, comparison, objection, urgency or numeric-emphasis hook, the target headline must remain equally dominant and must never collapse into a plain product-name label.
- Keep the reference raw copy's word order, line count, punctuation, emoji and colloquial endings such as ㅋㅋ, ;;, .. or 겨 when they exist. Do not add chat/comment/meme language when the source lacks it.
- Keep the inherited typography style, hierarchy, outline, emphasis colors, shapes and copy zones as closely as possible. Adjust font size only as needed to fit; preserve source line breaks whenever the target facts allow it.
- Preserve the reference's strong contrast. Derive at most one accent from the real product and pair it with a contrasting color; never recolor the package, tint the whole scene with the package color, or reduce text/background contrast.
- Main hook is the dominant 1–2 line message. Supporting copy is compact. Show price/offer only if supplied above.
- Render no number, price, discount, quantity or benefit that is absent from EXACT COPY TO RENDER, even if it remains visible in the source raster.
${packagedCopyLock}
- Produce one fully finished advertisement raster. There will be no local text overlay afterward.
${(brandMemory?.goldenReferences || []).length ? "- Reuse only approved abstract tone traits from brand memory; never copy old campaign wording." : ""}
`;
  }

  return `STAGE 4 OF 4 — QA INSPECTION AND FULL-RASTER AI REPAIR
${shared}
SOURCE ORDER
- FIRST attachment: the stage-3 finished advertisement to inspect and repair.
- FOLLOWING attachments: authoritative product references for product/logo/package comparison.
- The final attachment may be the original ZIP advertisement reference for composition-lock comparison.

AUTHORITATIVE COPY
${exactCopy}

REFERENCE RAW COPY
${referenceRawCopy || "Read it directly from the original reference attachment."}

TASK
- Inspect the entire advertisement for: reference preservation outside editable product/copy regions, real product/package identity, product count, logo/label fidelity, verified price and offer, exact Korean copy, one-for-one preservation of every source copy slot and its visual weight, preservation of the reference's headline strength, line order/punctuation/slang and information density, scene-copy alignment, Hangul spelling, mobile readability, clipping, collisions, natural shadows/perspective and coherent commercial finish.
- If the original advertisement reference contains a person, confirm that the finished ad uses a visibly different fictional adult while retaining the intended pose, action, framing and product interaction. Repair recognizable source-person identity, face copying or unnatural anatomy.
- For meat products, inspect the actual cut, fiber direction, irregular marbling/fat boundaries, surface moisture, raw/cooked state, browning and color against the authoritative product references. Repair plastic, waxy, rubbery, cloned, neon-red/orange or uniformly glossy meat texture.
- Repair every discovered issue inside the full raster with image generation. Preserve the randomly selected reference's composition and the established product placement and correct text wherever possible.
- Remove any hallucinated source brand, unsupported claim, malformed logo, stray glyph, duplicate word or mismatched price. Any number not present in AUTHORITATIVE COPY is a critical error.
- Do not create a new unrelated concept and do not patch with a local overlay.
- Repair product identity inside this complete AI raster. No product cutout or protected local layer will be restored afterward.
${feedback ? `KNOWN QA FEEDBACK\n${feedback}` : "Run a complete visual QA pass even when no prior validator feedback is supplied."}
`;
}

export function buildNativeValidationPrompt(job: GenerationJob, result: GenerationResult) {
  const productContract = productRenderingPromptContract(job, result);
  const adaptedLines = result.referenceAdaptedCopyPlan?.adaptedLines || [result.hookPlan.headline, result.hookPlan.body, result.hookPlan.proof, result.hookPlan.offer, result.hookPlan.cta].filter(Boolean);
  const sourceSlotCount = result.referenceAdaptedCopyPlan?.copySlots?.filter((slot) => slot.sourceText.trim()).length || result.referenceAdaptedCopyPlan?.referenceRawLines?.filter((line) => line.trim()).length || 0;
  return `Inspect the attached COMPLETE Korean performance advertisement.
Attachment order after the finished advertisement: first the randomly selected ZIP advertisement reference for composition fidelity when present, then authoritative URL product reference images.
Product: ${job.productTruth.normalized.cleanProductName || job.productTruth.product.productName}
Required main copy: ${result.hookPlan.headline}
Required sub copy: ${result.hookPlan.body}
Required offer: ${result.hookPlan.offer || "none"}
Required CTA: ${result.hookPlan.cta || "none"}
Required target lines in order: ${JSON.stringify(adaptedLines)}
Required visible source-copy slot count to preserve: ${sourceSlotCount || "read from the reference image"}
This is a reference-driven replacement workflow. Judge the selected reference's composition and design grammar; do not require a separate scene concept that conflicts with that reference.
The inspected attachment has already been locally normalized and decoded as a 1200x1200 JPEG under 800KB. Set exportCompliance to 100 and never request a visual remake for file format, dimensions or byte size.
Check fidelity to the reference layout, product/package identity, exact Korean copy, one-for-one copy-block count, headline rhetorical strength, information density, factual safety, mobile readability, natural anatomy/food texture, and whether this is one coherent finished ad rather than a background plus pasted product/text panel. The final image must keep the reference's design grammar but contain no source product, source wording, source price or source advertiser identity. A detached cutout, plain product-name headline replacing a strong source hook, missing source copy zones, any number absent from the required target lines, fake label, broken Hangul, invented claim, large layout drift or surviving source identity requires revise. Scores must use the 0–100 scale. Return the configured JSON schema.

If the selected advertisement reference contains a person, compare the reference and final advertisement: the compositional role, approximate pose and action should remain, but the final person must be a clearly different fictional adult with no recognizable source-person facial identity. For meat, a generic substituted cut, smooth plastic/waxy surface, repeated marbling, neon color, impossible fibers or uniformly lacquered gloss is a critical foodAppetiteAppeal and productIdentity failure.

${productContract}
For every packaged product—including cosmetics, wellness goods, drinks, milk, bottles, cans, pouches and boxes—any changed container, cap, label, logo, printed text, volume, color or sales unit is a critical failure and requires a full-raster AI revision. A pasted product cutout is also a critical failure. For meat, judge whether the original cut and marbling evidence were translated into natural, appetizing, physically coherent food photography rather than pasted or replaced with a different cut.`;
}

export function buildNativeGroupValidationPrompt(job: GenerationJob) {
  const materials = job.results.map((result) => ({
    material: materialLabel(result),
    referenceId: result.nativeCreative?.adReference?.id,
    mainCopy: result.hookPlan.headline,
    referenceProfile: result.referenceAdaptedCopyPlan?.referenceCopyProfileId,
  }));
  return `Compare the six COMPLETE advertisements as independent reference-adapted materials. Check reference separation, product role, layout, palette and typography without claiming a hook-only causal experiment. 문구만 다르고 배경·제품 배치가 사실상 같으면 실패로 판정한다. 이전 광고 조각을 재사용한 경우, 또는 배경 위에 상품·큰 문구 패널을 붙인 것처럼 보이는 경우에도 실패로 판정한다. ${JSON.stringify(materials)}`;
}
