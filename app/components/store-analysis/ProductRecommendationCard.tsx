"use client";

import Link from "next/link";
import { useState } from "react";
import type {
  ProductDetailAnalysis,
  RecommendedProductCandidate,
} from "../../lib/store-analysis/types";
import { buildProductCreationHref } from "../../lib/product-creation/handoffUrl";
import { ContentAngleList } from "./ContentAngleList";

const TYPE_LABELS = {
  "proven-candidate": "성과 가능성 높은 상품",
  "new-test-candidate": "새롭게 테스트할 상품",
  "rediscovery-candidate": "광고로 재발굴할 상품",
  "low-priority": "낮은 우선순위",
} as const;

function currency(value?: number) {
  return value ? `${Math.round(value).toLocaleString("ko-KR")}원` : "가격 정보 없음";
}

const SCORE_LABELS = [
  ["productStrengthScore", "상품 경쟁력", "productStrength"],
  ["priceAttractivenessScore", "가격 매력도", "priceAttractiveness"],
  ["reviewUsabilityScore", "리뷰 활용도", "reviewUsability"],
  ["imageUsabilityScore", "이미지 활용도", "imageUsability"],
  ["uspClarityScore", "USP 명확성", "uspClarity"],
  ["seasonFitScore", "시즌 적합도", "seasonFit"],
  ["contentExpansionScore", "콘텐츠 확장성", "contentExpansion"],
  ["detailPageQualityScore", "상세페이지 품질", "detailPageQuality"],
] as const;

export function ProductRecommendationCard({
  analysisId,
  candidate,
  detail,
}: {
  analysisId: string;
  candidate: RecommendedProductCandidate;
  detail: ProductDetailAnalysis;
}) {
  const [selectedAngleId, setSelectedAngleId] = useState(
    candidate.analysis.recommendedAngles[0]?.id
  );
  const selectedAngle =
    candidate.analysis.recommendedAngles.find((angle) => angle.id === selectedAngleId) ||
    candidate.analysis.recommendedAngles[0];
  const createHref = buildProductCreationHref(
    {
      analysisId,
      productId: candidate.product.id,
      angle: selectedAngle?.id,
    },
    candidate.product.url
  );
  return (
    <article className="product-recommendation-card">
      <div className="product-card-media">
        {candidate.product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt={candidate.product.name}
            loading="lazy"
            referrerPolicy="no-referrer"
            src={candidate.product.imageUrl}
          />
        ) : (
          <div className="product-image-placeholder">이미지 정보 없음</div>
        )}
        <span className={`candidate-badge ${candidate.analysis.recommendationType}`}>
          {TYPE_LABELS[candidate.analysis.recommendationType]}
        </span>
        <strong className="product-rank">#{candidate.rank}</strong>
      </div>
      <div className="product-card-content">
        <p className="product-category">{candidate.product.category || "카테고리 미확인"}</p>
        <h3>{candidate.product.name}</h3>
        <div className="product-price-row">
          <strong>{currency(candidate.product.salePrice)}</strong>
          {candidate.product.originalPrice ? (
            <del>{currency(candidate.product.originalPrice)}</del>
          ) : null}
          {candidate.product.discountRate ? <b>{candidate.product.discountRate}% 할인</b> : null}
        </div>
        <div className="product-public-signals">
          <span>리뷰 {candidate.product.reviewCount?.toLocaleString("ko-KR") ?? "정보 없음"}</span>
          <span>평점 {candidate.product.rating ?? "정보 없음"}</span>
          {candidate.product.isBest ? <span>베스트 발견</span> : null}
          {candidate.product.isNew ? <span>신상품 발견</span> : null}
          {candidate.product.isSoldOut ? <span className="danger">품절</span> : null}
        </div>
        <div className="overall-score">
          <div>
            <span>광고 적합도</span>
            <strong>{candidate.analysis.overallScore}</strong>
            <small>/100</small>
          </div>
          <p>confidence {Math.round(candidate.analysis.confidence * 100)}%</p>
        </div>
        <details className="score-breakdown">
          <summary>전략 자세히 보기 · 점수 근거와 주의 요소</summary>
          <div className="score-grid">
            {SCORE_LABELS.map(([key, label, availabilityKey]) => {
              const available = candidate.analysis.scoreAvailability?.[availabilityKey] !== false;
              return (
                <div key={key}>
                  <span>{label}</span>
                  <b>{available ? candidate.analysis[key] : "정보 부족"}</b>
                </div>
              );
            })}
          </div>
          <div className="reason-risk-grid">
            <div>
              <strong>추천 이유</strong>
              <ul>
                {candidate.analysis.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
            <div>
              <strong>주의 요소</strong>
              {candidate.analysis.risks.length ? (
                <ul>
                  {candidate.analysis.risks.map((risk) => (
                    <li key={risk}>{risk}</li>
                  ))}
                </ul>
              ) : (
                <p>공개 정보 기준 중대한 주의 요소가 발견되지 않았습니다.</p>
              )}
            </div>
          </div>
          {detail.detailPageQuality ? (
            <div className="detail-quality-note">
              <b>상세페이지 보완 제안</b>
              <span>
                {detail.detailPageQuality.recommendations.join(" · ") || "추가 보완 제안 없음"}
              </span>
            </div>
          ) : null}
        </details>
        <div className="product-angle-heading">
          <strong>추천 콘텐츠 가설</strong>
          <span>제작에 적용할 방향을 선택하세요.</span>
        </div>
        <ContentAngleList
          angles={candidate.analysis.recommendedAngles}
          onSelect={setSelectedAngleId}
          selectedId={selectedAngleId}
        />
        <div className="recommended-template-row">
          <strong>추천 템플릿</strong>
          {candidate.analysis.recommendedTemplateIds.map((id) => (
            <span key={id}>{id}</span>
          ))}
        </div>
        <div className="product-card-actions">
          <Link className="primary" href={createHref}>
            이 상품으로 제작하기 →
          </Link>
          <a href={candidate.product.url} rel="noreferrer" target="_blank">
            상품 상세 열기 ↗
          </a>
        </div>
      </div>
    </article>
  );
}
