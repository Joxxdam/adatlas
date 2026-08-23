"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AutoProductionAdvertiserConfig,
  AutoProductionDashboardStatus,
  AutoProductionPreview,
  AutoProductionProductTask,
  AutoProductionRun,
} from "../../lib/auto-production/types";
import {
  AUTO_PRODUCTION_CREATIVES_PER_PRODUCT,
  AUTO_PRODUCTION_DEFAULT_SCHEDULE_TIME,
  AUTO_PRODUCTION_IMAGES_PER_MALL,
  AUTO_PRODUCTION_PRODUCTS_PER_MALL,
} from "../../lib/auto-production/policy";
import styles from "./AutoProductionWorkspace.module.css";

type GlobalSettings = {
  paused: boolean;
  maxImagesPerDay: number;
  globalConcurrency: number;
};

type RunPeriod = "today" | "yesterday" | "seven-days" | "custom" | "all";

type FormState = {
  advertiserName: string;
  bigQueryBrandMatch: string;
  siteUrl: string;
  scheduleTime: string;
  scheduleDays: number[];
  productsPerRun: string;
  productCooldownDays: string;
  productFamilyCooldownDays: string;
  excludedProductIds: string;
  excludedCategories: string;
  requiredProductIds: string;
  adminProductUrls: string;
  adObjective: AutoProductionAdvertiserConfig["adObjective"];
  productVisibilityMode: AutoProductionAdvertiserConfig["productVisibilityMode"];
  enabled: boolean;
};

const emptyForm: FormState = {
  advertiserName: "",
  bigQueryBrandMatch: "",
  siteUrl: "",
  scheduleTime: AUTO_PRODUCTION_DEFAULT_SCHEDULE_TIME,
  scheduleDays: [0, 1, 2, 3, 4, 5, 6],
  productsPerRun: "4",
  productCooldownDays: "7",
  productFamilyCooldownDays: "14",
  excludedProductIds: "",
  excludedCategories: "",
  requiredProductIds: "",
  adminProductUrls: "",
  adObjective: "purchase",
  productVisibilityMode: "site-visible-only",
  enabled: false,
};

const weekdayLabels = ["일", "월", "화", "수", "목", "금", "토"];

const roleLabels: Record<AutoProductionProductTask["selectedRole"], string> = {
  "core-expansion": "꾸준히 잘 팔리는 주력상품",
  "low-exposure-opportunity": "광고 노출을 늘려볼 상품",
  reactivation: "구매 반응이 좋은 성장 후보",
  "new-exploration": "새롭게 테스트할 상품",
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

const productStatusLabels: Record<AutoProductionProductTask["status"], string> = {
  selected: "상품 선정",
  analyzing: "상품 분석 중",
  "hooks-ready": "문구 준비 완료",
  queued: "이미지 제작 대기",
  generating: "이미지 제작 중",
  completed: "완료",
  failed: "실패",
  "skipped-duplicate": "중복 제외",
  "skipped-insufficient-data": "상품 정보 부족",
  "skipped-unavailable": "상품 이용 불가",
};

const sourceLabels: Record<AutoProductionProductTask["candidate"]["source"], string> = {
  bigquery: "BigQuery 읽기 전용",
  crema: "크리마 읽기 전용",
  site: "공개 사이트",
  admin: "직접 지정 URL",
};

function resultStatusLabel(status: AutoProductionProductTask["results"][number]["status"]) {
  if (["success", "approved"].includes(status)) return "완료";
  if (["quality-review", "korean-review", "product-review", "group-review"].includes(status)) return "확인 필요";
  if (status === "failed") return "실패";
  if (status === "running") return "제작 중";
  if (status === "cancelled") return "취소";
  return "대기";
}

function seoulBusinessDate(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function list(value: string) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toForm(config: AutoProductionAdvertiserConfig): FormState {
  return {
    advertiserName: config.advertiserName,
    bigQueryBrandMatch: config.bigQueryBrandMatch,
    siteUrl: config.siteUrl,
    scheduleTime: config.scheduleTime,
    scheduleDays: config.scheduleDays,
    productsPerRun: String(config.productsPerRun),
    productCooldownDays: String(config.productCooldownDays),
    productFamilyCooldownDays: String(config.productFamilyCooldownDays),
    excludedProductIds: config.excludedProductIds.join(", "),
    excludedCategories: config.excludedCategories.join(", "),
    requiredProductIds: config.requiredProductIds.join(", "),
    adminProductUrls: config.adminProductUrls.join("\n"),
    adObjective: config.adObjective,
    productVisibilityMode: config.productVisibilityMode,
    enabled: config.enabled,
  };
}

function formPayload(form: FormState) {
  return {
    advertiserName: form.advertiserName,
    bigQueryBrandMatch: form.bigQueryBrandMatch || form.advertiserName,
    siteUrl: form.siteUrl,
    scheduleTime: form.scheduleTime,
    scheduleDays: form.scheduleDays,
    productsPerRun: AUTO_PRODUCTION_PRODUCTS_PER_MALL,
    creativesPerProduct: AUTO_PRODUCTION_CREATIVES_PER_PRODUCT,
    maxImagesPerRun: AUTO_PRODUCTION_IMAGES_PER_MALL,
    productCooldownDays: Number(form.productCooldownDays),
    productFamilyCooldownDays: Number(form.productFamilyCooldownDays),
    hookCooldownDays: 0,
    excludedProductIds: list(form.excludedProductIds),
    excludedCategories: list(form.excludedCategories),
    requiredProductIds: list(form.requiredProductIds),
    adminProductUrls: list(form.adminProductUrls),
    adObjective: form.adObjective,
    productVisibilityMode: form.productVisibilityMode,
    fullHookTestForNewProducts: false,
    explorationRatio: 0,
    enabled: form.enabled,
  };
}

function localDateTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("ko-KR", {
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
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "요청 처리에 실패했습니다.");
  return payload;
}

export function AutoProductionWorkspace() {
  const [advertisers, setAdvertisers] = useState<AutoProductionAdvertiserConfig[]>([]);
  const [settings, setSettings] = useState<GlobalSettings>({
    paused: false,
    maxImagesPerDay: AUTO_PRODUCTION_IMAGES_PER_MALL * 3,
    globalConcurrency: 2,
  });
  const [status, setStatus] = useState<AutoProductionDashboardStatus | null>(null);
  const [runs, setRuns] = useState<AutoProductionRun[]>([]);
  const [previews, setPreviews] = useState<AutoProductionPreview[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [runPeriod, setRunPeriod] = useState<RunPeriod>("today");
  const [customFrom, setCustomFrom] = useState(() => seoulBusinessDate(-6));
  const [customTo, setCustomTo] = useState(() => seoulBusinessDate());

  const runDateRange = useMemo(() => {
    if (runPeriod === "all") return {};
    if (runPeriod === "today") {
      const today = seoulBusinessDate();
      return { dateFrom: today, dateTo: today };
    }
    if (runPeriod === "yesterday") {
      const yesterday = seoulBusinessDate(-1);
      return { dateFrom: yesterday, dateTo: yesterday };
    }
    if (runPeriod === "seven-days") {
      return { dateFrom: seoulBusinessDate(-6), dateTo: seoulBusinessDate() };
    }
    return customFrom <= customTo
      ? { dateFrom: customFrom, dateTo: customTo }
      : { dateFrom: customTo, dateTo: customFrom };
  }, [customFrom, customTo, runPeriod]);

  const runQuery = useMemo(() => {
    const params = new URLSearchParams({ limit: "200" });
    if (runDateRange.dateFrom) params.set("dateFrom", runDateRange.dateFrom);
    if (runDateRange.dateTo) params.set("dateTo", runDateRange.dateTo);
    return params.toString();
  }, [runDateRange]);

  const hasActiveRun = useMemo(
    () => runs.some((run) => !terminalRunStatuses.has(run.status)),
    [runs]
  );
  const latestRunByAdvertiser = useMemo(
    () =>
      new Map(
        advertisers.map((advertiser) => [
          advertiser.advertiserId,
          runs.find((run) => run.advertiserId === advertiser.advertiserId),
        ])
      ),
    [advertisers, runs]
  );
  const previewTotal = useMemo(
    () => previews.reduce((sum, previewItem) => sum + previewItem.expectedImages, 0),
    [previews]
  );

  const refresh = useCallback(async () => {
    try {
      const [configPayload, statusPayload, runPayload] = await Promise.all([
        api<{ advertisers: AutoProductionAdvertiserConfig[]; settings: GlobalSettings }>(
          "/api/auto-production/advertisers"
        ),
        api<{ status: AutoProductionDashboardStatus }>("/api/auto-production/status"),
        api<{ runs: AutoProductionRun[] }>(`/api/auto-production/runs?${runQuery}`),
      ]);
      setAdvertisers(configPayload.advertisers);
      setSettings(configPayload.settings);
      setStatus(statusPayload.status);
      setRuns(runPayload.runs);
      setError("");
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "자동 제작 정보를 불러오지 못했습니다."
      );
    }
  }, [runQuery]);

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
      const payload = await api<{ previews: AutoProductionPreview[] }>(
        "/api/auto-production/preview",
        {
          method: "POST",
          body: JSON.stringify({ advertiserId }),
        }
      );
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
      await api(url, {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify(formPayload(form)),
      });
      setForm(emptyForm);
      setEditingId(null);
      setShowForm(false);
    });
  }

  return (
    <main className={styles.workspace}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>DAILY CREATIVE OPERATIONS</p>
          <h1>자동 콘텐츠 제작</h1>
          <p>매일 오전 7시, 몰별 상품 4개와 레퍼런스 기반 완성 광고 24장을 출근 전에 준비합니다.</p>
        </div>
        <div className={styles.actions}>
          <button
            className={styles.buttonSecondary}
            disabled={Boolean(working)}
            onClick={() => void preview()}
            type="button"
          >
            오늘 후보 미리보기
          </button>
          <button
            className={styles.button}
            disabled={Boolean(working) || settings.paused}
            onClick={() => void run()}
            type="button"
          >
            지금 실행
          </button>
        </div>
      </header>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <p className={styles.notice}>
        서버가 켜져 있을 때 백그라운드에서 계속 실행됩니다. 로컬 PC와 서버가 모두 꺼져 있으면
        실행되지 않으며, 같은 날 다시 켜면 누락된 예약을 한 번만 보충합니다. 수기 제작과 동일한
        카테고리별 ZIP 레퍼런스 6장을 사용하는 수동 제작과 동일한 생성 워크플로우만 사용하며,
        유료 API로 자동 전환하거나 Meta에 자동 게시하지 않습니다.
      </p>

      <section className={styles.stats} aria-label="자동 제작 현황">
        <div className={styles.stat}>
          <span>자동제작</span>
          <strong>{settings.paused ? "꺼짐" : "켜짐"}</strong>
        </div>
        <div className={styles.stat}>
          <span>다음 실행 시간</span>
          <strong>{localDateTime(status?.nextRunAt)}</strong>
        </div>
        <div className={styles.stat}>
          <span>오늘 제작 예정</span>
          <strong>{status?.plannedImageCount ?? status?.plannedProductCount ?? 0}장</strong>
        </div>
        <div className={styles.stat}>
          <span>오늘 완료</span>
          <strong>{status?.completedTodayCount ?? 0}장</strong>
        </div>
        <div className={styles.stat}>
          <span>확인 필요</span>
          <strong>{status?.failedTodayCount ?? 0}장</strong>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="today-progress-title">
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="today-progress-title">오늘의 제작 현황</h2>
            <p>광고주별 진행 상황만 간단히 보여드립니다.</p>
          </div>
        </div>
        <div className={styles.progressList}>
          {advertisers.map((advertiser) => {
            const latest = latestRunByAdvertiser.get(advertiser.advertiserId);
            const total = latest?.expectedImages || 0;
            const completed = latest?.completedImages || 0;
            const failed = latest?.failedImages || 0;
            const progress = total
              ? Math.min(100, Math.round(((completed + failed) / total) * 100))
              : 0;
            return (
              <article className={styles.progressCard} key={advertiser.advertiserId}>
                <strong>{advertiser.advertiserName}</strong>
                <span>
                  {latest
                    ? runStatusLabels[latest.status]
                    : advertiser.enabled
                      ? "실행 대기"
                      : "일시정지"}
                </span>
                <span>
                  상품 {latest?.tasks.length || 0}개 · 완성 {completed}장 · 실패 {failed}장
                </span>
                <progress max="100" value={progress}>
                  {progress}%
                </progress>
                <a href="#auto-production-results">결과 보기</a>
              </article>
            );
          })}
        </div>
      </section>

      <details className={styles.settingsPanel} id="advertiser-memory">
        <summary>자동제작 설정</summary>
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>광고주 자동 제작 설정</h2>
              <p>요일·시간·제외 조건을 저장합니다. 제작량은 몰당 4상품 × 6장으로 고정됩니다.</p>
            </div>
            <div className={styles.actions}>
              <label className={styles.limitControl}>
                일일 생성 한도
                <input
                  aria-label="하루 최대 자동 제작 이미지 수"
                  max="120"
                  min={Math.max(AUTO_PRODUCTION_IMAGES_PER_MALL, status?.plannedImageCount || status?.plannedProductCount || AUTO_PRODUCTION_IMAGES_PER_MALL)}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                        maxImagesPerDay: Math.max(
                          Math.max(AUTO_PRODUCTION_IMAGES_PER_MALL, status?.plannedImageCount || status?.plannedProductCount || AUTO_PRODUCTION_IMAGES_PER_MALL),
                          Math.min(120, Number(event.target.value) || AUTO_PRODUCTION_IMAGES_PER_MALL * 3)
                        ),
                    }))
                  }
                  type="number"
                  value={settings.maxImagesPerDay}
                />
                장
              </label>
              <label className={styles.limitControl}>
                <input
                  checked={settings.paused}
                  onChange={(event) =>
                    setSettings((current) => ({ ...current, paused: event.target.checked }))
                  }
                  type="checkbox"
                />
                전체 일시정지
              </label>
              <button
                className={styles.button}
                disabled={Boolean(working)}
                onClick={() =>
                  void runAction("global-settings", async () => {
                    await api("/api/auto-production/advertisers", {
                      method: "PATCH",
                      body: JSON.stringify({
                        maxImagesPerDay: settings.maxImagesPerDay,
                        paused: settings.paused,
                      }),
                    });
                  })
                }
                type="button"
              >
                전체 설정 저장
              </button>
              <button
                className={styles.buttonSecondary}
                onClick={() => {
                  setForm(emptyForm);
                  setEditingId(null);
                  setShowForm(true);
                }}
                type="button"
              >
                광고주 추가
              </button>
            </div>
          </div>

          {showForm ? (
            <div className={styles.form}>
              <div className={styles.formGrid}>
                <label>
                  광고주명
                  <input
                    required
                    value={form.advertiserName}
                    onChange={(event) => setForm({ ...form, advertiserName: event.target.value })}
                  />
                </label>
                <label>
                  BigQuery 브랜드 매칭
                  <input
                    value={form.bigQueryBrandMatch}
                    onChange={(event) =>
                      setForm({ ...form, bigQueryBrandMatch: event.target.value })
                    }
                  />
                </label>
                <label>
                  사이트 URL
                  <input
                    inputMode="url"
                    value={form.siteUrl}
                    onChange={(event) => setForm({ ...form, siteUrl: event.target.value })}
                  />
                </label>
                <label>
                  실행 시각
                  <input
                    type="time"
                    value={form.scheduleTime}
                    onChange={(event) => setForm({ ...form, scheduleTime: event.target.value })}
                  />
                </label>
                <fieldset className={styles.weekdays}>
                  <legend>실행 요일</legend>
                  {weekdayLabels.map((label, day) => (
                    <label key={label}>
                      <input
                        checked={form.scheduleDays.includes(day)}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            scheduleDays: event.target.checked
                              ? [...form.scheduleDays, day].sort((left, right) => left - right)
                              : form.scheduleDays.filter((item) => item !== day),
                          })
                        }
                        type="checkbox"
                      />
                      {label}
                    </label>
                  ))}
                </fieldset>
                <div className={styles.standardPolicy}>
                  <span>고정 제작 기준</span>
                  <strong>상품 4개 × 상품별 광고 6장 = 몰당 24장</strong>
                  <small>수동 제작과 동일하게 상품군별 ZIP 레퍼런스 6장을 배정한 뒤 상품과 문구를 교체합니다.</small>
                </div>
                <label>
                  상품 재선정 제한(일)
                  <input
                    min="0"
                    type="number"
                    value={form.productCooldownDays}
                    onChange={(event) =>
                      setForm({ ...form, productCooldownDays: event.target.value })
                    }
                  />
                </label>
                <label>
                  상품군 중복 방지(일)
                  <input
                    min="0"
                    type="number"
                    value={form.productFamilyCooldownDays}
                    onChange={(event) =>
                      setForm({ ...form, productFamilyCooldownDays: event.target.value })
                    }
                  />
                </label>
                <label>
                  광고 목표
                  <select
                    value={form.adObjective}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        adObjective: event.target.value as FormState["adObjective"],
                      })
                    }
                  >
                    <option value="purchase">판매</option>
                    <option value="signup">가입</option>
                    <option value="awareness">인지도</option>
                    <option value="retargeting">리타게팅</option>
                  </select>
                </label>
                <label>
                  제외 상품 ID
                  <input
                    value={form.excludedProductIds}
                    onChange={(event) =>
                      setForm({ ...form, excludedProductIds: event.target.value })
                    }
                  />
                </label>
                <label>
                  제외 카테고리
                  <input
                    value={form.excludedCategories}
                    onChange={(event) =>
                      setForm({ ...form, excludedCategories: event.target.value })
                    }
                  />
                </label>
                <label>
                  필수 상품 ID
                  <input
                    value={form.requiredProductIds}
                    onChange={(event) =>
                      setForm({ ...form, requiredProductIds: event.target.value })
                    }
                  />
                </label>
                <label>
                  관리자 상품 URL
                  <input
                    value={form.adminProductUrls}
                    onChange={(event) => setForm({ ...form, adminProductUrls: event.target.value })}
                  />
                </label>
              </div>
              <details className={styles.advanced}>
                <summary>고급 설정</summary>
                <div className={styles.formGrid}>
                  <label>
                    상품 노출 범위
                    <select
                      value={form.productVisibilityMode}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          productVisibilityMode: event.target
                            .value as FormState["productVisibilityMode"],
                        })
                      }
                    >
                      <option value="site-visible-only">사이트 노출 상품만</option>
                      <option value="include-crema-ad">크리마애드 상품 포함</option>
                      <option value="admin-only">관리자 지정 상품만</option>
                    </select>
                  </label>
                  <label className={styles.checkControl}>
                    <input
                      checked={form.enabled}
                      onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
                      type="checkbox"
                    />
                    저장 후 자동 제작 활성화
                  </label>
                </div>
              </details>
              <footer>
                <button
                  className={styles.buttonSecondary}
                  onClick={() => setShowForm(false)}
                  type="button"
                >
                  취소
                </button>
                <button
                  className={styles.button}
                  disabled={
                    working === "save" ||
                    !form.advertiserName.trim() ||
                    form.scheduleDays.length === 0
                  }
                  onClick={() => void saveAdvertiser()}
                  type="button"
                >
                  설정 저장
                </button>
              </footer>
            </div>
          ) : null}

          <div className={styles.grid}>
            {advertisers.map((advertiser) => (
              <article className={styles.advertiser} key={advertiser.advertiserId}>
                <div className={styles.advertiserTop}>
                  <h3>{advertiser.advertiserName}</h3>
                  <span className={advertiser.enabled ? styles.badge : styles.badgeOff}>
                    {advertiser.enabled ? "자동 제작 켜짐" : "일시정지"}
                  </span>
                </div>
                <div className={styles.meta}>
                  <span>
                    {advertiser.scheduleDays.length === 7
                      ? "매일"
                      : advertiser.scheduleDays.map((day) => weekdayLabels[day]).join("·")}{" "}
                    {advertiser.scheduleTime} · 상품 {advertiser.productsPerRun}개 ×{" "}
                    {advertiser.creativesPerProduct}장
                  </span>
                  <span>
                    상품 {advertiser.productCooldownDays}일 · 상품군{" "}
                    {advertiser.productFamilyCooldownDays}일 중복 방지
                  </span>
                  <span>다음 실행 {localDateTime(advertiser.nextRunAt)}</span>
                  <span>
                    최근 실행{" "}
                    {latestRunByAdvertiser.get(advertiser.advertiserId)
                      ? `${localDateTime(latestRunByAdvertiser.get(advertiser.advertiserId)?.startedAt)} · ${runStatusLabels[latestRunByAdvertiser.get(advertiser.advertiserId)!.status]}`
                      : "없음"}
                  </span>
                </div>
                <div className={styles.cardActions}>
                  <button
                    disabled={Boolean(working)}
                    onClick={() => void preview(advertiser.advertiserId)}
                    type="button"
                  >
                    후보 보기
                  </button>
                  <button
                    disabled={Boolean(working) || settings.paused || !advertiser.enabled}
                    onClick={() => void run(advertiser.advertiserId)}
                    type="button"
                  >
                    지금 실행
                  </button>
                  <button
                    onClick={() => {
                      setForm(toForm(advertiser));
                      setEditingId(advertiser.advertiserId);
                      setShowForm(true);
                    }}
                    type="button"
                  >
                    설정 수정
                  </button>
                  <button
                    disabled={Boolean(working)}
                    onClick={() =>
                      void runAction(`toggle:${advertiser.advertiserId}`, async () => {
                        await api(
                          `/api/auto-production/advertisers/${encodeURIComponent(advertiser.advertiserId)}`,
                          {
                            method: "PATCH",
                            body: JSON.stringify({ enabled: !advertiser.enabled }),
                          }
                        );
                      })
                    }
                    type="button"
                  >
                    {advertiser.enabled ? "일시정지" : "재개"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </details>

      {previews.length ? (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>오늘 후보 미리보기</h2>
              <p>확인된 근거만 사용하며 판매성과를 임의로 예측하지 않습니다.</p>
            </div>
          </div>
          {previewTotal > settings.maxImagesPerDay ? (
            <p className={styles.error} role="alert">
              예상 {previewTotal}장으로 하루 자동 제작 한도 {settings.maxImagesPerDay}장을
              초과합니다. 실행 시 한도 내 상품만 안전하게 선정됩니다.
            </p>
          ) : null}
          <div className={styles.preview}>
            {previews.map((preview) => (
              <div className={styles.previewGroup} key={preview.advertiserId}>
                <strong>
                  {preview.advertiserName} · {preview.source} · 예상 {preview.expectedImages}장
                </strong>
                {preview.fallbackReason ? <p>{preview.fallbackReason}</p> : null}
                <ul className={styles.previewList}>
                  {preview.candidates.map((candidate) => (
                    <li key={candidate.id}>
                      <span>{candidate.productName}</span>
                      <small>
                        {roleLabels[candidate.recommendationRole]} ·{" "}
                        {candidate.recommendationReason}
                      </small>
                    </li>
                  ))}
                </ul>
                {preview.warnings.map((warning) => (
                  <p className={styles.error} key={warning}>
                    {warning}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className={styles.section} id="auto-production-results">
        <div className={styles.sectionHeader}>
          <div>
            <h2>최근 자동 제작 결과</h2>
            <p>광고주별 실행 상태와 완성 이미지를 확인하고 바로 다운로드할 수 있습니다.</p>
          </div>
        </div>
        <div className={styles.historyToolbar}>
          <div className={styles.periodButtons} aria-label="실행 날짜 범위" role="group">
            {([
              ["today", "오늘"],
              ["yesterday", "어제"],
              ["seven-days", "최근 7일"],
              ["custom", "기간 선택"],
              ["all", "전체"],
            ] as Array<[RunPeriod, string]>).map(([value, label]) => (
              <button
                aria-pressed={runPeriod === value}
                className={runPeriod === value ? styles.periodActive : undefined}
                key={value}
                onClick={() => setRunPeriod(value)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          {runPeriod === "custom" ? (
            <div className={styles.customDates}>
              <label>
                시작일
                <input
                  max={customTo}
                  onChange={(event) => setCustomFrom(event.target.value)}
                  type="date"
                  value={customFrom}
                />
              </label>
              <span>~</span>
              <label>
                종료일
                <input
                  min={customFrom}
                  onChange={(event) => setCustomTo(event.target.value)}
                  type="date"
                  value={customTo}
                />
              </label>
            </div>
          ) : null}
          <strong className={styles.historyCount}>실행 {runs.length}건</strong>
        </div>
        {!runs.length ? (
          <div className={styles.empty}>
            선택한 날짜에 자동 제작 기록이 없습니다.
          </div>
        ) : null}
        {runs.map((productionRun, runIndex) => {
          const reviewCount = productionRun.tasks
            .flatMap((task) => task.results)
            .filter((result) => ["quality-review", "korean-review", "product-review", "group-review"].includes(result.status)).length;
          const productCount = productionRun.tasks.length;
          return (
            <details className={styles.run} defaultOpen={runIndex === 0} key={productionRun.id}>
              <summary className={styles.runHeader}>
                <div>
                  <p className={styles.runDate}>{productionRun.businessDate} · {localDateTime(productionRun.startedAt)}</p>
                  <h3>{productionRun.advertiserName} 자동제작</h3>
                  <p>
                    상품 {productCount}개 · 완료 {productionRun.completedImages}/{productionRun.expectedImages}장
                    {reviewCount ? ` · 확인 필요 ${reviewCount}장` : ""}
                    {productionRun.failedImages ? ` · 실패 ${productionRun.failedImages}장` : ""}
                  </p>
                </div>
                <div className={styles.runSummaryRight}>
                  <span className={styles.status}>{runStatusLabels[productionRun.status]}</span>
                  <span className={styles.expandHint}>결과 펼치기</span>
                </div>
              </summary>
              <div className={styles.runBody}>
                <div className={styles.runActions}>
                  {productionRun.completedImages ? (
                    <a
                      className={styles.button}
                      href={`/api/auto-production/runs/${encodeURIComponent(productionRun.id)}/download`}
                    >
                      전체 {productionRun.completedImages}장 ZIP 다운로드
                    </a>
                  ) : null}
                  <a className={styles.buttonSecondary} href="/archive">
                    아카이브 보기
                  </a>
                  {productionRun.packageStatus === "building" || productionRun.packageStatus === "pending" ? (
                    <span className={styles.packagePending}>ZIP 준비 중</span>
                  ) : productionRun.packageStatus === "failed" ? (
                    <span className={styles.packagePending}>클릭 시 ZIP 다시 준비</span>
                  ) : null}
                  {!terminalRunStatuses.has(productionRun.status) ? (
                    <button
                      className={styles.buttonDanger}
                      disabled={Boolean(working)}
                      onClick={() =>
                        void runAction(`cancel:${productionRun.id}`, async () => {
                          await api(`/api/auto-production/runs/${encodeURIComponent(productionRun.id)}`, {
                            method: "PATCH",
                            body: JSON.stringify({ action: "cancel" }),
                          });
                        })
                      }
                      type="button"
                    >
                      제작 중지
                    </button>
                  ) : null}
                </div>

                <div className={styles.taskResults}>
                  {productionRun.tasks.map((task, taskIndex) => {
                    const downloadableCount = task.results.filter((result) => ["success", "approved"].includes(result.status)).length;
                    return (
                      <section className={styles.task} key={task.id}>
                        <header className={styles.taskOverview}>
                          {task.candidate.imageUrl ? (
                            <img alt="" src={task.candidate.imageUrl} />
                          ) : (
                            <div className={styles.placeholder}>상품</div>
                          )}
                          <div>
                            <p className={styles.taskNumber}>상품 {taskIndex + 1}</p>
                            <h4>{task.candidate.productName}</h4>
                            <div className={styles.taskChips}>
                              <span>{roleLabels[task.selectedRole]}</span>
                              <span>{sourceLabels[task.candidate.source]}</span>
                              <span>{productStatusLabels[task.status]}</span>
                            </div>
                          </div>
                          <div className={styles.taskActions}>
                            {downloadableCount ? (
                              <a
                                className={styles.buttonSecondary}
                                href={`/api/auto-production/runs/${encodeURIComponent(productionRun.id)}/products/${encodeURIComponent(task.id)}/download`}
                              >
                                상품 {downloadableCount}장 ZIP
                              </a>
                            ) : null}
                            <a
                              className={styles.productLink}
                              href={`/create-product?view=results&productUrl=${encodeURIComponent(task.candidate.productUrl)}${task.generationJobId ? `&jobId=${encodeURIComponent(task.generationJobId)}` : ""}`}
                            >
                              상세 제작 화면
                            </a>
                          </div>
                        </header>
                        <div className={styles.selectionReason}>
                          <strong>선정 이유</strong>
                          <span>{task.selectedReason}</span>
                        </div>
                        {task.results.length ? (
                          <div className={styles.imageResults} aria-label={`${task.candidate.productName} 자동제작 이미지`}>
                            {task.results.map((result, resultIndex) => (
                              <article className={styles.imageResult} key={result.generationResultId}>
                                {result.imageUrl ? (
                                  <a href={result.downloadUrl || result.imageUrl}>
                                    <img
                                      alt={`${task.candidate.productName} 광고 ${resultIndex + 1}`}
                                      loading="lazy"
                                      src={result.imageUrl}
                                    />
                                  </a>
                                ) : (
                                  <div className={styles.imagePending}>
                                    <span>{resultIndex + 1}</span>
                                    <strong>{resultStatusLabel(result.status)}</strong>
                                  </div>
                                )}
                                <div className={styles.imageMeta}>
                                  <span>{result.hookCode}</span>
                                  <strong>{resultStatusLabel(result.status)}</strong>
                                  {result.downloadUrl ? <a href={result.downloadUrl}>다운로드</a> : null}
                                </div>
                              </article>
                            ))}
                          </div>
                        ) : (
                          <div className={styles.taskEmpty}>{productStatusLabels[task.status]}</div>
                        )}
                        {task.error ? <p className={styles.error}>{task.error}</p> : null}
                      </section>
                    );
                  })}
                </div>
                {productionRun.warnings.length ? (
                  <details className={styles.runMessages}>
                    <summary>안내 및 제외 사유 {productionRun.warnings.length}건</summary>
                    {productionRun.warnings.map((warning) => <p key={warning}>{warning}</p>)}
                  </details>
                ) : null}
              </div>
            </details>
          );
        })}
      </section>
    </main>
  );
}
