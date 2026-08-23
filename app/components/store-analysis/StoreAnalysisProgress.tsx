"use client";

const steps = [
  ["discovering-store", "사이트 확인 중", "쇼핑몰 구조와 공개 페이지 접근 가능 여부를 확인합니다."],
  ["discovering-products", "상품 후보 수집 중", "카테고리·베스트·신상품·할인 페이지에서 상품 링크를 찾습니다."],
  ["analyzing-products", "상세페이지 분석 중", "상품별 가격·이미지·USP·구성 정보를 확인합니다."],
  ["analyzing-reviews", "리뷰 분석 중", "공개 리뷰에서 반복되는 장점과 사용 상황을 요약합니다."],
  ["scoring", "광고 적합도 계산 중", "확인 가능한 신호만 재가중해 후보군과 점수를 계산합니다."],
  ["generating-strategies", "콘텐츠 전략 정리 중", "서로 다른 구매 이유의 가설과 템플릿을 연결합니다."],
] as const;

export function StoreAnalysisProgress({ activeIndex }: { activeIndex: number }) {
  return (
    <section className="store-progress" aria-live="polite">
      <div className="store-progress-head">
        <span className="store-progress-spinner" aria-hidden="true" />
        <div>
          <strong>{steps[Math.min(activeIndex, steps.length - 1)][1]}</strong>
          <p>{steps[Math.min(activeIndex, steps.length - 1)][2]}</p>
        </div>
      </div>
      <ol>
        {steps.map(([id, label], index) => (
          <li className={index < activeIndex ? "done" : index === activeIndex ? "active" : ""} key={id}>
            <i>{index < activeIndex ? "✓" : index + 1}</i>
            <span>{label}</span>
          </li>
        ))}
      </ol>
      <small>사이트 구조에 따라 수 분이 걸릴 수 있습니다. 현재 페이지를 닫지 마세요.</small>
    </section>
  );
}
