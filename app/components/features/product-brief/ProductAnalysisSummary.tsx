"use client";

/* Product-page and runtime image URLs intentionally bypass Next image optimization. */
/* eslint-disable @next/next/no-img-element */

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
  return Array.from(new Set(source.match(/\d+(?:\.\d+)?\s*(?:kg|g|ml|l|개|팩|세트|입|장|병|포)/gi) || []))
    .slice(0, 3)
    .join(" / ");
}

function evidenceFromProduct(product: ProductInfoForPrompt) {
  const source = `${product.productName} ${product.mainBenefit} ${product.extractedDescription}`;
  const evidence = [/국내산/.test(source) ? "국내산 표기" : "", /원산지/.test(source) ? "원산지 표기" : "", /인증/.test(source) ? "인증 정보" : "", /후기|리뷰/.test(source) ? "후기·리뷰 문구" : "", product.originalPrice && product.price ? "정상가·판매가 확인" : "", product.discountInfo ? compact(product.discountInfo, 34) : ""].filter(Boolean);
  return Array.from(new Set(evidence)).join(", ");
}

function featureList(product: ProductInfoForPrompt) {
  const candidates = [...(product.verifiedBenefits || []), product.mainBenefit, product.discountInfo, product.ingredients?.length ? `주요 성분 · ${product.ingredients.slice(0, 3).join(", ")}` : "", product.targetCustomer ? `추천 대상 · ${product.targetCustomer}` : ""].map((item) => compact(item, 64)).filter(Boolean);
  return Array.from(new Set(candidates)).slice(0, 3);
}

export function ProductAnalysisSummary(props: { product: ProductInfoForPrompt; brief: AdBrief; references?: AdImageLabel[]; loaded: boolean; imagePaths?: string[]; onChooseOther?: () => void; onUseProduct?: () => void; selectedForGeneration?: boolean }) {
  if (!props.loaded) return null;

  const inferred = inferAdBriefContext({
    product: props.product,
    brief: props.brief,
    references: props.references,
  });
  const composition = compositionFromProduct(props.product);
  const benefit = compact(props.product.mainBenefit || props.product.extractedDescription);
  const evidence = evidenceFromProduct(props.product);
  const features = featureList(props.product);
  const imageCandidates = [props.product.extractedMainImage || props.product.extractedGalleryImages?.[0], ...(props.product.extractedGalleryImages || []), ...(props.imagePaths || []), props.product.productImagePath].filter((value): value is string => Boolean(value));
  const originalCandidates = imageCandidates.filter((value) => !/\/(?:processed-products|product-cutouts)\//i.test(value));
  const imagePath = originalCandidates[0] || imageCandidates[0];
  const sourceImageCount = new Set([...(props.imagePaths || []), ...(props.product.productImagePaths || []), ...(props.product.extractedGalleryImages || []), ...(props.product.sourceImageCandidates || []).map((candidate) => candidate.imagePath)].filter(Boolean)).size;

  return (
    <section className={styles.productConfirmation} aria-label="분석한 상품 확인">
      <div className={styles.productConfirmationMedia}>{imagePath ? <img alt={`${props.product.productName} 대표 상품`} src={imagePath} /> : <span>상품 이미지 준비 중</span>}</div>
      <div className={styles.productConfirmationBody}>
        <span className={styles.sectionStep}>상품 분석 완료</span>
        <h4>{props.product.productName || "상품 정보 자동 분석 완료"}</h4>
        <p className={styles.productBrand}>{props.product.brandName || props.product.advertiserName || "브랜드 미확인"}</p>
        <strong className={styles.productPrice}>{props.product.price || "가격 미확인"}</strong>
        {features.length ? (
          <ul className={styles.productFeatureList}>
            {features.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
        ) : (
          <p className={styles.productFeatureEmpty}>공개 페이지에서 확인된 핵심 특징을 상세 분석에서 확인해 주세요.</p>
        )}
        <p className={styles.sourceImageCount}>광고 제작에 사용할 수 있는 원본 이미지 {sourceImageCount}장</p>
        <div className={styles.productConfirmationActions}>
          <button disabled={props.selectedForGeneration} onClick={props.onUseProduct} type="button">
            {props.selectedForGeneration ? "선택 완료 · 아래에서 제작 상태 확인" : "이 상품으로 광고 만들기"}
          </button>
          <button onClick={props.onChooseOther} type="button">
            다른 상품 선택
          </button>
        </div>
        <details className={styles.analysisSummary}>
          <summary>분석 내용 자세히 보기</summary>
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
            <dt>추천 대상</dt>
            <dd>{props.product.targetCustomer || "확인되지 않음"}</dd>
            <dt>추천 방향</dt>
            <dd>
              {inferred.hookType} · {inferred.tone}
            </dd>
            <dt>원본 이미지</dt>
            <dd>
              {props.imagePaths?.length ? (
                <div className={styles.analysisImageList}>
                  {props.imagePaths.slice(0, 8).map((path, index) => (
                    <img alt={`상품 원본 ${index + 1}`} key={path} src={path} />
                  ))}
                </div>
              ) : (
                "확인되지 않음"
              )}
            </dd>
          </dl>
        </details>
      </div>
    </section>
  );
}
