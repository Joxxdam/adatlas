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
  if (override === "food-produce" || profile === "food_fresh" || /fruit|produce|agriculture|과일|농산물/i.test(productType)) {
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
  if (policy === "natural-meat-reference") {
    return `MEAT PRODUCT POLICY — NATURAL SCENE INTEGRATION
- Treat the highest-resolution authoritative URL product photos as the visual truth for the sold cut, muscle direction, irregular marbling boundaries, fat-to-lean ratio, meat color, thickness, surface moisture, pack count and label. Do not average these details into a generic steak or chicken image.
- Recreate that same meat naturally in the reference composition with coherent perspective, contact, shadows and food lighting. It must look photographed in the scene, never like a rectangular source photo or detached cutout pasted on top.
- Preserve fine physical microtexture: non-repeating muscle fibers, naturally uneven fat edges, small thickness variations, restrained moisture and believable pores. Raw meat is moist but not lacquered, glassy, rubbery or uniformly glossy.
- For cooked meat, use physically plausible browning: irregular sear, rendered fat, small char variation and believable juices. Do not turn the surface into smooth orange glaze unless the authoritative product reference visibly confirms a sauce or glaze.
- A raw-to-cooked or serving scene may be generated only when the hook needs it and the supplied references support it; keep the same identifiable cut and do not invent a different cut, grade, origin, quantity or package.
- The assigned advertisement composition is ${result.nativeCreative?.adReference?.compositionType || "reference-defined"}. In a product-packshot or product-lineup composition, if the authoritative product reference shows the sold meat in separate vacuum packs, trays or labeled units, preserve that packaging format and visible unit count. Never unwrap and repack it into the source advertiser's gift box or tray.
- In a genuine cooking or serving composition, show only a plausible portion unwrapped while keeping the verified sold unit truthful; do not imply a different bundle, tray count or gift-set package.
- Match the reference photo's white balance and natural food color. Avoid neon red/orange saturation, cloned marbling, symmetrical fibers, melted-plastic highlights, waxy skin, floating trays and unrelated stock meat photography.
- If the source evidence is insufficient for a convincing close-up, use a slightly wider credible cooking or serving composition instead of hallucinating macro texture.`;
  }
  if (policy === "ai-packaged-product-reference") {
    return `PACKAGED PRODUCT POLICY — FULL AI REFERENCE INTEGRATION
- The original URL product images are authoritative visual references only. Never extract, cut out or locally composite their pixels into the result.
- Recreate the same container, cap, package geometry, dominant colors, label hierarchy, logo placement, printed volume and verified sales-unit count as part of one coherent AI-generated scene.
- Match scene perspective, contact, reflections, surrounding light, water, foam, ingredients and hands naturally. The package must belong to the photographed environment and must never look like a floating or pasted cutout.
- Do not synthesize a substitute brand, flavor, variant or package count. If identity fidelity is insufficient, regenerate the complete AI raster instead of restoring a local product layer.`;
  }
  return `STANDARD PRODUCT REFERENCE POLICY
- Preserve the authoritative URL product's type, silhouette, proportions, package structure, dominant colors, count and recognizable details while integrating it naturally into the scene.`;
}
