import type { GenerationJob, GenerationResult } from "./types";
import type { AdvertiserBrandMemory } from "./codexRegistry.server";
import type { NativeCreativeGenerationStage } from "./providers/CreativeGenerationProvider.ts";
import { buildAdaptiveLayoutPlan, referenceCreativeGrammars } from "./referenceCreativeGrammar.ts";
import { productRenderingPromptContract, resolveProductRenderingPolicy } from "./productRenderingPolicy.ts";

export const NATIVE_FINAL_PROMPT_VERSION = "reference-native-copy-v10-no-generated-standalone-logo";

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
- Faithfully preserve the product's package geometry, dominant colors, label hierarchy, material, count and recognizable silhouette. Preserve a real logo only where it is physically printed on the authoritative product/package; never extract it into a separate canvas logo.
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
- No newly generated standalone logo, wordmark, calligraphic brand name, initials, monogram, emblem, crest, seal, certification badge, signature or stamp anywhere outside the physical target product/package. When the exact ad copy contains a brand or product name, render it only as ordinary copy in its assigned text zone, never as a logo-like mark. Optional advertiser branding is a separate user-selected delivery post-process and must not be created in this raster.

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
        .map((slot) => {
          const location = slot.box
            ? `box=${Math.round(slot.box.x * 100)},${Math.round(slot.box.y * 100)},${Math.round(slot.box.width * 100)},${Math.round(slot.box.height * 100)}%`
            : "box=read-source-zone";
          const visual = [slot.align ? `align=${slot.align}` : "", slot.sizeClass ? `size=${slot.sizeClass}` : "", slot.colorHint ? `color=${slot.colorHint}` : "", slot.backgroundHint ? `background=${slot.backgroundHint}` : "", slot.outlineHint ? `outline=${slot.outlineHint}` : "", slot.characterBudget ? `budget≈${slot.characterBudget}자` : ""].filter(Boolean).join(", ");
          const eraseSourceBrand = slot.sourceType === "source-brand" || slot.replacePolicy === "remove";
          return `${slot.index + 1}. [${slot.role}/${slot.emphasis}/${slot.sourceType || "ad-copy"}/${slot.replacePolicy || "adapt"}; ${location}${visual ? `; ${visual}` : ""}] ${slot.sourceText.trim() ? JSON.stringify(slot.sourceText) : "[read the visually corresponding source zone directly from the reference]"} → ${eraseSourceBrand ? "[ERASE COMPLETELY; reconstruct only the immediate surrounding background; render no text, emblem, monogram or logo]" : JSON.stringify(slot.targetText)}`;
        })
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
- Preserve a real logo only when it is physically printed on the authoritative target product/package. Everywhere else, never generate a standalone logo, wordmark, calligraphic brand/product name, initials, monogram, emblem, crest, seal, certification badge, signature or stamp. A brand/product name required by the exact copy is ordinary ad typography only. User-selected advertiser branding is applied later as a separate delivery post-process, not in this raster.
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
- Preserve exact package geometry, material, dominant color, cap/container shape, label hierarchy, sales-unit count and recognizable product details. Preserve a real logo only in its physically printed package location; do not reproduce it as a separate logo elsewhere on the canvas.
- Match the original reference product positions, count, perspective, scale, shadows, reflections, contact, depth and lighting so the replacement belongs in exactly the same design.
- Treat the entire region outside the old product and visible source-person regions as locked pixels: do not change the background, typography, source wording, price, badges, colors, graphic shapes, borders, spacing or layout in this stage.
- If the reference repeats one product visually, repeat the same verified target product cleanly without implying a bundle or changing the verified sales unit.
- Do not invent variants, flavors, package counts or labels. Do not add new marketing copy, price or offer yet.
- LOCKED REGIONS: every pixel outside the old product region(s) and any visible source-person region(s), including all original copy, typography, background, unrelated props, graphic shapes, badges and spacing.
- EDITABLE REGIONS: the old product region(s), plus visible source-person region(s) solely for replacing identity while preserving pose, action, scale, lighting and product interaction.
- Do not add any target-brand wordmark, emblem, seal, stamp or logo outside the physical product/package during product replacement.
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
- For every source-brand/remove slot, erase the complete old wordmark inside that slot's OCR box and reconstruct only the immediate surrounding background. Render no replacement text, initials, emblem, stamp, badge or logo in that box. Never turn the current product or brand name into a newly invented standalone logo.
- Apply that prohibition to the ENTIRE canvas, not only the known removal boxes: do not create a logo-like handwritten/calligraphic product name, signature, seal, crest, monogram, certification badge or decorative wordmark in any corner, margin, headline area or empty space. If the exact target copy contains the product or brand name, it must remain ordinary advertising typography inside its assigned copy zone.
- A real logo printed on the locked target product/package remains part of the product identity. Any separate advertiser logo is applied only later from an explicitly selected transparent source file; do not invent it during image generation.
- Render the exact Korean strings above without paraphrasing, duplication or unsupported additions.
- Replace every visible source text block one-for-one according to the slot contract, except source-brand/remove slots which must remain text-free after background reconstruction. Keep the same number of headline, support, proof, offer/label, CTA and badge zones outside those removal slots, the same reading order and approximately the same visual text mass. Do not delete a non-brand source callout merely because its old price or offer is unsupported; render its assigned verified target line in that zone without preserving the old offer meaning.
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
- Inspect Korean at 200–400% character level. Transcribe only the glyphs actually visible; never infer the intended word from sentence context. If a syllable block has fused, missing or malformed strokes, record it as [깨짐:판독불가] and repair it. Repeated-syllable words such as 넉넉, 촉촉 and 쫀득 must show each complete Hangul block independently, with no merged or mutated letterforms.
- For a packaged lineup, compare every visible bottle/package independently against the authoritative references. Repair duplicated generic packages, wrong cap/container colors, invented variants, changed printed volume, malformed brand marks and random readable label glyphs. Keep at least one dominant package large and unobstructed enough for mobile identity recognition.
- If the original advertisement reference contains a person, confirm that the finished ad uses a visibly different fictional adult while retaining the intended pose, action, framing and product interaction. Repair recognizable source-person identity, face copying or unnatural anatomy.
- For meat products, inspect the actual cut, width-to-thickness ratio, fat-cap thickness, fiber direction, irregular marbling frequency/density/fat boundaries, surface moisture, raw/cooked state, browning and color against the authoritative product references. Repair thickened or rounded generic steak shapes, exaggerated premium marbling, white spiderweb/worm-like fat, cloned vein maps, plastic, waxy, rubbery, neon-red/orange or uniformly glossy meat texture.
- Repair every discovered issue inside the full raster with image generation. Preserve the randomly selected reference's composition and the established product placement and correct text wherever possible.
- Source-brand/remove OCR boxes must contain no standalone text, emblem, monogram, stamp or invented target-brand logo after their immediate background is reconstructed. Preserve only a real mark that is physically printed on the locked target product/package.
- Inspect the complete canvas beyond those known boxes. Any newly created calligraphic brand/product name, standalone wordmark, initials, monogram, emblem, crest, seal, certification badge, signature or stamp outside the physical package is a critical error. Remove the complete invented mark and reconstruct only its immediate background; never replace it with another text mark.
- Remove any hallucinated source brand, invented standalone target-brand logo, unsupported claim, malformed logo, stray glyph, duplicate word or mismatched price. Any number not present in AUTHORITATIVE COPY is a critical error.
- Do not create a new unrelated concept and do not patch with a local overlay.
- Repair product identity inside this complete AI raster. No product cutout or protected local layer will be restored afterward.
${feedback ? `KNOWN QA FEEDBACK\n${feedback}` : "Run a complete visual QA pass even when no prior validator feedback is supplied."}
`;
}

export function buildNativeValidationPrompt(job: GenerationJob, result: GenerationResult) {
  const productContract = productRenderingPromptContract(job, result);
  const adaptedLines = result.referenceAdaptedCopyPlan?.adaptedLines || [result.hookPlan.headline, result.hookPlan.body, result.hookPlan.proof, result.hookPlan.offer, result.hookPlan.cta].filter(Boolean);
  const copySlots = result.referenceAdaptedCopyPlan?.copySlots || [];
  const sourceBrandRemovalSlots = copySlots
    .filter((slot) => slot.sourceType === "source-brand" || slot.replacePolicy === "remove")
    .map((slot) => ({ index: slot.index, sourceText: slot.sourceText, box: slot.box }));
  const sourceSlotCount = copySlots.length
    ? copySlots.filter((slot) => slot.sourceText.trim() && slot.sourceType !== "source-brand" && slot.replacePolicy !== "remove").length
    : result.referenceAdaptedCopyPlan?.referenceRawLines?.filter((line) => line.trim()).length || 0;
  return `Inspect the attached COMPLETE Korean performance advertisement.
Attachment order after the finished advertisement: first the randomly selected ZIP advertisement reference for composition fidelity when present, then authoritative URL product reference images.
Product: ${job.productTruth.normalized.cleanProductName || job.productTruth.product.productName}
Required main copy: ${result.hookPlan.headline}
Required sub copy: ${result.hookPlan.body}
Required offer: ${result.hookPlan.offer || "none"}
Required CTA: ${result.hookPlan.cta || "none"}
Required target lines in order: ${JSON.stringify(adaptedLines)}
Required visible source-copy slot count to preserve: ${copySlots.length ? sourceSlotCount : sourceSlotCount || "read from the reference image"}
Source-brand/remove slots that must be text-free background after removal: ${JSON.stringify(sourceBrandRemovalSlots)}
This is a reference-driven replacement workflow. Judge the selected reference's composition and design grammar; do not require a separate scene concept that conflicts with that reference.
The inspected attachment has already been locally normalized and decoded as a 1200x1200 JPEG under 800KB. Set exportCompliance to 100 and never request a visual remake for file format, dimensions or byte size.
Check fidelity to the reference layout, product/package identity, exact Korean copy, one-for-one copy-block count outside removal slots, headline rhetorical strength, information density, factual safety, mobile readability, natural anatomy/food texture, and whether this is one coherent finished ad rather than a background plus pasted product/text panel. Inspect the final image at 200–400% and transcribe only the glyphs literally visible into observedKoreanText; do not autocorrect or infer intended words from Required target lines. Mark fused, missing or malformed Hangul strokes as [깨짐:판독불가]. Repeated-syllable words such as 넉넉, 촉촉 and 쫀득 require two separately complete syllable blocks. Also read the Korean target lines as consumer-facing sentences: subject and predicate, particles, modifiers and sentence endings must be natural when adjacent lines are joined. A grammatically broken slot substitution, non-human subject performing a human action, dangling connective ending or incomplete comma is a Korean-copy and commercial-quality failure even when every Hangul glyph was rendered exactly. The final image must keep the reference's design grammar but contain no source product, source wording, source price or source advertiser identity. Every listed source-brand/remove box must contain only reconstructed surrounding background: any standalone replacement brand text, stylized initials, emblem, stamp or invented logo in those boxes requires revise. Separately inspect the entire canvas for a newly generated standalone logo-like mark outside the physical target product/package. A calligraphic or handwritten brand/product name, standalone wordmark, initials, monogram, emblem, crest, seal, certification badge, signature or stamp counts as a generated logo even when its letters are spelled correctly or resemble required copy. Ordinary ad copy in an assigned text zone is not a logo. Set standaloneLogoDetected=true, describe each finding in standaloneLogoFindings and require revise whenever any such generated mark exists; only a real logo physically printed on the authoritative product/package is exempt. A detached cutout, plain product-name headline replacing a strong source hook, missing non-brand source copy zones, any number absent from the required target lines, fake label, broken Hangul, invented claim, large layout drift or surviving source identity requires revise. Scores must use the 0–100 scale. Return the configured JSON schema including standaloneLogoDetected and standaloneLogoFindings.

If the selected advertisement reference contains a person, compare the reference and final advertisement: the compositional role, approximate pose and action should remain, but the final person must be a clearly different fictional adult with no recognizable source-person facial identity. For meat, compare directly with the authoritative seller photos: a generic or thicker substituted cut, altered width-to-thickness ratio, exaggerated marbling grade/density, repeated or mirrored vein map, spiderweb/worm-like fat, smooth plastic/waxy surface, neon color, impossible fibers or uniformly lacquered gloss is a critical foodAppetiteAppeal and productIdentity failure.

${productContract}
For every packaged product—including cosmetics, wellness goods, drinks, milk, bottles, cans, pouches and boxes—compare each visible package separately. Any duplicated generic package, invented variant, changed container, cap, label, logo, printed text, volume, color or sales unit is a critical failure and requires a full-raster AI revision. At least one dominant package must remain recognizable at mobile size. A pasted product cutout is also a critical failure. For meat, judge whether the original cut and marbling evidence were translated into natural, appetizing, physically coherent food photography rather than pasted or replaced with a different cut.`;
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
