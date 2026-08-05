import Link from "next/link";
import { FeaturePageShell } from "../../components/AppFeatureNavigation";
import { StoreAnalysisResults } from "../../components/store-analysis/StoreAnalysisResults";
import { storeAnalysisRepository } from "../../lib/store-analysis/storeAnalysisRepository";

export const dynamic = "force-dynamic";

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function StoreAnalysisResultsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const analysisId = single(params.analysisId);
  let result = null;
  if (analysisId) {
    try {
      result = await storeAnalysisRepository.getById(analysisId);
    } catch {
      result = null;
    }
  }
  if (!result) {
    return (
      <FeaturePageShell activeFeature="store-analysis">
        <main className="store-result-missing">
          <p className="eyebrow">RESULT NOT FOUND</p>
          <h1>분석 결과를 찾지 못했습니다.</h1>
          <p>analysisId가 없거나 개발용 저장소에서 결과가 삭제되었습니다.</p>
          <Link href="/analyze-store">업체 분석으로 돌아가기</Link>
        </main>
      </FeaturePageShell>
    );
  }
  return (
    <FeaturePageShell activeFeature="store-analysis">
      <StoreAnalysisResults result={result} />
    </FeaturePageShell>
  );
}
