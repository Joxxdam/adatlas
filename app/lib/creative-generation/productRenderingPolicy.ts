import type { GenerationJob, GenerationResult, PlacementBox } from "./types";

export type ProductRenderingPolicy = "natural-meat-reference" | "identity-locked-packaged-product" | "standard-reference";

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
  // 재분류하면 원물/간식을 불필요한 패키지 보호 합성으로 보내게 된다.
  if (override === "food-produce" || profile === "food_fresh" || /fruit|produce|agriculture|과일|농산물/i.test(productType)) {
    return "standard-reference";
  }
  const packageText = [productText, job.productTruth.normalized?.packageOrOption, job.productTruth.normalized?.quantity, job.productTruth.normalized?.composition].filter(Boolean).join(" ");
  const beautyOrHealth = override === "beauty" || ["beauty_cosmetics", "personal_care", "health"].includes(profile || "");
  const unmistakablyPackaged = /화장품|스킨케어|바디워시|샤워젤|샴푸|클렌저|세럼|앰플|크림|로션|에센스|향수|건강기능식품|건기식|영양제|비타민|유산균|홍삼|우유|음료|주스|커피|녹차|홍차|말차|보이차|유자차|생강차|차음료|티백|소스|보틀|캔|파우치|튜브|단지|bottle|can\b|pouch|tube|jar|milk|drink|juice|tea\b/i.test(packageText);
  if (beautyOrHealth || unmistakablyPackaged) {
    return "identity-locked-packaged-product";
  }
  return "standard-reference";
}

export function identityLockedProductPlacements(result: GenerationResult): PlacementBox[] {
  const instances = result.creativeDesign?.productComposition.instances || [];
  const placements = instances
    .map((instance) => ({ x: instance.x, y: instance.y, width: instance.width, height: instance.height }))
    .filter((box) => box.width > 0 && box.height > 0)
    .slice(0, 3);
  if (placements.length) return placements;
  if (result.creativeDesign?.productPosition) return [result.creativeDesign.productPosition];
  return [{ x: 690, y: 280, width: 420, height: 650 }];
}

export function productRenderingPromptContract(job: GenerationJob, result: GenerationResult) {
  const policy = resolveProductRenderingPolicy(job);
  if (policy === "natural-meat-reference") {
    return `MEAT PRODUCT POLICY — NATURAL SCENE INTEGRATION
- Treat the authoritative URL product photos as the visual truth for the sold cut, marbling distribution, fat-to-lean ratio, meat color, thickness, pack count and label.
- Recreate that same meat naturally in the reference composition with coherent perspective, moisture, fibers, contact, shadows and food lighting. It must look photographed in the scene, never like a rectangular source photo or detached cutout pasted on top.
- A raw-to-cooked or serving scene may be generated only when the hook needs it; keep the same identifiable cut and do not invent a different cut, grade, origin, quantity or package.
- Avoid plastic texture, repeated cloned marbling, neon-red meat, impossible fibers, floating trays and unrelated steak photography.`;
  }
  if (policy === "identity-locked-packaged-product") {
    const placements = identityLockedProductPlacements(result)
      .map((box) => `x=${box.x}, y=${box.y}, width=${box.width}, height=${box.height}`)
      .join("; ");
    return `PACKAGED PRODUCT POLICY — ORIGINAL PRODUCT IDENTITY LOCK
- The original URL product raster is immutable identity evidence. Never repaint, redraw, relabel, recolor, reshape or regenerate the container, cap, package, logo, label, printed characters, volume or sales unit.
- Only the surrounding scene, lighting, contact shadow and composition may change. The protected original product layer is locally restored after AI editing.
- Do not synthesize a substitute package. Keep the intended product landing zones clean and physically grounded for the protected original product: ${placements}.
- Later copy and QA edits must not place text, effects, water, foam, ingredients, hands or decorative objects over the protected package or label.`;
  }
  return `STANDARD PRODUCT REFERENCE POLICY
- Preserve the authoritative URL product's type, silhouette, proportions, package structure, dominant colors, count and recognizable details while integrating it naturally into the scene.`;
}
