import type { GenerationJob, GenerationResult, PlacementBox } from "./types";

export type ProductRenderingPolicy = "natural-meat-reference" | "protected-packaged-product" | "standard-reference";

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
    return "protected-packaged-product";
  }
  return "standard-reference";
}

function overlapArea(left: PlacementBox, right: PlacementBox) {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  return width * height;
}

/** 레퍼런스의 OCR 문구 상자를 피하면서 포장 상품 원본층을 놓을 안정 영역입니다. */
export function resolveProtectedProductPlacement(result: GenerationResult): PlacementBox {
  const shape = result.nativeCreative?.adReference?.productSlotShape;
  const size = shape === "wide" ? { width: 600, height: 430 } : shape === "square" ? { width: 520, height: 520 } : { width: 430, height: 650 };
  const candidates: PlacementBox[] = [
    { x: 690, y: 360, ...size },
    { x: 80, y: 360, ...size },
    { x: Math.round((1200 - size.width) / 2), y: 470, ...size },
  ].map((box) => ({ ...box, x: Math.max(40, Math.min(1160 - box.width, box.x)), y: Math.max(120, Math.min(1160 - box.height, box.y)) }));
  const copyBoxes = (result.referenceAdaptedCopyPlan?.copySlots || [])
    .map((slot) => slot.box)
    .filter((box): box is { x: number; y: number; width: number; height: number } => Boolean(box))
    .map((box) => ({ x: box.x * 1200, y: box.y * 1200, width: box.width * 1200, height: box.height * 1200 }));
  return candidates.reduce((best, candidate) => {
    const score = copyBoxes.reduce((sum, box) => sum + overlapArea(candidate, box), 0);
    const bestScore = copyBoxes.reduce((sum, box) => sum + overlapArea(best, box), 0);
    return score < bestScore ? candidate : best;
  }, candidates[0]);
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
  if (policy === "protected-packaged-product") {
    const placement = resolveProtectedProductPlacement(result);
    return `PACKAGED PRODUCT POLICY — IMMUTABLE ORIGINAL PRODUCT RASTER
- Cosmetics and every labeled bottle, can, pouch, tube, jar or box use the authoritative current-product raster as an immutable identity layer. Never redraw, relabel, recolor or synthesize a substitute package.
- Preserve the source container silhouette, cap, package geometry, dominant colors, physical label, logo, printed volume and verified sales-unit count. The physical package pixels are restored after AI scene/copy editing, so reserve the assigned product region and never place copy over it.
- For a multi-variant lineup, use only separately verified current-product rasters. Never duplicate one generic bottle into invented variants or imply a larger sales unit than ProductTruth.
- Generate or edit the surrounding scene, contact surface, water, foam, ingredients, hands, reflections and shadows around the protected product region. Do not paint over the package to make the lighting match.
- Keep at least one protected hero package large and unobstructed enough for its real label hierarchy to remain recognizable on mobile.
- Reserve this exact 1200-grid product region for the immutable layer: x=${placement.x}, y=${placement.y}, width=${placement.width}, height=${placement.height}. Keep advertising copy and faces outside it.
- A clean protected composite is intentional identity preservation, not permission to add a detached stock-product sticker. Ground it with coherent scale, occlusion-free placement and surrounding scene light while leaving the product RGB pixels unchanged.${constraintContract}`;
  }
  return `STANDARD PRODUCT REFERENCE POLICY
- Preserve the authoritative URL product's type, silhouette, proportions, package structure, dominant colors, count and recognizable details while integrating it naturally into the scene.${constraintContract}`;
}
