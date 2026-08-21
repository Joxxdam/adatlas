import Link from "next/link";
import { FeaturePageShell } from "../../components/AppFeatureNavigation";
import { WatchlistExplorer } from "../../components/WatchlistExplorer";
import { readContentAnalyses, readWatchlist } from "../../lib/watchlist/store";

export const dynamic = "force-dynamic";

export default async function ReferenceManagementPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab = "collection" } = await searchParams;
  const [brands, analyses] = await Promise.all([readWatchlist(), readContentAnalyses()]);
  return (
    <FeaturePageShell activeFeature="references">
      <main className="reference-page">
        <header className="reference-page-header">
          <div>
            <p className="eyebrow">MANAGEMENT</p>
            <h1>레퍼런스 관리</h1>
            <p>수집 콘텐츠와 분석 라벨을 한 관리 화면에서 확인합니다.</p>
          </div>
          <nav aria-label="레퍼런스 탭">
            <Link
              aria-current={tab === "collection" ? "page" : undefined}
              href="/admin/references?tab=collection"
            >
              수집 콘텐츠
            </Link>
            <Link
              aria-current={tab === "analysis" ? "page" : undefined}
              href="/admin/references?tab=analysis"
            >
              이미지 분석
            </Link>
          </nav>
        </header>
        <p>
          {tab === "analysis"
            ? "저장된 광고 콘텐츠 분석과 라벨을 확인합니다. 기존 데이터와 API 저장 구조는 그대로 유지됩니다."
            : "브랜드 워치리스트의 수집 원문과 분석 결과를 확인합니다."}
        </p>
        <WatchlistExplorer brands={brands} analyses={analyses} />
      </main>
    </FeaturePageShell>
  );
}
