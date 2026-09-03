import { FeaturePageShell } from "../components/AppFeatureNavigation";
import { CreativeArchiveWorkspace } from "../components/creative-archive/CreativeArchiveWorkspace";
import { listCreativeArchivePage } from "../lib/creative-archive/service.server";
import Link from "next/link";
import { CategoryCreativeArchive } from "../components/category-creatives/CategoryCreativeArchive";
import { listCategoryCreativeJobs } from "../lib/category-creatives/repository.server";

export const dynamic = "force-dynamic";

export default async function CreativeArchivePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const kind = params.kind === "product" || params.kind === "category" ? params.kind : "all";
  const [archivePage, categoryJobs] = await Promise.all([
    kind === "category" ? Promise.resolve({ entries: [], total: 0 }) : listCreativeArchivePage({ limit: 48 }),
    kind === "product" ? Promise.resolve([]) : listCategoryCreativeJobs(),
  ]);
  return (
    <FeaturePageShell activeFeature="archive">
      <main style={{ minWidth: 0 }}>
        <nav aria-label="아카이브 종류" style={{ display: "flex", gap: 8, padding: "28px 56px 0" }}>
          <Link href="/archive" style={{ padding: "10px 16px", borderRadius: 999, background: kind === "all" ? "#176fd1" : "#fff", color: kind === "all" ? "#fff" : "#253a5a", textDecoration: "none" }}>전체</Link>
          <Link href="/archive?kind=product" style={{ padding: "10px 16px", borderRadius: 999, background: kind === "product" ? "#176fd1" : "#fff", color: kind === "product" ? "#fff" : "#253a5a", textDecoration: "none" }}>상품 광고</Link>
          <Link href="/archive?kind=category" style={{ padding: "10px 16px", borderRadius: 999, background: kind === "category" ? "#176fd1" : "#fff", color: kind === "category" ? "#fff" : "#253a5a", textDecoration: "none" }}>카테고리 이미지</Link>
        </nav>
        {kind === "category" || categoryJobs.length ? <CategoryCreativeArchive jobs={categoryJobs} /> : null}
        {kind !== "category" ? <CreativeArchiveWorkspace initialEntries={archivePage.entries} initialTotal={archivePage.total} /> : null}
      </main>
    </FeaturePageShell>
  );
}
