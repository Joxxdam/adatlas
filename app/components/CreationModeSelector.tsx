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
      "추천 템플릿",
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
      "업체별 문구 가이드 적용",
      "이미지 선택",
      "템플릿 선택",
      "단일/일괄 소재 생성",
    ],
    href: "/create-product",
    button: "상세페이지로 제작 시작",
    accent: "creation",
    audience: "제작할 상품 URL이 이미 준비되어 있다면",
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
            쇼핑몰에서 광고 후보를 먼저 찾거나, 준비된 상품으로 곧바로 기존 제작 엔진을 사용할 수
            있습니다.
          </p>
        </section>
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
        <p className="mode-selector-note">
          두 방식 모두 동일한 상품 추출·카피 가이드·이미지 선택·템플릿·단일/일괄 렌더링 엔진을
          사용합니다.
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
