import { defaultAdBrief, productInfoToAdBrief } from "../mvp/adBrief";
import { readAdImageLabels } from "../mvp/labelStore";
import { matchReferences } from "../mvp/referenceMatcher";
import type { ProductInfoForPrompt } from "../mvp/types";
import type { ProductDetailAnalysis } from "./types";

function referenceProductInfo(detail: ProductDetailAnalysis): ProductInfoForPrompt {
  return {
    productName: detail.product.name,
    category: detail.product.category || "기타",
    price: detail.product.salePrice ? `${detail.product.salePrice.toLocaleString("ko-KR")}원` : "",
    originalPrice: detail.product.originalPrice
      ? `${detail.product.originalPrice.toLocaleString("ko-KR")}원`
      : "",
    discountInfo: detail.product.discountRate ? `${detail.product.discountRate}% 할인` : "",
    mainBenefit: detail.uspCandidates.join(" · "),
    targetCustomer: detail.reviewAnalysis?.purchaseSituations.join(", ") || "",
    landingUrl: detail.product.url,
    productImagePath: detail.product.imageUrl || "",
    productImagePaths: detail.imageUrls.slice(0, 4),
    backgroundImagePath: "",
    extractedDescription: detail.description,
    extractedMainImage: detail.product.imageUrl,
    extractedGalleryImages: detail.imageUrls,
  };
}

export async function recommendReferencesForProducts(products: ProductDetailAnalysis[]) {
  const labels = await readAdImageLabels();
  return new Map(
    products.map((detail) => {
      const product = referenceProductInfo(detail);
      const matches = matchReferences({
        product,
        brief: productInfoToAdBrief(product, defaultAdBrief),
        labels,
        limit: 5,
      });
      const first = matches[0]?.context;
      return [
        detail.product.id,
        {
          ids: matches.map((match) => match.referenceId),
          styleName: first?.copyNuance || first?.visualTone,
          layoutPattern: first?.layoutPattern,
          visualTone: first?.visualTone,
        },
      ] as const;
    })
  );
}
