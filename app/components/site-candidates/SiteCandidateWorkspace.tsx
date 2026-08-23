"use client";

import { useEffect, useMemo, useState } from "react";
import type { SiteCandidateAnalysisResult, SiteDiscoveryResult, SiteEvidenceLevel, SiteEvidenceState, SitePageType, SiteRecommendationType } from "../../lib/site-candidates/types";
import styles from "./SiteCandidateWorkspace.module.css";

const PAGE_TYPE_LABEL: Record<SitePageType, string> = {
  homepage: "브랜드 홈페이지",
  category: "상품 카테고리",
  promotion: "기획전·프로모션",
  product: "상품 상세페이지",
  unsupported: "분석하기 어려운 일반 페이지",
};

const TYPE_LABEL: Record<SiteRecommendationType, string> = {
  "review-trust": "후기·신뢰",
  "core-usp": "핵심 USP",
  "price-benefit": "가격·혜택",
  "problem-solution": "문제 해결",
  situation: "상황",
  "visual-hook": "시각 후킹",
  "new-product-test": "신상품",
  "seasonal-test": "시즌",
  "bundle-value": "세트·구성",
  "clear-target": "타깃 명확",
};

const EVIDENCE_LABEL: Record<SiteEvidenceLevel, string> = {
  high: "높음",
  medium: "보통",
  low: "낮음",
};

const EVIDENCE_STATE_LABEL: Record<SiteEvidenceState, string> = {
  present: "확인됨",
  absent: "없음",
  unavailable: "확인 불가",
  extraction_failed: "추출 실패",
  not_applicable: "해당 없음",
};

const PLATFORM_LABEL = {
  cafe24: "Cafe24",
  makeshop: "메이크샵",
  shopify: "Shopify",
  smartstore: "스마트스토어",
  generic: "일반 쇼핑몰",
  unknown: "확인 불가",
} as const;

const PROGRESS_STEPS = ["URL 확인 중", "사이트 유형 분석 중", "상품 찾는 중", "상품 상세 분석 중", "후보 점수 계산 중"];

function priceText(value?: number) {
  return value ? `${Math.round(value).toLocaleString("ko-KR")}원` : "가격 확인 불가";
}

function evidenceValue(value: unknown) {
  if (Array.isArray(value)) return value.join(" · ") || "-";
  if (typeof value === "number") return value.toLocaleString("ko-KR");
  if (typeof value === "boolean") return value ? "예" : "아니요";
  return String(value ?? "-");
}

export function SiteCandidateWorkspace() {
  const [url, setUrl] = useState("");
  const [discovery, setDiscovery] = useState<SiteDiscoveryResult | null>(null);
  const [analysis, setAnalysis] = useState<SiteCandidateAnalysisResult | null>(null);
  const [filter, setFilter] = useState<SiteRecommendationType | "all">("all");
  const [loading, setLoading] = useState(false);
  const [progressIndex, setProgressIndex] = useState(0);
  const [error, setError] = useState("");
  const [selectingId, setSelectingId] = useState("");

  useEffect(() => {
    if (!loading) return;
    const timer = window.setInterval(() => setProgressIndex((current) => Math.min(PROGRESS_STEPS.length - 1, current + 1)), 1_700);
    return () => window.clearInterval(timer);
  }, [loading]);

  const visibleCandidates = useMemo(() => {
    if (!analysis) return [];
    if (filter === "all") return analysis.candidates;
    return analysis.candidates.filter((candidate) => candidate.recommendationTypes.includes(filter));
  }, [analysis, filter]);

  async function analyzeSite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setProgressIndex(0);
    setError("");
    setDiscovery(null);
    setAnalysis(null);
    setFilter("all");
    try {
      const discoverResponse = await fetch("/api/ad-candidates/site/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const discoverPayload = (await discoverResponse.json()) as {
        ok?: boolean;
        discovery?: SiteDiscoveryResult;
        error?: string;
      };
      if (!discoverResponse.ok || !discoverPayload.discovery) {
        throw new Error(discoverPayload.error || "사이트에서 상품을 찾지 못했습니다.");
      }
      setDiscovery(discoverPayload.discovery);
      if (discoverPayload.discovery.pageType === "unsupported" || !discoverPayload.discovery.products.length) {
        setProgressIndex(PROGRESS_STEPS.length - 1);
        return;
      }
      setProgressIndex(3);
      const analyzeResponse = await fetch("/api/ad-candidates/site/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discoveryId: discoverPayload.discovery.discoveryId }),
      });
      const analyzePayload = (await analyzeResponse.json()) as {
        ok?: boolean;
        analysis?: SiteCandidateAnalysisResult;
        error?: string;
      };
      if (!analyzeResponse.ok || !analyzePayload.analysis) {
        throw new Error(analyzePayload.error || "상품 후보를 분석하지 못했습니다.");
      }
      setAnalysis(analyzePayload.analysis);
      setDiscovery(analyzePayload.analysis.discovery);
      setProgressIndex(PROGRESS_STEPS.length - 1);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "사이트 분석 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function createFromCandidate(candidateId: string) {
    if (!analysis) return;
    setSelectingId(candidateId);
    setError("");
    try {
      const response = await fetch("/api/ad-candidates/site/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysisId: analysis.analysisId, candidateId }),
      });
      const payload = (await response.json()) as { nextUrl?: string; error?: string };
      if (!response.ok || !payload.nextUrl) {
        throw new Error(payload.error || "선택한 상품을 광고 제작 화면으로 전달하지 못했습니다.");
      }
      window.location.assign(payload.nextUrl);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "상품 선택 중 오류가 발생했습니다.");
      setSelectingId("");
    }
  }

  return (
    <section className={styles.workspace} aria-labelledby="site-candidate-title">
      <header className={styles.header}>
        <div>
          <p className="eyebrow">SITE PUBLIC DATA DISCOVERY</p>
          <h1 id="site-candidate-title">사이트 URL로 광고 콘텐츠 후보 찾기</h1>
          <p>자사몰의 상품·가격·혜택·후기·USP·이미지를 확인해 광고 실험 우선 상품을 추천합니다.</p>
        </div>
        <div className={styles.sourceBadge}>
          <strong>사이트 공개정보 기반</strong>
          <small>실제 판매성과 아님</small>
        </div>
      </header>

      <form className={styles.search} onSubmit={analyzeSite}>
        <label>
          <span>업체 홈페이지, 카테고리, 기획전 또는 상품 URL</span>
          <input disabled={loading} inputMode="url" onChange={(event) => setUrl(event.target.value)} placeholder="https://brand.example.com/category/..." required type="url" value={url} />
        </label>
        <button disabled={loading} type="submit">
          {loading ? PROGRESS_STEPS[progressIndex] : "사이트 분석하고 후보 찾기"}
        </button>
      </form>

      <div className={styles.disclaimer}>사이트 공개정보를 기반으로 광고 콘텐츠 후보를 추천합니다. 실제 판매량·전환율·ROAS를 예측하지 않으며 최종 성과는 광고 테스트로 검증해야 합니다.</div>

      {error ? <div className={styles.error}>{error}</div> : null}

      {discovery ? (
        <div className={styles.discoverySummary}>
          <div>
            <span>감지된 유형</span>
            <strong>{PAGE_TYPE_LABEL[discovery.pageType]}</strong>
          </div>
          <div>
            <span>감지된 쇼핑몰</span>
            <strong>{PLATFORM_LABEL[discovery.platform]}</strong>
          </div>
          <div>
            <span>발견 상품</span>
            <strong>{discovery.discoveredProductCount}개</strong>
          </div>
          <div>
            <span>분석 가능 상품</span>
            <strong>{discovery.analyzableProductCount}개</strong>
          </div>
          <div>
            <span>분석 기준일</span>
            <strong>{discovery.analyzedAt.slice(0, 10)}</strong>
          </div>
        </div>
      ) : null}

      {discovery?.pageType === "unsupported" || (discovery && !discovery.products.length) ? (
        <div className={styles.empty}>
          <strong>해당 페이지에서 상품 목록을 자동으로 찾지 못했습니다.</strong>
          <span>카테고리 또는 상품 상세페이지 URL을 입력해주세요.</span>
        </div>
      ) : null}

      {analysis ? (
        <>
          <div className={styles.scoreGuide}>
            <div>
              <strong>사이트 URL · 콘텐츠 실험 준비도</strong>
              <p>공개 상세페이지에서 USP·리뷰·혜택·상품 이미지 등 광고 콘텐츠를 만들 근거가 얼마나 충분한지를 나타냅니다. 실제 판매 또는 광고 성과를 예측한 점수가 아닙니다.</p>
            </div>
            <p>추천 순위는 콘텐츠 실험 준비도와 함께 후킹 유형·상품 카테고리의 다양성을 반영합니다. 분석 결과는 서버 메모리에 임시 저장되며 재시작 또는 만료 후 다시 분석해야 합니다.</p>
          </div>

          <div className={styles.toolbar}>
            <div className={styles.filters} aria-label="사이트 후보 유형 필터">
              <button className={filter === "all" ? styles.active : ""} onClick={() => setFilter("all")} type="button">
                전체
              </button>
              {Object.entries(TYPE_LABEL).map(([value, label]) => (
                <button className={filter === value ? styles.active : ""} key={value} onClick={() => setFilter(value as SiteRecommendationType)} type="button">
                  {label}
                </button>
              ))}
            </div>
            <p>
              추천 {analysis.candidates.length}개 · 분석 {analysis.analyzedProductCount}개
            </p>
          </div>

          <div className={styles.grid}>
            {visibleCandidates.map((candidate) => {
              const product = candidate.product;
              const recommendation = candidate.recommendationSummary || {
                coreReason: candidate.recommendationReasons[0] || "확인 가능한 공개정보가 적어 상세페이지 추가 확인이 필요합니다.",
                topStrengths: Object.values(candidate.score.sections)
                  .filter((item) => item.score > 0 && item.reasons.length)
                  .sort((left, right) => right.score / right.maxScore - left.score / left.maxScore)
                  .slice(0, 3)
                  .map((item) => ({
                    sectionKey: item.key,
                    label: item.label,
                    score: item.score,
                    maxScore: item.maxScore,
                    evidence: item.reasons.slice(0, 2).join(" · "),
                  })),
                recommendedTest: `${TYPE_LABEL[candidate.primaryRecommendationType]}형 후킹 우선 검증`,
                insufficientData: candidate.evidenceLevel === "low",
              };
              return (
                <article className={styles.card} key={candidate.id}>
                  <div className={styles.rank}>#{candidate.rank}</div>
                  <div className={styles.productArea}>
                    <div aria-label={`${product.productName} 대표 이미지`} className={styles.productImage} role="img" style={product.representativeImage ? { backgroundImage: `url(${JSON.stringify(product.representativeImage).slice(1, -1)})` } : undefined}>
                      {!product.representativeImage ? <span>이미지 확보 필요</span> : null}
                    </div>
                    <div className={styles.productHeading}>
                      <div className={styles.badges}>
                        <span>{TYPE_LABEL[candidate.primaryRecommendationType]}</span>
                        <b title="공개 상세페이지에서 광고 콘텐츠를 만들 근거가 충분한 정도입니다. 실제 판매 또는 광고 성과를 예측하지 않습니다.">콘텐츠 실험 준비도 {candidate.score.total}</b>
                        <small>근거 {EVIDENCE_LABEL[candidate.evidenceLevel]}</small>
                      </div>
                      <h2>{product.productName}</h2>
                      <p>
                        {product.brandName || analysis.discovery.storeName || "브랜드 확인 불가"} · {product.category || "카테고리 확인 불가"}
                      </p>
                      <div className={styles.priceLine}>
                        <strong>{priceText(product.salePrice)}</strong>
                        {product.regularPrice ? <del>{priceText(product.regularPrice)}</del> : null}
                        {product.discountRate ? <span>{product.discountRate}% 할인</span> : null}
                      </div>
                    </div>
                  </div>

                  <section className={styles.recommendationPanel} aria-label="이 상품을 추천하는 이유">
                    <p className={styles.recommendationTitle}>이 상품을 추천하는 이유</p>
                    <div className={styles.recommendationCore}>
                      <span>
                        추천 이유 <em>시스템 해석</em>
                      </span>
                      <p>{recommendation.coreReason}</p>
                    </div>
                    {recommendation.topStrengths.length ? (
                      <div className={styles.strengthBlock}>
                        <span>
                          확인 근거 <em>실제 공개정보</em>
                        </span>
                        <div className={styles.strengthRows}>
                          {recommendation.topStrengths.slice(0, 3).map((strength) => (
                            <div key={strength.sectionKey}>
                              <strong>
                                {strength.label} {strength.score}/{strength.maxScore}
                              </strong>
                              <small>· {strength.evidence}</small>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <div className={styles.testRecommendation}>
                      <span>
                        추천 테스트 <em>시스템 해석</em>
                      </span>
                      <p>{recommendation.recommendedTest}</p>
                      <small>동일한 디자인에서 메인 후킹과 서브 문구만 바꿔 비교합니다.</small>
                    </div>
                    <div className={styles.testRecommendation}>
                      <span>
                        주의사항 <em>미확인 정보</em>
                      </span>
                      <p>{candidate.cautions[0] || "확인된 공개정보 범위 안에서만 문구를 제작합니다."}</p>
                    </div>
                    <div className={styles.testRecommendation}>
                      <span>
                        데이터 상태 <em>근거 수준</em>
                      </span>
                      <p>{candidate.evidenceLevel === "high" ? "근거 충분" : candidate.evidenceLevel === "medium" ? "일부 근거" : "추가 확인 필요"}</p>
                    </div>
                  </section>

                  <dl className={styles.quickFacts}>
                    <div>
                      <dt>확인된 USP</dt>
                      <dd>{product.uspCandidates[0] || "확인 불가"}</dd>
                    </div>
                    <div>
                      <dt>혜택</dt>
                      <dd>{product.benefits[0] || "확인 불가"}</dd>
                    </div>
                    <div>
                      <dt>리뷰·평점</dt>
                      <dd>
                        {product.reviewCount ? `${product.reviewCount.toLocaleString("ko-KR")}개` : "확인 불가"}
                        {product.rating ? ` · ${product.rating.toFixed(1)}점` : ""}
                      </dd>
                    </div>
                    <div>
                      <dt>이미지</dt>
                      <dd>{product.representativeImage ? `${product.additionalImages.length + 1}개 확보` : "확보 필요"}</dd>
                    </div>
                    <div>
                      <dt>랜딩</dt>
                      <dd>{product.hasPurchaseButton ? "구매 버튼 확인" : "추가 확인 필요"}</dd>
                    </div>
                    <div>
                      <dt>분석 기준일</dt>
                      <dd>{product.analyzedAt.slice(0, 10)}</dd>
                    </div>
                  </dl>

                  <details className={styles.details}>
                    <summary>상세 근거 보기</summary>
                    <div className={styles.scoreBreakdown}>
                      {Object.values(candidate.score.sections).map((item) => (
                        <div data-status={item.status} key={item.key}>
                          <span>{item.label}</span>
                          <strong>{item.status === "unavailable" ? `미확인 · 최대 ${item.maxScore}` : `받은 점수 ${item.score} · 최대 ${item.maxScore}`}</strong>
                          <em>
                            근거 충족 {item.evidenceCount}/{item.indicatorCount}
                          </em>
                          <small>{item.reasons.join(" · ") || (item.status === "unavailable" ? "확인하지 못한 정보: 공개 페이지에서 근거를 찾지 못함" : "점수가 낮은 이유: 확인된 강점 근거가 적음")}</small>
                        </div>
                      ))}
                    </div>
                    <h3>실제 확인 정보</h3>
                    <dl className={styles.evidenceList}>
                      {product.evidence.map((field) => (
                        <div key={field.key} data-state={field.state}>
                          <dt>{field.label}</dt>
                          <dd>
                            {EVIDENCE_STATE_LABEL[field.state]} · {evidenceValue(field.value)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <h3>소재 제작 시 주의사항</h3>
                    <ul>
                      {candidate.cautions.map((caution) => (
                        <li key={caution}>{caution}</li>
                      ))}
                    </ul>
                    <a href={product.productUrl} rel="noreferrer" target="_blank">
                      원본 상품 페이지 열기
                    </a>
                  </details>

                  <div className={styles.actions}>
                    <button disabled={Boolean(selectingId)} onClick={() => void createFromCandidate(candidate.id)} type="button">
                      {selectingId === candidate.id ? "제작 화면 준비 중" : "이 상품으로 광고 만들기"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          {!visibleCandidates.length ? (
            <div className={styles.empty}>
              <strong>선택한 유형의 후보가 없습니다.</strong>
              <span>확인되지 않은 근거로 후보를 억지로 만들지 않았습니다.</span>
            </div>
          ) : null}

          {analysis.warnings.length ? (
            <details className={styles.warnings}>
              <summary>일부 분석 제한 및 주의사항 {analysis.warnings.length}건</summary>
              <ul>
                {analysis.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : null}

      <footer className={styles.futureNote}>판매 데이터가 없는 광고주도 사이트 분석으로 시작하고, 실제 광고 성과가 쌓이면 성과 기반 콘텐츠 추천으로 발전할 수 있습니다.</footer>
    </section>
  );
}
