"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  MetaAccount,
  MetaAdvertiserAssetMap,
  MetaBaselineAdSet,
  MetaCampaign,
  MetaCreativeDraft,
  MetaDraftRegistrationInput,
  MetaPreflightResult,
  PerformanceTestType,
} from "../../lib/meta/types";
import styles from "./MetaOperations.module.css";

type Props = {
  advertiserId: string;
  advertiserName: string;
  productId: string;
  productName: string;
  landingUrl: string;
  approvedCreatives: MetaCreativeDraft[];
  testType?: PerformanceTestType;
  archiveEntryIds?: string[];
};

type Capability = {
  readEnabled: boolean;
  writeEnabled: boolean;
  dryRun: boolean;
  configured: boolean;
};

async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const payload = (await response.json()) as T & { ok?: boolean; error?: string };
  if (!response.ok || payload.ok === false)
    throw new Error(payload.error || "요청에 실패했습니다.");
  return payload;
}

export function MetaDraftRegistrationPanel(props: Props) {
  const [capability, setCapability] = useState<Capability | null>(null);
  const [mapping, setMapping] = useState<MetaAdvertiserAssetMap | null>(null);
  const [accounts, setAccounts] = useState<MetaAccount[]>([]);
  const [campaigns, setCampaigns] = useState<MetaCampaign[]>([]);
  const [adSets, setAdSets] = useState<MetaBaselineAdSet[]>([]);
  const [accountId, setAccountId] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [adSetId, setAdSetId] = useState("");
  const [preflight, setPreflight] = useState<MetaPreflightResult | null>(null);
  const [confirmationToken, setConfirmationToken] = useState("");
  const [checked, setChecked] = useState(false);
  const [status, setStatus] = useState(
    "Meta API는 명시적인 버튼을 누르기 전까지 호출되지 않습니다."
  );
  const [busy, setBusy] = useState("");

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      api<{ capability: Capability }>("/api/meta/status"),
      api<{ mappings: MetaAdvertiserAssetMap[] }>("/api/meta/advertisers"),
    ]).then(([statusPayload, advertiserPayload]) => {
      if (cancelled) return;
      setCapability(statusPayload.capability);
      setMapping(
        advertiserPayload.mappings.find((item) => item.advertiserId === props.advertiserId) || null
      );
    });
    return () => {
      cancelled = true;
    };
  }, [props.advertiserId]);

  const account = accounts.find((item) => item.id === accountId);
  const campaign = campaigns.find((item) => item.id === campaignId);
  const baselineAdSet = adSets.find((item) => item.id === adSetId);
  const input = useMemo<MetaDraftRegistrationInput | null>(() => {
    if (!mapping || !account || !campaign || !baselineAdSet || !props.landingUrl) return null;
    return {
      requestKey: [
        props.advertiserId,
        props.productId,
        "T01",
        props.testType || "creative-combination",
        props.approvedCreatives.map((creative) => creative.materialCode).join("-"),
        new Date().toISOString().slice(0, 10),
      ].join(":"),
      advertiserId: props.advertiserId,
      advertiserName: props.advertiserName,
      productId: props.productId,
      productName: props.productName,
      testRound: 1,
      testType: props.testType || "creative-combination",
      archiveEntryIds: props.archiveEntryIds,
      adAccount: account,
      campaign,
      baselineAdSet,
      pageId: mapping.pageId || "",
      instagramActorId: mapping.instagramActorId,
      pixelId: mapping.pixelId,
      datasetId: mapping.datasetId,
      conversionEvent: "PURCHASE",
      creatives: props.approvedCreatives,
    };
  }, [account, baselineAdSet, campaign, mapping, props]);

  function resetAfterAccount(nextAccountId: string) {
    setAccountId(nextAccountId);
    setCampaignId("");
    setAdSetId("");
    setCampaigns([]);
    setAdSets([]);
    setPreflight(null);
    setConfirmationToken("");
    setChecked(false);
  }

  function invalidateConfirmation() {
    setPreflight(null);
    setConfirmationToken("");
    setChecked(false);
  }

  async function runRead(action: string, body: Record<string, unknown> = {}) {
    setBusy(action);
    try {
      const payload = await api<{ result: unknown[] | Record<string, unknown> }>("/api/meta/read", {
        action,
        advertiserId: props.advertiserId,
        ...body,
      });
      if (action === "connection") setStatus("Meta 연결과 토큰 권한을 확인했습니다.");
      if (action === "accounts") {
        setAccounts(payload.result as MetaAccount[]);
        setStatus("허용 목록과 광고주 매핑의 교집합만 불러왔습니다.");
      }
      if (action === "campaigns") {
        setCampaigns(payload.result as MetaCampaign[]);
        setStatus("기존 캠페인을 불러왔습니다. 캠페인은 생성하거나 수정하지 않습니다.");
      }
      if (action === "adsets") {
        setAdSets(payload.result as MetaBaselineAdSet[]);
        setStatus("선택 캠페인에 속한 기준 광고 세트를 불러왔습니다.");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Meta 읽기 실패");
    } finally {
      setBusy("");
    }
  }

  async function runPreflight() {
    if (!input) return;
    setBusy("preflight");
    try {
      const payload = await api<{ preflight: MetaPreflightResult }>(
        "/api/meta/drafts/preflight",
        input
      );
      setPreflight(payload.preflight);
      setStatus(
        payload.preflight.ok
          ? "사전 검토를 통과했습니다. 실제 등록 내용을 확인해 주세요."
          : "차단 항목을 해결한 뒤 다시 검토해 주세요."
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "사전 검토 실패");
    } finally {
      setBusy("");
    }
  }

  async function confirmPreview() {
    if (!input || !checked || !preflight?.ok) return;
    setBusy("confirm");
    try {
      const payload = await api<{ confirmation: { token: string } }>(
        "/api/meta/drafts/confirm",
        input
      );
      setConfirmationToken(payload.confirmation.token);
      setStatus("등록 내용에 결합된 일회성 확인 토큰을 발급했습니다.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "최종 확인 실패");
    } finally {
      setBusy("");
    }
  }

  async function register() {
    if (!input || !confirmationToken) return;
    setBusy("register");
    try {
      await api("/api/meta/drafts/register", { input, confirmationToken });
      setConfirmationToken("");
      setStatus("PAUSED 초안을 생성하고 성과 확인 목록에 연결했습니다. 사후 안전 검증 결과를 확인해 주세요.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "PAUSED 초안 등록 실패");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className={styles.panel} id="meta-draft-registration">
      <header className={styles.header}>
        <div>
          <p className="eyebrow">PERFORMANCE SETUP · META DRAFT</p>
          <h3>선택 소재를 기존 캠페인에 PAUSED로 설정</h3>
          <p>
            캠페인과 기준 광고 세트는 읽기 전용이며, 새 광고 세트 1개와 광고 최대 6개만 PAUSED로
            만듭니다.
          </p>
        </div>
        <span className={styles.safety}>ACTIVE 차단</span>
      </header>

      <div className={styles.flow} aria-label="Meta 등록 흐름">
        {["광고주", "광고 계정", "기존 캠페인", "기준 광고 세트", "사전 검토", "PAUSED 등록"].map(
          (label, index) => (
            <span key={label}>
              {index + 1}. {label}
            </span>
          )
        )}
      </div>

      <div className={styles.notice}>
        <strong>
          {props.advertiserName || "광고주 미확인"} · {props.productName || "상품 미확인"}
        </strong>
        <span>
          승인 결과 {props.approvedCreatives.filter((item) => item.approved).length}/6 · CTA 지금
          구매하기 / SHOP_NOW
        </span>
        <span>{props.testType === "hook-only" ? "후킹만 비교" : "전체 소재 조합 비교"}</span>
      </div>

      {!capability?.configured || !capability.readEnabled ? (
        <div className={styles.setup}>
          <strong>Meta 읽기 연결이 꺼져 있습니다.</strong>
          <p>
            서버 환경변수에 전용 시스템 사용자 토큰을 설정하고 META_READ_ENABLED=true로 전환한 뒤
            아래 확인 버튼을 사용하세요. 토큰 입력란은 화면에 제공하지 않습니다.
          </p>
          <button
            disabled={busy === "connection"}
            onClick={() => runRead("connection")}
            type="button"
          >
            Meta 연결 확인
          </button>
        </div>
      ) : (
        <div className={styles.actions}>
          <button disabled={Boolean(busy)} onClick={() => runRead("connection")} type="button">
            Meta 연결 확인
          </button>
          <button
            disabled={Boolean(busy) || !mapping}
            onClick={() => runRead("accounts")}
            type="button"
          >
            광고 계정 불러오기
          </button>
        </div>
      )}

      <div className={styles.selectionGrid}>
        <label>
          <span>광고 계정</span>
          <select onChange={(event) => resetAfterAccount(event.target.value)} value={accountId}>
            <option value="">광고 계정을 선택하세요</option>
            {accounts.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.currency} · …{item.id.slice(-4)}
              </option>
            ))}
          </select>
          <button
            disabled={!accountId || Boolean(busy)}
            onClick={() => runRead("campaigns", { accountId })}
            type="button"
          >
            캠페인 불러오기
          </button>
        </label>
        <label>
          <span>기존 캠페인</span>
          <select
            onChange={(event) => {
              setCampaignId(event.target.value);
              setAdSetId("");
              setAdSets([]);
              invalidateConfirmation();
            }}
            value={campaignId}
          >
            <option value="">기존 판매 캠페인을 선택하세요</option>
            {campaigns.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.budgetMode}
              </option>
            ))}
          </select>
          <button
            disabled={!campaignId || Boolean(busy)}
            onClick={() => runRead("adsets", { accountId, campaignId })}
            type="button"
          >
            기준 광고 세트 불러오기
          </button>
        </label>
        <label>
          <span>기준 광고 세트</span>
          <select
            onChange={(event) => {
              setAdSetId(event.target.value);
              invalidateConfirmation();
            }}
            value={adSetId}
          >
            <option value="">기준 광고 세트를 선택하세요</option>
            {adSets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <small>
            타깃·게재 위치·Purchase 전환 설정만 복사합니다. 예산·일정·상태·기존 광고는 복사하지
            않습니다.
          </small>
        </label>
      </div>

      <details className={styles.details}>
        <summary>상세 설정과 고정 안전 정책</summary>
        <ul>
          <li>광고 계정 변경 시 캠페인·광고 세트·Page·Instagram·픽셀·확인 토큰 전체 초기화</li>
          <li>일 예산 USD 5는 API minor unit 500으로 전송</li>
          <li>비USD 계정은 승인된 계정별 예산 매핑이 없으면 차단</li>
          <li>단일 이미지, 단일 문구, 단일 랜딩 URL, SHOP_NOW만 허용</li>
          <li>Advantage+·Asset Feed·Flexible Creative·Shop·Catalog·Site Links 강제 제외</li>
        </ul>
      </details>

      <button
        className={styles.primary}
        disabled={!input || Boolean(busy)}
        onClick={runPreflight}
        type="button"
      >
        안전 검증 및 등록 내용 미리보기
      </button>

      {preflight ? (
        <div className={styles.preflight}>
          <h4>최종 사전 검토</h4>
          <div className={styles.checks}>
            {preflight.checks.map((check) => (
              <article className={check.ok ? styles.pass : styles.block} key={check.key}>
                <strong>
                  {check.ok ? "통과" : "차단"} · {check.label}
                </strong>
                <span>{check.detail}</span>
              </article>
            ))}
          </div>
          <div className={styles.summary}>
            <span>{preflight.draft.adSetName}</span>
            <strong>
              {preflight.budget.display} · API {preflight.budget.dailyBudgetMinor ?? "-"}
            </strong>
            <span>광고 세트 PAUSED · 광고 H01~H06 PAUSED</span>
          </div>
          <label className={styles.confirm}>
            <input
              checked={checked}
              onChange={(event) => {
                setChecked(event.target.checked);
                setConfirmationToken("");
              }}
              type="checkbox"
            />
            선택한 Meta 광고 계정에 PAUSED 초안이 실제 생성되는 것을 확인했습니다.
          </label>
          {!confirmationToken ? (
            <button
              disabled={!checked || !preflight.ok || Boolean(busy)}
              onClick={confirmPreview}
              type="button"
            >
              최종 등록 내용 확인
            </button>
          ) : (
            <button
              className={styles.danger}
              disabled={Boolean(busy)}
              onClick={register}
              type="button"
            >
              PAUSED 상태로 Meta 초안 등록
            </button>
          )}
        </div>
      ) : null}
      <p className={styles.status} role="status">
        {status}
      </p>
    </section>
  );
}
