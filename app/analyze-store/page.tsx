import { FeaturePageShell } from "../components/AppFeatureNavigation";
import { StoreAnalysisForm } from "../components/store-analysis/StoreAnalysisForm";
import { CremaOpportunityWorkspace } from "../components/crema-market/CremaOpportunityWorkspace";
import { BigQueryCandidateWorkspace } from "../components/bigquery/BigQueryCandidateWorkspace";

export const dynamic = "force-dynamic";

export default function AnalyzeStorePage() {
  return (
    <FeaturePageShell activeFeature="store-analysis">
      <BigQueryCandidateWorkspace />
      <CremaOpportunityWorkspace />
      <section className="direct-store-analysis-entry" id="direct-store-analysis-entry">
        <div>
          <p className="eyebrow">EXISTING DETAIL-PAGE FLOW</p>
          <h2>상세페이지로 광고 만들기</h2>
          <p>크리마켓 연결 여부와 관계없이 업체 URL을 분석하고 기존 상품 추천·제작 흐름을 사용합니다.</p>
        </div>
        <StoreAnalysisForm />
      </section>
    </FeaturePageShell>
  );
}
