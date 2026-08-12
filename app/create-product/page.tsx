import { MvpDashboard } from "../components/MvpDashboard";
import { readCollectedAdImages } from "../lib/mvp/collectedImageStore";
import { readBrands, readGenerated } from "../lib/mvp/store";
import { buildProductCreationHandoff } from "../lib/store-analysis/productCreationAdapter";
import { storeAnalysisRepository } from "../lib/store-analysis/storeAnalysisRepository";
import { buildOpportunityProductCreationHandoff } from "../lib/crema-market/handoff.server";

export const dynamic = "force-dynamic";

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CreateProductPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const analysisId = single(params.analysisId);
  const productId = single(params.productId);
  const angle = single(params.angle);
  const opportunityId = single(params.opportunityId);
  const [brands, images, generated] = await Promise.all([
    readBrands(),
    readCollectedAdImages(),
    readGenerated(),
  ]);
  let initialCreationHandoff = null;
  if (opportunityId) {
    try {
      initialCreationHandoff = await buildOpportunityProductCreationHandoff(opportunityId);
    } catch {
      initialCreationHandoff = null;
    }
  } else if (analysisId && productId) {
    try {
      const result = await storeAnalysisRepository.getById(analysisId);
      if (result) {
        initialCreationHandoff = buildProductCreationHandoff({
          result,
          productId,
          angleIdOrType: angle,
        });
      }
    } catch {
      initialCreationHandoff = null;
    }
  }
  return (
    <MvpDashboard
      activeFeature="product-creation"
      initialBrands={brands}
      initialCreationHandoff={initialCreationHandoff}
      initialGenerated={generated}
      initialImages={images}
    />
  );
}
