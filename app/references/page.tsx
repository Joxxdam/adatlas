import Link from "next/link";
import { WatchlistExplorer } from "../components/WatchlistExplorer";
import { readContentAnalyses, readWatchlist } from "../lib/watchlist/store";

export const dynamic = "force-dynamic";

export default async function ReferencesPage() {
  const [brands, analyses] = await Promise.all([readWatchlist(), readContentAnalyses()]);

  return (
    <main className="reference-page">
      <header className="reference-page-header">
        <div>
          <p className="eyebrow">AdAtlas Collection</p>
          <h1>레퍼런스 수집 콘텐츠</h1>
          <p>100개 브랜드 워치리스트에서 수집한 콘텐츠 원문과 AI 분석 결과를 브랜드별로 확인합니다.</p>
        </div>
        <Link href="/">대시보드로 돌아가기</Link>
      </header>
      <WatchlistExplorer brands={brands} analyses={analyses} />
    </main>
  );
}
