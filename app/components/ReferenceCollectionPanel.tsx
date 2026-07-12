"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

type WatchlistSummary = {
  brands: number;
  enabled: number;
  analyses: number;
  latest: {
    id: string;
    brand: string;
    hook: string;
    usp: string[];
    frames: string[];
    copyScore: number;
  }[];
};

type CrawlState =
  | { status: "idle"; message: string }
  | { status: "loading"; message: string }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

export function ReferenceCollectionPanel() {
  const [summary, setSummary] = useState<WatchlistSummary | null>(null);
  const [limit, setLimit] = useState(100);
  const [priority, setPriority] = useState("");
  const [state, setState] = useState<CrawlState>({
    status: "idle",
    message: "100개 브랜드 워치리스트를 기준으로 매일 오전 9시에 콘텐츠를 수집합니다.",
  });

  async function loadSummary() {
    const response = await fetch("/api/watchlist");
    const result = await response.json();
    setSummary(result);
  }

  useEffect(() => {
    loadSummary().catch(() => undefined);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({
      status: "loading",
      message: "브랜드 워치리스트 콘텐츠를 크롤링하고 분석하는 중입니다.",
    });

    try {
      const response = await fetch("/api/watchlist/crawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit, priority: priority || undefined }),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error ?? "크롤링 요청이 실패했습니다.");
      }

      setState({
        status: "success",
        message: `${result.brands}개 브랜드를 크롤링해 ${result.analyses}개 분석을 생성했습니다. 새 분석 ${result.added}개, 전체 ${result.total}개.`,
      });
      await loadSummary();
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.",
      });
    }
  }

  return (
    <section className="panel" id="레퍼런스 수집">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">브랜드 워치리스트</p>
          <h2>100개 브랜드 콘텐츠 크롤링 및 문구 분석</h2>
        </div>
        <Link className="text-action-link" href="/references">
          전체 콘텐츠 보기
        </Link>
      </div>

      <form className="collection-form" onSubmit={handleSubmit}>
        <label>
          수집 브랜드 수
          <select value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
            <option value={20}>20개 테스트</option>
            <option value={50}>50개</option>
            <option value={100}>100개 전체</option>
          </select>
        </label>
        <label>
          우선순위
          <select value={priority} onChange={(event) => setPriority(event.target.value)}>
            <option value="">전체</option>
            <option value="A">A 우선</option>
            <option value="B">B 우선</option>
          </select>
        </label>
        <label>
          실행
          <button type="submit" disabled={state.status === "loading"}>
            {state.status === "loading" ? "분석 중" : "지금 크롤링 실행"}
          </button>
        </label>
        <div className={`collection-status ${state.status}`}>{state.message}</div>
      </form>

      <div className="watchlist-summary">
        <article>
          <span>워치리스트</span>
          <strong>{summary?.brands ?? 100}개</strong>
        </article>
        <article>
          <span>활성 브랜드</span>
          <strong>{summary?.enabled ?? 100}개</strong>
        </article>
        <article>
          <span>저장된 분석</span>
          <strong>{summary?.analyses ?? 0}개</strong>
        </article>
      </div>

      {summary?.latest?.length ? (
        <div className="analysis-preview-list">
          {summary.latest.slice(0, 3).map((item) => (
            <article key={item.id}>
              <div>
                <strong>{item.brand}</strong>
                <b>{item.copyScore}</b>
              </div>
              <p>{item.hook}</p>
              <span>{item.frames.join(" + ")}</span>
              <small>{item.usp.slice(0, 2).join(" / ")}</small>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
