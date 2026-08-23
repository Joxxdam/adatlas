import Link from "next/link";
import { FeaturePageShell } from "./AppFeatureNavigation";
import { DaywizBrand } from "./DaywizBrand";

const modes = [
  {
    eyebrow: "STORE DISCOVERY",
    title: "광고 기회 상품 찾기",
    description: "BigQuery·크리마켓·업로드 지표를 비교하고, 미연결 시 기존 쇼핑몰 분석으로 광고 후보를 찾습니다.",
    features: [
      "BigQuery 판매·노출 데이터 분석",
      "베스트 카테고리 분석",
      "광고 후보 상품 추천",
      "후기/USP 분석",
      "신상품 및 할인 상품 분석",
      "추천 콘텐츠 전략",
    ],
    href: "/analyze-store",
    button: "광고 기회 찾기",
    accent: "analysis",
    audience: "어떤 상품을 광고할지 아직 정하지 않았다면",
  },
  {
    eyebrow: "DIRECT CREATION",
    title: "상세페이지로 광고 만들기",
    description: "제작할 상품이 정해져 있다면 상품 URL을 입력해 바로 광고 소재를 만듭니다.",
    features: [
      "상품정보 추출",
      "상품 근거 기반 후킹 후보 기획",
      "최종 후킹 6개 선정",
      "후킹별 AI 완성 광고 생성",
      "개별 검수·수정·다운로드",
    ],
    href: "/create-product",
    button: "상세페이지로 제작 시작",
    accent: "creation",
    audience: "제작할 상품 URL이 이미 준비되어 있다면",
  },
] as const;

const operationLinks = [
  {
    eyebrow: "ASSET LIBRARY",
    title: "완성 이미지 확인",
    description: "상품별 제작 결과를 모아보고 다운로드하거나 성과 테스트에 사용할 소재를 선택합니다.",
    href: "/archive",
    action: "아카이브 열기",
    accent: "archive",
    steps: ["제작 결과 확인", "상품별 다운로드", "성과 소재 선택"],
  },
  {
    eyebrow: "PERFORMANCE",
    title: "광고 성과 확인",
    description: "선택한 소재를 Meta 성과와 연결하고 어떤 후킹과 디자인이 효과적인지 비교합니다.",
    href: "/performance",
    action: "성과 확인하기",
    accent: "performance",
    steps: ["소재 조합 설정", "Meta 성과 연결", "결과 비교"],
  },
] as const;

export function CreationModeSelector() {
  return (
    <FeaturePageShell>
      <main className="mode-selector-page">
        <section className="mode-selector-hero">
          <div className="mode-selector-brand">
            <DaywizBrand />
          </div>
          <p className="eyebrow">CREATIVE OPERATIONS</p>
          <h1>광고 제작을 어디서 시작할까요?</h1>
          <p>
            쇼핑몰에서 광고 후보를 먼저 찾거나, 준비된 상품으로 후킹별 AI 완성 광고를 바로 만들 수
            있습니다.
          </p>
        </section>
        <ol className="mode-selector-flow" aria-label="기본 광고 제작 순서">
          <li><b>1</b><span>광고 후보 찾기</span></li>
          <li><b>2</b><span>상품 선택</span></li>
          <li><b>3</b><span>AI 광고 만들기</span></li>
          <li><b>4</b><span>제작 결과 확인</span></li>
        </ol>
        <section className="mode-card-grid" aria-label="제작 방식 선택">
          {modes.map((mode, index) => (
            <article className={`mode-card ${mode.accent}`} key={mode.title}>
              <div className="mode-card-index">0{index + 1}</div>
              <p className="eyebrow">{mode.eyebrow}</p>
              <h2>{mode.title}</h2>
              <p className="mode-card-audience">{mode.audience}</p>
              <p className="mode-card-description">{mode.description}</p>
              <ul>
                {mode.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              <Link className="mode-card-action" href={mode.href}>
                {mode.button}
                <span aria-hidden="true">→</span>
              </Link>
            </article>
          ))}
        </section>
        <section className="home-operation-section" aria-labelledby="home-operation-title">
          <div className="home-operation-heading">
            <div>
              <p className="eyebrow">AFTER CREATION</p>
              <h2 id="home-operation-title">만든 광고를 확인하고 성과까지 이어보세요</h2>
            </div>
            <p>제작 완료 이미지는 아카이브에 모이고, 선택한 소재는 성과 확인에서 바로 비교할 수 있습니다.</p>
          </div>
          <div className="home-operation-grid">
            {operationLinks.map((item) => (
              <Link className={`home-operation-card ${item.accent}`} href={item.href} key={item.title}>
                <div>
                  <p className="eyebrow">{item.eyebrow}</p>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </div>
                <ul aria-label={`${item.title} 주요 기능`}>
                  {item.steps.map((step) => <li key={step}>{step}</li>)}
                </ul>
                <strong>{item.action}<span aria-hidden="true">→</span></strong>
              </Link>
            ))}
          </div>
        </section>
        <p className="mode-selector-note">
          후보 탐색과 바로 제작은 같은 6장 생성 흐름을 사용하며, 완성 결과는 아카이브와 성과 확인으로 연결됩니다.
        </p>
        <section className="reference-mode-entry" aria-labelledby="reference-mode-title">
          <div className="reference-mode-index">03</div>
          <div>
            <p className="eyebrow">IMAGE ANALYSIS ARCHIVE</p>
            <h2 id="reference-mode-title">이미지 분석 레퍼런스 보러가기</h2>
            <p>
              기존에 수집한 광고 이미지를 선택하고 AI 분석 결과와 레퍼런스 라벨을 확인합니다.
            </p>
          </div>
          <ul>
            <li>수집 이미지 확인</li>
            <li>AI 이미지 분석</li>
            <li>카테고리·후킹·소구점 라벨</li>
            <li>기존 레퍼런스 분석 화면</li>
          </ul>
          <Link href="/image-analysis-references">
            이미지 분석 레퍼런스 보러가기
            <span aria-hidden="true">→</span>
          </Link>
        </section>
      </main>
    </FeaturePageShell>
  );
}
