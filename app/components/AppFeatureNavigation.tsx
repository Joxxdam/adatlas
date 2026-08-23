import Link from "next/link";
import type { ReactNode } from "react";
import { DaywizBrand } from "./DaywizBrand";

export type AppFeatureKey = "store-analysis" | "creative-production" | "category-creative" | "video-planning" | "performance" | "archive" | "auto-production" | "advertisers" | "references";

export const PERFORMANCE_FEATURE = {
  key: "performance" as const,
  href: "/performance",
  label: "성과 확인",
  description: "선택 소재를 설정하고 Meta 성과를 비교합니다",
};

export const IMAGE_CONTENT_FEATURES = [
  {
    key: "store-analysis" as const,
    href: "/analyze-store",
    index: "01",
    label: "광고 후보 찾기",
    description: "데이터와 쇼핑몰에서 기회를 찾습니다",
  },
  {
    key: "creative-production" as const,
    href: "/create-product?step=product",
    index: "02",
    label: "상품 광고 제작",
    description: "상품 분석부터 이미지 6장 제작까지 진행합니다",
  },
  {
    key: "category-creative" as const,
    href: "/category-images",
    index: "03",
    label: "카테고리 이미지",
    description: "카테고리 대표 이미지를 두 규격으로 제작합니다",
  },
];

export const VIDEO_PLANNING_FEATURE = {
  key: "video-planning" as const,
  href: "/video-planning",
  label: "영상 기획",
  description: "상품 기반 대본과 장면 제작안을 별도로 기획합니다",
};

export const ARCHIVE_FEATURE = {
  key: "archive" as const,
  href: "/archive",
  label: "아카이브",
  description: "완성 콘텐츠를 보관하고 테스트 소재를 선택합니다",
};

export const MAIN_FEATURES = [...IMAGE_CONTENT_FEATURES, PERFORMANCE_FEATURE, VIDEO_PLANNING_FEATURE, ARCHIVE_FEATURE];

export const MANAGEMENT_FEATURES = [
  { key: "auto-production" as const, href: "/admin/auto-production", label: "자동 제작 관리" },
  { key: "advertisers" as const, href: "/admin/advertisers", label: "광고주 설정" },
  { key: "references" as const, href: "/admin/references", label: "레퍼런스 관리" },
];

export function AppFeatureNavigation({ activeFeature }: { activeFeature?: AppFeatureKey }) {
  return (
    <nav className="app-feature-navigation" aria-label="데이위즈 콘텐츠 제작 영역">
      <section className="feature-navigation-group feature-navigation-image" aria-labelledby="image-content-navigation-label">
        <div className="feature-navigation-group-label" id="image-content-navigation-label">
          <span>IMAGE CONTENT</span>
          <strong>이미지 콘텐츠</strong>
        </div>
        <div className="feature-navigation-links">
          {IMAGE_CONTENT_FEATURES.map((feature) => (
            <Link aria-current={activeFeature === feature.key ? "page" : undefined} className={activeFeature === feature.key ? "active" : ""} href={feature.href} key={feature.key}>
              <span>{feature.index}</span>
              <div>
                <strong>{feature.label}</strong>
                <small>{feature.description}</small>
              </div>
            </Link>
          ))}
        </div>
        <details className="feature-navigation-management feature-navigation-performance-menu" open={activeFeature === PERFORMANCE_FEATURE.key}>
          <summary>
            <span>성과 확인</span>
          </summary>
          <nav className="app-auxiliary-navigation" aria-label="성과 확인">
            <Link aria-current={activeFeature === PERFORMANCE_FEATURE.key ? "page" : undefined} className={activeFeature === PERFORMANCE_FEATURE.key ? "active" : ""} href={PERFORMANCE_FEATURE.href}>
              광고 성과 확인
            </Link>
          </nav>
        </details>
        <details className="feature-navigation-management" open={MANAGEMENT_FEATURES.some((feature) => feature.key === activeFeature)}>
          <summary>
            <span>이미지 제작 관리 도구</span>
          </summary>
          <AuxiliaryFeatureNavigation activeFeature={activeFeature} />
        </details>
      </section>

      <section className="feature-navigation-group feature-navigation-video" aria-labelledby="video-planning-navigation-label">
        <div className="feature-navigation-group-label" id="video-planning-navigation-label">
          <span>VIDEO CONTENT</span>
          <strong>영상 콘텐츠</strong>
        </div>
        <Link aria-current={activeFeature === VIDEO_PLANNING_FEATURE.key ? "page" : undefined} className={`feature-navigation-video-link${activeFeature === VIDEO_PLANNING_FEATURE.key ? " active" : ""}`} href={VIDEO_PLANNING_FEATURE.href}>
          <span>VIDEO</span>
          <div>
            <strong>{VIDEO_PLANNING_FEATURE.label}</strong>
            <small>{VIDEO_PLANNING_FEATURE.description}</small>
          </div>
        </Link>
      </section>

      <section className="feature-navigation-group feature-navigation-archive" aria-labelledby="archive-navigation-label">
        <div className="feature-navigation-group-label" id="archive-navigation-label">
          <span>ASSET LIBRARY</span>
          <strong>콘텐츠 보관</strong>
        </div>
        <Link aria-current={activeFeature === ARCHIVE_FEATURE.key ? "page" : undefined} className={`feature-navigation-archive-link${activeFeature === ARCHIVE_FEATURE.key ? " active" : ""}`} href={ARCHIVE_FEATURE.href}>
          <span>ALL</span>
          <div>
            <strong>{ARCHIVE_FEATURE.label}</strong>
            <small>{ARCHIVE_FEATURE.description}</small>
          </div>
        </Link>
      </section>
    </nav>
  );
}

export function AuxiliaryFeatureNavigation({ activeFeature }: { activeFeature?: AppFeatureKey }) {
  return (
    <nav className="app-auxiliary-navigation" aria-label="이미지 제작 관리 도구">
      {MANAGEMENT_FEATURES.map((feature) => (
        <Link aria-current={activeFeature === feature.key ? "page" : undefined} className={activeFeature === feature.key ? "active" : ""} href={feature.href} key={feature.key}>
          {feature.label}
        </Link>
      ))}
    </nav>
  );
}

export function AppSidebar({ activeFeature, className = "feature-sidebar", id }: { activeFeature?: AppFeatureKey; className?: string; id?: string }) {
  return (
    <aside className={className} id={id}>
      <Link className="feature-sidebar-brand adatlas-sidebar-brand" href="/">
        <DaywizBrand subtitle="Creative Operations" />
      </Link>
      <div className="feature-sidebar-heading">
        <p className="eyebrow">CONTENT WORKSPACE</p>
        <h2>제작 영역을 선택하세요</h2>
      </div>
      <AppFeatureNavigation activeFeature={activeFeature} />
      <details className="mvp-sidebar-help">
        <summary>도움말</summary>
        <p>상품 광고는 URL로 6장을 만들고, 카테고리 이미지는 실제 상품 3~5장으로 한 콘셉트의 두 규격을 만듭니다.</p>
      </details>
    </aside>
  );
}

export function FeaturePageShell({ activeFeature, children }: { activeFeature?: AppFeatureKey; children: ReactNode }) {
  return (
    <div className="feature-page-shell">
      <AppSidebar activeFeature={activeFeature} />
      {children}
    </div>
  );
}
