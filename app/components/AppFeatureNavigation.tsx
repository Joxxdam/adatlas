import Link from "next/link";
import type { ReactNode } from "react";

export type AppFeatureKey = "store-analysis" | "product-creation" | "image-references";

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
    label: "분석 후 제작하기",
    description: "쇼핑몰에서 광고 후보 찾기",
  },
  {
    key: "product-creation",
    href: "/create-product",
    index: "02",
    label: "선택 상품 제작하기",
    description: "상품 URL로 바로 제작하기",
  },
  {
    key: "image-references",
    href: "/image-analysis-references",
    index: "03",
    label: "이미지 분석 레퍼런스 보러가기",
    description: "수집 이미지 분석·라벨 보기",
  },
];

export function AppFeatureNavigation({
  activeFeature,
}: {
  activeFeature?: AppFeatureKey;
}) {
  return (
    <nav className="app-feature-navigation" aria-label="AdAtlas 주요 기능">
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
          <span>A</span>
          <div>
            <strong>AdAtlas</strong>
            <small>Creative Operations</small>
          </div>
        </Link>
        <div className="feature-sidebar-heading">
          <p className="eyebrow">WORKSPACE</p>
          <h2>무엇을 시작할까요?</h2>
        </div>
        <AppFeatureNavigation activeFeature={activeFeature} />
        <Link className="feature-sidebar-home" href="/">
          전체 기능 홈으로
        </Link>
      </aside>
      {children}
    </div>
  );
}
