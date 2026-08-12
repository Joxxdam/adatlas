"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { GenerationJob } from "../../lib/creative-generation/types";
import type { ProductInfoForPrompt } from "../../lib/mvp/types";
import type {
  CreativeExperiment,
  ExperimentAnalysis,
  ExperimentAsset,
  ExperimentObjective,
  HookGroup,
  ObjectiveHookInsight,
  PerformanceRecord,
} from "../../lib/hook-experiments/types";
import styles from "./HookExperimentWorkspace.module.css";

type Snapshot = {
  experiment: CreativeExperiment;
  hookGroups: HookGroup[];
  experimentAssets: ExperimentAsset[];
  performanceRecords: PerformanceRecord[];
  analysis: ExperimentAnalysis | null;
};

type ExperimentResponse = {
  ok: boolean;
  error?: string;
  experiment?: Snapshot;
  job?: GenerationJob;
};

const objectiveLabels: Record<ExperimentObjective, string> = {
  AWR: "인지 · CPM",
  TRF: "트래픽 · 랜딩 조회 비용",
  SLS: "판매 · ROAS",
  ENG: "참여 · 참여당 비용",
  ETC: "기타 · CTR",
};

const emptyProduct: ProductInfoForPrompt = {
  productName: "",
  category: "",
  price: "",
  discountInfo: "",
  mainBenefit: "",
  targetCustomer: "",
  landingUrl: "",
  productImagePath: "",
  productImagePaths: [],
  backgroundImagePath: "",
  brandName: "",
  advertiserName: "",
};

function stageLabel(stage: CreativeExperiment["stage"]) {
  return stage === "DISCOVERY" ? "T01 탐색" : stage === "VALIDATION" ? "T02 검증" : "T03 고도화";
}

function readError(payload: { error?: string }, fallback: string) {
  return payload.error || fallback;
}

function metricText(value: number | null, name: string) {
  if (value === null) return "데이터 없음";
  if (/ROAS/.test(name)) return `${value.toFixed(2)}배`;
  if (/CTR|비율|도달률/.test(name)) return `${(value * 100).toFixed(2)}%`;
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

export function HookExperimentWorkspace() {
  const [draft, setDraft] = useState({
    advertiserName: "",
    brandName: "",
    originalHostProductNo: "",
    objective: "TRF" as ExperimentObjective,
    useControl: false,
    product: emptyProduct,
    metaTestPlan: {
      campaignName: "",
      adsetName: "",
      target: "",
      budgetPerHook: "",
      manager: "",
    },
  });
  const [experiments, setExperiments] = useState<Snapshot[]>([]);
  const [current, setCurrent] = useState<Snapshot | null>(null);
  const [job, setJob] = useState<GenerationJob | null>(null);
  const [insights, setInsights] = useState<ObjectiveHookInsight[]>([]);
  const [status, setStatus] = useState(
    "상품 URL 또는 상품 정보를 입력해 첫 탐색 실험을 시작하세요."
  );
  const [busy, setBusy] = useState<
    "loading" | "creating" | "extracting" | "generating" | "uploading" | "next" | null
  >("loading");
  const [progress, setProgress] = useState({ done: 0, total: 0, failed: 0 });
  const fileRef = useRef<HTMLInputElement>(null);

  const groupedAssets = useMemo(
    () =>
      current?.hookGroups.map((group) => ({
        group,
        assets: current.experimentAssets.filter((asset) => asset.hookGroupId === group.id),
      })) || [],
    [current]
  );

  async function refreshList(selectId?: string) {
    const response = await fetch("/api/hook-experiments", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok || !payload.ok)
      throw new Error(readError(payload, "실험 목록을 불러오지 못했습니다."));
    setExperiments(payload.experiments || []);
    const selected = (payload.experiments || []).find(
      (item: Snapshot) => item.experiment.id === selectId
    );
    if (selected) setCurrent(selected);
  }

  async function openExperiment(experimentId: string) {
    setBusy("loading");
    try {
      const response = await fetch(`/api/hook-experiments/${experimentId}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.ok)
        throw new Error(readError(payload, "실험을 불러오지 못했습니다."));
      setCurrent(payload.experiment);
      const generationJobId = payload.experiment.experiment.generationJobId;
      if (generationJobId) {
        const jobResponse = await fetch(`/api/creative-generation/jobs/${generationJobId}`, {
          cache: "no-store",
        });
        const jobPayload = await jobResponse.json();
        setJob(jobResponse.ok ? jobPayload.job : null);
      }
      setStatus(`${payload.experiment.experiment.experimentCode}를 불러왔습니다.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "실험 조회 실패");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetch("/api/hook-experiments", { cache: "no-store" }).then((response) => response.json()),
      fetch("/api/hook-experiments/insights", { cache: "no-store" }).then((response) =>
        response.json()
      ),
    ])
      .then(([experimentPayload, insightPayload]) => {
        if (cancelled) return;
        if (!experimentPayload.ok)
          throw new Error(readError(experimentPayload, "실험 목록을 불러오지 못했습니다."));
        setExperiments(experimentPayload.experiments || []);
        setInsights(insightPayload.insights || []);
      })
      .catch((error) => {
        if (!cancelled) setStatus(error instanceof Error ? error.message : "초기 데이터 조회 실패");
      })
      .finally(() => {
        if (!cancelled) setBusy(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function updateProduct<K extends keyof ProductInfoForPrompt>(
    key: K,
    value: ProductInfoForPrompt[K]
  ) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      product: { ...currentDraft.product, [key]: value },
    }));
  }

  async function extractProduct() {
    if (!draft.product.landingUrl.trim())
      return setStatus("상품 상세페이지 URL을 먼저 입력해 주세요.");
    setBusy("extracting");
    setStatus("공개 상세페이지에서 상품 사실과 이미지 후보를 확인하고 있습니다.");
    try {
      const response = await fetch("/api/extract/product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productUrl: draft.product.landingUrl }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(readError(payload, "상품 정보 추출 실패"));
      const info = payload.productInfo as Record<string, unknown>;
      const imagePaths = [
        info.mainImage,
        ...(Array.isArray(info.galleryImages) ? info.galleryImages : []),
      ].filter((value): value is string => typeof value === "string" && Boolean(value));
      setDraft((currentDraft) => ({
        ...currentDraft,
        brandName: String(info.brandName || currentDraft.brandName),
        product: {
          ...currentDraft.product,
          ...info,
          landingUrl: currentDraft.product.landingUrl,
          productName: String(info.productName || currentDraft.product.productName),
          category: String(info.category || currentDraft.product.category),
          price: String(info.price || currentDraft.product.price),
          discountInfo: String(info.discountInfo || currentDraft.product.discountInfo),
          mainBenefit: String(
            info.mainBenefit || info.extractedDescription || currentDraft.product.mainBenefit
          ),
          brandName: String(info.brandName || currentDraft.brandName),
          productImagePath: imagePaths[0] || currentDraft.product.productImagePath,
          productImagePaths: imagePaths.slice(0, 12),
          backgroundImagePath: "",
        } as ProductInfoForPrompt,
      }));
      setStatus(
        `상품정보와 이미지 ${imagePaths.length}개를 불러왔습니다. 확인 후 실험을 시작하세요.`
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "상품 정보 추출 실패");
    } finally {
      setBusy(null);
    }
  }

  async function createExperiment(event: FormEvent) {
    event.preventDefault();
    setBusy("creating");
    setStatus("8개 후킹과 16개 소재 계획을 만들고 있습니다.");
    try {
      const response = await fetch("/api/hook-experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          advertiserName: draft.advertiserName || draft.brandName,
          brandName: draft.brandName,
          originalHostProductNo: draft.originalHostProductNo,
          objective: draft.objective,
          stage: "DISCOVERY",
          useControl: draft.useControl,
          metaTestPlan: {
            ...draft.metaTestPlan,
            budgetPerHook: draft.metaTestPlan.budgetPerHook
              ? Number(draft.metaTestPlan.budgetPerHook)
              : undefined,
          },
          product: {
            ...draft.product,
            advertiserName: draft.advertiserName,
            brandName: draft.brandName,
            productImagePaths: draft.product.productImagePaths?.length
              ? draft.product.productImagePaths
              : [draft.product.productImagePath].filter(Boolean),
          },
        }),
      });
      const payload = (await response.json()) as ExperimentResponse;
      if (!response.ok || !payload.ok || !payload.experiment || !payload.job)
        throw new Error(readError(payload, "실험 생성 실패"));
      setCurrent(payload.experiment);
      setJob(payload.job);
      await refreshList(payload.experiment.experiment.id);
      setStatus(
        `${payload.experiment.experiment.experimentCode}: ${payload.experiment.experiment.totalAssetCount}개 제작 계획이 준비됐습니다.`
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "실험 생성 실패");
    } finally {
      setBusy(null);
    }
  }

  async function generateAll() {
    if (!current?.experiment.generationJobId || !job) return;
    const pending = job.results.filter((result) => result.status !== "success");
    if (!pending.length) return setStatus("모든 실험 소재가 이미 생성됐습니다.");
    setBusy("generating");
    setProgress({ done: 0, total: pending.length, failed: 0 });
    let cursor = 0;
    let failed = 0;
    const worker = async () => {
      while (cursor < pending.length) {
        const result = pending[cursor++];
        try {
          const response = await fetch(
            `/api/creative-generation/jobs/${job.id}/results/${result.id}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                requestId: `hook-experiment-${current.experiment.id}-${result.id}`,
              }),
            }
          );
          if (!response.ok) failed += 1;
        } catch {
          failed += 1;
        }
        setProgress((value) => ({ ...value, done: value.done + 1, failed }));
      }
    };
    await Promise.all([worker(), worker()]);
    await openExperiment(current.experiment.id);
    await refreshList(current.experiment.id);
    setBusy(null);
    setStatus(
      failed
        ? `${pending.length - failed}개 생성, ${failed}개 실패했습니다. 실패 소재만 다시 시도할 수 있습니다.`
        : `${pending.length}개 소재 생성이 완료됐습니다.`
    );
  }

  async function updateRegistration(relation: ExperimentAsset, registered: boolean) {
    if (!current) return;
    const response = await fetch(`/api/hook-experiments/${current.experiment.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update-registration",
        experimentAssetId: relation.id,
        changes: { hostingRegistrationStatus: registered ? "registered" : "not_registered" },
      }),
    });
    const payload = await response.json();
    if (!response.ok) return setStatus(readError(payload, "등록 상태 수정 실패"));
    await openExperiment(current.experiment.id);
  }

  async function linkExistingAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current) return;
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/hook-experiments/${current.experiment.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "link-asset",
        experimentAssetId: form.get("slot"),
        assetCode: form.get("assetCode"),
      }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) return setStatus(readError(payload, "기존 소재 연결 실패"));
    await openExperiment(current.experiment.id);
    setStatus("기존 소재를 이 실험에 연결했습니다. 소재코드는 변경하지 않았습니다.");
    event.currentTarget.reset();
  }

  async function saveRegistrationDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current) return;
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/hook-experiments/${current.experiment.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update-registration",
        experimentAssetId: form.get("relation"),
        changes: {
          hostingRegistrationStatus: form.get("hostingRegistrationStatus"),
          registeredHostProductNo: form.get("registeredHostProductNo"),
          cremaCollectionStatus: form.get("cremaCollectionStatus"),
          catalogProductId: form.get("catalogProductId"),
          productMatchStatus: form.get("productMatchStatus"),
          notes: form.get("notes"),
        },
      }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) return setStatus(readError(payload, "등록 상세 저장 실패"));
    await openExperiment(current.experiment.id);
    setStatus("호스팅·크리마 수집·상품 매칭 상태를 저장했습니다.");
  }

  async function uploadPerformance(event: FormEvent) {
    event.preventDefault();
    if (!current || !fileRef.current?.files?.[0])
      return setStatus("Meta 보고서 CSV 또는 XLSX 파일을 선택해 주세요.");
    setBusy("uploading");
    setStatus("광고 이름의 소재코드를 연결하고 원시 합계 기준으로 성과를 계산하고 있습니다.");
    try {
      const form = new FormData();
      form.set("file", fileRef.current.files[0]);
      const response = await fetch(`/api/hook-experiments/${current.experiment.id}/performance`, {
        method: "POST",
        body: form,
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(readError(payload, "성과 분석 실패"));
      setCurrent(payload.snapshot);
      setInsights(payload.insights || []);
      setStatus(
        `${payload.matching.total}행 중 ${payload.matching.matched}행 자동 연결 · ${payload.matching.unresolved}행 확인 필요`
      );
      await refreshList(current.experiment.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "성과 분석 실패");
    } finally {
      setBusy(null);
    }
  }

  async function connectPerformance(recordId: string, experimentAssetId: string) {
    if (!current || !experimentAssetId) return;
    const response = await fetch(`/api/hook-experiments/${current.experiment.id}/performance`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recordId, experimentAssetId }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) return setStatus(readError(payload, "수동 연결 실패"));
    setCurrent(payload.snapshot);
    setStatus("보고서 행을 소재에 연결하고 분석을 다시 계산했습니다.");
  }

  async function createNext() {
    if (!current) return;
    setBusy("next");
    try {
      const response = await fetch(`/api/hook-experiments/${current.experiment.id}/next`, {
        method: "POST",
      });
      const payload = (await response.json()) as ExperimentResponse;
      if (!response.ok || !payload.ok || !payload.experiment || !payload.job)
        throw new Error(readError(payload, "다음 실험 생성 실패"));
      setCurrent(payload.experiment);
      setJob(payload.job);
      await refreshList(payload.experiment.experiment.id);
      setStatus(
        `${stageLabel(payload.experiment.experiment.stage)} ${payload.experiment.experiment.totalAssetCount}개 계획을 만들었습니다.`
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "다음 실험 생성 실패");
    } finally {
      setBusy(null);
    }
  }

  const successful = job?.results.filter((result) => result.status === "success").length || 0;
  const unresolved =
    current?.performanceRecords.filter((record) => record.matchStatus !== "matched") || [];
  const verifiedInsights = insights.filter(
    (insight) =>
      insight.status === "VERIFIED" &&
      (!current || insight.objective === current.experiment.objective)
  );

  return (
    <main className={styles.workspace}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>HOOK EXPERIMENT LAB</p>
          <h1>후킹을 넓게 만들고, 실제 성과로 좁힙니다</h1>
          <p>콘텐츠는 목표에 종속하지 않습니다. 목표는 Meta 테스트와 성과 해석에만 적용됩니다.</p>
        </div>
        <div className={styles.flow} aria-label="실험 진행 단계">
          <span>1 · 8×2 탐색</span>
          <i>→</i>
          <span>2 · 3×6 검증</span>
          <i>→</i>
          <span>3 · 1×6 고도화</span>
        </div>
      </header>

      <div className={`${styles.notice} ${busy ? styles.running : ""}`} role="status">
        <span>{busy ? "진행 중" : "상태"}</span>
        {status}
        {busy === "generating" ? (
          <b>
            {progress.done}/{progress.total} · 실패 {progress.failed}
          </b>
        ) : null}
      </div>

      <section className={styles.layout}>
        <aside className={styles.history}>
          <div className={styles.sectionTitle}>
            <div>
              <small>EXPERIMENTS</small>
              <h2>실험 기록</h2>
            </div>
            <b>{experiments.length}</b>
          </div>
          <button
            className={!current ? styles.activeHistory : ""}
            onClick={() => {
              setCurrent(null);
              setJob(null);
            }}
            type="button"
          >
            + 새 T01 실험
          </button>
          {experiments.map((item) => (
            <button
              className={current?.experiment.id === item.experiment.id ? styles.activeHistory : ""}
              key={item.experiment.id}
              onClick={() => void openExperiment(item.experiment.id)}
              type="button"
            >
              <span>
                {stageLabel(item.experiment.stage)} · {item.experiment.objective}
              </span>
              <strong>{item.experiment.product.productName}</strong>
              <small>{item.experiment.status.replaceAll("_", " ")}</small>
            </button>
          ))}
        </aside>

        <div className={styles.content}>
          {!current ? (
            <form className={styles.card} onSubmit={createExperiment}>
              <div className={styles.cardHead}>
                <div>
                  <small>STEP 01</small>
                  <h2>첫 탐색 실험 설정</h2>
                  <p>실제 상품 사실을 기준으로 안전하게 적용 가능한 후킹 8개를 고릅니다.</p>
                </div>
                <span className={styles.countBadge}>16장</span>
              </div>
              <div className={styles.urlRow}>
                <label>
                  <span>상품 상세페이지 URL</span>
                  <input
                    onChange={(event) => updateProduct("landingUrl", event.target.value)}
                    placeholder="https://.../product/..."
                    type="url"
                    value={draft.product.landingUrl}
                  />
                </label>
                <button
                  disabled={Boolean(busy)}
                  onClick={() => void extractProduct()}
                  type="button"
                >
                  상품정보 불러오기
                </button>
              </div>
              <div className={styles.formGrid}>
                <label>
                  <span>광고주</span>
                  <input
                    onChange={(event) =>
                      setDraft((value) => ({ ...value, advertiserName: event.target.value }))
                    }
                    required
                    value={draft.advertiserName}
                  />
                </label>
                <label>
                  <span>브랜드</span>
                  <input
                    onChange={(event) =>
                      setDraft((value) => ({ ...value, brandName: event.target.value }))
                    }
                    required
                    value={draft.brandName}
                  />
                </label>
                <label>
                  <span>원본 호스팅사 상품번호</span>
                  <input
                    onChange={(event) =>
                      setDraft((value) => ({ ...value, originalHostProductNo: event.target.value }))
                    }
                    placeholder="예: 102938"
                    required
                    value={draft.originalHostProductNo}
                  />
                </label>
                <label>
                  <span>실제 테스트 목표</span>
                  <select
                    onChange={(event) =>
                      setDraft((value) => ({
                        ...value,
                        objective: event.target.value as ExperimentObjective,
                      }))
                    }
                    value={draft.objective}
                  >
                    {Object.entries(objectiveLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>상품명</span>
                  <input
                    onChange={(event) => updateProduct("productName", event.target.value)}
                    required
                    value={draft.product.productName}
                  />
                </label>
                <label>
                  <span>카테고리</span>
                  <input
                    onChange={(event) => updateProduct("category", event.target.value)}
                    required
                    value={draft.product.category}
                  />
                </label>
                <label>
                  <span>가격 · 사실 확인값</span>
                  <input
                    onChange={(event) => updateProduct("price", event.target.value)}
                    value={draft.product.price}
                  />
                </label>
                <label>
                  <span>대표 상품 이미지 URL/경로</span>
                  <input
                    onChange={(event) => updateProduct("productImagePath", event.target.value)}
                    required
                    value={draft.product.productImagePath}
                  />
                </label>
              </div>
              <details className={styles.details}>
                <summary>상품 메시지·타깃·할인 등 상세 정보</summary>
                <div className={styles.formGrid}>
                  <label>
                    <span>핵심 효용</span>
                    <textarea
                      onChange={(event) => updateProduct("mainBenefit", event.target.value)}
                      required
                      value={draft.product.mainBenefit}
                    />
                  </label>
                  <label>
                    <span>타깃 상황</span>
                    <textarea
                      onChange={(event) => updateProduct("targetCustomer", event.target.value)}
                      required
                      value={draft.product.targetCustomer}
                    />
                  </label>
                  <label>
                    <span>할인·구성 정보</span>
                    <input
                      onChange={(event) => updateProduct("discountInfo", event.target.value)}
                      value={draft.product.discountInfo}
                    />
                  </label>
                  <label className={styles.checkbox}>
                    <input
                      checked={draft.useControl}
                      onChange={(event) =>
                        setDraft((value) => ({ ...value, useControl: event.target.checked }))
                      }
                      type="checkbox"
                    />
                    <span>기존 소재 대조군 추가</span>
                  </label>
                  <label>
                    <span>Meta 캠페인명</span>
                    <input
                      onChange={(event) =>
                        setDraft((value) => ({
                          ...value,
                          metaTestPlan: { ...value.metaTestPlan, campaignName: event.target.value },
                        }))
                      }
                      value={draft.metaTestPlan.campaignName}
                    />
                  </label>
                  <label>
                    <span>광고세트명</span>
                    <input
                      onChange={(event) =>
                        setDraft((value) => ({
                          ...value,
                          metaTestPlan: { ...value.metaTestPlan, adsetName: event.target.value },
                        }))
                      }
                      value={draft.metaTestPlan.adsetName}
                    />
                  </label>
                  <label>
                    <span>동일 테스트 타깃</span>
                    <input
                      onChange={(event) =>
                        setDraft((value) => ({
                          ...value,
                          metaTestPlan: { ...value.metaTestPlan, target: event.target.value },
                        }))
                      }
                      value={draft.metaTestPlan.target}
                    />
                  </label>
                  <label>
                    <span>후킹당 예산</span>
                    <input
                      min="0"
                      onChange={(event) =>
                        setDraft((value) => ({
                          ...value,
                          metaTestPlan: {
                            ...value.metaTestPlan,
                            budgetPerHook: event.target.value,
                          },
                        }))
                      }
                      type="number"
                      value={draft.metaTestPlan.budgetPerHook}
                    />
                  </label>
                  <label>
                    <span>담당자</span>
                    <input
                      onChange={(event) =>
                        setDraft((value) => ({
                          ...value,
                          metaTestPlan: { ...value.metaTestPlan, manager: event.target.value },
                        }))
                      }
                      value={draft.metaTestPlan.manager}
                    />
                  </label>
                </div>
              </details>
              <div className={styles.formAction}>
                <p>목표가 달라도 같은 상품·후킹 메시지는 동일하게 생성됩니다.</p>
                <button disabled={Boolean(busy)} type="submit">
                  T01 후킹 8개 · 소재 16장 계획하기
                </button>
              </div>
            </form>
          ) : (
            <>
              <section className={styles.summaryCard}>
                <div>
                  <small>{current.experiment.experimentCode}</small>
                  <h2>{current.experiment.product.productName}</h2>
                  <p>
                    {stageLabel(current.experiment.stage)} ·{" "}
                    {objectiveLabels[current.experiment.objective]} · {current.experiment.hookCount}
                    개 후킹 × {current.experiment.variantsPerHook}장
                  </p>
                </div>
                <div className={styles.summaryStats}>
                  <span>
                    <b>{successful}</b>/{current.experiment.totalAssetCount}
                    <small>생성</small>
                  </span>
                  <span>
                    <b>{current.performanceRecords.length}</b>
                    <small>성과 행</small>
                  </span>
                  <span>
                    <b>{current.analysis?.comparable ? "가능" : "대기"}</b>
                    <small>비교</small>
                  </span>
                </div>
              </section>

              <section className={styles.card}>
                <div className={styles.cardHead}>
                  <div>
                    <small>STEP 02</small>
                    <h2>후킹별 콘텐츠 생성</h2>
                    <p>같은 후킹 안에서는 핵심 메시지를 유지하고 시각 표현만 바꿉니다.</p>
                  </div>
                  <button
                    disabled={Boolean(busy) || successful === current.experiment.totalAssetCount}
                    onClick={() => void generateAll()}
                    type="button"
                  >
                    {successful
                      ? "미완료 소재 다시 생성"
                      : `${current.experiment.totalAssetCount}장 생성 시작`}
                  </button>
                </div>
                <div className={styles.hookGrid}>
                  {groupedAssets.map(({ group, assets }) => {
                    const analysis = current.analysis?.groups.find(
                      (item) => item.hookGroupId === group.id
                    );
                    return (
                      <article className={styles.hookCard} key={group.id}>
                        <div className={styles.hookHead}>
                          <b>{group.hookCode}</b>
                          <div>
                            <strong>{group.hookType}</strong>
                            <small>
                              {assets.filter((asset) => asset.assetId).length}/{assets.length} 생성
                            </small>
                          </div>
                          {analysis?.rank ? <em>#{analysis.rank}</em> : null}
                        </div>
                        <p>{assets[0]?.mainMessage}</p>
                        <details>
                          <summary>가설·소재·등록 상태</summary>
                          <p>{group.hypothesis}</p>
                          <small>{group.recommendationReason}</small>
                          <ul>
                            {assets.map((asset) => {
                              const result = job?.results.find(
                                (item) => item.id === asset.generationResultId
                              );
                              return (
                                <li key={asset.id}>
                                  {result?.imagePath ? (
                                    // Generated assets are already optimized and can have runtime-only local paths.
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      alt={`${group.hookCode} ${asset.variant}`}
                                      src={result.imagePath}
                                    />
                                  ) : (
                                    <span className={styles.placeholder}>{asset.variant}</span>
                                  )}
                                  <div>
                                    <b>{asset.assetCode || `${group.hookCode}-${asset.variant}`}</b>
                                    <small>{asset.visualDirection.replaceAll("_", " ")}</small>
                                    {asset.assetId ? (
                                      <label className={styles.miniCheck}>
                                        <input
                                          checked={asset.hostingRegistrationStatus === "registered"}
                                          onChange={(event) =>
                                            void updateRegistration(asset, event.target.checked)
                                          }
                                          type="checkbox"
                                        />
                                        호스팅 등록 확인
                                      </label>
                                    ) : null}
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        </details>
                      </article>
                    );
                  })}
                </div>
              </section>

              <section className={styles.twoColumns}>
                <div className={styles.card}>
                  <div className={styles.cardHead}>
                    <div>
                      <small>STEP 03</small>
                      <h2>등록 패키지</h2>
                      <p>후킹 폴더·이미지·XLSX·CSV를 한 번에 받습니다.</p>
                    </div>
                  </div>
                  <a
                    className={styles.download}
                    href={`/api/hook-experiments/${current.experiment.id}/package`}
                  >
                    호스팅 등록 ZIP 다운로드
                  </a>
                  <p className={styles.help}>
                    외부 서비스에는 자동 등록하지 않습니다. ZIP의 권장 자체상품코드와 비노출
                    카테고리를 수동 등록하세요.
                  </p>
                  <details className={styles.details}>
                    <summary>기존 소재 재사용·등록 상태 상세 입력</summary>
                    <form className={styles.compactForm} onSubmit={linkExistingAsset}>
                      <strong>기존 소재를 빈 슬롯에 연결</strong>
                      <select name="slot" required defaultValue="">
                        <option value="">빈 소재 슬롯</option>
                        {current.experimentAssets
                          .filter((asset) => !asset.assetId)
                          .map((asset) => (
                            <option key={asset.id} value={asset.id}>
                              {asset.hookCode}-{asset.variant} · {asset.visualDirection}
                            </option>
                          ))}
                      </select>
                      <input name="assetCode" placeholder="AT-BRAND-PRODUCT-HOOK-T01-A" required />
                      <button type="submit">코드 변경 없이 연결</button>
                    </form>
                    <form className={styles.compactForm} onSubmit={saveRegistrationDetails}>
                      <strong>등록·수집·상품 매칭 상태</strong>
                      <select name="relation" required defaultValue="">
                        <option value="">생성/연결된 소재</option>
                        {current.experimentAssets
                          .filter((asset) => asset.assetId)
                          .map((asset) => (
                            <option key={asset.id} value={asset.id}>
                              {asset.assetCode}
                            </option>
                          ))}
                      </select>
                      <select name="hostingRegistrationStatus" defaultValue="not_registered">
                        <option value="not_registered">호스팅 미등록</option>
                        <option value="registered">호스팅 등록</option>
                        <option value="failed">등록 실패</option>
                      </select>
                      <input
                        name="registeredHostProductNo"
                        placeholder="등록된 호스팅사 상품번호"
                      />
                      <select name="cremaCollectionStatus" defaultValue="not_requested">
                        <option value="not_requested">크리마 수집 미요청</option>
                        <option value="pending">수집 대기</option>
                        <option value="collected">수집 완료</option>
                        <option value="failed">수집 실패</option>
                      </select>
                      <input name="catalogProductId" placeholder="카탈로그 상품 ID" />
                      <select name="productMatchStatus" defaultValue="not_checked">
                        <option value="not_checked">상품 매칭 미확인</option>
                        <option value="matched">매칭 완료</option>
                        <option value="needs_review">검토 필요</option>
                        <option value="not_found">찾지 못함</option>
                      </select>
                      <input name="notes" placeholder="비고" />
                      <button type="submit">상태 저장</button>
                    </form>
                  </details>
                </div>
                <form className={styles.card} onSubmit={uploadPerformance}>
                  <div className={styles.cardHead}>
                    <div>
                      <small>STEP 04</small>
                      <h2>Meta 성과 검증</h2>
                      <p>광고 이름에 소재코드가 포함된 CSV/XLSX를 업로드합니다.</p>
                    </div>
                  </div>
                  <input accept=".csv,.xlsx,.xls" ref={fileRef} type="file" />
                  <button disabled={Boolean(busy)} type="submit">
                    보고서 연결·분석
                  </button>
                </form>
              </section>

              {unresolved.length ? (
                <section className={styles.card}>
                  <div className={styles.cardHead}>
                    <div>
                      <small>MATCH REVIEW</small>
                      <h2>연결 확인이 필요한 보고서 {unresolved.length}행</h2>
                    </div>
                  </div>
                  <div className={styles.matchList}>
                    {unresolved.map((record) => (
                      <form
                        key={record.id}
                        onSubmit={(event) => {
                          event.preventDefault();
                          const select = new FormData(event.currentTarget).get("asset") as string;
                          void connectPerformance(record.id, select);
                        }}
                      >
                        <div>
                          <b>{record.adName || record.adId}</b>
                          <small>{record.matchMessage}</small>
                        </div>
                        <select name="asset" required defaultValue="">
                          <option value="">실험 소재 선택</option>
                          {current.experimentAssets
                            .filter((asset) => asset.assetId)
                            .map((asset) => (
                              <option key={asset.id} value={asset.id}>
                                {asset.assetCode}
                              </option>
                            ))}
                        </select>
                        <button type="submit">연결</button>
                      </form>
                    ))}
                  </div>
                </section>
              ) : null}

              {current.analysis ? (
                <section className={styles.card}>
                  <div className={styles.cardHead}>
                    <div>
                      <small>ANALYSIS</small>
                      <h2>
                        {current.analysis.comparable
                          ? "비교 가능한 실험 결과"
                          : "아직 우승 후킹을 정할 수 없습니다"}
                      </h2>
                      <p>
                        비율을 평균내지 않고 지출·노출·클릭·전환 원시 합계를 먼저 더해 계산했습니다.
                      </p>
                    </div>
                    {!current.analysis.needsMoreData &&
                    current.experiment.stage !== "REFINEMENT" ? (
                      <button
                        disabled={Boolean(busy)}
                        onClick={() => void createNext()}
                        type="button"
                      >
                        다음 회차 만들기
                      </button>
                    ) : null}
                  </div>
                  {current.analysis.warnings.length ? (
                    <ul className={styles.warnings}>
                      {current.analysis.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  ) : null}
                  <div className={styles.ranking}>
                    {current.analysis.groups.map((group) => (
                      <article key={group.hookGroupId}>
                        <span>#{group.rank || "–"}</span>
                        <div>
                          <strong>
                            {group.hookCode} · {group.hookType}
                          </strong>
                          <small>
                            {group.eligibleAssetCount}개 소재 기준 ·{" "}
                            {group.stability.replaceAll("_", " ")}
                          </small>
                        </div>
                        <b>
                          {metricText(group.primaryMetricValue, group.primaryMetric)}
                          <small>{group.primaryMetric}</small>
                        </b>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className={styles.card}>
                <div className={styles.cardHead}>
                  <div>
                    <small>OBJECTIVE LEARNING</small>
                    <h2>목표별 검증 학습</h2>
                    <p>
                      동일 조건의 적격 실험 3회·소재 6개 이상일 때만 VERIFIED 추천으로 승격합니다.
                    </p>
                  </div>
                </div>
                {verifiedInsights.length ? (
                  <div className={styles.insights}>
                    {verifiedInsights.map((insight) => (
                      <span key={insight.id}>
                        <b>{insight.hookCode}</b>
                        {insight.objective} · 신뢰 {insight.confidenceScore}%
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className={styles.empty}>
                    아직 VERIFIED 후킹이 없습니다. 초기 신호는 자동 제작 추천에 섞지 않습니다.
                  </p>
                )}
              </section>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
