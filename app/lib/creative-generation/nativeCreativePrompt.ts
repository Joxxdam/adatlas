import type { GenerationJob, GenerationResult } from "./types";
import type { AdvertiserBrandMemory } from "./codexRegistry.server";
import type { NativeCreativeGenerationStage } from "./providers/CreativeGenerationProvider.ts";
import { buildAdaptiveLayoutPlan, referenceCreativeGrammars } from "./referenceCreativeGrammar.ts";
import { productRenderingPromptContract, resolveProductRenderingPolicy } from "./productRenderingPolicy.ts";
import { resolveCategoryCreativeProfile } from "./categoryCreativeRouter.ts";
import { isMeatProductContext } from "./productSignalHygiene.ts";
import { referenceRequiresComparisonSemantics } from "./referenceSemanticRoles.ts";

export const NATIVE_FINAL_PROMPT_VERSION = "reference-native-copy-v27-living-subject-context-scene";

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

export function nativeReferenceRequiresHumanReplacement(result: GenerationResult) {
  const reference = result.nativeCreative?.adReference;
  return reference?.photographyType === "human-model" || reference?.compositionType === "human-use" || reference?.layoutFamily === "human-use" || result.scenePlan?.sceneAsset?.includesPerson === true;
}

export function nativeReferenceRequiresComparisonSemantics(result: GenerationResult) {
  return referenceRequiresComparisonSemantics(result.nativeCreative?.adReference);
}

export function nativeReferenceRequiresSourceBrandRegionClear(result: GenerationResult) {
  return (result.referenceAdaptedCopyPlan?.copySlots || []).some((slot) => slot.sourceType === "source-brand" || slot.replacePolicy === "remove");
}

function withKoreanObjectParticle(value: string) {
  const trimmed = value.trim();
  const lastCode = trimmed.charCodeAt(trimmed.length - 1);
  const hasFinalConsonant = lastCode >= 0xac00 && lastCode <= 0xd7a3 && (lastCode - 0xac00) % 28 !== 0;
  return `${trimmed}${hasFinalConsonant ? "을" : "를"}`;
}

function targetCustomerForHuman(job: GenerationJob, result: GenerationResult) {
  const explicitTarget = job.productTruth.product.targetCustomer?.trim();
  const plannedAudience = result.hookPlan.audience?.trim();
  const category = resolveCategoryCreativeProfile(job.productTruth).category;
  if (explicitTarget) return explicitTarget;
  const audienceContradictsCategory =
    (category.startsWith("food_") && /샤워|바디|스킨|피부|화장|세정|체취|향수/u.test(plannedAudience || "")) ||
    ((category === "beauty_cosmetics" || category === "personal_care") && /먹는|간식|식사|요리|시식|한입/u.test(plannedAudience || "")) ||
    (category === "fashion" && /먹는|식사|샤워|스킨케어/u.test(plannedAudience || ""));
  if (plannedAudience && !audienceContradictsCategory && !/^(?:상품|핵심|확인된)\s*(?:고객|구매자)$/u.test(plannedAudience)) return plannedAudience;
  const productName = job.productTruth.normalized.baseProductName || job.productTruth.normalized.cleanProductName || job.productTruth.product.productName;
  if (category.startsWith("food_")) return `${withKoreanObjectParticle(productName)} 실제로 먹거나 나눠 먹는 성인 고객`;
  if (category === "fashion") return `${withKoreanObjectParticle(productName)} 실제로 착용하는 성인 고객`;
  return `${withKoreanObjectParticle(productName)} 실제로 구매·사용하는 성인 고객`;
}

function humanProductInteractionContract(job: GenerationJob) {
  const category = resolveCategoryCreativeProfile(job.productTruth).category;
  const productName = job.productTruth.normalized.baseProductName || job.productTruth.normalized.cleanProductName || job.productTruth.product.productName;
  if (category.startsWith("food_")) {
    return `- FOOD HUMAN ACTION IS MANDATORY WHEN A PERSON IS PRESENT: show the new person naturally eating, tasting, offering, serving or visibly holding ${productName} as food. The actual product must be involved in the hand-to-mouth or table interaction, not merely pasted beside the person.
- Remove source-category grooming or cosmetics behavior completely. Never preserve smelling a shirt/body, checking body odor, showering, applying skincare, holding a cosmetic bottle, or another non-food gesture. A restaurant background alone does not make the action food-relevant.`;
  }
  if (category === "beauty_cosmetics" || category === "personal_care") {
    return `- The new person's action must visibly demonstrate a plausible use moment for ${productName}; do not retain an unrelated food, fashion or household action from the source reference.`;
  }
  if (category === "fashion") {
    return `- The new person must visibly wear, carry or style ${productName}; do not retain an unrelated source-category action.`;
  }
  return `- The new person's action must visibly and plausibly interact with ${productName}. Replace any source-category-specific gesture that no longer makes sense for this product.`;
}

function humanReferenceIdentityContract(job: GenerationJob, result: GenerationResult) {
  const targetCustomer = targetCustomerForHuman(job, result);
  const interactionContract = humanProductInteractionContract(job);
  const exactCopyMeaning = [result.hookPlan.headline, result.hookPlan.body, result.hookPlan.proof, result.hookPlan.offer, result.hookPlan.cta].map((value) => String(value || "").trim()).filter(Boolean).join(" / ") || "the verified current-product message";
  return `HUMAN REFERENCE IDENTITY AND FULL-SCENE POLICY
- When the selected advertisement reference contains any face, hand-led model, partial body or full person, replacement is mandatory. Never leave the source person unchanged and never solve this by simply deleting the person.
- Treat the reference person only as a HUMAN-PRESENCE SIGNAL and a rough visual-weight/available-area guide. The source identity, body, silhouette, pose, action, gesture, expression, gaze, wardrobe, styling, location and category story are not references to preserve.
- Cast a clearly different fictional adult who credibly represents this product's verified target customer: ${targetCustomer}.
- Do NOT edit the person and background as separate patches. Design and regenerate the target person, action, expression, styling, location, surrounding props, lighting and entire photographic background together as ONE integrated full-scene composition from the current ProductTruth and exact target copy. TARGET COPY MEANING: ${exactCopyMeaning}.
- The new human moment must visually prove or reinforce that target copy. A person whose expression, action or situation would fit the source advertisement better than the current copy is a critical failure.
- Preserve only the reference's macro text/product hierarchy, copy zones, reading flow, commercial visual balance, broad camera depth and contrast. Do NOT preserve the old location pixels, source person's semantic advertising role, category-specific story, pose, gaze, body orientation or person-specific framing.
- Change at least TWO of these human-composition attributes: body orientation, pose/action, hand gesture or product grip, gaze direction, camera angle/height, crop, or position within the allocated human area. The new shot must be visibly distinguishable even before comparing faces.
- Change facial structure, eyes, nose, mouth, hairstyle, hair color or texture, wardrobe details and accessories together; a minor face retouch, recolor, face swap on the same body, or near-identical pose is not enough.
- Remove the source person's recognizable identity completely before rebuilding the person. Never retain the original face and merely retouch, restyle or recolor it.
- Never reproduce, identify or preserve the source person's recognizable face, biometric likeness, distinctive styling, body silhouette or identifiable gesture. The result should feel like the same campaign art direction newly photographed with a target-relevant model and a different human sub-composition.
- Keep anatomy, hands, product grip, occlusion, perspective and contact physically natural. Keep text and product slots readable, but freely reconstruct the whole person-led photographic scene and background as a coherent target-product moment.
- Do not infer or exaggerate race, disability, medical condition, income, religion or another sensitive trait. If the verified target does not specify age or gender, use a plausible adult without stereotyping.
- The source person's old category-specific action is NOT locked. Replace it with an action that demonstrates the current product's real use or consumption context.
${interactionContract}
- When the source reference has no person, do not add one unless the inherited composition and verified usage story clearly require it.

ANIMAL / ANIMAL-CHARACTER MANDATORY REPLACEMENT
- When the selected reference contains any real animal, illustrated animal, mascot animal or animal-like character, replacement is mandatory even when the source animal already seems broadly compatible. Never preserve the original animal identity unchanged and never solve this by simply deleting the animal.
- Replace it with a clearly different animal or animal character that is naturally associated with the current product's category, use moment and exact copy. Product relevance decides WHAT replaces it, never WHETHER replacement happens.
- If no different species is naturally relevant, use a clearly different individual, breed, coloration or character design of the most relevant species. Never force an arbitrary species merely for novelty.
- Preserve the reference's animal count, approximate footprint, foreground/background depth, gaze direction, emotional reaction, gesture/action role, visual weight and illustration/photography style so the macro composition remains recognizable.
- Rebuild the animal and its immediately surrounding scene, contact, shadows, props and interaction together as one coherent raster. Never paste a new animal cutout over the old background.
- A human must remain a human and an animal must remain an animal unless the inherited creative is explicitly an illustrated mascot/character concept whose semantic role is better served by a target-product-relevant animal character.`;
}

function backgroundAdaptationContract(job: GenerationJob, result: GenerationResult) {
  const category = resolveCategoryCreativeProfile(job.productTruth).category;
  const productName = job.productTruth.normalized.baseProductName || job.productTruth.normalized.cleanProductName || job.productTruth.product.productName;
  const exactCopyMeaning = [result.hookPlan.headline, result.hookPlan.body, result.hookPlan.proof, result.hookPlan.offer, result.hookPlan.cta]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" / ") || "the supplied exact target copy";
  const humanScene = nativeReferenceRequiresHumanReplacement(result);
  const verifiedVisualMotifs = [
    productName,
    ...job.productTruth.normalized.ingredients,
    ...job.productTruth.facts
      .filter((fact) => fact.usableInCopy && fact.verification !== "unverified" && Boolean(fact.evidenceType && ["ingredient", "identity"].includes(fact.evidenceType)))
      .map((fact) => fact.value),
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 10);
  const semanticCarrierGuidance = (() => {
    const productContext = `${productName} ${job.productTruth.product.category || ""} ${job.productTruth.product.detectedProductType || ""}`;
    if (category === "food_meat") {
      return "For the current meat product, a butcher tray, grill, skillet, cutting board or serving plate is compatible only when it matches the authoritative raw/cooked state and actual sales unit; remove unrelated snack bowls, cosmetic props and beverage vessels.";
    }
    if (category.startsWith("food_") && /무화과|곶감|말랭이|반건조|건조|건과|견과|스낵|간식|과자|전병|쿠키|비스킷|한과|약과|디저트/iu.test(productContext)) {
      return "For this dried-fruit/snack product, rebuild any source-product carrier and surrounding food props as a coherent snack-serving assembly: use a clean dry ceramic/wood plate, snack bowl, basket, parchment-lined tray or the verified sales package as appropriate. A meat frying pan/grill, raw-meat foam tray, butcher knife, kimchi tub, brine container and every related meat-meal cue—including tongs, banchan, meat sauces, cooking steam and bell-pepper/herb meat garnish—must be removed or regenerated unless the authoritative product page explicitly proves that use. Preserve the reference's macro design and text zones, not its old meal props.";
    }
    if (category === "food_fresh") {
      return "For this fresh food, use a produce basket, clean plate, cutting/serving board or verified package only when appropriate to the authoritative product state. Remove old-category cookware, brine tubs, cosmetic tools and unrelated prepared-dish vessels.";
    }
    if (category === "food_processed") {
      return "For this processed food, the carrier must match the authoritative ready-to-eat, packaged, side-dish, beverage or cooking state. Replace any pan, grill, raw-meat tray, kimchi tub, drink glass or utensil that falsely implies a different food type or preparation method.";
    }
    if (category === "beauty_cosmetics" || category === "personal_care") {
      return "Use only product-appropriate vanity, shower, sink, applicator or texture props. Remove food plates, pans, grills, cutlery, ingredient piles and serving vessels that communicate eating or cooking.";
    }
    if (category === "fashion") {
      return "Use only product-appropriate wardrobe, hanger, dressing, street or studio props. Remove food containers, cookware, cosmetic applicators and source-category handling tools.";
    }
    return "Any carrier or tool must communicate the current product's real storage, preparation, serving or use behavior. Replace a source-category vessel or tool whenever it makes the current product look like a different kind of item.";
  })();
  return `BACKGROUND AND SEMANTIC-PROP DECISION POLICY
- Current product: ${productName}. Current category: ${category}. Exact copy meaning: ${exactCopyMeaning}.
- Verified current-product motif candidates: ${verifiedVisualMotifs.join("; ") || productName}. The authoritative product-page images may additionally prove visually obvious product parts, ingredients and serving/use elements.
- ${humanScene ? "HUMAN REFERENCE DETECTED: rebuild the person, action, place, surrounding props and complete photographic background together as one integrated target-product scene. The old location is only a loose spatial-depth/camera reference, never a pixel lock." : "NO HUMAN REFERENCE DETECTED: inspect whether the reference has a meaningful contextual scene. Any recognizable real place, lifestyle setting, furnished room, desk, shelf, kitchen, bathroom, outdoor location, contextual tabletop or cluster of surrounding lifestyle props counts as a background scene and MUST be rebuilt for the current product."}
- CONTEXTUAL BACKGROUND REPLACEMENT IS MANDATORY: when a meaningful place or contextual prop arrangement exists, regenerate that background as a new product-and-copy-aligned place even if the old scene is not obviously impossible. A merely plausible old desk, room, table or lifestyle scene is not enough. Preserve macro camera depth, horizon, lighting direction, negative space, copy zones, product/text hierarchy and overall visual weight—not the old place pixels or landmark arrangement.
- BACKGROUND-ABSENT EXCEPTION: white, solid-color, achromatic, abstract/graphic and genuinely plain seamless studio fields with no recognizable place, furniture, lifestyle props or semantic surface story are not contextual backgrounds. Preserve those simple fields and their graphic composition.
- An ordinary table/surface counts as contextual when surrounding cups, stationery, bottles, dishes, tools, furniture or decor create a recognizable use occasion. Rebuild the complete arrangement rather than deleting one prop at a time. For example, an art desk with pencils and glass dishes must become a coherent family snack/tea setting for a traditional snack while keeping the inherited product and copy footprints.
- Distinguish BACKGROUND from a SEMANTIC CARRIER, SOURCE-SEMANTIC PROP or PRODUCT-LINKED DECORATIVE MOTIF. A pan, grill, cooking pot, raw-meat tray, kimchi/side-dish tub, brine container, serving vessel, drink glass, cosmetic applicator, clothing rack, ingredient mound, source package, knife/tongs, category-specific hand action, anthropomorphic ingredient/product character, mascot-like produce/food/object, emoji-style product icon, ingredient illustration, sticker or decorative pictogram is part of the source product assembly—not protected background—when it tells viewers what the old product is, contains, or how it is prepared, stored, served or used.
- MANDATORY REPLACEMENT RULE: if keeping that carrier, vessel, tool, ingredient, character, icon, illustration or action would make ${productName} look like a different category, ingredient set, preparation method, storage format or consumption/use occasion, replace it together with the source product. "The product pixels were replaced" is not sufficient while an old-category semantic carrier or decorative motif remains.
- REGENERATE AS ONE ASSEMBLY: when several source props form one old-product story—such as a grill plus meat tongs, sauces, kimchi and banchan, or a meat tray plus pepper/herb garnish—do not patch the props one by one. Regenerate the complete product-bearing tabletop/serving assembly inside the inherited photographic area so every visible prop belongs naturally to ${productName}. Preserve the macro camera, typography zones, visual weight and reading flow.
- UNVERIFIED FOOD GARNISH IS NOT DECORATION: paprika, rosemary, mint, raw vegetables, sauces, side dishes and ingredient piles inherited from the source must be removed or replaced unless ProductTruth or authoritative product images verify that they belong with the current product. Never keep them merely for color balance.
- Preserve the reference's carrier footprint, visual mass, perspective, crop, shadows and product-to-copy balance, but rebuild the carrier as a current-product-compatible object. Do not use this rule to regenerate a compatible neutral plate, bowl, white surface, ordinary tabletop or simple studio background.
- CHARACTER / ICON STYLE-LOCK RULE: keep the inherited character or motif count, positions, approximate sizes, silhouettes/visual mass, crop, spacing, expression/emotional role, pose, line weight, outline, rendering medium and palette logic. Replace only the literal source-category identity with the current product, a verified current-product ingredient/component, or a visually obvious element proven by the authoritative product-page images. For example, unrelated fruit/vegetable characters around galbitang should become cute rib, green-onion or jujube characters only when those elements are verified by ProductTruth or visibly proven in the authoritative product images.
- Never infer a replacement ingredient from the reference decoration itself. Evidence priority is ProductTruth/product title → verified ingredients/facts → clearly visible authoritative product-page images → the current product itself as the character/motif. If no specific ingredient/component is verified, use the current product as the replacement character or motif; never retain the unrelated source character and never invent an unsupported ingredient.
- ${semanticCarrierGuidance}
- Do not add a separate image-generation stage. Resolve the allowed product, prop and conditional scene adaptation in this same full-raster edit.`;
}

function originalSourceResearchSceneContract(job: GenerationJob, result: GenerationResult) {
  if (!job.productTruth.product.vendorResearch?.allowSheetClaimsInCopy) return "";
  const exactMeaning = [result.hookPlan.headline, result.hookPlan.body, result.hookPlan.proof, result.hookPlan.offer, result.hookPlan.cta]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" / ");
  return `ORIGINAL SOURCE RESEARCH-TO-SCENE CONTRACT
- The user-provided Original Source research sheet is authorized evidence for this matched product. Any number, cooling/moisture/ingredient benefit, skin concern or use moment already present in the exact target copy is intentional; preserve its rhetorical strength and never weaken, censor or replace it with generic package copy.
- Build the visual story from this exact copy meaning: ${exactMeaning || "the supplied Original Source target copy"}.
- A loss-aversion or problem headline needs a visibly understandable problem-to-payoff scene. A numbered-reasons reference needs distinct visual support for the strongest reasons instead of a generic bottle lineup. A cooling claim should read through water, freshness, post-workout/heat context or a refreshed target customer; a moisture claim should read through rich foam, comfortable skin and a warm shower ritual; citrus/fruity claims should use only the verified matched ingredients and scent mood.
- If a person is present, cast a clearly different fictional target customer and make their action, expression, styling and setting demonstrate the exact current-product message. The reference person is only permission to use a human, never permission to keep the same identity, pose or source-category action.
- Do not render research-report meta language such as 소개됨, 방향, 활용 or 콘셉트. Render only the exact consumer-facing copy supplied below.`;
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
  const humanContract = humanReferenceIdentityContract(job, result);
  const backgroundContract = backgroundAdaptationContract(job, result);
  const originalSourceContract = originalSourceResearchSceneContract(job, result);
  const exactCopy = [`MAIN COPY: ${result.hookPlan.headline}`, result.hookPlan.body ? `SUB COPY: ${result.hookPlan.body}` : "", result.hookPlan.proof ? `PROOF: ${result.hookPlan.proof}` : "", result.hookPlan.offer ? `OFFER: ${result.hookPlan.offer}` : "", result.hookPlan.cta ? `CTA: ${result.hookPlan.cta}` : ""].filter(Boolean).join("\n");

  return `Use the image generation skill to create ONE FINAL, COMPLETE, READY-TO-RUN Korean square performance advertisement.

NON-NEGOTIABLE OUTPUT
- Save exactly one raster image to: ${outputPath}
- Square 1:1 composition for a final 1200 x 1200 export.
- The generated raster itself must contain the hook-specific scene, exact Korean advertising copy, typography, graphic emphasis and verified offer/CTA.
- This is NOT a background plate. Do not reserve an empty product slot or copy-safe placeholder for later compositing.
- No template renderer, SVG text layer, canvas text layer, product cutout or post-render copy panel will be added after generation.
- URL product images are authoritative AI references only. No source-product pixels will be extracted, cut out, pasted or restored after generation.

AUTHORITATIVE PRODUCT REFERENCE
- The FIRST attached product-page image is the authoritative product identity and sales unit.
- Faithfully preserve the product's package geometry, dominant colors, label hierarchy, material, count and recognizable silhouette. Preserve a real logo only where it is physically printed on the authoritative product/package; never extract it into a separate canvas logo.
- Integrate the product naturally into the hook-specific scene with coherent perspective, contact shadow, lighting and scale. It must not look like a floating cutout pasted over a stock background.
- Additional attached product-page images are evidence for texture, use, ingredients, context and alternate views. They are not ads to copy.
- The selected reference advertisement's macro design, copy zones, reading order and visual hierarchy are locked. Scene/background pixels follow the explicit background decision policy below; its source product, incompatible semantic props and source advertiser identity must be replaced, not retained.
- Repeat or overlap the same product only when the verified composition and this hook genuinely need quantity/lineup emphasis. Otherwise use one dominant product hero.

Shipping, free-shipping, shipping-fee, dispatch, arrival-date, courier or delivery wording anywhere in the final is prohibited and requires revise.

${productContract}

${humanContract}

${backgroundContract}

${originalSourceContract}

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
- The selected quality reference is the macro advertising-design source, not merely an abstract style suggestion. For non-human compatible scenes preserve background pixels; for human references the integrated full-scene policy intentionally replaces the person-led photographic scene while preserving design hierarchy and copy zones.
- One dominant visual story per card: product/food/use moment should occupy roughly 45-70% of the visual attention.
- Clear hierarchy: hook first, product/use proof second, verified offer or CTA third. Keep secondary decoration restrained.
- Use strong contrast and one category/brand accent plus at most one urgency color.
- A scene must prove the hook: price hooks show the verified sales unit/value; sensory hooks show texture, water, foam, steam, marbling or motion; situation hooks show the actual customer moment; evidence hooks connect one verified fact to the product; reversal hooks create a clean objection/payoff tension.
- 국대한우·육류: natural marbling and food color, appetizing raw/cooked detail, grill/table/serving action or verified pack composition; never plastic-looking meat or an unrelated cut.
- 오리지널소스·퍼스널케어: package label remains recognizable; derive the person, action, ingredient motif and shower/customer-tension scene from the exact target copy and its matched research fact; do not default to a generic bottle lineup and do not repeat the same ice background across hooks.
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
  const humanContract = humanReferenceIdentityContract(job, result);
  const backgroundContract = backgroundAdaptationContract(job, result);
  const integratedHumanScene = nativeReferenceRequiresHumanReplacement(result);
  const comparisonReference = nativeReferenceRequiresComparisonSemantics(result);
  const originalSourceContract = originalSourceResearchSceneContract(job, result);
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
          return `${slot.index + 1}. [${slot.role}/${slot.emphasis}/${slot.sourceType || "ad-copy"}/${slot.replacePolicy || "adapt"}; ${location}${visual ? `; ${visual}` : ""}] ${slot.sourceText.trim() ? JSON.stringify(slot.sourceText) : "[read the visually corresponding source zone directly from the reference]"} → ${eraseSourceBrand ? "[ERASE THE ENTIRE SOURCE-BRAND REGION INCLUDING ITS BADGE/CAPSULE/RIBBON/CONTAINER; reconstruct the true surrounding background; render no empty shape, text, emblem, monogram or logo]" : JSON.stringify(slot.targetText)}`;
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
  const originCopyPolicy = isMeatProductContext(job.productTruth.product)
    ? "This is a meat product. Origin copy is allowed only when the exact required target lines contain verified domestic-Korean origin wording; never preserve or invent any other origin wording."
    : "This is not a meat product. Remove every origin claim, including 국내산, 국산, 원산지 and place-of-origin badges, even when it is true or appears in the source reference/product page; origin must not occupy any visible copy slot.";
  const foodObjectPolicy = comparisonReference
    ? `- This is a semantic comparison reference. The unfavorable/problem side may contain exactly one generic, unbranded SAME-CATEGORY alternative to the current product. It must look ordinary, sparse or poor-value but still safe and edible—never spoiled, contaminated or a named competitor. The favorable/solution side must show the authoritative current product. Every other edible object must be the current product or a verified ingredient/component; remove all unrelated source foods and garnishes.`
    : `- For a food product, every visible edible object must be the current product itself or an ingredient/component explicitly proven by ProductTruth or the authoritative product images. Never retain or invent unrelated mushrooms, vegetables, fruit, meat, garnish, side dishes or ingredient piles merely because they existed in the source reference or look decorative.`;
  const shared = `
OUTPUT CONTRACT
- Use the image generation skill to EDIT or CREATE exactly one complete square raster and save it to: ${outputPath}
- Work on the full raster with AI. Do not return a background plate, blank template, SVG, HTML, Canvas instructions or a plan.
- Final composition target is a Korean performance advertisement for ${productName}, exported later as 1200x1200 JPEG.
- Never invent price, discount, origin, grade, quantity, review, efficacy, certification or urgency. Verified facts: ${facts.length ? facts.join("; ") : "none beyond the supplied copy and visible product identity"}.
- Never render shipping, free-shipping, shipping-fee, dispatch, arrival-date, courier or delivery copy, even if the source advertisement contains it.
- ${originCopyPolicy}
${foodObjectPolicy}
- Keep all important content inside a generous square safe area. No clipping, broken anatomy, fake UI, illegible Hangul or accidental overlaps.
- Preserve a real logo only when it is physically printed on the authoritative target product/package. Everywhere else, never generate a standalone logo, wordmark, calligraphic brand/product name, initials, monogram, emblem, crest, seal, certification badge, signature or stamp. A brand/product name required by the exact copy is ordinary ad typography only. User-selected advertiser branding is applied later as a separate delivery post-process, not in this raster.
- ${materialLabel(result)} uses its own randomly assigned ZIP reference. H01-H06 is only an internal ordering code; do not invent or impose a separate hook concept.

${productContract}

${humanContract}

${backgroundContract}

${originalSourceContract}
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
    const productReplacementTask = `- Change the source product instances into ${productName} using the attached product references.
- Preserve exact package geometry, material, dominant color, cap/container shape, label hierarchy, sales-unit count and recognizable product details.
- Generate the product, its contact surface, surrounding light, reflections, shadows, hands and occlusions together in one coherent raster. Never leave an empty reserved product box and never paste or restore a local product cutout later.`;
    const sceneRegionContract = integratedHumanScene
      ? `- HUMAN FULL-SCENE MODE: the source copy/price/logo/graphic text zones remain locked until stage 3, but the entire person-led photographic scene is editable as one coherent region. Regenerate the target person, action, location, surrounding props and complete photographic background together; never patch a new person onto the old location.
- EDITABLE REGIONS: old product region(s) plus the full person-led photographic scene/background excluding locked copy and graphic zones.
- LOCKED REGIONS: source copy, price, badges, borders, graphic shapes, copy-zone geometry, reading order and macro commercial layout.`
      : `- NON-HUMAN SCENE-REBUILD MODE: when a meaningful contextual background exists, the full photographic/location scene is editable and must be regenerated as a coherent current-product use occasion. Only a genuinely background-absent white/solid/achromatic/abstract/graphic/plain seamless studio field remains locked.
- EDITABLE REGIONS: old product region(s), every visible animal or animal-like character, every contextual background place and lifestyle-prop arrangement, and every semantic carrier/source-semantic prop/action attached to the old product.
- SEMANTIC CARRIER AND DECORATIVE-MOTIF REPLACEMENT IS MANDATORY, NOT OPTIONAL: do not leave a meat frying pan/grill/raw-meat tray, kimchi or brine tub, cooking vessel, drinkware, applicator, source package, knife/tongs, unrelated product/ingredient character, mascot-like produce, emoji-style icon, ingredient illustration/sticker or another old-category handling/decorative object when it makes the current product read as the wrong food/product, ingredient set or use method. Rebuild it inside the same footprint as a verified current-product-compatible carrier or motif while preserving the inherited macro visual weight and illustration style; any surrounding contextual scene still follows the mandatory background-rebuild rule.
- LOCKED REGIONS: source copy, price, badges, borders, graphic shapes, copy-zone geometry, reading order, macro layout and any genuinely background-absent simple field.`;
    const comparisonProductContract = comparisonReference
      ? `- SEMANTIC VS COMPARISON OVERRIDE: preserve the inherited left/right or problem/solution split and visible comparison marker, but assign the product roles deliberately.
- UNFAVORABLE/PROBLEM SIDE: replace the old source-category item with a generic unbranded alternative from the SAME product category as ${productName}. For a snack, this means a small, plain, less-appetizing serving of the same kind of snack—not steak, vegetables, a full meal, cosmetics or another category. It may communicate poor value through sparse quantity and ordinary presentation, but never show spoilage, danger or a named competitor.
- FAVORABLE/SOLUTION SIDE: show the authoritative current ${productName} as the clear hero, with its verified appearance and a visibly more satisfying presentation.
- Remove the old source food, garnish, sauce, side dishes, vessels and category story from BOTH sides. Rebuild each side as a coherent same-category comparison while keeping the reference's split geometry, visual weight, text zones and commercial hierarchy.
- This comparison-role rule overrides any generic instruction to repeat the exact same current product in every source product slot. Do not turn both sides into the same hero product and do not compare the current product with an unrelated category.`
      : "";
    return `STAGE 2 OF 4 — REPLACE THE PRODUCT WITH AUTHORITATIVE PRODUCT REFERENCES
${shared}
SOURCE ORDER
- FIRST attachment: the structure raster created in stage 1. Preserve its macro composition and commercial polish.
- FOLLOWING attachments: authoritative product-page images. They define the real sales unit and product identity.

TASK
${productReplacementTask}
${comparisonProductContract}
- When a source person is visible, regenerate the target-customer-relevant fictional adult and the complete surrounding scene/background together as required by HUMAN REFERENCE IDENTITY AND FULL-SCENE POLICY.
- When any source animal or animal-like character is visible, replace it with a clearly different current-product-relevant animal while preserving its count, footprint, depth, gaze, reaction role and visual style. Rebuild it together with the surrounding scene; never retain or locally patch the old animal.
- Preserve a real logo only in its physically printed package location; do not reproduce it as a separate logo elsewhere on the canvas.
- Match the original reference product positions, count, perspective, scale, shadows, reflections, contact, depth and lighting so the replacement belongs in exactly the same design.
- Apply the following region contract exactly:
${sceneRegionContract}
- If the reference repeats one product visually and is NOT a semantic comparison, repeat the same verified target product cleanly without implying a bundle or changing the verified sales unit.
- A multi-slot beauty reference may show the same verified package several times at different scales, angles or crops, or reserve non-product slots for foam, texture, verified ingredients or the regenerated use moment. It must never invent another scent, variant, package design or sales quantity.
- Do not invent variants, flavors, package counts or labels. Do not add new marketing copy, price or offer yet.
- Do not add any target-brand wordmark, emblem, seal, stamp or logo outside the physical product/package during product replacement.
`;
  }

  if (stage === "copy-replacement") {
    const packagedCopyLock = "- Never regenerate, deform, recolor, move or relabel the target product in this stage. Preserve its natural scene contact, hand occlusion, reflections and shadows; no local product layer will be restored later.";
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
- Remove source-reference disclosure copy such as '연출 이미지', '예시 이미지', '참고 이미지', '합성/생성 이미지', '이해를 돕기 위한 이미지', '실제와 다를 수 있습니다' and any source AI-use disclosure. Do not adapt, paraphrase or relocate those phrases into a speech bubble, badge, corner note or ordinary copy slot. Reconstruct the immediate background instead. Optional AI disclosure is a separate user-selected delivery post-process and must not be generated here.
- For every source-brand/remove slot, erase the complete old wordmark AND its associated badge, capsule, ribbon, button, label panel, seal or colored container inside that OCR region. Reconstruct the actual surrounding background continuously across the whole region. A blank red capsule or any other empty branded container is a critical failure. Render no replacement text, initials, emblem, stamp, badge or logo in that box. Never turn the current product or brand name into a newly invented standalone logo.
- Apply that prohibition to the ENTIRE canvas, not only the known removal boxes: do not create a logo-like handwritten/calligraphic product name, signature, seal, crest, monogram, certification badge or decorative wordmark in any corner, margin, headline area or empty space. If the exact target copy contains the product or brand name, it must remain ordinary advertising typography inside its assigned copy zone.
- A real logo printed on the locked target product/package remains part of the product identity. Any separate advertiser logo is applied only later from an explicitly selected transparent source file; do not invent it during image generation.
- Render the exact Korean strings above without paraphrasing, duplication or unsupported additions.
- Replace every visible source text block one-for-one according to the slot contract, except source-brand/remove regions which must disappear completely into reconstructed surrounding background. They must not survive as empty containers. Keep the same number of headline, support, proof, offer/label, CTA and badge zones outside those removal regions, the same reading order and approximately the same visual text mass. Do not delete a non-brand source callout merely because its old price or offer is unsupported; render its assigned verified target line in that zone without preserving the old offer meaning.
- A non-brand headline, support, proof, offer, CTA, badge, button, capsule, ribbon or panel must NEVER be left blank. Only an explicit source-brand/remove slot may become text-free. If a stale input ever assigns an empty target to a non-brand slot, use the supplied verified headline/support/offer/CTA copy that best fits that slot instead of exporting an empty visual container.
- When a slot's source text says to read the corresponding zone directly, OCR that visible reference zone yourself and replace it with the assigned target. It is never permission to erase the zone or leave an empty panel.
- Preserve rhetorical force as well as typography. If the source headline is a question, reversal, comparison, objection, urgency or numeric-emphasis hook, the target headline must remain equally dominant and must never collapse into a plain product-name label.
- Keep the reference raw copy's word order, line count, punctuation, emoji and colloquial endings such as ㅋㅋ, ;;, .. or 겨 when they exist. Do not add chat/comment/meme language when the source lacks it.
- Keep the inherited typography style, hierarchy, outline, emphasis colors, shapes and copy zones as closely as possible. Adjust font size only as needed to fit; preserve source line breaks whenever the target facts allow it.
- Preserve the reference's strong contrast. Derive at most one accent from the real product and pair it with a contrasting color; never recolor the package, tint the whole scene with the package color, or reduce text/background contrast.
- Main hook is the dominant 1–2 line message. Supporting copy is compact. Show price/offer only if supplied above.
- Render no number, price, discount, quantity or benefit that is absent from EXACT COPY TO RENDER, even if it remains visible in the source raster.
- Render no shipping, free-shipping, shipping-fee, dispatch, arrival-date, courier or delivery wording anywhere.
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
- Inspect the entire advertisement for: compliance with the background/person full-scene decision policy, reference macro-design preservation outside allowed scene/product/copy regions, real product/package identity, product count, logo/label fidelity, verified price and offer, exact Korean copy, one-for-one preservation of every source copy slot and its visual weight, preservation of the reference's headline strength, line order/punctuation/slang and information density, scene-copy alignment, Hangul spelling, mobile readability, clipping, collisions, natural shadows/perspective and coherent commercial finish.
- Inspect every inherited non-brand text container. An empty button, capsule, banner, ribbon, badge, price strip, CTA panel or headline panel is a critical failure even when its old unsupported wording was correctly removed. Fill it with the assigned verified target copy and preserve the inherited visual weight. Only explicit source-brand/remove boxes may remain text-free.
- Inspect Korean at 200–400% character level. Transcribe only the glyphs actually visible; never infer the intended word from sentence context. If a syllable block has fused, missing or malformed strokes, record it as [깨짐:판독불가] and repair it. Repeated-syllable words such as 넉넉, 촉촉 and 쫀득 must show each complete Hangul block independently, with no merged or mutated letterforms.
- For a packaged lineup, compare every visible bottle/package independently against the authoritative references. Repair duplicated generic packages, wrong cap/container colors, invented variants, changed printed volume, malformed brand marks and random readable label glyphs. Keep at least one dominant package large and unobstructed enough for mobile identity recognition.
- If the original advertisement reference contains a person, confirm that the finished ad uses a visibly different target-customer-relevant fictional adult and that the person, action, location, surrounding props and complete photographic background were rebuilt together as one coherent target-product scene. Removing the person, patching a new person onto the old background, preserving the old location/category story, preserving a near-identical pose/framing, using an unrelated demographic, retaining recognizable identity, or face-swapping on the same body is a critical error; rebuild the entire integrated human scene/background while preserving copy and macro-design zones.
- If the original reference has no person, compare the background against the source. Unnecessary regeneration of a white, plain, achromatic, abstract, graphic, studio, neutral wall/table/surface, plate-centered hero or already compatible use scene is an error and must be reverted. A clearly incompatible old-category place may change. An incompatible semantic carrier, source prop or product-linked decorative motif—including a frying pan, grill, raw-meat tray, kimchi/brine tub, cooking vessel, drinkware, applicator, ingredient pile, source package, knife/tongs, category-specific hand action, unrelated ingredient/product character, mascot-like produce, emoji-style product icon, ingredient illustration, sticker or pictogram—MUST change when retaining it makes the current product read as a different category, ingredient set, preparation/storage method or use occasion. Repair it inside its inherited footprint without regenerating the compatible surrounding background. For a character/icon replacement, preserve the reference's count, position, scale, crop, expression, pose, line weight and illustration style while changing its literal identity only to a ProductTruth-verified or authoritative-image-proven current-product motif. If no ingredient/component is verified, use the current product itself as the motif rather than inventing an ingredient.
- For meat products, inspect the actual cut, width-to-thickness ratio, fat-cap thickness, fiber direction, irregular marbling frequency/density/fat boundaries, surface moisture, raw/cooked state, browning and color against the authoritative product references. Repair thickened or rounded generic steak shapes, exaggerated premium marbling, white spiderweb/worm-like fat, cloned vein maps, plastic, waxy, rubbery, neon-red/orange or uniformly glossy meat texture.
- Repair every discovered issue inside the full raster with image generation. Preserve the randomly selected reference's composition and the established product placement and correct text wherever possible.
- Source-brand/remove OCR boxes must contain no standalone text, emblem, monogram, stamp or invented target-brand logo after their immediate background is reconstructed. Preserve only a real mark that is physically printed on the locked target product/package.
- A source-brand/remove region must not survive as a blank badge, capsule, ribbon, button, label panel, seal, colored patch or empty branded container. Remove the complete visual container and reconstruct continuous surrounding background unless that shape is independently required by another verified non-brand copy slot.
- Inspect the complete canvas beyond those known boxes. Any newly created calligraphic brand/product name, standalone wordmark, initials, monogram, emblem, crest, seal, certification badge, signature or stamp outside the physical package is a critical error. Remove the complete invented mark and reconstruct only its immediate background; never replace it with another text mark.
- Remove any hallucinated source brand, invented standalone target-brand logo, unsupported claim, malformed logo, stray glyph, duplicate word or mismatched price. Any number not present in AUTHORITATIVE COPY is a critical error.
${comparisonReference ? `- SEMANTIC COMPARISON QA: the problem/unfavorable side must show a generic unbranded SAME-CATEGORY alternative, while the solution/favorable side must show the authoritative current ${productName}. Fail if both sides show the same hero product, if the unfavorable side contains an unrelated meal/product category, if the old source food or garnish remains, or if the visual no longer communicates a clear problem-versus-solution relationship.` : ""}
- Search every speech bubble, badge, label, corner, footer and small-print area for source-reference disclosure copy such as '연출 이미지', '예시 이미지', '참고 이미지', '합성/생성 이미지', '이해를 돕기 위한 이미지', '실제와 다를 수 있습니다' or any source AI-use disclosure. Remove the complete disclosure and reconstruct its immediate background. Do not add a replacement disclosure here; optional AI disclosure is applied only by a separate user-selected delivery post-process.
- Do not create a new unrelated concept and do not patch with a local overlay.
- Repair product identity inside this complete AI raster. No protected local layer, cutout or package overlay will be restored afterward.
${feedback ? `KNOWN QA FEEDBACK\n${feedback}` : "Run a complete visual QA pass even when no prior validator feedback is supplied."}
`;
}

export function buildNativeValidationPrompt(job: GenerationJob, result: GenerationResult) {
  const productContract = productRenderingPromptContract(job, result);
  const originCopyPolicy = isMeatProductContext(job.productTruth.product)
    ? "This is a meat product. Origin copy is allowed only when the exact required target lines contain verified domestic-Korean origin wording; never preserve or invent any other origin wording."
    : "This is not a meat product. Remove every origin claim, including 국내산, 국산, 원산지 and place-of-origin badges, even when it is true or appears in the source reference/product page; origin must not occupy any visible copy slot.";
  const backgroundContract = backgroundAdaptationContract(job, result);
  const integratedHumanScene = nativeReferenceRequiresHumanReplacement(result);
  const semanticComparison = nativeReferenceRequiresComparisonSemantics(result);
  const sourceBrandRegionClearRequired = nativeReferenceRequiresSourceBrandRegionClear(result);
  const adaptedLines = result.referenceAdaptedCopyPlan?.adaptedLines || [result.hookPlan.headline, result.hookPlan.body, result.hookPlan.proof, result.hookPlan.offer, result.hookPlan.cta].filter(Boolean);
  const copySlots = result.referenceAdaptedCopyPlan?.copySlots || [];
  const sourceBrandRemovalSlots = copySlots
    .filter((slot) => slot.sourceType === "source-brand" || slot.replacePolicy === "remove")
    .map((slot) => ({ index: slot.index, sourceText: slot.sourceText, box: slot.box }));
  const sourceSlotCount = copySlots.length
    ? copySlots.filter((slot) => slot.sourceText.trim() && slot.sourceType !== "source-brand" && slot.replacePolicy !== "remove").length
    : result.referenceAdaptedCopyPlan?.referenceRawLines?.filter((line) => line.trim()).length || 0;
  const targetCustomer = targetCustomerForHuman(job, result);
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
Source-brand region clear required: ${sourceBrandRegionClearRequired}. Every listed source-brand region must lose both its text/logo and its associated visual container; an empty badge/capsule/ribbon/button/colored panel is not cleared background.
Semantic comparison required: ${semanticComparison}. When true, the unfavorable side must depict one generic unbranded same-category alternative and the favorable side must depict the authoritative current product; an unrelated product category or the same hero product on both sides fails.
This is a reference-driven replacement workflow. Judge the selected reference's composition and design grammar; do not require a separate scene concept that conflicts with that reference.
${backgroundContract}
${integratedHumanScene ? "Because the reference contains a person, require one coherent regenerated person+action+location+props+complete-background scene. A new person patched onto the old location or old category story fails sceneProductInteractionAligned." : "If the reference contains a meaningful contextual background, require one coherent regenerated product-relevant place and surrounding prop arrangement; retaining a merely plausible old desk, room, table or lifestyle scene fails contextualBackgroundRebuilt. Only a genuinely background-absent white/solid/achromatic/abstract/graphic/plain seamless studio field should remain unchanged."}
The inspected attachment has already been locally normalized and decoded as a 1200x1200 JPEG under 800KB. Set exportCompliance to 100 and never request a visual remake for file format, dimensions or byte size.
Check fidelity to the reference layout, product/package identity, exact Korean copy, one-for-one copy-block count outside removal slots, headline rhetorical strength, information density, factual safety, mobile readability, natural anatomy/food texture, and whether this is one coherent finished ad rather than a background plus pasted product/text panel. Inspect every inherited non-brand button, capsule, banner, ribbon, badge, price strip, CTA panel and headline panel: an empty visual text container is a critical failure and requires revise. A source-brand/remove region may be text-free only after its complete badge/capsule/ribbon/button/label container has also been removed and the surrounding background reconstructed continuously. Set sourceBrandRegionCleared=false and list the region in sourceBrandRegionFindings if any empty branded container, colored pill or old-brand silhouette remains. Search every speech bubble, badge, label, corner, footer and small-print area for source-reference disclosure copy including '연출 이미지', '예시 이미지', '참고 이미지', '합성/생성 이미지', '이해를 돕기 위한 이미지', '실제와 다를 수 있습니다' and source AI-use disclosures. Transcribe any such disclosure literally into observedKoreanText and require revise; it must be removed from the base creative rather than adapted or relocated. Optional AI disclosure is a separate user-selected delivery post-process and must not be generated or required during this QA. Inspect the final image at 200–400% and transcribe only the glyphs literally visible into observedKoreanText; do not autocorrect or infer intended words from Required target lines. Mark fused, missing or malformed Hangul strokes as [깨짐:판독불가]. Repeated-syllable words such as 넉넉, 촉촉 and 쫀득 require two separately complete syllable blocks. Also read the Korean target lines as consumer-facing sentences: subject and predicate, particles, modifiers and sentence endings must be natural when adjacent lines are joined. A grammatically broken slot substitution, non-human subject performing a human action, dangling connective ending or incomplete comma is a Korean-copy and commercial-quality failure even when every Hangul glyph was rendered exactly. The final image must keep the reference's design grammar but contain no source product, source wording, source price or source advertiser identity. Every listed source-brand/remove box must contain only reconstructed surrounding background: any standalone replacement brand text, empty badge container, stylized initials, emblem, stamp or invented logo in those boxes requires revise. Separately inspect the entire canvas for a newly generated standalone logo-like mark outside the physical target product/package. A calligraphic or handwritten brand/product name, standalone wordmark, initials, monogram, emblem, crest, seal, certification badge, signature or stamp counts as a generated logo even when its letters are spelled correctly or resemble required copy. Ordinary ad copy in an assigned text zone is not a logo. Set standaloneLogoDetected=true, describe each finding in standaloneLogoFindings and require revise whenever any such generated mark exists; only a real logo physically printed on the authoritative product/package is exempt. A detached cutout, plain product-name headline replacing a strong source hook, missing non-brand source copy zones, any number absent from the required target lines, fake label, broken Hangul, invented claim, large layout drift or surviving source identity requires revise. Scores must use the 0–100 scale.

${originCopyPolicy} Transcribe any visible origin wording into observedKoreanText and require revise whenever it violates this policy.

MANDATORY FOOD-OBJECT AUDIT: inspect the complete canvas and enumerate every visible edible object, ingredient, garnish, side dish and food-shaped decorative motif. Compare each one with the current product, ProductTruth and authoritative product images. Set unrelatedFoodOrIngredientDetected=true if even one edible object cannot be verified as the current product or a real ingredient/component; list it precisely in unrelatedFoodOrIngredientFindings and require revise. For example, mushrooms beside apples, bell peppers beside crackers, meat-table garnishes beside dried fruit, or unrelated produce characters are critical failures. For non-food products set the field false unless food is incorrectly present in the scene.

If the selected advertisement reference contains a person, treat that source person only as evidence that the composition needs a human—not as an identity, pose, action, expression, wardrobe, location or category-story reference. The final must contain a clearly different fictional adult suitable for the verified target customer (${targetCustomer}) and must visibly change at least TWO of: body orientation, pose/action, hand gesture or product grip, gaze, camera angle/height, crop, or position. The target person, action, styling, location, surrounding props, lighting and complete photographic background must form one newly generated coherent scene; person-only patching onto the old background is a critical failure. Compare concrete background landmarks between the reference and final—desk objects, pencils, bottles, glasses, wall art, furniture edges, windows, shelves, tile seams, plants and lighting patterns. If several distinctive landmarks remain in the same positions, set humanSceneBackgroundRebuilt=false even when the face, hands or product changed, and list those landmarks in humanSceneBackgroundFindings. A deleted person, the same face or biometric likeness, a face swap on the same body, a near-identical pose/framing, or an obviously unrelated target model is also a critical failure. Set sourcePersonDetected=true whenever the reference contains any visible person, partial body, model-led hand or recognizable face. Set sourcePersonReplaced=true only when a new person remains in the final and the source identity is fully gone. Set humanCompositionChanged=true only when at least two listed human-composition attributes visibly changed and the human scene is not a person-only patch. Set humanSceneBackgroundRebuilt=true only when the old location pixels and distinctive background landmark arrangement are genuinely gone. Score targetAudienceFit from 0–100 and explain failures in humanReplacementFindings. Independently set humanCopyAligned=false when the new person's action, expression, styling or situation does not visually support the exact target copy, or still tells the source advertisement's story; explain this in humanCopyAlignmentFindings.

MANDATORY ANIMAL AUDIT: set sourceAnimalDetected=true whenever the reference contains any real animal, illustrated animal, animal mascot or animal-like character. When true, the final must retain the inherited animal count, approximate footprint, depth, gaze, reaction/action role and visual style but use a clearly different current-product-relevant animal or animal character. Set sourceAnimalReplaced=false if the original animal identity remains, the animal was merely deleted, an arbitrary unrelated species was inserted, or a new animal was pasted over the old scene without coherent contact and lighting. List concrete mismatches in animalReplacementFindings and require revise.

MANDATORY CONTEXTUAL-BACKGROUND AUDIT: compare the original reference and final. Set sourceContextualBackgroundDetected=true whenever the reference has a recognizable real place, furnished room, desk, shelf, kitchen, bathroom, outdoor location, contextual tabletop or lifestyle-prop arrangement. White, solid-color, achromatic, abstract/graphic and genuinely plain seamless studio fields without place/prop meaning are not contextual backgrounds. When a contextual background exists, set contextualBackgroundRebuilt=true only when its old place pixels and distinctive landmark/prop arrangement are genuinely gone and a coherent current-product-and-copy-aligned scene replaces them while preserving macro camera depth, negative space, product/text footprints and commercial layout. A plausible but unchanged art desk, room, table, kitchen or bathroom fails. List surviving landmarks or context mismatch in contextualBackgroundFindings and require revise.

Independently set sceneProductInteractionAligned=false when the final person's gesture, animal role or surrounding full scene still communicates the source category, when a person/animal was patched onto the old location, when a background-absent neutral/simple field was unnecessarily turned into a conflicting scene, OR when an old-category semantic carrier or product-linked decorative motif remains—for example a snack/dried fruit left in a meat frying pan, grill or raw-meat tray; food left in a kimchi/brine tub that implies the wrong product; cosmetics left in cookware; unrelated fruit/vegetable/product characters or ingredient icons left around another food; or any incompatible vessel, tool, ingredient pile, source package, mascot, sticker, pictogram or handling action. A retained incompatible semantic carrier or decorative motif is a critical failure: add a concrete failure finding and require recommendation=revise even if product pixels, copy and layout are otherwise correct. A replacement character/icon must preserve the inherited style and emotional/layout role but depict only the verified current product or a ProductTruth/authoritative-image-proven ingredient or component; an invented ingredient is also a critical failure. For food, smelling clothing/body, showering, skincare gestures or a product merely pasted beside a non-eating person are also critical failures. Explain this in sceneProductInteractionFindings. For meat, compare directly with the authoritative seller photos: a generic or thicker substituted cut, altered width-to-thickness ratio, exaggerated marbling grade/density, repeated or mirrored vein map, spiderweb/worm-like fat, smooth plastic/waxy surface, neon color, impossible fibers or uniformly lacquered gloss is a critical foodAppetiteAppeal and productIdentity failure.

When Semantic comparison required is true, set comparisonSemanticAligned=true only if the inherited problem/solution or left/right relationship remains immediately legible: the unfavorable side is one unbranded same-category alternative and the favorable side is the authoritative current product. Set it false if the negative side is an unrelated meal/category, if old source garnishes remain, if both sides show the same current hero product, if the VS relationship disappeared, or if the copy no longer assigns a concrete disadvantage to the unfavorable side and a concrete benefit to the current product. List the exact mismatch in comparisonSemanticFindings.

${productContract}
For every packaged product—including cosmetics, wellness goods, drinks, milk, bottles, cans, pouches and boxes—compare each visible package separately. Any duplicated generic package, invented variant, changed container, cap, label, logo, printed text, volume, color or sales unit is a critical failure. At least one dominant package must remain recognizable at mobile size. A detached product cutout, reserved empty package box, pasted package panel, product with no coherent contact/occlusion, or evidence of a local package overlay is a critical failure. For meat, judge whether the original cut and marbling evidence were translated into natural, appetizing, physically coherent food photography rather than pasted or replaced with a different cut.`;
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
