"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CreativeArchiveEntry } from "../../lib/creative-archive/types";
import type { MetaAccount, MetaBaselineAdSet, MetaCampaign, PerformanceExperiment, PerformanceTestType } from "../../lib/meta/types";
import { spendImbalanceWarning } from "../../lib/meta/performance";
import { ArchivePerformanceSetup } from "./ArchivePerformanceSetup";
import styles from "./MetaOperations.module.css";

type LegacyExperimentSummary = {
  id: string;
  code: string;
  advertiserName: string;
  productName: string;
  status: string;
  objective: string;
  hookCount: number;
};

async function api<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/meta/performance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "성과 작업에 실패했습니다.");
  return payload;
}

async function metaRead<T>(body: Record<string, unknown>) {
  const response = await fetch("/api/meta/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as { ok: boolean; result: T; error?: string };
  if (!response.ok || !payload.ok) throw new Error(payload.error || "Meta 읽기에 실패했습니다.");
  return payload.result;
}

function money(value: number, currency: string) {
  return new Intl.NumberFormat("ko-KR", { style: "currency", currency }).format(value);
}

function PerformanceTable({ experiment }: { experiment: PerformanceExperiment }) {
  const warning = spendImbalanceWarning(experiment.rows);
  const hookOnly = experiment.testType === "hook-only";
  return (
    <>
      <p className={styles.interpretation}>{hookOnly ? "과거 동일 디자인 후킹 기록입니다." : "Meta 운영 환경에서의 광고 소재 성과입니다. 레퍼런스 구성·상품 표현·문구·레이아웃과 Meta의 노출 배분이 함께 반영된 결과입니다."}</p>
      {warning ? <p className={styles.warning}>{warning}</p> : null}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{hookOnly ? "후킹" : "소재"}</th>
              {!hookOnly ? <th>미리보기</th> : null}
              {!hookOnly ? <th>광고 콘셉트·레퍼런스</th> : null}
              <th>광고명</th>
              <th>상태</th>
              <th>노출</th>
              <th>광고비</th>
              <th>배분</th>
              <th>아웃바운드 CTR</th>
              <th>CPC</th>
              <th>랜딩 조회</th>
              <th>구매</th>
              <th>CPA</th>
              <th>ROAS</th>
            </tr>
          </thead>
          <tbody>
            {experiment.rows.map((row, index) => (
              <tr key={row.adId}>
                <td>
                  <strong>{hookOnly ? row.hookCode : `소재 ${String(index + 1).padStart(2, "0")}`}</strong>
                  <small>{row.materialCode}</small>
                </td>
                {!hookOnly ? <td>{row.previewUrl ? <img alt={`${row.materialCode} 소재 미리보기`} className={styles.performanceThumb} src={row.previewUrl} /> : "-"}</td> : null}
                {!hookOnly ? <td><strong>{row.advertisingConcept || "소재 설명 미기록"}</strong><small>{row.referenceId ? `레퍼런스 ${row.referenceId}` : "레퍼런스 미기록"}</small></td> : null}
                <td>{row.adName}</td>
                <td>{row.status}</td>
                <td>{row.impressions.toLocaleString("ko-KR")}</td>
                <td>{money(row.spend, experiment.currency)}</td>
                <td>{(row.spendShare * 100).toFixed(1)}%</td>
                <td>{row.ctr.toFixed(2)}%</td>
                <td>{row.outboundClicks ? money(row.cpc, experiment.currency) : "-"}</td>
                <td>{row.landingPageViews.toLocaleString("ko-KR")}</td>
                <td>{row.purchases.toLocaleString("ko-KR")}</td>
                <td>{row.purchases ? money(row.cpa, experiment.currency) : "-"}</td>
                <td>{row.roas ? `${row.roas.toFixed(2)}x` : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function PerformanceWorkspace({ initialExperiments, legacyExperiments, selectedArchiveEntries }: { initialExperiments: PerformanceExperiment[]; legacyExperiments: LegacyExperimentSummary[]; selectedArchiveEntries: CreativeArchiveEntry[] }) {
  const [experiments, setExperiments] = useState(initialExperiments);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("성과 데이터는 버튼을 누를 때만 Meta에서 읽습니다.");
  const [busy, setBusy] = useState("");
  const [advertiserId, setAdvertiserId] = useState("");
  const [advertiserName, setAdvertiserName] = useState("");
  const [productName, setProductName] = useState("");
  const [landingUrl, setLandingUrl] = useState("");
  const [testType, setTestType] = useState<PerformanceTestType>("creative-combination");
  const [accounts, setAccounts] = useState<MetaAccount[]>([]);
  const [campaigns, setCampaigns] = useState<MetaCampaign[]>([]);
  const [adSets, setAdSets] = useState<MetaBaselineAdSet[]>([]);
  const [accountId, setAccountId] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [adSetId, setAdSetId] = useState("");
  const [ads, setAds] = useState<Array<Record<string, unknown>>>([]);
  const visible = useMemo(() => experiments.filter((item) => `${item.advertiserName} ${item.productName} ${item.campaignName}`.toLowerCase().includes(query.toLowerCase())), [experiments, query]);

  async function refreshLocal() {
    const response = await fetch("/api/meta/performance", { cache: "no-store" });
    const payload = (await response.json()) as { experiments: PerformanceExperiment[] };
    setExperiments(payload.experiments);
  }

  async function act(action: "start" | "stop" | "refresh", experimentId: string) {
    setBusy(`${action}:${experimentId}`);
    try {
      await api({ action, experimentId });
      await refreshLocal();
      setStatus(action === "refresh" ? "최근 3일 성과를 새로 반영했습니다." : "성과 추적 설정을 저장했습니다.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "성과 작업 실패");
    } finally {
      setBusy("");
    }
  }

  async function read(action: string, body: Record<string, unknown> = {}) {
    setBusy(action);
    try {
      const result = await metaRead<unknown[]>({ action, advertiserId, ...body });
      if (action === "connection") setStatus("Meta 연결을 확인했습니다.");
      if (action === "accounts") {
        setAccounts(result as MetaAccount[]);
        setStatus("허용·매핑된 광고 계정만 불러왔습니다.");
      }
      if (action === "campaigns") {
        setCampaigns(result as MetaCampaign[]);
        setStatus("기존 캠페인을 읽기 전용으로 불러왔습니다.");
      }
      if (action === "adsets") {
        setAdSets(result as MetaBaselineAdSet[]);
        setStatus("기존 광고 세트를 읽기 전용으로 불러왔습니다.");
      }
      if (action === "ads") {
        setAds(result as Array<Record<string, unknown>>);
        setStatus("광고 ID 기준 연결 후보를 불러왔습니다. 자동 연결하지 않습니다.");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Meta 읽기 실패");
    } finally {
      setBusy("");
    }
  }

  async function connectExistingAdSet() {
    const account = accounts.find((item) => item.id === accountId);
    const campaign = campaigns.find((item) => item.id === campaignId);
    const adSet = adSets.find((item) => item.id === adSetId);
    if (!account || !campaign || !adSet || !advertiserName.trim() || !productName.trim()) return;
    const rows = ads
      .slice(0, 6)
      .map((ad, index) => {
        const adName = String(ad.name || `광고 ${index + 1}`);
        const match = adName.match(/H0[1-6]/i);
        const hookCode = match?.[0]?.toUpperCase() || `H0${index + 1}`;
        return {
          hookCode,
          materialCode: adName.match(/AT-[A-Za-z0-9_-]+/)?.[0] || adName,
          adId: String(ad.id || ""),
          adName,
          impressions: 0,
          spend: 0,
          outboundClicks: 0,
          landingPageViews: 0,
          purchases: 0,
          purchaseValue: 0,
          ctr: 0,
          cpc: 0,
          cpa: 0,
          roas: 0,
          spendShare: 0,
          status: "추가 데이터 필요",
        };
      })
      .filter((row) => row.adId);
    if (!rows.length) {
      setStatus("연결할 광고를 확인하지 못했습니다.");
      return;
    }
    const experiment: PerformanceExperiment = {
      id: `meta-performance-${crypto.randomUUID()}`,
      advertiserId,
      advertiserName: advertiserName.trim(),
      productId: productName.trim(),
      productName: productName.trim(),
      landingUrl: landingUrl.trim() || undefined,
      testRound: 1,
      testType,
      source: "meta",
      adAccountId: account.id,
      adAccountName: account.name,
      currency: account.currency,
      campaignId: campaign.id,
      campaignName: campaign.name,
      adSetId: adSet.id,
      adSetName: adSet.name,
      metaStatus: "READ_ONLY_LINK",
      trackingEnabled: false,
      trackingStatus: "prelaunch",
      timezoneName: account.timezoneName,
      attributionSetting: JSON.stringify(adSet.attributionSpec || []),
      rows,
    };
    setBusy("connect");
    try {
      await api({ action: "connect", experiment });
      await refreshLocal();
      setStatus("기존 광고 세트를 읽기 전용 성과 실험으로 연결했습니다.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "성과 연결 실패");
    } finally {
      setBusy("");
    }
  }

  return (
    <main className={styles.workspace}>
      <header className={styles.pageHeader}>
        <div>
          <p className="eyebrow">04 PERFORMANCE</p>
          <h1>성과 확인</h1>
          <p>아카이브 소재를 광고로 설정하고, Meta에서 수집한 성과를 안전하게 비교합니다.</p>
        </div>
      </header>
      <ArchivePerformanceSetup entries={selectedArchiveEntries} />
      <p className={styles.notice}>{status}</p>
      <div className={styles.toolbar}>
        <input aria-label="성과 검색" onChange={(event) => setQuery(event.target.value)} placeholder="광고주·상품·캠페인 검색" value={query} />
      </div>

      <details className={styles.panel}>
        <summary>기존 Meta 광고 세트 연결</summary>
        <p>페이지를 여는 것만으로 Meta를 호출하지 않습니다. 아래 버튼을 순서대로 눌러 읽기 전용 후보를 확인하세요.</p>
        <div className={styles.formGrid}>
          <label>
            광고주 ID
            <input
              onChange={(event) => {
                setAdvertiserId(event.target.value);
                setAccounts([]);
                setCampaigns([]);
                setAdSets([]);
                setAds([]);
              }}
              value={advertiserId}
            />
          </label>
          <label>
            광고주명
            <input onChange={(event) => setAdvertiserName(event.target.value)} value={advertiserName} />
          </label>
          <label>
            상품명
            <input onChange={(event) => setProductName(event.target.value)} value={productName} />
          </label>
          <label>
            상품 랜딩 URL(선택)
            <input inputMode="url" onChange={(event) => setLandingUrl(event.target.value)} value={landingUrl} />
          </label>
          <label>
            성과 해석 단위
            <select onChange={(event) => setTestType(event.target.value as PerformanceTestType)} value={testType}>
              <option value="creative-combination">완성 광고 소재 비교</option>
            </select>
          </label>
          <button disabled={!advertiserId || Boolean(busy)} onClick={() => void read("connection")} type="button">
            연결 확인
          </button>
          <button disabled={!advertiserId || Boolean(busy)} onClick={() => void read("accounts")} type="button">
            광고 계정 불러오기
          </button>
          <label>
            광고 계정
            <select
              onChange={(event) => {
                setAccountId(event.target.value);
                setCampaignId("");
                setAdSetId("");
                setCampaigns([]);
                setAdSets([]);
                setAds([]);
              }}
              value={accountId}
            >
              <option value="">선택</option>
              {accounts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.currency}
                </option>
              ))}
            </select>
          </label>
          <button disabled={!accountId || Boolean(busy)} onClick={() => void read("campaigns", { accountId })} type="button">
            기존 캠페인 불러오기
          </button>
          <label>
            기존 캠페인
            <select
              onChange={(event) => {
                setCampaignId(event.target.value);
                setAdSetId("");
                setAdSets([]);
                setAds([]);
              }}
              value={campaignId}
            >
              <option value="">선택</option>
              {campaigns.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.budgetMode}
                </option>
              ))}
            </select>
          </label>
          <button disabled={!campaignId || Boolean(busy)} onClick={() => void read("adsets", { accountId, campaignId })} type="button">
            광고 세트 불러오기
          </button>
          <label>
            기준 광고 세트
            <select
              onChange={(event) => {
                setAdSetId(event.target.value);
                setAds([]);
              }}
              value={adSetId}
            >
              <option value="">선택</option>
              {adSets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <button disabled={!adSetId || Boolean(busy)} onClick={() => void read("ads", { adSetId })} type="button">
            광고 확인
          </button>
        </div>
        {ads.length ? (
          <div className={styles.notice}>
            <span>확인된 광고 {ads.length}개. 소재코드와 ad_id를 검토한 뒤 명시적으로 연결합니다.</span>
            <button disabled={!advertiserName.trim() || !productName.trim() || Boolean(busy)} onClick={() => void connectExistingAdSet()} type="button">
              이 광고 세트 성과 연결
            </button>
          </div>
        ) : null}
      </details>

      <section className={styles.list} aria-label="성과 실험 목록">
        {visible.map((experiment) => (
          <article className={styles.card} key={experiment.id}>
            <header>
              <div>
                <small>{experiment.advertiserName}</small>
                <h2>{experiment.productName}</h2>
                <p>
                  {experiment.campaignName} · {experiment.adSetName}
                </p>
                <small>{experiment.testType === "hook-only" ? "과거 후킹 비교 기록" : "완성 광고 소재 비교"}</small>
              </div>
              <span>{experiment.trackingStatus}</span>
            </header>
            <PerformanceTable experiment={experiment} />
            <footer className={styles.actions}>
              <button disabled={Boolean(busy)} onClick={() => void act(experiment.trackingEnabled ? "stop" : "start", experiment.id)} type="button">
                {experiment.trackingEnabled ? "추적 중지" : "추적 시작"}
              </button>
              <button disabled={!experiment.trackingEnabled || Boolean(busy)} onClick={() => void act("refresh", experiment.id)} type="button">
                성과 새로고침
              </button>
              <Link href={`/performance/${encodeURIComponent(experiment.id)}`}>상세 보기</Link>
              <Link href={`/create-product?step=product${experiment.landingUrl ? `&productUrl=${encodeURIComponent(experiment.landingUrl)}` : ""}`}>{experiment.testType === "hook-only" ? "과거 결과로 새 상품 제작 열기" : "성과 우수 소재를 참고해 새 광고 만들기"}</Link>
            </footer>
          </article>
        ))}
        {!visible.length ? <div className={styles.empty}>연결된 Meta 성과 실험이 없습니다. 기존 후킹 실험 기록은 아래에서 이어서 확인할 수 있습니다.</div> : null}
      </section>

      <details className={styles.panel}>
        <summary>기존 후킹 테스트 기록 {legacyExperiments.length}개</summary>
        <div className={styles.legacyList}>
          {legacyExperiments.map((item) => (
            <article key={item.id}>
              <strong>{item.productName}</strong>
              <span>
                {item.code} · {item.objective} · 후킹 {item.hookCount}개 · {item.status}
              </span>
              <Link href={`/performance?legacy=${encodeURIComponent(item.id)}`}>성과 확인 흐름에서 보기</Link>
            </article>
          ))}
        </div>
      </details>
    </main>
  );
}

export function PerformanceDetail({ experiment }: { experiment: PerformanceExperiment }) {
  return (
    <main className={styles.workspace}>
      <Link href="/performance">← 성과 확인</Link>
      <header className={styles.pageHeader}>
        <div>
          <p className="eyebrow">EXPERIMENT DETAIL</p>
          <h1>{experiment.productName}</h1>
          <p>
            {experiment.advertiserName} · {experiment.campaignName} · {experiment.adSetName}
          </p>
        </div>
      </header>
      <PerformanceTable experiment={experiment} />
      <section className={styles.panel}>
        <h2>판단 원칙</h2>
        <p>판매 캠페인의 최종 우승은 CTR만으로 결정하지 않습니다. 최소 노출·아웃바운드 클릭·구매·광고비와 불균등 집행 여부를 함께 확인합니다.</p>
      </section>
    </main>
  );
}
