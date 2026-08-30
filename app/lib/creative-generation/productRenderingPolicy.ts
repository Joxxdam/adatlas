import type { GenerationJob, GenerationResult } from "./types";

export type ProductRenderingPolicy = "natural-meat-reference" | "ai-packaged-product-reference" | "standard-reference";

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
    return `MEAT PRODUCT POLICY — NATURAL SCENE INTEGRATION
- Treat the highest-resolution authoritative URL product photos as the visual truth for the sold cut, muscle direction, irregular marbling boundaries, fat-to-lean ratio, meat color, thickness, surface moisture, pack count and label. Do not average these details into a generic steak or chicken image.
- Before generating, compare several authoritative raw-product photos and lock the sold cut's cross-section outline, slice width-to-thickness ratio, fat-cap thickness, muscle-group boundaries, marbling frequency, branch thickness and density range. Match the normal/median slice shown by the seller; never make the meat thicker, rounder, redder or more heavily marbled merely to look premium.
- Recreate that same meat naturally in the reference composition with coherent perspective, contact, shadows and food lighting. It must look photographed in the scene, never like a rectangular source photo or detached cutout pasted on top.
- Preserve fine physical microtexture: non-repeating muscle fibers, naturally uneven fat edges, small thickness variations, restrained moisture and believable pores. Every slice must have its own plausible irregular grain; do not clone, mirror or repeat the same vein map across pieces. Raw meat is moist but not lacquered, glassy, rubbery or uniformly glossy.
- Marbling must remain subordinate to the actual muscle structure. Do not add dense white spiderwebs, oversized veins, worm-like fat, near-symmetrical branching or a higher marbling grade than the source evidence. Preserve the seller photo's natural gaps and asymmetry so the result remains appetizing rather than anatomical or grotesque.
- For cooked meat, use physically plausible browning: irregular sear, rendered fat, small char variation and believable juices. Do not turn the surface into smooth orange glaze unless the authoritative product reference visibly confirms a sauce or glaze.
- A raw-to-cooked or serving scene may be generated only when the hook needs it and the supplied references support it; keep the same identifiable cut, pre-cook thickness and plausible shrinkage, and do not invent a different cut, grade, origin, quantity or package.
- The assigned advertisement composition is ${result.nativeCreative?.adReference?.compositionType || "reference-defined"}. In a product-packshot or product-lineup composition, if the authoritative product reference shows the sold meat in separate vacuum packs, trays or labeled units, preserve that packaging format and visible unit count. Never unwrap and repack it into the source advertiser's gift box or tray.
- In a genuine cooking or serving composition, show only a plausible portion unwrapped while keeping the verified sold unit truthful; do not imply a different bundle, tray count or gift-set package.
- Match the reference photo's white balance and natural food color. Avoid neon red/orange saturation, cloned marbling, symmetrical fibers, melted-plastic highlights, waxy skin, floating trays and unrelated stock meat photography.
- Use the source photos as visual evidence, not as pixels to paste: recreate the product coherently inside the selected advertisement layout and never crop, screen-capture, cut out or locally composite the seller photo.
- If the source evidence is insufficient for a convincing close-up, use a slightly wider credible cooking or serving composition instead of hallucinating macro texture.${constraintContract}`;
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
