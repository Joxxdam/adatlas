import { MvpDashboard } from "../components/MvpDashboard";
import { readCollectedAdImages } from "../lib/mvp/collectedImageStore";
import { readBrands, readGenerated } from "../lib/mvp/store";
import { buildProductCreationHandoff } from "../lib/store-analysis/productCreationAdapter";
import { storeAnalysisRepository } from "../lib/store-analysis/storeAnalysisRepository";
import { buildOpportunityProductCreationHandoff } from "../lib/crema-market/handoff.server";
import { buildBigQueryProductCreationHandoff } from "../lib/bigquery/handoff.server";
import { buildSiteCandidateProductCreationHandoff } from "../lib/site-candidates/handoff.server";
import { normalizeProductCreationUrl } from "../lib/product-creation/handoffUrl";
import { redirect } from "next/navigation";

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
  const dataCandidateId = single(params.dataCandidateId);
  const siteCandidateId = single(params.siteCandidateId);
  const initialProductUrl = normalizeProductCreationUrl(single(params.productUrl));
  const view = single(params.view);
  const requestedStep = single(params.step);
  if (requestedStep === "meta") {
    redirect("/archive");
  }
  const initialWorkflowStep =
    view === "results"
      ? "results"
      : ["product", "hooks", "creative"].includes(requestedStep || "")
        ? (requestedStep as "product" | "hooks" | "creative")
        : "product";
  const [brands, images, generated] = await Promise.all([
    readBrands(),
    readCollectedAdImages(),
    readGenerated(),
  ]);
  let initialCreationHandoff = null;
  if (siteCandidateId) {
    try {
      initialCreationHandoff = buildSiteCandidateProductCreationHandoff(siteCandidateId);
    } catch {
      initialCreationHandoff = null;
    }
  } else if (dataCandidateId) {
    try {
      initialCreationHandoff = await buildBigQueryProductCreationHandoff(dataCandidateId);
    } catch {
      initialCreationHandoff = null;
    }
  } else if (opportunityId) {
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
      activeFeature="creative-production"
      initialActiveMenu={view === "results" ? "결과 다운로드" : "광고 생성"}
      initialWorkflowStep={initialWorkflowStep}
      initialBrands={brands}
      initialCreationHandoff={initialCreationHandoff}
      initialProductUrl={initialProductUrl}
      initialGenerated={generated}
      initialImages={images}
    />
  );
}
