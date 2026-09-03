import Link from "next/link";
import type { ComponentProps } from "react";
import type { CollectedAdImage, GeneratedAdImage } from "../../lib/mvp/types";
import { BackgroundLibraryManager } from "./background-library/BackgroundLibraryManager";
import { CreativeAssetLibrary } from "./creative-assets/CreativeAssetLibrary";
import {
  appealPointOptions,
  categoryOptions,
  CrawledGrid,
  FilterBar,
  hookTypeOptions,
  ImageGrid,
  LabelPanel,
  TaxonomyGroup,
  type MetaCrawlItem,
} from "./reference-management/ReferenceAnalysisPanels";
import type { Status } from "../MvpDashboardConfig";

type ManagementMenu = "카테고리 관리" | "이미지 수집" | "이미지 분석";

export function WorkspaceHeader({ activeMenu }: { activeMenu: ManagementMenu | "광고 생성" | "결과 다운로드" }) {
  return (
    <header className={`mvp-hero ${activeMenu === "광고 생성" ? "creation-page-hero" : ""}`}>
      <div>
        <p className="eyebrow">{activeMenu === "광고 생성" ? "CREATE" : activeMenu === "결과 다운로드" ? "RESULTS" : "ADMIN"}</p>
        <h2>{activeMenu === "광고 생성" ? "광고 만들기" : activeMenu === "결과 다운로드" ? "제작 결과" : "이미지 관리 현황"}</h2>
        <p>{activeMenu === "광고 생성" ? "상품 페이지 주소를 입력하면 상품을 분석하고 광고 콘텐츠를 제작합니다." : activeMenu === "결과 다운로드" ? "생성한 광고와 소재코드를 다시 확인하고 내려받습니다." : "수집 이미지, 라벨, 카테고리와 생성 설정을 관리합니다."}</p>
      </div>
    </header>
  );
}

export function ManagementOverview({ metrics, status }: { metrics: Array<Array<string | number>>; status: Status }) {
  return (
    <>
      <section className="mvp-metrics" aria-label="이미지 관리 현황">
        {metrics.map(([label, value]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>
      <div className={`mvp-status ${status.kind}`}>{status.message}</div>
    </>
  );
}

export function CategoryManagementPanel() {
  return (
    <section className="mvp-panel">
      <div className="mvp-panel-head">
        <h3>카테고리 관리</h3>
      </div>
      <div className="taxonomy-board">
        <TaxonomyGroup title="카테고리" items={categoryOptions} />
        <TaxonomyGroup title="후킹 유형" items={hookTypeOptions} />
        <TaxonomyGroup title="소구점" items={appealPointOptions} />
      </div>
      <BackgroundLibraryManager />
    </section>
  );
}

type ReferenceManagementPanelProps = {
  mode: "collection" | "analysis";
  onRefresh: () => void;
  crawledItems: MetaCrawlItem[];
  filterBarProps: ComponentProps<typeof FilterBar>;
  imageGridProps: Omit<ComponentProps<typeof ImageGrid>, "showAnalysis">;
  labelPanelProps: ComponentProps<typeof LabelPanel>;
};

export function ReferenceManagementPanel({ mode, onRefresh, crawledItems, filterBarProps, imageGridProps, labelPanelProps }: ReferenceManagementPanelProps) {
  const isCollection = mode === "collection";
  return (
    <section className="mvp-panel">
      <div className="mvp-panel-head">
        <h3>{isCollection ? "이미지 수집" : "이미지 분석"}</h3>
        {isCollection ? (
          <button onClick={onRefresh} type="button">
            이미지 새로고침
          </button>
        ) : (
          <span className="panel-note">이미지별 카드에서 AI 분석 또는 재분석을 실행하세요.</span>
        )}
      </div>
      {isCollection ? <FilterBar {...filterBarProps} /> : null}
      {isCollection && crawledItems.length ? <CrawledGrid items={crawledItems} /> : null}
      <div className="labeling-workspace">
        <ImageGrid {...imageGridProps} showAnalysis={!isCollection} />
        <LabelPanel {...labelPanelProps} />
      </div>
    </section>
  );
}

export function ResultsDownloadPanel({ generated }: { generated: GeneratedAdImage[] }) {
  return (
    <section className="mvp-panel">
      <div className="mvp-panel-head">
        <div>
          <p className="eyebrow">STEP 4 · RESULTS</p>
          <h3>H01~H06 제작 결과</h3>
        </div>
        <Link className="mvp-primary-link" href="/archive">
          아카이브에서 성과 테스트 설정
        </Link>
      </div>
      <nav className="create-product-step-navigation" aria-label="광고 제작 단계">
        {[
          ["product", "01 상품 선택"],
          ["hooks", "02 후킹 및 방향"],
          ["creative", "03 AI 광고 제작"],
          ["results", "04 제작 결과"],
        ].map(([step, label]) => (
          <Link aria-current={step === "results" ? "step" : undefined} className={step === "results" ? "active" : ""} href={`/create-product?${step === "results" ? "view=results" : `step=${step}`}`} key={step}>
            {label}
          </Link>
        ))}
      </nav>
      <div className="download-list">
        {generated.length ? (
          generated.map((item) => (
            <article key={item.id}>
              <strong>{item.productName}</strong>
              <span>{new Date(item.createdAt).toLocaleString("ko-KR")}</span>
            </article>
          ))
        ) : (
          <article>
            <strong>아직 저장된 이미지 생성 결과가 없습니다.</strong>
            <span>광고 만들기에서 상품을 분석하고 첫 광고를 만들어 보세요.</span>
          </article>
        )}
      </div>
      <CreativeAssetLibrary />
    </section>
  );
}
