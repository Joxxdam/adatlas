"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { StoreAnalysisProgress } from "./StoreAnalysisProgress";

type FormState = {
  storeUrl: string;
  storeName: string;
  priorityCategories: string;
  excludedCategories: string;
  maxProducts: number;
  includeBest: boolean;
  includeNew: boolean;
  includeDiscounted: boolean;
  analyzeReviews: boolean;
};

const initialState: FormState = {
  storeUrl: "",
  storeName: "",
  priorityCategories: "",
  excludedCategories: "",
  maxProducts: 30,
  includeBest: true,
  includeNew: true,
  includeDiscounted: true,
  analyzeReviews: true,
};

export function StoreAnalysisForm() {
  const router = useRouter();
  const [form, setForm] = useState(initialState);
  const [submitting, setSubmitting] = useState(false);
  const [progressIndex, setProgressIndex] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!submitting) return;
    const timer = window.setInterval(
      () => setProgressIndex((current) => Math.min(5, current + 1)),
      2800
    );
    return () => window.clearInterval(timer);
  }, [submitting]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setProgressIndex(0);
    setError("");
    try {
      const response = await fetch("/api/store-analysis/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          priorityCategories: form.priorityCategories
            .split(/[,\n]/)
            .map((value) => value.trim())
            .filter(Boolean),
          excludedCategories: form.excludedCategories
            .split(/[,\n]/)
            .map((value) => value.trim())
            .filter(Boolean),
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok || !result.analysisId) {
        throw new Error(result.error || "업체 분석에 실패했습니다.");
      }
      setProgressIndex(5);
      router.push(`/analyze-store/results?analysisId=${encodeURIComponent(result.analysisId)}`);
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "업체 분석 중 오류가 발생했습니다."
      );
      setSubmitting(false);
    }
  }

  return (
    <main className="store-analysis-page">
      <header className="store-analysis-header">
        <Link href="/">← 제작 방식 다시 선택</Link>
        <p className="eyebrow">STORE ANALYSIS</p>
        <h1>업체 분석 후 광고 후보 찾기</h1>
        <p>
          공개된 쇼핑몰 페이지에서 상품 후보를 수집하고, 어떤 상품을 어떤 구매 이유로 광고할지
          근거와 함께 추천합니다.
        </p>
      </header>

      {submitting ? (
        <StoreAnalysisProgress activeIndex={progressIndex} />
      ) : (
        <form className="store-analysis-form" onSubmit={submit}>
          <section className="store-form-section primary">
            <div className="store-form-heading">
              <span>01</span>
              <div>
                <h2>분석할 쇼핑몰</h2>
                <p>상품 상세 URL이 아닌 업체 쇼핑몰 메인 또는 카테고리 URL을 입력하세요.</p>
              </div>
            </div>
            <label className="store-field full">
              <span>
                업체 쇼핑몰 URL <b>필수</b>
              </span>
              <input
                inputMode="url"
                onChange={(event) => update("storeUrl", event.target.value)}
                placeholder="https://example.com"
                required
                type="url"
                value={form.storeUrl}
              />
            </label>
            <label className="store-field full">
              <span>
                업체명 <small>선택</small>
              </span>
              <input
                onChange={(event) => update("storeName", event.target.value)}
                placeholder="자동 감지되며, 필요한 경우 직접 입력"
                value={form.storeName}
              />
            </label>
          </section>

          <section className="store-form-section">
            <div className="store-form-heading">
              <span>02</span>
              <div>
                <h2>분석 범위 설정</h2>
                <p>우선순위와 제외 범위는 쉼표로 여러 개 입력할 수 있습니다.</p>
              </div>
            </div>
            <div className="store-form-grid">
              <label className="store-field">
                <span>
                  우선 분석 카테고리 <small>선택</small>
                </span>
                <input
                  onChange={(event) => update("priorityCategories", event.target.value)}
                  placeholder="예: 캠핑, 선물세트"
                  value={form.priorityCategories}
                />
              </label>
              <label className="store-field">
                <span>
                  제외할 카테고리 <small>선택</small>
                </span>
                <input
                  onChange={(event) => update("excludedCategories", event.target.value)}
                  placeholder="예: 소모품, 액세서리"
                  value={form.excludedCategories}
                />
              </label>
              <label className="store-field">
                <span>최대 수집 상품 수</span>
                <input
                  max={30}
                  min={1}
                  onChange={(event) => update("maxProducts", Number(event.target.value))}
                  type="number"
                  value={form.maxProducts}
                />
                <small>1차 MVP는 최대 30개까지 상세 분석합니다.</small>
              </label>
            </div>
            <div className="store-toggle-grid">
              {(
                [
                  ["includeBest", "베스트 상품 포함", "베스트·인기 영역을 우선 탐색합니다."],
                  [
                    "includeNew",
                    "신상품 포함",
                    "리뷰가 적어도 신상품 테스트 가치를 별도 평가합니다.",
                  ],
                  [
                    "includeDiscounted",
                    "할인 상품 포함",
                    "할인·기획전 영역과 확인된 가격 혜택을 분석합니다.",
                  ],
                  ["analyzeReviews", "리뷰 분석", "공개 HTML에 노출된 리뷰 패턴만 요약합니다."],
                ] as const
              ).map(([key, label, description]) => (
                <label className="store-toggle" key={key}>
                  <input
                    checked={form[key]}
                    onChange={(event) => update(key, event.target.checked)}
                    type="checkbox"
                  />
                  <span>
                    <b>{label}</b>
                    <small>{description}</small>
                  </span>
                </label>
              ))}
            </div>
          </section>

          <aside className="store-analysis-notice">
            <strong>분석 전에 확인해 주세요</strong>
            <ul>
              <li>쇼핑몰 구조에 따라 일부 상품이나 리뷰를 가져오지 못할 수 있습니다.</li>
              <li>공개 페이지에서 확인 가능한 정보만 분석합니다.</li>
              <li>
                실제 매출·재고·마진이 연결되지 않은 경우 광고 제작 적합도를 기준으로 추천합니다.
              </li>
              <li>추천 결과는 실제 매출 순위가 아니며 성과를 보장하지 않습니다.</li>
              <li>robots 정책이나 접근 제한이 확인되면 우회하지 않습니다.</li>
            </ul>
          </aside>
          {error ? <div className="store-form-error">{error}</div> : null}
          <button className="store-analysis-submit" type="submit">
            업체 분석하기 <span aria-hidden="true">→</span>
          </button>
        </form>
      )}
    </main>
  );
}
