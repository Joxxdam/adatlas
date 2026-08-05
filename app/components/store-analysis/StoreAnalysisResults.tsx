import Link from "next/link";
import type {
  ProductAdvertisingAnalysis,
  StoreAnalysisResult,
} from "../../lib/store-analysis/types";
import { CategoryRecommendationList } from "./CategoryRecommendationList";
import { ProductRecommendationCard } from "./ProductRecommendationCard";
import { StoreAnalysisSummary } from "./StoreAnalysisSummary";

const GROUPS: Array<{
  type: ProductAdvertisingAnalysis["recommendationType"];
  title: string;
  description: string;
}> = [
  {
    type: "proven-candidate",
    title: "성과 가능성 높은 상품",
    description: "베스트·리뷰·가격·이미지·USP 신호가 함께 확인된 검증형 후보입니다.",
  },
  {
    type: "new-test-candidate",
    title: "새롭게 테스트할 상품",
    description: "리뷰가 적어도 신상품 발견성, 차별점, 이미지와 콘텐츠 확장성이 있는 후보입니다.",
  },
  {
    type: "rediscovery-candidate",
    title: "광고로 재발굴할 상품",
    description:
      "비주력 노출이어도 공개 USP와 여러 광고 각도로 다시 테스트할 가치가 있는 후보입니다.",
  },
];

export function StoreAnalysisResults({ result }: { result: StoreAnalysisResult }) {
  const detailById = new Map(result.products.map((detail) => [detail.product.id, detail]));
  const lowPriority = result.products.filter(
    (detail) => detail.advertisingAnalysis?.recommendationType === "low-priority"
  );
  return (
    <main className="store-results-page">
      <header className="store-results-header">
        <div>
          <Link href="/analyze-store">← 새 업체 분석</Link>
          <p className="eyebrow">STORE ANALYSIS RESULT</p>
          <h1>지금 광고 제작에 활용할 후보</h1>
          <p>실제 매출 순위가 아니라 공개 정보 기준의 광고 제작 적합도와 근거입니다.</p>
        </div>
        <Link className="direct-create-link" href="/create-product">
          상품 URL로 바로 제작
        </Link>
      </header>
      <StoreAnalysisSummary result={result} />
      {result.warnings.length ? (
        <details className="analysis-warning-panel" open>
          <summary>분석 경고 및 부분 성공 안내 {result.warnings.length}건</summary>
          <ul>
            {result.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <CategoryRecommendationList categories={result.categories} />
      <section className="analysis-result-section">
        <div className="result-section-heading">
          <div>
            <p className="eyebrow">PRODUCT OPPORTUNITY</p>
            <h2>추천 상품</h2>
          </div>
          <p>상품과 콘텐츠 가설을 선택하면 기존 제작 화면에 정보가 자동으로 전달됩니다.</p>
        </div>
        {GROUPS.map((group) => {
          const candidates = result.recommendedProducts.filter(
            (candidate) => candidate.analysis.recommendationType === group.type
          );
          if (!candidates.length) return null;
          return (
            <section className="candidate-group" key={group.type}>
              <div className="candidate-group-heading">
                <h3>{group.title}</h3>
                <p>{group.description}</p>
                <span>{candidates.length}개</span>
              </div>
              <div className="product-recommendation-list">
                {candidates.map((candidate) => {
                  const detail = detailById.get(candidate.product.id);
                  return detail ? (
                    <ProductRecommendationCard
                      analysisId={result.analysisId}
                      candidate={candidate}
                      detail={detail}
                      key={candidate.product.id}
                    />
                  ) : null;
                })}
              </div>
            </section>
          );
        })}
        {!result.recommendedProducts.length ? (
          <div className="analysis-empty-state">
            공개 정보만으로 추천 기준을 충족한 상품을 찾지 못했습니다. 낮은 우선순위 이유를
            확인하거나 상품 URL로 직접 제작해 주세요.
          </div>
        ) : null}
      </section>
      {lowPriority.length ? (
        <details className="low-priority-panel">
          <summary>낮은 우선순위 상품 {lowPriority.length}개 보기</summary>
          <div>
            {lowPriority.map((detail) => (
              <article key={detail.product.id}>
                <div>
                  <strong>{detail.product.name}</strong>
                  <span>{detail.product.category || "카테고리 미확인"}</span>
                </div>
                <b>{detail.advertisingAnalysis?.overallScore ?? 0}점</b>
                <ul>
                  {(detail.advertisingAnalysis?.risks || ["광고 근거 부족"]).map((risk) => (
                    <li key={risk}>{risk}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </details>
      ) : null}
      <aside className="analysis-limitations">
        <strong>해석 시 주의사항</strong>
        <ul>
          {result.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </aside>
    </main>
  );
}
