"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type {
  BigQueryAdvertiser,
  BigQueryCandidateCapability,
  BigQueryCandidateMetric,
  BigQueryCandidatePeriod,
  BigQueryCandidateResponse,
  BigQueryCandidateType,
  BigQueryConnectionStatus,
} from "../../lib/bigquery/types";
import styles from "./BigQueryCandidateWorkspace.module.css";

const candidateLabels: Record<BigQueryCandidateType, string> = {
  "sales-rising": "매출 상승",
  bestseller: "판매 상위",
  "review-strength": "후기 강점",
  "exposure-efficient": "노출 효율",
  "exposure-potential": "저노출 잠재",
  "improvement-needed": "전환 개선 필요",
  "new-product": "신상품",
  "price-competitive": "가격 경쟁력",
};

const periodLabels: Record<BigQueryCandidatePeriod, string> = {
  "4w": "최근 4주",
  "8w": "최근 8주",
  "12w": "최근 12주",
};

function metricText(metric: BigQueryCandidateMetric) {
  if (metric.value === null) return "데이터 없음";
  if (metric.unit === "currency") {
    return `${Math.round(metric.value).toLocaleString("ko-KR")}원`;
  }
  if (metric.unit === "rate") {
    const sign = metric.value > 0 && metric.key === "sales-change" ? "+" : "";
    return `${sign}${(metric.value * 100).toFixed(1)}%`;
  }
  if (metric.unit === "rank") return `${Math.round(metric.value)}위`;
  return Math.round(metric.value).toLocaleString("ko-KR");
}

function bytesText(bytes: number) {
  if (!bytes) return "캐시 사용";
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function sufficiencyText(value: BigQueryCandidateResponse["candidates"][number]["dataSufficiency"]) {
  if (value === "analysis-ready") return "분석 가능";
  if (value === "reference-only") return "참고용";
  if (value === "connection-required") return "연결 확인 필요";
  return "데이터 부족";
}

export function BigQueryCandidateWorkspace({
  onOpenSiteMode,
}: {
  onOpenSiteMode?: () => void;
}) {
  const [status, setStatus] = useState<BigQueryConnectionStatus | null>(null);
  const [advertisers, setAdvertisers] = useState<BigQueryAdvertiser[]>([]);
  const [advertiserSearch, setAdvertiserSearch] = useState("");
  const [advertiserId, setAdvertiserId] = useState("");
  const [period, setPeriod] = useState<BigQueryCandidatePeriod>("4w");
  const [candidateType, setCandidateType] = useState<BigQueryCandidateType | "all">("all");
  const [result, setResult] = useState<BigQueryCandidateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [querying, setQuerying] = useState(false);
  const [message, setMessage] = useState("BigQuery 읽기 전용 연결을 확인하고 있습니다.");

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      setLoading(true);
      try {
        const [statusResponse, brandsResponse] = await Promise.all([
          fetch("/api/bigquery/status", { cache: "no-store" }),
          fetch("/api/ad-candidates/brands", { cache: "no-store" }),
        ]);
        const statusPayload = (await statusResponse.json()) as {
          status?: BigQueryConnectionStatus;
        };
        const brandsPayload = (await brandsResponse.json()) as {
          advertisers?: BigQueryAdvertiser[];
          error?: string;
        };
        if (cancelled) return;
        if (statusPayload.status) setStatus(statusPayload.status);
        if (!brandsResponse.ok) throw new Error(brandsPayload.error || "광고주 목록 조회에 실패했습니다.");
        const nextAdvertisers = brandsPayload.advertisers || [];
        setAdvertisers(nextAdvertisers);
        setAdvertiserId(nextAdvertisers[0]?.id || "");
        setMessage(
          nextAdvertisers.length
            ? `최근 집계가 있는 광고주 ${nextAdvertisers.length.toLocaleString("ko-KR")}곳을 찾았습니다.`
            : "조회 가능한 광고주가 없습니다. 아래 URL 분석 흐름을 이용해 주세요."
        );
      } catch (error) {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : "BigQuery 연결을 확인하지 못했습니다.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void initialize();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredAdvertisers = useMemo(() => {
    const query = advertiserSearch.trim().toLocaleLowerCase("ko-KR");
    if (!query) return advertisers;
    return advertisers.filter((advertiser) =>
      [advertiser.name, advertiser.category || "", advertiser.storeUrl || ""]
        .join(" ")
        .toLocaleLowerCase("ko-KR")
        .includes(query)
    );
  }, [advertiserSearch, advertisers]);

  const selectedAdvertiser = advertisers.find((advertiser) => advertiser.id === advertiserId);
  const typeOptions = useMemo(() => result?.capabilities || [], [result]);

  async function findCandidates() {
    if (!advertiserId) {
      setMessage("광고주를 먼저 선택해 주세요.");
      return;
    }
    setQuerying(true);
    setMessage("dry run으로 조회량을 확인한 뒤 광고 후보를 계산하고 있습니다.");
    try {
      const params = new URLSearchParams({ brandId: advertiserId, period, type: candidateType });
      const response = await fetch(`/api/ad-candidates?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json()) as BigQueryCandidateResponse & {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "광고 후보 조회에 실패했습니다.");
      setResult(payload);
      setMessage(
        payload.candidates.length
          ? `근거가 있는 광고 후보 ${payload.candidates.length}건을 찾았습니다.`
          : "현재 조건에서 근거가 충분한 후보가 없습니다. 기간이나 유형을 바꿔 보세요."
      );
    } catch (error) {
      setResult(null);
      setMessage(error instanceof Error ? error.message : "광고 후보를 불러오지 못했습니다.");
    } finally {
      setQuerying(false);
    }
  }

  function filterResult(type: BigQueryCandidateType | "all") {
    setCandidateType(type);
    if (!result) return;
    void (async () => {
      setQuerying(true);
      try {
        const params = new URLSearchParams({ brandId: advertiserId, period, type });
        const response = await fetch(`/api/ad-candidates?${params.toString()}`, { cache: "no-store" });
        const payload = (await response.json()) as BigQueryCandidateResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error || "필터를 적용하지 못했습니다.");
        setResult(payload);
        setMessage(`필터 결과 ${payload.candidates.length}건입니다.`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "필터 적용에 실패했습니다.");
      } finally {
        setQuerying(false);
      }
    })();
  }

  return (
    <section className={styles.workspace} aria-labelledby="bigquery-candidate-title">
      <header className={styles.header}>
        <div>
          <p className="eyebrow">DATA-BASED AD DISCOVERY</p>
          <h1 id="bigquery-candidate-title">데이터 기반 광고 후보 찾기</h1>
          <p>판매·노출·구매 집계를 읽기 전용으로 비교해 지금 광고할 근거가 있는 상품을 찾습니다.</p>
        </div>
        <div className={`${styles.connection} ${status?.connected ? styles.connected : ""}`}>
          <span aria-hidden="true" />
          <strong>{status?.connected ? "BigQuery 연결됨" : loading ? "연결 확인 중" : "연결 확인 필요"}</strong>
          <small>읽기 전용 · {status?.location || "US"}</small>
        </div>
      </header>

      <div className={styles.notice} role="status">
        <strong>{message}</strong>
        <span>사용자 SQL 입력 없이 고정 SELECT만 실행하며, 조회 전 비용 한도를 검사합니다.</span>
      </div>

      {!loading && (!status?.connected || !advertisers.length) ? (
        <div className={styles.siteFallback}>
          <div>
            <strong>연결된 판매 데이터가 없어 사이트 분석 추천으로 전환합니다.</strong>
            <span>
              자사몰 공개정보에서 광고 콘텐츠로 테스트할 가치가 높은 상품을 찾아드립니다.
            </span>
          </div>
          <button onClick={onOpenSiteMode} type="button">
            사이트 URL로 후보 찾기
          </button>
        </div>
      ) : null}

      <div className={styles.controls}>
        <label>
          <span>광고주 검색</span>
          <input
            onChange={(event) => setAdvertiserSearch(event.target.value)}
            placeholder="브랜드명 또는 카테고리"
            type="search"
            value={advertiserSearch}
          />
        </label>
        <label className={styles.advertiserSelect}>
          <span>광고주</span>
          <select
            disabled={loading || !filteredAdvertisers.length}
            onChange={(event) => {
              setAdvertiserId(event.target.value);
              setResult(null);
            }}
            value={filteredAdvertisers.some((item) => item.id === advertiserId) ? advertiserId : ""}
          >
            <option value="">광고주 선택</option>
            {filteredAdvertisers.map((advertiser) => (
              <option key={advertiser.id} value={advertiser.id}>
                {advertiser.name} · {advertiser.category || "카테고리 미확인"} · 상품 {advertiser.productCount}개
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>비교 기간</span>
          <select
            onChange={(event) => {
              setPeriod(event.target.value as BigQueryCandidatePeriod);
              setResult(null);
            }}
            value={period}
          >
            {Object.entries(periodLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <button disabled={querying || !advertiserId} onClick={() => void findCandidates()} type="button">
          {querying ? "근거 계산 중" : "광고 후보 찾기"}
        </button>
      </div>

      {selectedAdvertiser ? (
        <div className={styles.advertiserSummary}>
          <div><span>선택 광고주</span><strong>{selectedAdvertiser.name}</strong></div>
          <div><span>최신 데이터</span><strong>{selectedAdvertiser.latestDataDate}</strong></div>
          <div><span>조회 상품</span><strong>{selectedAdvertiser.productCount.toLocaleString("ko-KR")}개</strong></div>
          <div><span>브랜드 매칭</span><strong>{selectedAdvertiser.brandMatchConfidence === "exact" ? "정확히 연결" : "상품 집계명 기준"}</strong></div>
        </div>
      ) : null}

      {result ? (
        <>
          <div className={styles.resultToolbar}>
            <div className={styles.typeTabs} aria-label="후보 유형 필터">
              <button
                className={candidateType === "all" ? styles.active : ""}
                onClick={() => filterResult("all")}
                type="button"
              >
                전체
              </button>
              {typeOptions.map((capability) => (
                <button
                  className={candidateType === capability.type ? styles.active : ""}
                  disabled={capability.availability !== "analysis-ready"}
                  key={capability.type}
                  onClick={() => filterResult(capability.type)}
                  title={capability.reason}
                  type="button"
                >
                  {candidateLabels[capability.type]}
                </button>
              ))}
            </div>
            <p>최신 {result.latestDataDate} · {periodLabels[result.period]} · 조회 {bytesText(result.processedBytes)}</p>
          </div>

          <div className={styles.grid} aria-busy={querying}>
            {result.candidates.map((candidate, index) => (
              <article className={styles.card} key={candidate.id}>
                <div className={styles.rank}>#{index + 1}</div>
                <div className={styles.cardHeading}>
                  <div>
                    <div className={styles.badges}>
                      <span>{candidateLabels[candidate.primaryType]}</span>
                      <b>후보 점수 {candidate.score}</b>
                      <small>{sufficiencyText(candidate.dataSufficiency)}</small>
                      {candidate.secondaryTypes.slice(0, 2).map((type) => (
                        <small key={type}>{candidateLabels[type]}</small>
                      ))}
                    </div>
                    <h2>{candidate.productName}</h2>
                    <p>{candidate.brandName} · {candidate.category || "카테고리 미확인"}</p>
                  </div>
                  <div className={styles.imagePlaceholder}>
                    <strong>상품 이미지 미연결</strong>
                    <span>제작 화면에서 상세 URL로 보완</span>
                  </div>
                </div>
                <p className={styles.reason}>{candidate.recommendationReason}</p>
                <dl className={styles.metrics}>
                  {candidate.metrics.slice(0, 4).map((metric) => (
                    <div key={metric.key} title={metric.note}>
                      <dt>{metric.label}</dt>
                      <dd>{metricText(metric)}</dd>
                      <small>{metric.previousValue === null ? metric.note : `비교값 ${metric.unit === "rate" ? `${(metric.previousValue * 100).toFixed(1)}%` : Math.round(metric.previousValue).toLocaleString("ko-KR")}`}</small>
                    </div>
                  ))}
                </dl>
                <div className={styles.direction}>
                  <strong>추천 후킹</strong>
                  <span>{candidate.recommendedHookTypes.join(" · ")}</span>
                  <strong>메시지 방향</strong>
                  <span>{candidate.recommendedMessageAngles.join(" · ")}</span>
                </div>
                <details className={styles.details}>
                  <summary>데이터 기준과 주의사항</summary>
                  <p>분석 {candidate.analysisPeriodStart}~{candidate.analysisPeriodEnd} · 비교 {candidate.comparisonPeriodStart}~{candidate.comparisonPeriodEnd}</p>
                  <p>최신 기준일 {candidate.latestDataDate} · 충분도 {sufficiencyText(candidate.dataSufficiency)}</p>
                  <dl className={styles.detailMetrics}>
                    {candidate.metrics.map((metric) => (
                      <div key={metric.key}>
                        <dt>{metric.label}</dt>
                        <dd>{metricText(metric)}</dd>
                        <small>{metric.note}</small>
                      </div>
                    ))}
                  </dl>
                  <p>원본 테이블: {candidate.sourceTables.join(" · ")}</p>
                  <ul>{candidate.cautions.map((caution) => <li key={caution}>{caution}</li>)}</ul>
                </details>
                <div className={styles.actions}>
                  <Link href={`/create-product?dataCandidateId=${encodeURIComponent(candidate.id)}`}>
                    이 상품으로 광고 만들기
                    <span aria-hidden="true">→</span>
                  </Link>
                </div>
              </article>
            ))}
          </div>
          {!result.candidates.length ? (
            <div className={styles.empty}>
              <strong>조건에 맞는 후보가 없습니다.</strong>
              <span>다른 기간·유형을 선택하거나 상세페이지 URL로 직접 광고를 만들어 보세요.</span>
            </div>
          ) : null}

          <details className={styles.capabilities}>
            <summary>사용 지표와 현재 제공하지 않는 후보 유형</summary>
            <div>
              {result.capabilities.map((capability: BigQueryCandidateCapability) => (
                <article key={capability.type}>
                  <span data-state={capability.availability}>{candidateLabels[capability.type]}</span>
                  <p>{capability.reason}</p>
                </article>
              ))}
            </div>
          </details>
        </>
      ) : (
        <div className={styles.empty}>
          <strong>광고주와 기간을 선택해 후보를 찾아보세요.</strong>
          <span>연결 데이터가 없거나 원하는 상품이 없다면 기존 상세페이지 분석을 그대로 사용할 수 있습니다.</span>
          <button className={styles.inlineSiteAction} onClick={onOpenSiteMode} type="button">
            사이트 URL로 후보 찾기
          </button>
        </div>
      )}
    </section>
  );
}
