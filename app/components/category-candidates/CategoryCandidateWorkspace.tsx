"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { BigQueryAdvertiser } from "../../lib/bigquery/types";
import { defaultFashionCategories } from "../../lib/category-candidates/normalization";
import type { CategoryCandidate, CategoryCandidateResponse } from "../../lib/category-candidates/types";
import styles from "./CategoryCandidateWorkspace.module.css";

function money(value: number) {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function percent(value: number | null) {
  return value === null ? "비교 기준 없음" : `${value >= 0 ? "+" : ""}${Math.round(value * 100)}%`;
}

export function CategoryCandidateWorkspace() {
  const [advertisers, setAdvertisers] = useState<BigQueryAdvertiser[]>([]);
  const [advertiserId, setAdvertiserId] = useState("");
  const [result, setResult] = useState<CategoryCandidateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [categoryOverrides, setCategoryOverrides] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/ad-candidates/brands").then((response) => response.json()).then((payload) => {
      if (!payload.ok) throw new Error(payload.error || "광고주 목록을 불러오지 못했습니다.");
      setAdvertisers(payload.advertisers || payload.rows || []);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  const selectedAdvertiser = useMemo(() => advertisers.find((advertiser) => advertiser.id === advertiserId), [advertiserId, advertisers]);

  async function analyze() {
    if (!advertiserId) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/category-candidates?advertiserId=${encodeURIComponent(advertiserId)}`);
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "카테고리 분석에 실패했습니다.");
      setResult(payload);
      setCategoryOverrides({});
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={styles.root}>
      <header>
        <p className={styles.eyebrow}>CATEGORY OPPORTUNITY</p>
        <h2>카테고리 광고 후보 분석</h2>
        <p>최근 7일과 직전 7일, 최근 4주 흐름을 읽기 전용 데이터로 비교합니다. 상품 광고 후보와 별개의 분석입니다.</p>
      </header>
      <div className={styles.controls}>
        <label>
          <span>분석할 광고주</span>
          <select onChange={(event) => setAdvertiserId(event.target.value)} value={advertiserId}>
            <option value="">광고주를 선택하세요</option>
            {advertisers.map((advertiser) => <option key={advertiser.id} value={advertiser.id}>{advertiser.name}</option>)}
          </select>
        </label>
        <button disabled={!advertiserId || loading} onClick={analyze} type="button">{loading ? "카테고리 분석 중…" : "카테고리 후보 보기"}</button>
        <Link href={`/category-images${selectedAdvertiser ? `?advertiserId=${encodeURIComponent(selectedAdvertiser.id)}&advertiserName=${encodeURIComponent(selectedAdvertiser.name)}` : ""}`}>분석 없이 직접 제작</Link>
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
      {result ? (
        <div className={styles.results}>
          <div className={styles.summary}><strong>{result.advertiser.name}</strong><span>{result.latestDataDate} 기준 · {result.candidates.length}개 카테고리</span></div>
          <div className={styles.grid}>
            {result.candidates.map((candidate: CategoryCandidate) => {
              const productionCategoryId = categoryOverrides[candidate.id] || candidate.categoryId;
              const productionCategoryName = defaultFashionCategories.find((category) => category.id === productionCategoryId)?.name || candidate.categoryName;
              return <article key={candidate.id}>
                <div className={styles.cardTop}><span className={`${styles.status} ${styles[candidate.status]}`}>{candidate.statusLabel}</span><small>매출 비중 {Math.round(candidate.advertiserSalesShare * 100)}%</small></div>
                <h3>{candidate.categoryName}</h3>
                <label className={styles.mapping}><span>제작 분류 수정</span><select value={productionCategoryId} onChange={(event) => setCategoryOverrides((current) => ({ ...current, [candidate.id]: event.target.value }))}>{defaultFashionCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
                <p>{candidate.reason}</p>
                <dl>
                  <div><dt>최근 7일 매출</dt><dd>{money(candidate.current7Sales)}</dd></div>
                  <div><dt>직전 대비</dt><dd>{percent(candidate.salesChangeRate)}</dd></div>
                  <div><dt>주문</dt><dd>{candidate.current7Orders.toLocaleString("ko-KR")}건</dd></div>
                  <div><dt>상품 집중도</dt><dd>{Math.round(candidate.topProductConcentration * 100)}%</dd></div>
                </dl>
                <div className={styles.weeks}>{candidate.weeklySales.slice().reverse().map((value, index) => <span key={index} style={{ height: `${Math.max(8, Math.round((value / Math.max(...candidate.weeklySales, 1)) * 56))}px` }} title={money(value)} />)}</div>
                <details><summary>근거 상품과 데이터 제한</summary><p>원본 신호: {candidate.originalCategorySignals.join(" · ")}</p>{candidate.evidenceProducts.map((product, index) => <p key={`${candidate.id}-evidence-${index}`}>{product}</p>)}<p>{candidate.peerComparison.reason}</p></details>
                <Link href={`/category-images?advertiserId=${encodeURIComponent(candidate.advertiserId)}&advertiserName=${encodeURIComponent(candidate.advertiserName)}&categoryId=${encodeURIComponent(productionCategoryId)}&categoryName=${encodeURIComponent(productionCategoryName)}`}>이 카테고리 이미지 만들기</Link>
              </article>
            } )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
