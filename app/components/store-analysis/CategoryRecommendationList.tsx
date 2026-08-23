import type { StoreCategoryAnalysis } from "../../lib/store-analysis/types";

function currency(value?: number) {
  return value ? `${Math.round(value).toLocaleString("ko-KR")}원` : "정보 부족";
}

function percent(value?: number) {
  return value === undefined ? "정보 부족" : `${Math.round(value * 100)}%`;
}

export function CategoryRecommendationList({ categories }: { categories: StoreCategoryAnalysis[] }) {
  return (
    <section className="analysis-result-section">
      <div className="result-section-heading">
        <div>
          <p className="eyebrow">CATEGORY OPPORTUNITY</p>
          <h2>추천 카테고리</h2>
        </div>
        <p>상품 수가 아니라 리뷰·할인·이미지·USP·콘텐츠 확장성을 함께 반영했습니다.</p>
      </div>
      {categories.length ? (
        <div className="category-recommendation-grid">
          {categories.slice(0, 6).map((category, index) => (
            <article className="category-recommendation-card" key={category.id}>
              <div className="category-rank">
                <span>추천 {index + 1}위</span>
                <b>{category.recommendationScore ?? 0}</b>
              </div>
              <h3>{category.name}</h3>
              <dl>
                <div>
                  <dt>상품</dt>
                  <dd>{category.productCount ?? 0}개</dd>
                </div>
                <div>
                  <dt>평균 가격</dt>
                  <dd>{currency(category.averagePrice)}</dd>
                </div>
                <div>
                  <dt>할인 비중</dt>
                  <dd>{percent(category.discountedProductRatio)}</dd>
                </div>
                <div>
                  <dt>신상품 비중</dt>
                  <dd>{percent(category.newProductRatio)}</dd>
                </div>
              </dl>
              <ul>
                {category.reasons.slice(0, 4).map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              {category.recommendedAngleTypes?.length ? (
                <div className="category-angle-tags">
                  {category.recommendedAngleTypes.map((type) => (
                    <span key={type}>{type}</span>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <div className="analysis-empty-state">분류 가능한 카테고리 정보를 찾지 못했습니다.</div>
      )}
    </section>
  );
}
