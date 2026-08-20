import Link from "next/link";
import type { ReactNode } from "react";
import { DaywizBrand } from "./DaywizBrand";
import { AutoProductionStatusIndicator } from "./features/auto-production/AutoProductionStatusIndicator";
import { CreativeJobStatusIndicator } from "./features/creative-generation/CreativeJobStatusIndicator";

export type AppFeatureKey =
  | "store-analysis"
  | "product-selection"
  | "product-creation"
  | "auto-production"
  | "advertiser-memory"
  | "golden-references"
  | "hook-experiments"
  | "creative-results"
  | "image-references"
  | "video-collaboration";

const FEATURES: Array<{
  key: AppFeatureKey;
  href: string;
  index: string;
  label: string;
  description: string;
}> = [
  {
    key: "store-analysis",
    href: "/analyze-store",
    index: "01",
    label: "광고 후보 찾기",
    description: "쇼핑몰과 상품을 분석합니다",
  },
  {
    key: "product-selection",
    href: "/create-product?step=product",
    index: "02",
    label: "상품 선택",
    description: "제작할 상품을 확인합니다",
  },
  {
    key: "product-creation",
    href: "/create-product",
    index: "03",
    label: "AI 광고 만들기",
    description: "상품 근거로 완성 광고를 만듭니다",
  },
  {
    key: "creative-results",
    href: "/create-product?view=results",
    index: "04",
    label: "제작 결과 확인",
    description: "생성한 광고와 소재코드를 봅니다",
  },
];

const AUXILIARY_FEATURES: Array<{
  key: AppFeatureKey;
  href: string;
  label: string;
}> = [
  {
    key: "auto-production",
    href: "/admin/auto-production",
    label: "자동 콘텐츠 제작",
  },
  {
    key: "advertiser-memory",
    href: "/admin/auto-production#advertiser-memory",
    label: "광고주 기억",
  },
  {
    key: "golden-references",
    href: "/admin/auto-production#golden-references",
    label: "골든 레퍼런스",
  },
  {
    key: "hook-experiments",
    href: "/hook-experiments",
    label: "후킹 성과 테스트",
  },
  {
    key: "image-references",
    href: "/image-analysis-references",
    label: "이미지 분석 레퍼런스",
  },
  {
    key: "video-collaboration",
    href: "/video-collaboration",
    label: "영상 제작 협업",
  },
];

export function AppFeatureNavigation({
  activeFeature,
}: {
  activeFeature?: AppFeatureKey;
}) {
  return (
    <nav className="app-feature-navigation" aria-label="데이위즈 주요 기능">
      {FEATURES.map((feature) => (
        <Link
          aria-current={activeFeature === feature.key ? "page" : undefined}
          className={activeFeature === feature.key ? "active" : ""}
          href={feature.href}
          key={feature.key}
        >
          <span>{feature.index}</span>
          <div>
            <strong>{feature.label}</strong>
            <small>{feature.description}</small>
          </div>
        </Link>
      ))}
    </nav>
  );
}

export function AuxiliaryFeatureNavigation({
  activeFeature,
}: {
  activeFeature?: AppFeatureKey;
}) {
  return (
    <nav className="app-auxiliary-navigation" aria-label="데이위즈 보조 기능">
      {AUXILIARY_FEATURES.map((feature) => (
        <Link
          aria-current={activeFeature === feature.key ? "page" : undefined}
          className={activeFeature === feature.key ? "active" : ""}
          href={feature.href}
          key={feature.key}
        >
          {feature.label}
        </Link>
      ))}
    </nav>
  );
}

export function FeaturePageShell({
  activeFeature,
  children,
}: {
  activeFeature?: AppFeatureKey;
  children: ReactNode;
}) {
  return (
    <div className="feature-page-shell">
      <aside className="feature-sidebar">
        <Link className="feature-sidebar-brand" href="/">
          <DaywizBrand subtitle="Creative Operations" />
        </Link>
        <div className="feature-sidebar-heading">
          <p className="eyebrow">WORKSPACE</p>
          <h2>무엇을 시작할까요?</h2>
        </div>
        <AppFeatureNavigation activeFeature={activeFeature} />
        <AutoProductionStatusIndicator />
        <CreativeJobStatusIndicator />
        <details className="feature-sidebar-tools">
          <summary>관리 도구</summary>
          <AuxiliaryFeatureNavigation activeFeature={activeFeature} />
        </details>
        <Link className="feature-sidebar-home" href="/">
          도움말 · 전체 기능 홈
        </Link>
      </aside>
      {children}
    </div>
  );
}
