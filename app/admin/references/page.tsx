import Link from "next/link";
import { FeaturePageShell } from "../../components/AppFeatureNavigation";
import { WatchlistExplorer } from "../../components/WatchlistExplorer";
import { NativeReferenceLibraryManager } from "../../components/references/NativeReferenceLibraryManager";
import { nativeReferenceLibraryRepository } from "../../lib/creative-generation/nativeReferenceLibraryRepository.server";
import { nativeReferenceCategoryGroups, nativeReferenceFoodSubcategories, referenceBelongsToSelectionPool } from "../../lib/creative-generation/referenceLibraryManagement";
import { readContentAnalyses, readWatchlist } from "../../lib/watchlist/store";
import { isReferenceLibraryReadOnly } from "../../lib/runtimeStorage.ts";

export const dynamic = "force-dynamic";

export default async function ReferenceManagementPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab = "library" } = await searchParams;
  const readOnly = isReferenceLibraryReadOnly();
  const isLegacyTab = !readOnly && (tab === "collection" || tab === "analysis");
  const manifest = nativeReferenceLibraryRepository.list();
  const legacyData = isLegacyTab ? await Promise.all([readWatchlist(), readContentAnalyses()]) : [[], []];
  const [brands, analyses] = legacyData;
  const initialLibrary = {
    version: manifest.version,
    updatedAt: manifest.updatedAt || manifest.importedAt,
    items: manifest.items,
    counts: Object.fromEntries(nativeReferenceCategoryGroups.map((categoryGroup) => [categoryGroup, manifest.items.filter((item) => item.categoryGroup === categoryGroup).length])) as Record<(typeof nativeReferenceCategoryGroups)[number], number>,
    foodSubcategoryCounts: Object.fromEntries(nativeReferenceFoodSubcategories.map((foodSubcategory) => [foodSubcategory, manifest.items.filter((item) => referenceBelongsToSelectionPool(item, "food", foodSubcategory)).length])) as Record<(typeof nativeReferenceFoodSubcategories)[number], number>,
  };
  return (
    <FeaturePageShell activeFeature="references">
      <main className="reference-page">
        <header className="reference-page-header">
          <div>
            <p className="eyebrow">MANAGEMENT</p>
            <h1>레퍼런스 관리</h1>
            <p>수동·자동 광고 제작에서 실제로 사용할 이미지 레퍼런스를 관리합니다.</p>
          </div>
          <nav aria-label="레퍼런스 탭">
            <Link aria-current={!isLegacyTab ? "page" : undefined} href="/admin/references?tab=library">
              제작 레퍼런스
            </Link>
            {!readOnly ? (
              <>
                <Link aria-current={tab === "collection" ? "page" : undefined} href="/admin/references?tab=collection">
                  기존 수집 도구
                </Link>
                <Link aria-current={tab === "analysis" ? "page" : undefined} href="/admin/references?tab=analysis">
                  기존 분석 도구
                </Link>
              </>
            ) : null}
          </nav>
        </header>
        {isLegacyTab ? (
          <>
            <p>{tab === "analysis" ? "저장된 광고 콘텐츠 분석과 라벨을 확인합니다. 이 데이터는 제작용 레퍼런스 풀과 분리되어 있습니다." : "브랜드 워치리스트의 수집 원문과 분석 결과를 확인합니다. 제작에 쓰려면 제작 레퍼런스 탭에 이미지를 업로드하세요."}</p>
            <WatchlistExplorer brands={brands} analyses={analyses} />
          </>
        ) : (
          <NativeReferenceLibraryManager initialLibrary={initialLibrary} readOnly={readOnly} />
        )}
      </main>
    </FeaturePageShell>
  );
}
