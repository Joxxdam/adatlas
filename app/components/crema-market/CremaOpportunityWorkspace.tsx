"use client";

import Link from "next/link";
import { buildProductCreationHref } from "../../lib/product-creation/handoffUrl";
import { useEffect, useMemo, useState } from "react";
import type { CremaMarketDataset, ProductOpportunity, ProductOpportunityType } from "../../lib/crema-market/types";

type AdvertiserSummary = CremaMarketDataset["advertiser"] & {
  productCount: number;
  opportunityCount: number;
  latestAnalysisRun: CremaMarketDataset["analysisRuns"][number] | null;
  latestQualityReport: CremaMarketDataset["qualityReports"][number] | null;
};

const connectionLabels = {
  crema_connected: "크리마켓 연결됨",
  crema_partial: "일부 데이터 연결됨",
  crema_disconnected: "크리마켓 미연결",
  crema_error: "크리마켓 연결 확인 필요",
} as const;

const opportunityLabels: Record<ProductOpportunityType, string> = {
  HIDDEN_WINNER: "숨은 전환 상품",
  RISING_PRODUCT: "상승 상품",
  SCALE_CANDIDATE: "확장 후보",
  UNDEREXPOSED: "노출 부족",
  HIGH_INTEREST_LOW_CONVERSION: "관심 높음·전환 낮음",
  CART_ABANDONMENT: "장바구니 이탈",
  REVIEW_POWERED: "후기 강점",
  REVIEW_RISK: "후기 위험",
  REPEAT_PURCHASE: "재구매",
  BUNDLE_CANDIDATE: "묶음 후보",
  NEW_PRODUCT_TEST: "신상품 테스트",
  DECLINING_BESTSELLER: "기존 인기 하락",
  INVENTORY_OPPORTUNITY: "재고 기회",
  EXCLUDE_FROM_ADS: "광고 제외",
};

function metricText(value: number | null, unit: string) {
  if (value === null) return "데이터 없음";
  if (unit === "rate") return `${(value * 100).toFixed(1)}%`;
  if (unit === "currency") return `${Math.round(value).toLocaleString("ko-KR")}원`;
  if (unit === "score") return value.toFixed(1);
  return Math.round(value).toLocaleString("ko-KR");
}

export function CremaOpportunityWorkspace() {
  const [advertisers, setAdvertisers] = useState<AdvertiserSummary[]>([]);
  const [configured, setConfigured] = useState(false);
  const [selectedAdvertiserId, setSelectedAdvertiserId] = useState("");
  const [dataset, setDataset] = useState<CremaMarketDataset | null>(null);
  const [advertiserId, setAdvertiserId] = useState("");
  const [advertiserName, setAdvertiserName] = useState("");
  const [periodDays, setPeriodDays] = useState<1 | 7 | 14 | 28>(14);
  const [file, setFile] = useState<File | null>(null);
  const [typeFilter, setTypeFilter] = useState<ProductOpportunityType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<ProductOpportunity["status"] | "all">("recommended");
  const [sortBy, setSortBy] = useState<"score" | "confidence">("score");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [minimumConfidence, setMinimumConfidence] = useState(0);
  const [availabilityFilter, setAvailabilityFilter] = useState<"all" | "available" | "excluded">("all");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("크리마켓 연결은 선택사항입니다. 미연결 상태에서도 아래 상세페이지 분석을 계속 사용할 수 있습니다.");

  async function loadAdvertisers(preferredId?: string) {
    const response = await fetch("/api/crema-market", { cache: "no-store" });
    const payload = (await response.json()) as {
      advertisers?: AdvertiserSummary[];
      configured?: boolean;
      error?: string;
    };
    if (!response.ok) throw new Error(payload.error || "광고주 목록을 불러오지 못했습니다.");
    const next = payload.advertisers || [];
    setAdvertisers(next);
    setConfigured(Boolean(payload.configured));
    const id = preferredId || selectedAdvertiserId || next[0]?.id || "";
    setSelectedAdvertiserId(id);
    if (id) await loadDataset(id);
  }

  async function loadDataset(id: string) {
    const response = await fetch(`/api/crema-market?advertiserId=${encodeURIComponent(id)}`, {
      cache: "no-store",
    });
    const payload = (await response.json()) as { dataset?: CremaMarketDataset; error?: string };
    if (!response.ok || !payload.dataset) throw new Error(payload.error || "분석 데이터를 불러오지 못했습니다.");
    setDataset(payload.dataset);
    setAdvertiserId(payload.dataset.advertiser.id);
    setAdvertiserName(payload.dataset.advertiser.name);
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadAdvertisers().catch((error) => setMessage(error instanceof Error ? error.message : "목록 조회 실패"));
    }, 0);
    return () => window.clearTimeout(timeout);
    // Initial discovery only; subsequent refreshes are explicit user actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sync(mode: "crema_api" | "development_fixture") {
    setLoading(true);
    try {
      const response = await fetch("/api/crema-market/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, advertiserId, advertiserName, periodDays }),
      });
      const payload = (await response.json()) as {
        dataset?: CremaMarketDataset;
        error?: string;
        opportunities?: ProductOpportunity[];
      };
      if (!response.ok || !payload.dataset) throw new Error(payload.error || "동기화에 실패했습니다.");
      setDataset(payload.dataset);
      setSelectedAdvertiserId(payload.dataset.advertiser.id);
      setMessage(`분석 완료: 광고 기회 ${payload.opportunities?.length || 0}건을 찾았습니다.`);
      await loadAdvertisers(payload.dataset.advertiser.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "동기화 실패");
    } finally {
      setLoading(false);
    }
  }

  async function upload() {
    if (!file) return setMessage("CSV 또는 XLSX 파일을 선택해 주세요.");
    setLoading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("advertiserId", advertiserId);
      form.set("advertiserName", advertiserName);
      form.set("periodDays", String(periodDays));
      const response = await fetch("/api/crema-market/import", { method: "POST", body: form });
      const payload = (await response.json()) as {
        dataset?: CremaMarketDataset;
        error?: string;
        opportunities?: ProductOpportunity[];
        warnings?: string[];
      };
      if (!response.ok || !payload.dataset) throw new Error(payload.error || "업로드 분석에 실패했습니다.");
      setDataset(payload.dataset);
      setSelectedAdvertiserId(payload.dataset.advertiser.id);
      setMessage(`업로드 분석 완료: 광고 기회 ${payload.opportunities?.length || 0}건 · 데이터 없음은 0으로 바꾸지 않았습니다.`);
      await loadAdvertisers(payload.dataset.advertiser.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "업로드 실패");
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(opportunityId: string, status: "recommended" | "later" | "excluded") {
    const response = await fetch(`/api/crema-market/opportunities/${encodeURIComponent(opportunityId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!response.ok) return setMessage("상태를 변경하지 못했습니다.");
    setDataset((current) =>
      current
        ? {
            ...current,
            opportunities: current.opportunities.map((item) => (item.id === opportunityId ? { ...item, status, updatedAt: new Date().toISOString() } : item)),
          }
        : current
    );
  }

  const productMap = useMemo(() => new Map((dataset?.products || []).map((product) => [product.id, product])), [dataset]);
  const displayed = useMemo(() => {
    return [...(dataset?.opportunities || [])]
      .filter((item) => typeFilter === "all" || item.type === typeFilter || item.secondaryTypes.includes(typeFilter))
      .filter((item) => statusFilter === "all" || item.status === statusFilter)
      .filter((item) => categoryFilter === "all" || productMap.get(item.productId)?.categoryName === categoryFilter)
      .filter((item) => item.confidence >= minimumConfidence)
      .filter((item) => availabilityFilter === "all" || (availabilityFilter === "available" ? item.type !== "EXCLUDE_FROM_ADS" : item.type === "EXCLUDE_FROM_ADS"))
      .sort((left, right) => right[sortBy] - left[sortBy]);
  }, [availabilityFilter, categoryFilter, dataset, minimumConfidence, productMap, sortBy, statusFilter, typeFilter]);
  const quality = dataset?.qualityReports.at(-1);
  const run = dataset?.analysisRuns.at(-1);

  return (
    <section className="crema-opportunity-workspace">
      <div className="crema-workspace-head">
        <div>
          <p className="eyebrow">OPTIONAL CREMA MARKET SIGNALS</p>
          <h1>광고 기회 상품 찾기</h1>
          <p>상품·주문·후기와 업로드한 퍼널 지표를 비교해 광고할 이유가 있는 상품만 근거와 함께 추천합니다.</p>
        </div>
        <span className={`crema-connection-badge ${dataset?.advertiser.connectionStatus || "crema_disconnected"}`}>{connectionLabels[dataset?.advertiser.connectionStatus || "crema_disconnected"]}</span>
      </div>

      <div className="crema-connection-panel">
        <label>
          <span>광고주 ID</span>
          <input onChange={(event) => setAdvertiserId(event.target.value)} placeholder="예: brand-a" value={advertiserId} />
        </label>
        <label>
          <span>광고주명</span>
          <input onChange={(event) => setAdvertiserName(event.target.value)} placeholder="광고주 또는 브랜드명" value={advertiserName} />
        </label>
        <label>
          <span>분석 기간</span>
          <select onChange={(event) => setPeriodDays(Number(event.target.value) as 1 | 7 | 14 | 28)} value={periodDays}>
            <option value={1}>최근 1일</option>
            <option value={7}>최근 7일</option>
            <option value={14}>최근 14일</option>
            <option value={28}>최근 28일</option>
          </select>
        </label>
        <div className="crema-connection-actions">
          <button disabled={loading || !configured || !advertiserId || !advertiserName} onClick={() => void sync("crema_api")} type="button">
            공식 API 동기화
          </button>
          {!configured ? <small>서버에 CREMA_APP_ID/CREMA_SECRET을 설정하면 활성화됩니다.</small> : null}
        </div>
        <label className="crema-file-input">
          <span>CSV/XLSX 보완 데이터</span>
          <input accept=".csv,.xlsx,.xls" onChange={(event) => setFile(event.target.files?.[0] || null)} type="file" />
        </label>
        <button disabled={loading || !file || !advertiserId || !advertiserName} onClick={() => void upload()} type="button">
          파일 업로드 후 분석
        </button>
        {process.env.NODE_ENV !== "production" ? (
          <button className="secondary" disabled={loading} onClick={() => void sync("development_fixture")} type="button">
            개발 fixture로 확인
          </button>
        ) : null}
      </div>
      <p className="crema-workspace-message">{loading ? "데이터를 정규화하고 이전 동기간과 비교하는 중입니다…" : message}</p>

      {advertisers.length ? (
        <label className="crema-advertiser-picker">
          <span>저장된 광고주</span>
          <select
            onChange={(event) => {
              setSelectedAdvertiserId(event.target.value);
              void loadDataset(event.target.value).catch((error) => setMessage(error instanceof Error ? error.message : "조회 실패"));
            }}
            value={selectedAdvertiserId}
          >
            {advertisers.map((advertiser) => (
              <option key={advertiser.id} value={advertiser.id}>
                {advertiser.name} · {connectionLabels[advertiser.connectionStatus]} · 기회 {advertiser.opportunityCount}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {dataset && run ? (
        <>
          <div className="crema-analysis-summary">
            <article>
              <small>분석 기간</small>
              <strong>
                {run.currentStartsOn} – {run.currentEndsOn}
              </strong>
              <span>
                이전 {run.previousStartsOn} – {run.previousEndsOn}
              </span>
            </article>
            <article>
              <small>상품</small>
              <strong>{run.productCount}개</strong>
              <span>추천 기회 {dataset.opportunities.filter((item) => item.status === "recommended").length}건</span>
            </article>
            <article>
              <small>데이터 품질</small>
              <strong>{quality?.score ?? 0}점</strong>
              <span>확인 항목 {quality?.issues.length ?? 0}건</span>
            </article>
            <article>
              <small>수집 출처</small>
              <strong>{dataset.advertiser.provider === "crema_api" ? "크리마켓 공식 API" : dataset.advertiser.provider === "file_upload" ? "업로드 파일" : "개발 fixture"}</strong>
              <span>{dataset.advertiser.lastSyncedAt?.slice(0, 16).replace("T", " ")}</span>
            </article>
            <article>
              <small>소액 테스트</small>
              <strong>{dataset.opportunities.filter((item) => ["NEW_PRODUCT_TEST", "HIDDEN_WINNER", "RISING_PRODUCT"].includes(item.type)).length}개</strong>
              <span>가설 검증 우선</span>
            </article>
            <article>
              <small>개선 후 광고</small>
              <strong>{dataset.opportunities.filter((item) => ["HIGH_INTEREST_LOW_CONVERSION", "CART_ABANDONMENT", "REVIEW_RISK", "DECLINING_BESTSELLER"].includes(item.type)).length}개</strong>
              <span>장벽 해소 필요</span>
            </article>
            <article>
              <small>광고 제외</small>
              <strong>{dataset.opportunities.filter((item) => item.type === "EXCLUDE_FROM_ADS").length}개</strong>
              <span>상태·위험 확인</span>
            </article>
          </div>
          {quality?.issues.length ? (
            <details className="crema-quality-details">
              <summary>데이터 품질 확인사항 {quality.issues.length}건</summary>
              <ul>
                {quality.issues.slice(0, 20).map((issue, index) => (
                  <li className={issue.severity} key={`${issue.code}-${index}`}>
                    <strong>{issue.code}</strong> {issue.message}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <div className="crema-opportunity-filters">
            <select onChange={(event) => setTypeFilter(event.target.value as ProductOpportunityType | "all")} value={typeFilter}>
              <option value="all">모든 기회 유형</option>
              {Object.entries(opportunityLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select onChange={(event) => setCategoryFilter(event.target.value)} value={categoryFilter}>
              <option value="all">모든 카테고리</option>
              {Array.from(new Set(dataset.products.map((product) => product.categoryName).filter(Boolean))).map((category) => (
                <option key={category!} value={category!}>
                  {category}
                </option>
              ))}
            </select>
            <select onChange={(event) => setStatusFilter(event.target.value as ProductOpportunity["status"] | "all")} value={statusFilter}>
              <option value="all">모든 상태</option>
              <option value="recommended">추천</option>
              <option value="later">나중에</option>
              <option value="excluded">제외</option>
              <option value="creative_generated">소재 생성됨</option>
            </select>
            <select onChange={(event) => setMinimumConfidence(Number(event.target.value))} value={minimumConfidence}>
              <option value={0}>모든 신뢰도</option>
              <option value={60}>신뢰도 60 이상</option>
              <option value={80}>신뢰도 80 이상</option>
            </select>
            <select onChange={(event) => setAvailabilityFilter(event.target.value as "all" | "available" | "excluded")} value={availabilityFilter}>
              <option value="all">광고 가능 여부 전체</option>
              <option value="available">광고 제작 가능</option>
              <option value="excluded">광고 제외</option>
            </select>
            <select onChange={(event) => setSortBy(event.target.value as "score" | "confidence")} value={sortBy}>
              <option value="score">기회 점수순</option>
              <option value="confidence">신뢰도순</option>
            </select>
          </div>
          <div className="crema-opportunity-grid">
            {displayed.map((opportunity, rank) => {
              const product = productMap.get(opportunity.productId);
              return (
                <article className={`crema-opportunity-card ${opportunity.type === "EXCLUDE_FROM_ADS" ? "excluded" : ""}`} key={opportunity.id}>
                  <div className="crema-card-image">
                    {product?.imageUrl ? (
                      // External product images intentionally bypass Next image optimization.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img alt="" src={product.imageUrl} />
                    ) : (
                      <span>상품 이미지 없음</span>
                    )}
                  </div>
                  <div className="crema-card-body">
                    <div className="crema-card-labels">
                      <strong>#{rank + 1}</strong>
                      <span>{opportunityLabels[opportunity.type]}</span>
                      <b>기회 {opportunity.score}</b>
                      <small>신뢰도 {opportunity.confidence}</small>
                    </div>
                    <h3>{product?.name || opportunity.title}</h3>
                    <p>
                      {product?.categoryName || "카테고리 미확인"} · {opportunity.title}
                    </p>
                    {opportunity.secondaryTypes.length ? <p className="crema-secondary-types">보조 신호: {opportunity.secondaryTypes.map((type) => opportunityLabels[type]).join(" · ")}</p> : null}
                    <ul className="crema-evidence-list">
                      {opportunity.evidence.slice(0, 4).map((item) => (
                        <li key={item.metric}>
                          <span>{item.label}</span>
                          <strong>{metricText(item.current, item.unit)}</strong>
                          <small>{item.changeRate === null ? item.message : `이전 대비 ${(item.changeRate * 100).toFixed(1)}%`}</small>
                        </li>
                      ))}
                    </ul>
                    <div className="crema-recommendation">
                      <strong>{opportunity.recommendation.objective}</strong>
                      <span>{opportunity.recommendation.messageAngles.join(" · ")}</span>
                    </div>
                    {opportunity.risks.length ? <p className="crema-risk">확인사항: {opportunity.risks.join(" · ")}</p> : null}
                    <details>
                      <summary>판정 근거와 제작 방향</summary>
                      <p>{opportunity.recommendation.rationale.join(" ")}</p>
                      <p>후킹: {opportunity.recommendation.hookTypes.join(", ") || "생성 제외"}</p>
                      <p>이미지: {opportunity.recommendation.imageDirection}</p>
                    </details>
                    <div className="crema-card-actions">
                      {opportunity.type !== "EXCLUDE_FROM_ADS" ? <Link href={buildProductCreationHref({ opportunityId: opportunity.id }, product?.url)}>이 상품으로 광고 만들기</Link> : null}
                      <button onClick={() => void updateStatus(opportunity.id, "later")} type="button">
                        나중에
                      </button>
                      <button onClick={() => void updateStatus(opportunity.id, "excluded")} type="button">
                        제외
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          {!displayed.length ? <p className="crema-empty">현재 필터에 맞는 광고 기회가 없습니다.</p> : null}
        </>
      ) : (
        <div className="crema-disconnected-state">
          <strong>크리마켓 데이터가 없어도 괜찮습니다.</strong>
          <p>아래 ‘상세페이지로 광고 만들기’에서 기존 URL 분석과 제작 기능을 그대로 사용할 수 있습니다.</p>
        </div>
      )}
    </section>
  );
}
