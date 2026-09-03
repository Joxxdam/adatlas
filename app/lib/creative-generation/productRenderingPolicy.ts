import type { GenerationJob, GenerationResult } from "./types";

export type ProductRenderingPolicy = "natural-meat-reference" | "ai-packaged-product-reference" | "standard-reference";

export type MeatPresentationMode = "clean-retail-cut" | "verified-set-composition" | "hook-supported-cooked-scene";

export type MeatPresentationContract = {
  mode: MeatPresentationMode;
  hasAuthoritativeCutEvidence: boolean;
  hasAuthoritativeCookedEvidence: boolean;
  hookNeedsCookedScene: boolean;
  referenceNeedsCookedScene: boolean;
  cookedSceneAllowed: boolean;
  hasVerifiedSetComposition: boolean;
  verifiedPackCount?: number;
};

function parseVerifiedPackCount(values: Array<string | undefined>) {
  const counts = [...new Set(values
    .flatMap((value) => Array.from(String(value || "").matchAll(/(?:^|\s|[(/,+])([2-9]|[1-9]\d)\s*(?:팩|개입|개|봉|트레이|박스)(?=세트|입|$|\s|[)}/,+x×])/gi)))
    .map((match) => Number(match[1]))
    .filter((count) => Number.isInteger(count) && count >= 2 && count <= 99))];
  // "3팩/4팩/5팩 옵션"처럼 선택지 여러 개가 함께 노출되면 현재 판매
  // 단위를 확정할 수 없다. 하나의 고유 팩 수만 반복 확인될 때만 사용한다.
  return counts.length === 1 ? counts[0] : undefined;
}

function hookNeedsCookedMeatScene(result: GenerationResult) {
  const premise = result.referenceAdaptedCopyPlan?.creativePremise;
  const brief = result.hookPlan.creativeBrief;
  const hookSceneText = [
    result.hookPlan.headline,
    result.hookPlan.body,
    result.hookPlan.proof,
    result.hookPlan.cta,
    result.hookPlan.sceneIntent,
    result.hookPlan.visualDirection,
    ...(result.referenceAdaptedCopyPlan?.adaptedLines || []),
    premise?.situation,
    premise?.tension,
    premise?.productBridge,
    brief?.sceneDescription,
    brief?.visualStory,
  ]
    .filter(Boolean)
    .join(" ");
  // 상품명에 들어 있는 '스테이크/구이용'은 조리 장면의 근거가 아니다. 실제
  // 소비자 문구나 장면 의도가 굽기·먹기·육즙 같은 감각적 payoff를 요구해야 한다.
  return /팬에\s*(?:굽|올리)|불판|그릴|숯불|직화|굽(?:는|고|자|기|어|습니다)|구워|구운|익혀|조리|상차림|플레이팅|식탁|한입|먹(?:는|어|자|고)|드시|드셔|육즙|불향|겉바속촉|시즐|sear|sizzl|\bgrill(?:ed|ing)?\b|\bcook(?:ed|ing)?\b|\bserv(?:e|ed|ing)\b|\btast(?:e|ing)\b/i.test(hookSceneText);
}

function referenceNeedsCookedMeatScene(result: GenerationResult) {
  // 육류 before/after는 복수 판매 단위가 아니라 상태 변화 슬롯이다. 문구에
  // '굽다'가 없더라도 레퍼런스가 요구하는 원물→조리 payoff를 보존한다.
  return result.nativeCreative?.adReference?.compositionType === "before-after";
}

function hasVerifiedMultiUnitVisual(job: GenerationJob) {
  const sourceCandidateProof = (job.productTruth.product.sourceImageCandidates || []).some(
    (candidate) => candidate.multipleObjectsAreSalesUnit === true && candidate.selected !== false
  );
  const profileProof = (job.productReferenceProfile?.referenceImages || []).some(
    (image) => image.usableForGeneration && !image.duplicateOf && /세트|구성|전체|라인업|여러\s*(?:팩|개)|[2-9]\s*(?:팩|개|트레이)/i.test(image.description || "")
  );
  const assetProof = [...(job.productTruth.imageAssets || []), ...(job.productTruth.referenceImages || [])].some((asset) => {
    const signals = [asset.reason, ...(asset.classificationSignals || [])].join(" ");
    return asset.verified && /세트|구성|전체|라인업|multi[- ]?unit|sales[- ]?unit|multiple\s+objects/i.test(signals);
  });
  return sourceCandidateProof || profileProof || assetProof;
}

export function resolveMeatPresentationContract(job: GenerationJob, result: GenerationResult): MeatPresentationContract {
  const hasAuthoritativeCutEvidence =
    (job.productReferenceProfile?.referenceImages || []).some((image) => image.usableForGeneration && !image.duplicateOf && image.role !== "brand-logo") ||
    Boolean(job.productTruth.confirmedProductImage || job.productTruth.imagePaths?.length || job.productTruth.product.confirmedProductImagePaths?.length);
  const hasAuthoritativeCookedEvidence = (job.productReferenceProfile?.referenceImages || []).some(
    (image) => image.role === "cooked" && image.usableForGeneration && !image.duplicateOf
  );
  const hookNeedsCookedScene = hookNeedsCookedMeatScene(result);
  const referenceNeedsCookedScene = referenceNeedsCookedMeatScene(result);
  const cookedSceneAllowed = hasAuthoritativeCutEvidence && (hookNeedsCookedScene || referenceNeedsCookedScene);
  const verifiedFacts = (job.productTruth.facts || []).filter(
    (fact) => fact.verification !== "unverified" && (fact.evidenceType === "composition" || fact.evidenceType === "quantity")
  );
  const verifiedPackCount = parseVerifiedPackCount([
    job.productReferenceProfile?.immutableFacts?.count,
    job.productReferenceProfile?.immutableFacts?.quantity,
    ...(job.productReferenceProfile?.immutableFacts?.includedItems || []),
    job.productTruth.normalized.composition,
    job.productTruth.normalized.quantity,
    job.productTruth.normalized.packageOrOption,
    ...verifiedFacts.flatMap((fact) => [fact.label, fact.value]),
  ]);
  const hasVerifiedSetComposition = Boolean(verifiedPackCount && hasVerifiedMultiUnitVisual(job));
  const mode: MeatPresentationMode = cookedSceneAllowed
    ? "hook-supported-cooked-scene"
    : hasVerifiedSetComposition
      ? "verified-set-composition"
      : "clean-retail-cut";
  return {
    mode,
    hasAuthoritativeCutEvidence,
    hasAuthoritativeCookedEvidence,
    hookNeedsCookedScene,
    referenceNeedsCookedScene,
    cookedSceneAllowed,
    hasVerifiedSetComposition,
    verifiedPackCount,
  };
}

export function resolveProductRenderingPolicy(job: GenerationJob): ProductRenderingPolicy {
  const profile = job.creativePlan?.categoryCreativeProfile?.category;
  const override = job.referenceCategoryOverride;
  const productType = String(job.productReferenceProfile?.immutableFacts?.productType || "").toLowerCase();
  const productText = [job.productTruth.product.category, job.productTruth.product.productName, job.productTruth.normalized?.cleanProductName, productType].filter(Boolean).join(" ");
  if (profile === "food_meat" || /한우|소고기|쇠고기|돼지고기|삼겹살|갈비|등심|안심|스테이크|육류|정육/i.test(productText)) {
    return "natural-meat-reference";
  }
  // 사용자가 고른 식품 풀과 ProductTruth의 식품 프로필을 우선한다. 상품명에
  // '건강간식'처럼 마케팅 단어가 있다는 이유만으로 건강·웰니스 상품으로
  // 재분류하면 원물/간식을 불필요한 포장 상품 AI 정책으로 보내게 된다.
  if (override === "food-snack" || override === "food-produce" || profile === "food_fresh" || /snack|fruit|produce|agriculture|간식|과일|농산물/i.test(productType)) {
    return "standard-reference";
  }
  const packageText = [productText, job.productTruth.normalized?.packageOrOption, job.productTruth.normalized?.quantity, job.productTruth.normalized?.composition].filter(Boolean).join(" ");
  const beautyOrHealth = override === "beauty" || ["beauty_cosmetics", "personal_care", "health"].includes(profile || "");
  const unmistakablyPackaged = /화장품|스킨케어|바디워시|샤워젤|샴푸|클렌저|세럼|앰플|크림|로션|에센스|향수|건강기능식품|건기식|영양제|비타민|유산균|홍삼|우유|음료|주스|커피|녹차|홍차|말차|보이차|유자차|생강차|차음료|티백|소스|보틀|캔|파우치|튜브|단지|bottle|can\b|pouch|tube|jar|milk|drink|juice|tea\b/i.test(packageText);
  if (beautyOrHealth || unmistakablyPackaged) {
    return "ai-packaged-product-reference";
  }
  return "standard-reference";
}

export function productRenderingPromptContract(job: GenerationJob, result: GenerationResult) {
  const policy = resolveProductRenderingPolicy(job);
  const productConstraints = job.productTruth.productCopyConstraints || [];
  const constraintContract = productConstraints.length
    ? `\nPRODUCT CONDITION CONSTRAINTS — INTERNAL, NEVER RENDER AS COPY
- These OCR-backed notes prevent visual or verbal overstatement: ${productConstraints.join("; ")}
- Do not print, paraphrase or expose these cautionary notes in the advertisement. Use them only to avoid depicting a more premium grade, more uniform appearance, different use class or better physical condition than the actual sold product.`
    : "";
  if (policy === "natural-meat-reference") {
    const presentation = resolveMeatPresentationContract(job, result);
    const presentationContract = presentation.mode === "verified-set-composition"
      ? `RESOLVED MEAT PRESENTATION MODE: VERIFIED SET COMPOSITION
- Show exactly ${presentation.verifiedPackCount} separately countable sales units in one coherent composition because both the verified quantity fact and a multi-unit seller image support it.
- Preserve the seller-proven tray/vacuum-pack shape, label position, package color and unit arrangement. Do not invent gold trays, gift boxes, garnish, extra packs, a ceremonial set, a new package brand or any readable label text that is not literally proven by the authoritative seller image.`
      : presentation.mode === "hook-supported-cooked-scene"
        ? `RESOLVED MEAT PRESENTATION MODE: HOOK-SUPPORTED COOKED SCENE
- A cooked or serving view is allowed because the seller's authoritative raw/cut evidence exists AND this material's exact hook/scene or inherited before/after structure calls for cooking, eating or sensory payoff. A seller-provided cooked reference is helpful but not required.
- The cooked result must still be visibly traceable to the same sold cut. Use plausible shrinkage, appetizing irregular searing, rendered fat, moist cut surfaces and abundant but physically believable meat juices; never use a dry, burned, plastic-looking or generic stock steak.
- Make the cooked scene visibly prove the assigned hook at first glance: a sizzle/grill hook needs active heat and searing, an eating hook needs a natural serving or bite moment, and a juiciness hook needs a restrained cut/open surface with believable moisture. Do not use cooked meat as unrelated decoration.`
        : `RESOLVED MEAT PRESENTATION MODE: CLEAN RETAIL CUT
- Do not show cooked meat. Present the seller-proven raw/chilled cut, one verified retail unit, tray or package as clean commercial food photography.
- Favor an immediately legible cut silhouette and natural color over extreme macro detail. If a multi-pack quantity lacks visual sales-unit proof, show one verified unit without implying that it is the full set.
- Unless the authoritative seller evidence proves an actual package/set and exact unit count, show the meat unwrapped. Never fill an unused product slot with a gift box, gold tray, retail package or invented label.`;
    return `MEAT PRODUCT POLICY — NATURAL SCENE INTEGRATION
${presentationContract}
- This resolved mode is mandatory for this material. The selected reference's semantic structure is authoritative: before/after means a truthful state transition, not two packages. Do not substitute a required cooked/served state with a gift box, gold tray or retail package.
- Treat the highest-resolution authoritative URL product photos as the visual truth for the sold cut, muscle direction, irregular marbling boundaries, fat-to-lean ratio, meat color, thickness, surface moisture, pack count and label. Do not average these details into a generic steak or chicken image.
- RAW/COOKED HOOK GATE: inspect the authoritative product attachments and the exact material hook before choosing a cooking state. A cooked view is allowed when the seller evidence proves the real raw cut/thickness AND the exact hook or scene calls for cooking, eating, serving, searing or juiciness. A product title containing words such as steak, grill or barbecue is not enough by itself. If the hook does not need a cooked payoff, keep the hero meat raw/chilled or packaged even when the selected reference contains cooked food.
- PRODUCT IDENTITY OVERRIDES THE SOURCE FOOD SCENE: a frying pan, grill or plated-steak reference never authorizes converting thin or irregular seller cuts into thick medallions, cubes, fillets or generic steak blocks. Preserve the reference's macro visual footprint and advertising hierarchy, but change the carrier or presentation whenever that is necessary to keep the real sold cut recognizable.
- Before generating, compare several authoritative raw-product photos and lock the sold cut's cross-section outline, slice width-to-thickness ratio, fat-cap thickness, muscle-group boundaries, marbling frequency, branch thickness and density range. Match the normal/median slice shown by the seller; never make the meat thicker, rounder, redder or more heavily marbled merely to look premium.
- SHAPE CONSERVATION: copy the seller evidence's median width-to-thickness ratio, irregular perimeter, taper, muscle direction and piece-to-piece variation. Cooking shrinkage may reduce width and add irregular browning, but it must never increase apparent thickness, round the perimeter, regularize every piece into the same rectangle or make multiple pieces look cast from one mold.
- Recreate that same meat naturally in the reference composition with coherent perspective, contact, shadows and food lighting. It must look photographed in the scene, never like a rectangular source photo or detached cutout pasted on top.
- Preserve fine physical microtexture: non-repeating muscle fibers, naturally uneven fat edges, small thickness variations and believable pores. Every slice must have its own plausible irregular grain; do not clone, mirror or repeat the same vein map across pieces.
- APPETITE LIGHTING IS REQUIRED: use warm directional commercial food light, rich but credible red lean, creamy natural fat, local contrast and depth, plus small varied specular highlights on fresh cut surfaces and edges. Raw meat must look freshly cut and naturally moist—not matte, chalky, gray, dry or dehydrated. Moisture must remain localized and physically believable, never slimy, lacquered, glassy or uniformly glossy.
- Keep detail at appetizing retail-photography distance. Never exaggerate pores, torn fibers, wet connective tissue, blood, sinew or anatomical cross-sections, and never print, emboss or draw a decorative grain pattern onto the meat surface.
- Marbling must remain subordinate to the actual muscle structure. Do not add dense white spiderwebs, oversized veins, worm-like fat, near-symmetrical branching or a higher marbling grade than the source evidence. Preserve the seller photo's natural gaps and asymmetry so the result remains appetizing rather than anatomical or grotesque.
- For cooked meat, use physically plausible browning: irregular sear, rendered fat, small char variation, moist cut surfaces and abundant but believable juices. Do not make it dry or burned, and do not fake juiciness with orange glaze, glassy coating or an impossible pool of liquid unless the authoritative product reference visibly confirms a sauce.
- A raw-to-cooked or serving scene may be generated when the hook needs it and the authoritative seller images clearly establish the sold raw cut. Keep the same identifiable cut, pre-cook width-to-thickness ratio and plausible shrinkage, and do not invent a different cut, grade, origin, quantity or package. If a seller-provided cooked reference exists, use it as additional browning and doneness evidence; otherwise infer only physically ordinary cooking changes from the verified raw cut.
- The assigned advertisement composition is ${result.nativeCreative?.adReference?.compositionType || "reference-defined"}. In a product-packshot or product-lineup composition, if the authoritative product reference shows the sold meat in separate vacuum packs, trays or labeled units, preserve that packaging format and visible unit count. Never unwrap and repack it into the source advertiser's gift box or tray.
- In a genuine cooking or serving composition, show only a plausible portion unwrapped while keeping the verified sold unit truthful; do not imply a different bundle, tray count or gift-set package.
- No AI-invented meat packaging: outside verified-set-composition, do not create a branded tray, gift box, package badge or readable physical label. Inside verified-set-composition, never invent or paraphrase package wording; an unsupported package brand or label is a critical failure.
- Match the reference photo's white balance and natural food color. Avoid neon red/orange saturation, cloned marbling, symmetrical fibers, melted-plastic highlights, waxy skin, floating trays and unrelated stock meat photography.
- Use the source photos as visual evidence, not as pixels to paste: recreate the product coherently inside the selected advertisement layout and never crop, screen-capture, cut out or locally composite the seller photo.
- If the source evidence is insufficient for a convincing close-up, do not hallucinate macro texture or a generic cooked steak. Generate a slightly wider raw/chilled preparation, verified tray, gift-set or package-led composition that keeps the seller-proven product identity visible.${constraintContract}`;
  }
  if (policy === "ai-packaged-product-reference") {
    return `PACKAGED PRODUCT POLICY — FULL AI REFERENCE INTEGRATION
- Treat the authoritative URL product images as strict visual evidence for the real package, but never extract, cut out, paste, locally composite or restore their pixels after generation.
- Recreate the current product and its surrounding scene together as one coherent photographic raster. The package must share the scene's perspective, contact, hand occlusion, reflections, water/foam, shadows, color temperature and lighting; it must never look like a floating sticker or reserved placeholder.
- Match the real container silhouette, proportions, cap, package geometry, dominant colors, material, label hierarchy, logo position, printed volume and verified sales-unit count as closely as the supplied product references allow. Do not substitute a generic package.
- Keep one dominant hero package large and unobstructed enough for its recognizable identity and label hierarchy to read on mobile. Do not invent tiny readable label claims when the source evidence is unclear.
- For a multi-variant lineup, identify every authoritative package separately and preserve each verified variant's own color, cap, logo position and printed volume. Never duplicate a generic package into invented variants or imply a larger sales unit.
- Replace the reference advertiser's product inside the inherited product role and visual footprint. Preserve the reference's commercial hierarchy while adapting product interaction to the current item.
- If the selected reference contains a person or hand, generate the product, grip, fingers, occlusion and complete surrounding scene together. Never reserve an empty product rectangle and never add the package after the person/background is finished.
- If identity fidelity is insufficient, regenerate the complete AI raster and recheck it against the authoritative product images. A local product cutout is never an allowed repair.${constraintContract}`;
  }
  return `STANDARD PRODUCT REFERENCE POLICY
- Preserve the authoritative URL product's type, silhouette, proportions, package structure, dominant colors, count and recognizable details while integrating it naturally into the scene.${constraintContract}`;
}
