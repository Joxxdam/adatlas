"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import type {
  AutoProductionAdvertiserConfig,
  AutoProductionDashboardStatus,
  AutoProductionPreview,
  AutoProductionProductTask,
  AutoProductionResult,
  AutoProductionRun,
} from "../../lib/auto-production/types";
import styles from "./AutoProductionWorkspace.module.css";

type GlobalSettings = {
  paused: boolean;
  maxImagesPerDay: number;
  globalConcurrency: number;
};

type FormState = {
  advertiserName: string;
  bigQueryBrandMatch: string;
  siteUrl: string;
  scheduleTime: string;
  scheduleDays: number[];
  productsPerRun: string;
  creativesPerProduct: string;
  productCooldownDays: string;
  hookCooldownDays: string;
  excludedProductIds: string;
  excludedCategories: string;
  requiredProductIds: string;
  adminProductUrls: string;
  adObjective: AutoProductionAdvertiserConfig["adObjective"];
  productVisibilityMode: AutoProductionAdvertiserConfig["productVisibilityMode"];
  fullHookTestForNewProducts: boolean;
  explorationRatio: string;
  enabled: boolean;
};

const emptyForm: FormState = {
  advertiserName: "",
  bigQueryBrandMatch: "",
  siteUrl: "",
  scheduleTime: "09:00",
  scheduleDays: [0, 1, 2, 3, 4, 5, 6],
  productsPerRun: "4",
  creativesPerProduct: "1",
  productCooldownDays: "7",
  hookCooldownDays: "14",
  excludedProductIds: "",
  excludedCategories: "",
  requiredProductIds: "",
  adminProductUrls: "",
  adObjective: "purchase",
  productVisibilityMode: "site-visible-only",
  fullHookTestForNewProducts: false,
  explorationRatio: "30",
  enabled: true,
};

const weekdayLabels = ["일", "월", "화", "수", "목", "금", "토"];

const roleLabels: Record<AutoProductionProductTask["selectedRole"], string> = {
  "core-expansion": "핵심 상품 확장",
  "low-exposure-opportunity": "저노출 기회",
  reactivation: "재활성화",
  "new-exploration": "신규 탐색",
};

const runStatusLabels: Record<AutoProductionRun["status"], string> = {
  scheduled: "예약됨",
  "selecting-products": "상품 선정 중",
  "analyzing-products": "상품 분석 중",
  "generating-hooks": "후킹 생성 중",
  queued: "제작 대기",
  "generating-creatives": "콘텐츠 제작 중",
  completed: "완료",
  partial: "일부 완료",
  failed: "실패",
  cancelled: "취소",
  skipped: "건너뜀",
};

const terminalRunStatuses = new Set<AutoProductionRun["status"]>([
  "completed",
  "partial",
  "failed",
  "cancelled",
  "skipped",
]);

function list(value: string) {
  return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

function toForm(config: AutoProductionAdvertiserConfig): FormState {
  return {
    advertiserName: config.advertiserName,
    bigQueryBrandMatch: config.bigQueryBrandMatch,
    siteUrl: config.siteUrl,
    scheduleTime: config.scheduleTime,
    scheduleDays: config.scheduleDays,
    productsPerRun: String(config.productsPerRun),
    creativesPerProduct: String(config.creativesPerProduct),
    productCooldownDays: String(config.productCooldownDays),
    hookCooldownDays: String(config.hookCooldownDays),
    excludedProductIds: config.excludedProductIds.join(", "),
    excludedCategories: config.excludedCategories.join(", "),
    requiredProductIds: config.requiredProductIds.join(", "),
    adminProductUrls: config.adminProductUrls.join("\n"),
    adObjective: config.adObjective,
    productVisibilityMode: config.productVisibilityMode,
    fullHookTestForNewProducts: config.fullHookTestForNewProducts,
    explorationRatio: String(Math.round(config.explorationRatio * 100)),
    enabled: config.enabled,
  };
}

function formPayload(form: FormState) {
  const productsPerRun = Number(form.productsPerRun);
  const creativesPerProduct = Number(form.creativesPerProduct);
  return {
    advertiserName: form.advertiserName,
    bigQueryBrandMatch: form.bigQueryBrandMatch || form.advertiserName,
    siteUrl: form.siteUrl,
    scheduleTime: form.scheduleTime,
    scheduleDays: form.scheduleDays,
    productsPerRun,
    creativesPerProduct,
    maxImagesPerRun: Math.min(24, productsPerRun * (form.fullHookTestForNewProducts ? 6 : creativesPerProduct)),
    productCooldownDays: Number(form.productCooldownDays),
    hookCooldownDays: Number(form.hookCooldownDays),
    excludedProductIds: list(form.excludedProductIds),
    excludedCategories: list(form.excludedCategories),
    requiredProductIds: list(form.requiredProductIds),
    adminProductUrls: list(form.adminProductUrls),
    adObjective: form.adObjective,
    productVisibilityMode: form.productVisibilityMode,
    fullHookTestForNewProducts: form.fullHookTestForNewProducts,
    explorationRatio: Math.max(0, Math.min(1, Number(form.explorationRatio) / 100)),
    enabled: form.enabled,
  };
}

function localDateTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "요청 처리에 실패했습니다.");
  return payload;
}

function ResultActions({
  result,
  jobId,
  onUpdated,
}: {
  result: AutoProductionResult;
  jobId?: string;
  onUpdated: () => Promise<void>;
}) {
  const [working, setWorking] = useState(false);

  async function update(action: "approve" | "exclude" | "revise") {
    if (!jobId) return;
    const feedback = action === "revise"
      ? window.prompt("수정할 내용을 입력하세요. 상품 사실과 후킹 방향은 유지됩니다.", "후킹이 더 빠르게 읽히도록 수정")
      : undefined;
    if (action === "revise" && feedback === null) return;
    setWorking(true);
    try {
      await api(`/api/creative-generation/jobs/${encodeURIComponent(jobId)}/results/${encodeURIComponent(result.generationResultId)}`, {
        method: "POST",
        body: JSON.stringify({ action, feedback, requestId: `auto-production-${action}-${Date.now()}` }),
      });
      await onUpdated();
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className={styles.cardActions}>
      {result.downloadUrl ? <a download href={result.downloadUrl}>다운로드</a> : null}
      {result.assetCode ? <button onClick={() => navigator.clipboard.writeText(result.assetCode!)} type="button">소재코드 복사</button> : null}
      {result.adName ? <button onClick={() => navigator.clipboard.writeText(result.adName!)} type="button">광고명 복사</button> : null}
      {result.utm ? <button onClick={() => navigator.clipboard.writeText(result.utm!)} type="button">UTM 복사</button> : null}
      {jobId && result.imageUrl ? (
        <>
          <button disabled={working} onClick={() => void update("approve")} type="button">승인</button>
          <button disabled={working} onClick={() => void update("revise")} type="button">AI 수정</button>
          <button disabled={working} onClick={() => void update("exclude")} type="button">제외</button>
        </>
      ) : null}
    </div>
  );
}

export function AutoProductionWorkspace() {
  const [advertisers, setAdvertisers] = useState<AutoProductionAdvertiserConfig[]>([]);
  const [settings, setSettings] = useState<GlobalSettings>({ paused: false, maxImagesPerDay: 12, globalConcurrency: 2 });
  const [status, setStatus] = useState<AutoProductionDashboardStatus | null>(null);
  const [runs, setRuns] = useState<AutoProductionRun[]>([]);
  const [previews, setPreviews] = useState<AutoProductionPreview[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState("");

  const hasActiveRun = useMemo(() => runs.some((run) => !terminalRunStatuses.has(run.status)), [runs]);
  const latestRunByAdvertiser = useMemo(() => new Map(
    advertisers.map((advertiser) => [advertiser.advertiserId, runs.find((run) => run.advertiserId === advertiser.advertiserId)])
  ), [advertisers, runs]);
  const previewTotal = useMemo(() => previews.reduce((sum, previewItem) => sum + previewItem.expectedImages, 0), [previews]);

  const refresh = useCallback(async () => {
    try {
      const [configPayload, statusPayload, runPayload] = await Promise.all([
        api<{ advertisers: AutoProductionAdvertiserConfig[]; settings: GlobalSettings }>("/api/auto-production/advertisers"),
        api<{ status: AutoProductionDashboardStatus }>("/api/auto-production/status"),
        api<{ runs: AutoProductionRun[] }>("/api/auto-production/runs?limit=30"),
      ]);
      setAdvertisers(configPayload.advertisers);
      setSettings(configPayload.settings);
      setStatus(statusPayload.status);
      setRuns(runPayload.runs);
      setError("");
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "자동 제작 정보를 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(refresh, hasActiveRun ? 4_000 : 12_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [hasActiveRun, refresh]);

  async function runAction(key: string, work: () => Promise<void>) {
    setWorking(key);
    setError("");
    try {
      await work();
      await refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "요청을 처리하지 못했습니다.");
    } finally {
      setWorking(null);
    }
  }

  async function preview(advertiserId?: string) {
    await runAction(`preview:${advertiserId || "all"}`, async () => {
      const payload = await api<{ previews: AutoProductionPreview[] }>("/api/auto-production/preview", {
        method: "POST",
        body: JSON.stringify({ advertiserId }),
      });
      setPreviews(payload.previews);
    });
  }

  async function run(advertiserId?: string) {
    await runAction(`run:${advertiserId || "all"}`, async () => {
      await api("/api/auto-production/run", {
        method: "POST",
        body: JSON.stringify({ advertiserId, trigger: "manual" }),
      });
    });
  }

  async function saveAdvertiser() {
    await runAction("save", async () => {
      const url = editingId
        ? `/api/auto-production/advertisers/${encodeURIComponent(editingId)}`
        : "/api/auto-production/advertisers";
      await api(url, { method: editingId ? "PATCH" : "POST", body: JSON.stringify(formPayload(form)) });
      setForm(emptyForm);
      setEditingId(null);
      setShowForm(false);
    });
  }

  async function queueHooks(runId: string, taskId: string, hookCodes?: string[]) {
    await runAction(`hooks:${taskId}:${hookCodes?.join("-") || "all"}`, async () => {
      await api(`/api/auto-production/runs/${encodeURIComponent(runId)}/products/${encodeURIComponent(taskId)}/hooks`, {
        method: "POST",
        body: JSON.stringify(hookCodes?.length ? { hookCodes } : { all: true }),
      });
    });
  }

  return (
    <main className={styles.workspace}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>DAILY CREATIVE OPERATIONS</p>
          <h1>자동 제작</h1>
          <p>매일 오전 9시, 검증된 상품 근거와 새로운 후킹으로 광고 콘텐츠를 자동 제작합니다.</p>
        </div>
        <div className={styles.actions}>
          <label className={styles.limitControl}>일일 최대
            <input
              aria-label="하루 최대 자동 제작 이미지 수"
              max="120"
              min="1"
              onBlur={() => void runAction("daily-limit", async () => {
                await api("/api/auto-production/advertisers", { method: "PATCH", body: JSON.stringify({ maxImagesPerDay: settings.maxImagesPerDay }) });
              })}
              onChange={(event) => setSettings((current) => ({ ...current, maxImagesPerDay: Math.max(1, Math.min(120, Number(event.target.value) || 1)) }))}
              type="number"
              value={settings.maxImagesPerDay}
            />장
          </label>
          <button className={styles.buttonSecondary} disabled={Boolean(working)} onClick={() => void preview()} type="button">오늘 후보 미리보기</button>
          <button className={styles.button} disabled={Boolean(working) || settings.paused} onClick={() => void run()} type="button">오늘 자동 제작 실행</button>
          <button
            className={settings.paused ? styles.button : styles.buttonDanger}
            disabled={Boolean(working)}
            onClick={() => void runAction("pause", async () => {
              await api("/api/auto-production/advertisers", { method: "PATCH", body: JSON.stringify({ paused: !settings.paused }) });
            })}
            type="button"
          >
            {settings.paused ? "전체 자동 제작 재개" : "전체 자동 제작 일시정지"}
          </button>
        </div>
      </header>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <p className={styles.notice}>기본 운영 한도는 광고주 3곳 × 상품 4개 × 콘텐츠 1장, 하루 최대 {status?.maxImagesPerDay || settings.maxImagesPerDay}장입니다. 광고 플랫폼 게시는 자동으로 수행하지 않습니다.</p>

      <section className={styles.stats} aria-label="자동 제작 현황">
        <div className={styles.stat}><span>다음 실행</span><strong>{localDateTime(status?.nextRunAt)}</strong></div>
        <div className={styles.stat}><span>활성 광고주</span><strong>{status?.activeAdvertiserCount ?? advertisers.filter((item) => item.enabled).length}곳</strong></div>
        <div className={styles.stat}><span>오늘 계획</span><strong>{status?.plannedProductCount ?? 0}장</strong></div>
        <div className={styles.stat}><span>오늘 완료</span><strong>{status?.completedTodayCount ?? 0}장</strong></div>
        <div className={styles.stat}><span>현재 상태</span><strong>{settings.paused ? "일시정지" : hasActiveRun ? "제작 중" : "대기"}</strong></div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div><h2>광고주 자동 제작 설정</h2><p>데이터 소스 실패 시 사이트, 관리자 상품 URL 순으로 안전하게 전환합니다.</p></div>
          <button className={styles.buttonSecondary} onClick={() => { setForm(emptyForm); setEditingId(null); setShowForm(true); }} type="button">광고주 추가</button>
        </div>

        {showForm ? (
          <div className={styles.form}>
            <div className={styles.formGrid}>
              <label>광고주명<input required value={form.advertiserName} onChange={(event) => setForm({ ...form, advertiserName: event.target.value })} /></label>
              <label>BigQuery 브랜드 매칭<input value={form.bigQueryBrandMatch} onChange={(event) => setForm({ ...form, bigQueryBrandMatch: event.target.value })} /></label>
              <label>사이트 URL<input inputMode="url" value={form.siteUrl} onChange={(event) => setForm({ ...form, siteUrl: event.target.value })} /></label>
              <label>실행 시각<input type="time" value={form.scheduleTime} onChange={(event) => setForm({ ...form, scheduleTime: event.target.value })} /></label>
              <fieldset className={styles.weekdays}>
                <legend>실행 요일</legend>
                {weekdayLabels.map((label, day) => (
                  <label key={label}>
                    <input
                      checked={form.scheduleDays.includes(day)}
                      onChange={(event) => setForm({
                        ...form,
                        scheduleDays: event.target.checked
                          ? [...form.scheduleDays, day].sort((left, right) => left - right)
                          : form.scheduleDays.filter((item) => item !== day),
                      })}
                      type="checkbox"
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              <label>실행당 상품 수<input max="12" min="1" type="number" value={form.productsPerRun} onChange={(event) => setForm({ ...form, productsPerRun: event.target.value })} /></label>
              <label>상품당 콘텐츠 수<input max="6" min="1" type="number" value={form.creativesPerProduct} onChange={(event) => setForm({ ...form, creativesPerProduct: event.target.value })} /></label>
              <label>상품 재선정 제한(일)<input min="0" type="number" value={form.productCooldownDays} onChange={(event) => setForm({ ...form, productCooldownDays: event.target.value })} /></label>
              <label>후킹 재사용 제한(일)<input min="0" type="number" value={form.hookCooldownDays} onChange={(event) => setForm({ ...form, hookCooldownDays: event.target.value })} /></label>
              <label>광고 목표<select value={form.adObjective} onChange={(event) => setForm({ ...form, adObjective: event.target.value as FormState["adObjective"] })}><option value="purchase">판매</option><option value="signup">가입</option><option value="awareness">인지도</option><option value="retargeting">리타게팅</option></select></label>
              <label>제외 상품 ID<input value={form.excludedProductIds} onChange={(event) => setForm({ ...form, excludedProductIds: event.target.value })} /></label>
              <label>제외 카테고리<input value={form.excludedCategories} onChange={(event) => setForm({ ...form, excludedCategories: event.target.value })} /></label>
              <label>필수 상품 ID<input value={form.requiredProductIds} onChange={(event) => setForm({ ...form, requiredProductIds: event.target.value })} /></label>
              <label>관리자 상품 URL<input value={form.adminProductUrls} onChange={(event) => setForm({ ...form, adminProductUrls: event.target.value })} /></label>
            </div>
            <details className={styles.advanced}>
              <summary>고급 설정</summary>
              <div className={styles.formGrid}>
                <label>상품 노출 범위
                  <select value={form.productVisibilityMode} onChange={(event) => setForm({ ...form, productVisibilityMode: event.target.value as FormState["productVisibilityMode"] })}>
                    <option value="site-visible-only">사이트 노출 상품만</option>
                    <option value="include-crema-ad">크리마애드 상품 포함</option>
                    <option value="admin-only">관리자 지정 상품만</option>
                  </select>
                </label>
                <label>새 후킹 탐색 비율(%)<input max="100" min="0" type="number" value={form.explorationRatio} onChange={(event) => setForm({ ...form, explorationRatio: event.target.value })} /></label>
                <label className={styles.checkControl}><input checked={form.fullHookTestForNewProducts} onChange={(event) => setForm({ ...form, fullHookTestForNewProducts: event.target.checked })} type="checkbox" />신규 상품은 후킹 6개 전체 제작</label>
                <label className={styles.checkControl}><input checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} type="checkbox" />저장 후 자동 제작 활성화</label>
              </div>
            </details>
            <footer>
              <button className={styles.buttonSecondary} onClick={() => setShowForm(false)} type="button">취소</button>
              <button className={styles.button} disabled={working === "save" || !form.advertiserName.trim() || form.scheduleDays.length === 0} onClick={() => void saveAdvertiser()} type="button">설정 저장</button>
            </footer>
          </div>
        ) : null}

        <div className={styles.grid}>
          {advertisers.map((advertiser) => (
            <article className={styles.advertiser} key={advertiser.advertiserId}>
              <div className={styles.advertiserTop}>
                <h3>{advertiser.advertiserName}</h3>
                <span className={advertiser.enabled ? styles.badge : styles.badgeOff}>{advertiser.enabled ? "자동 제작 켜짐" : "일시정지"}</span>
              </div>
              <div className={styles.meta}>
                <span>{advertiser.scheduleDays.length === 7 ? "매일" : advertiser.scheduleDays.map((day) => weekdayLabels[day]).join("·")} {advertiser.scheduleTime} · 상품 {advertiser.productsPerRun}개 × {advertiser.creativesPerProduct}장</span>
                <span>상품 {advertiser.productCooldownDays}일 · 후킹 {advertiser.hookCooldownDays}일 중복 방지</span>
                <span>다음 실행 {localDateTime(advertiser.nextRunAt)}</span>
                <span>최근 실행 {latestRunByAdvertiser.get(advertiser.advertiserId) ? `${localDateTime(latestRunByAdvertiser.get(advertiser.advertiserId)?.startedAt)} · ${runStatusLabels[latestRunByAdvertiser.get(advertiser.advertiserId)!.status]}` : "없음"}</span>
              </div>
              <div className={styles.cardActions}>
                <button disabled={Boolean(working)} onClick={() => void preview(advertiser.advertiserId)} type="button">후보 보기</button>
                <button disabled={Boolean(working) || settings.paused || !advertiser.enabled} onClick={() => void run(advertiser.advertiserId)} type="button">지금 실행</button>
                <button onClick={() => { setForm(toForm(advertiser)); setEditingId(advertiser.advertiserId); setShowForm(true); }} type="button">설정 수정</button>
                <button disabled={Boolean(working)} onClick={() => void runAction(`toggle:${advertiser.advertiserId}`, async () => {
                  await api(`/api/auto-production/advertisers/${encodeURIComponent(advertiser.advertiserId)}`, { method: "PATCH", body: JSON.stringify({ enabled: !advertiser.enabled }) });
                })} type="button">{advertiser.enabled ? "일시정지" : "재개"}</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {previews.length ? (
        <section className={styles.section}>
          <div className={styles.sectionHeader}><div><h2>오늘 후보 미리보기</h2><p>확인된 근거만 사용하며 판매성과를 임의로 예측하지 않습니다.</p></div></div>
          {previewTotal > settings.maxImagesPerDay ? <p className={styles.error} role="alert">예상 {previewTotal}장으로 하루 자동 제작 한도 {settings.maxImagesPerDay}장을 초과합니다. 실행 시 한도 내 상품만 안전하게 선정됩니다.</p> : null}
          <div className={styles.preview}>
            {previews.map((preview) => (
              <div className={styles.previewGroup} key={preview.advertiserId}>
                <strong>{preview.advertiserName} · {preview.source} · 예상 {preview.expectedImages}장</strong>
                {preview.fallbackReason ? <p>{preview.fallbackReason}</p> : null}
                <ul className={styles.previewList}>
                  {preview.candidates.map((candidate) => <li key={candidate.id}><span>{candidate.productName}</span><small>{roleLabels[candidate.recommendationRole]} · {candidate.recommendationReason}</small></li>)}
                </ul>
                {preview.warnings.map((warning) => <p className={styles.error} key={warning}>{warning}</p>)}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className={styles.section} id="auto-production-results">
        <div className={styles.sectionHeader}><div><h2>자동 제작 결과</h2><p>상품별로 6개 후킹 가설을 보관하고, 매일 겹치지 않는 1개 후킹을 우선 제작합니다.</p></div></div>
        {!runs.length ? <div className={styles.empty}>아직 실행 기록이 없습니다. 후보를 확인한 뒤 오늘 자동 제작을 실행해보세요.</div> : null}
        {runs.map((productionRun) => (
          <article className={styles.run} key={productionRun.id}>
            <header className={styles.runHeader}>
              <div><h3>{productionRun.advertiserName} · {productionRun.businessDate}</h3><p>{productionRun.dataSourceUsed || "데이터 확인 중"} · 완료 {productionRun.completedImages}/{productionRun.expectedImages} · 실패 {productionRun.failedImages}</p></div>
              <div>
                <span className={styles.status}>{runStatusLabels[productionRun.status]}</span>
                {!terminalRunStatuses.has(productionRun.status) ? <button className={styles.buttonDanger} disabled={Boolean(working)} onClick={() => void runAction(`cancel:${productionRun.id}`, async () => { await api(`/api/auto-production/runs/${encodeURIComponent(productionRun.id)}`, { method: "PATCH", body: JSON.stringify({ action: "cancel" }) }); })} type="button">중지</button> : null}
              </div>
            </header>
            <div className={styles.tasks}>
              {productionRun.tasks.map((task) => {
                const selected = task.hookHypotheses.find((hook) => hook.code === task.selectedHookCode);
                return (
                  <section className={styles.task} key={task.id}>
                    <div className={styles.taskHead}>
                      {task.candidate.imageUrl ? <Image alt="" height={74} src={task.candidate.imageUrl} unoptimized width={74} /> : <div className={styles.placeholder} />}
                      <div><h4>{task.candidate.productName}</h4><small>{roleLabels[task.selectedRole]} · {task.status}</small></div>
                    </div>
                    <p className={styles.reason}>{task.selectedReason}</p>
                    {selected ? <div className={styles.hook}><span>{selected.code} · {selected.hookType}</span><strong>{selected.mainHook}</strong><p>{selected.subCopy}</p></div> : null}
                    <details className={styles.hypotheses}>
                      <summary>후킹 가설 6개 보기</summary>
                      {task.hookHypotheses.map((hook) => (
                        <div className={styles.hypothesis} key={hook.code}>
                          <strong>{hook.code} · {hook.mainHook}</strong><p>{hook.subCopy}</p>
                          <button disabled={Boolean(working)} onClick={() => void queueHooks(productionRun.id, task.id, [hook.code])} type="button">이 후킹으로 1장 제작</button>
                        </div>
                      ))}
                      {task.hookHypotheses.length ? <button className={styles.buttonSecondary} disabled={Boolean(working)} onClick={() => void queueHooks(productionRun.id, task.id)} type="button">6개 후킹 모두 제작</button> : null}
                    </details>
                    {task.error ? <p className={styles.error}>{task.error}</p> : null}
                    <div className={styles.results}>
                      {task.results.map((result) => (
                        <div className={styles.result} key={result.generationResultId}>
                          {result.imageUrl ? <Image alt={`${task.candidate.productName} ${result.hookCode} 광고`} height={600} src={result.imageUrl} unoptimized width={600} /> : <div className={styles.placeholder} />}
                          <div className={styles.resultMeta}>
                            <strong>{result.hookCode} · {result.status}</strong>
                            <small>{localDateTime(result.createdAt)}</small>
                            {result.assetCode ? <code>{result.assetCode}</code> : null}
                            <ResultActions result={result} jobId={task.generationJobId} onUpdated={refresh} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
