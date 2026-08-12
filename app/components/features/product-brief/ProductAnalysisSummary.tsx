"use client";

import { inferAdBriefContext } from "../../../lib/mvp/adBriefInference";
import type { AdBrief, AdImageLabel, ProductInfoForPrompt } from "../../../lib/mvp/types";
import styles from "../creative-workflow/CreativeWorkflow.module.css";

function compact(value: string | undefined, max = 76) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function compositionFromProduct(product: ProductInfoForPrompt) {
  const source = `${product.productName} ${product.mainBenefit} ${product.extractedDescription}`;
  return Array.from(
    new Set(source.match(/\d+(?:\.\d+)?\s*(?:kg|g|ml|l|개|팩|세트|입|장|병|포)/gi) || [])
  )
    .slice(0, 3)
    .join(" / ");
}

function evidenceFromProduct(product: ProductInfoForPrompt) {
  const source = `${product.productName} ${product.mainBenefit} ${product.extractedDescription}`;
  const evidence = [
    /국내산/.test(source) ? "국내산 표기" : "",
    /원산지/.test(source) ? "원산지 표기" : "",
    /인증/.test(source) ? "인증 정보" : "",
    /후기|리뷰/.test(source) ? "후기·리뷰 문구" : "",
    product.originalPrice && product.price ? "정상가·판매가 확인" : "",
    product.discountInfo ? compact(product.discountInfo, 34) : "",
  ].filter(Boolean);
  return Array.from(new Set(evidence)).join(", ");
}

export function ProductAnalysisSummary(props: {
  product: ProductInfoForPrompt;
  brief: AdBrief;
  references?: AdImageLabel[];
  loaded: boolean;
}) {
  if (!props.loaded) return null;

  const inferred = inferAdBriefContext({
    product: props.product,
    brief: props.brief,
    references: props.references,
  });
  const composition = compositionFromProduct(props.product);
  const benefit = compact(props.product.mainBenefit || props.product.extractedDescription);
  const evidence = evidenceFromProduct(props.product);

  return (
    <details className={styles.analysisSummary}>
      <summary className={styles.analysisSummaryHeader}>
        <div>
          <span>1 · 상품 확인</span>
          <h4>{props.product.productName || "상품 정보 자동 분석 완료"}</h4>
          <small>{props.product.price || "가격 미확인"} · 상세 분석 보기</small>
        </div>
        <strong>1200×1200 광고 준비됨</strong>
      </summary>
      <dl className={styles.analysisGrid}>
        <dt>상품명</dt>
        <dd>{props.product.productName || "확인되지 않음"}</dd>
        <dt>판매가</dt>
        <dd>{props.product.price || "확인되지 않음"}</dd>
        <dt>주요 구성</dt>
        <dd>{composition || "확인되지 않음"}</dd>
        <dt>주요 혜택</dt>
        <dd>{benefit || "확인되지 않음"}</dd>
        <dt>확인된 근거</dt>
        <dd>{evidence || "추가로 확인된 근거 없음"}</dd>
        <dt>자동 추천 방향</dt>
        <dd>
          {inferred.hookType} · {inferred.tone}
        </dd>
      </dl>
    </details>
  );
}
