import type { StoreAnalysisResult } from "../../lib/store-analysis/types";

export function StoreAnalysisSummary({ result }: { result: StoreAnalysisResult }) {
  const items = [
    ["추정 플랫폼", result.storeInfo.platform || "unknown"],
    ["분석 카테고리", `${result.stats.categoryCount}개`],
    ["수집 상품", `${result.stats.discoveredProductCount}개`],
    ["상세 분석", `${result.stats.analyzedProductCount}개`],
    ["리뷰 분석", `${result.stats.reviewAnalyzedProductCount}개`],
    ["분석 실패", `${result.stats.failedProductCount}개`],
  ];
  return (
    <section className="analysis-summary-card">
      <div className="analysis-summary-title">
        {result.storeInfo.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="" referrerPolicy="no-referrer" src={result.storeInfo.logoUrl} />
        ) : (
          <span>{(result.storeInfo.storeName || result.storeInfo.domain).slice(0, 1)}</span>
        )}
        <div>
          <p className="eyebrow">ANALYSIS SUMMARY</p>
          <h2>{result.storeInfo.storeName || result.storeInfo.brandName || result.storeInfo.domain}</h2>
          <a href={result.storeInfo.storeUrl} rel="noreferrer" target="_blank">
            {result.storeInfo.domain} ↗
          </a>
        </div>
        <div className={`copy-guide-state ${result.copyGuideMatch.matched ? "matched" : ""}`}>
          <b>{result.copyGuideMatch.matched ? "업체 카피 가이드 매칭" : "업체 전용 가이드 없음"}</b>
          <span>{result.copyGuideMatch.matched ? `${result.copyGuideMatch.brandName} · ${result.copyGuideMatch.matchedBy}` : "상품 카테고리와 공개 정보 기준으로 제작"}</span>
        </div>
      </div>
      <dl className="analysis-stat-grid">
        {items.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {result.storeInfo.repeatedBrandPhrases?.length ? (
        <div className="brand-phrase-list">
          <strong>사이트에서 반복 확인된 표현</strong>
          <div>
            {result.storeInfo.repeatedBrandPhrases.slice(0, 6).map((phrase) => (
              <span key={phrase}>{phrase}</span>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
