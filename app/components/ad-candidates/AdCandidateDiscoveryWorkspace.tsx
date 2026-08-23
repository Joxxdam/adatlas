"use client";

import { useState } from "react";
import { BigQueryCandidateWorkspace } from "../bigquery/BigQueryCandidateWorkspace";
import { CategoryCandidateWorkspace } from "../category-candidates/CategoryCandidateWorkspace";
import { SiteCandidateWorkspace } from "../site-candidates/SiteCandidateWorkspace";
import styles from "./AdCandidateDiscoveryWorkspace.module.css";

type CandidateMode = "bigquery" | "site";
type CandidateDomain = "product" | "category";

export function AdCandidateDiscoveryWorkspace() {
  const [mode, setMode] = useState<CandidateMode>("bigquery");
  const [domain, setDomain] = useState<CandidateDomain>("product");

  return (
    <div className={styles.root}>
      <div className={styles.modeBar} aria-label="광고 후보 종류">
        <button aria-pressed={domain === "product"} className={domain === "product" ? styles.active : ""} onClick={() => setDomain("product")} type="button"><strong>상품 후보</strong><span>광고할 개별 상품을 찾습니다</span></button>
        <button aria-pressed={domain === "category"} className={domain === "category" ? styles.active : ""} onClick={() => setDomain("category")} type="button"><strong>카테고리 후보</strong><span>카테고리 흐름과 대표 이미지 기회를 찾습니다</span></button>
      </div>
      {domain === "category" ? <CategoryCandidateWorkspace /> : <>
      <div className={styles.modeBar} aria-label="광고 후보 탐색 방식">
        <button aria-pressed={mode === "bigquery"} className={mode === "bigquery" ? styles.active : ""} onClick={() => setMode("bigquery")} type="button">
          <strong>크리마 데이터로 찾기</strong>
          <span>실제 판매·노출·구매 집계</span>
        </button>
        <button aria-pressed={mode === "site"} className={mode === "site" ? styles.active : ""} onClick={() => setMode("site")} type="button">
          <strong>사이트 URL로 찾기</strong>
          <span>자사몰 공개정보 기반 광고 실험 후보</span>
        </button>
      </div>
      {mode === "bigquery" ? <BigQueryCandidateWorkspace onOpenSiteMode={() => setMode("site")} /> : <SiteCandidateWorkspace />}
      </>}
    </div>
  );
}
