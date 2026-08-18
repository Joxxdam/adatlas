"use client";

/* Runtime-generated and product-page images intentionally bypass Next image optimization. */
/* eslint-disable @next/next/no-img-element */

import JSZip from "jszip";
import { useEffect, useMemo, useRef, useState } from "react";
import { CreativeAssetActions, markCreativeAssetExported } from "../creative-assets/CreativeAssetActions";
import { getGenerationPlanSummary } from "../../../lib/mvp/adObjective";
import type { AdBrief, ProductInfoForPrompt } from "../../../lib/mvp/types";
import {
  CREATIVE_PLANNER_VERSION,
  type CopyPlan,
  type CreativeExplorationMode,
  type GenerationJob,
  type GenerationResult,
} from "../../../lib/creative-generation/types";
import { buildGenerationSummary } from "../../../lib/creative-generation/generationSummary";

type EditableCopy = Pick<CopyPlan, "headline" | "body" | "proof" | "offer" | "cta">;

type Props = {
  product: ProductInfoForPrompt;
  productImagePaths: string[];
  selectedAdImages: string[];
  logoPath?: string;
  adBrief: AdBrief;
  planConfirmed: boolean;
  productLoaded: boolean;
  source: "landing-page" | "user-input";
};

const storedJobKey = "daywiz-active-creative-job-id";
const legacyStoredJobKey = `adatlas-hook-experiment-job-id-${CREATIVE_PLANNER_VERSION}`;

const resultStatusLabels: Record<GenerationResult["status"], string> = {
  pending: "대기",
  running: "생성 중",
  success: "생성 완료",
  failed: "실패",
  cancelled: "취소됨",
  "korean-review": "한국어 검수 필요",
  "product-review": "상품 확인 필요",
  approved: "승인",
  excluded: "제외",
};

const generationStageLabels: Record<NonNullable<GenerationResult["generationStage"]>, string> = {
  planned: "장면 제작 대기",
  "scene-generating": "상세페이지 사진으로 전체 키비주얼 제작 중",
  compositing: "상품 동일성·구도 확인 중",
  "copy-rendering": "한국어 문구 적용 중",
  "quality-check": "품질 확인 중",
  completed: "제작 완료",
  "reference-preparing": "상품 사진 준비 중",
  "ai-generating": "후킹에 맞춰 완성 광고 AI 생성 중",
  "ai-revising": "AI가 문구·제품을 직접 수정 중",
  exporting: "1200×1200 JPG 검증·압축 중",
};

function requestId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function mergeResult(current: GenerationJob | null, incoming: GenerationJob, result?: GenerationResult) {
  if (!current || current.id !== incoming.id) return incoming;
  return {
    ...current,
    ...incoming,
    results: result
      ? current.results.map((item) => (item.id === result.id ? result : item))
      : incoming.results,
  };
}

function initialEdit(result: GenerationResult): EditableCopy {
  return {
    headline: result.hookPlan.headline,
    body: result.hookPlan.body,
    proof: result.hookPlan.proof,
    offer: result.hookPlan.offer,
    cta: result.hookPlan.cta,
  };
}

export function HookExperimentCreativeGenerator(props: Props) {
  const [job, setJob] = useState<GenerationJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [message, setMessage] = useState("상품정보를 확인하고 광고 목표와 제작 방식을 확정해 주세요.");
  const [edits, setEdits] = useState<Record<string, EditableCopy>>({});
  const generationModePreference = "ai-full-scene" as const;
  const [strategyVariation, setStrategyVariation] = useState(0);
  const [explorationMode, setExplorationMode] = useState<CreativeExplorationMode>("concept-exploration");
  const [engine, setEngine] = useState<"codex_local" | "openai_api">("codex_local");
  const [providerStatus, setProviderStatus] = useState("로컬 Codex 상태 확인 중…");
  const [latestCompletedResultId, setLatestCompletedResultId] = useState<string>();
  const [runnerActive, setRunnerActive] = useState(false);
  const previousPlanConfirmed = useRef(props.planConfirmed);
  const generationPlan = getGenerationPlanSummary(props.adBrief);
  const canGenerate = Boolean(props.product.productName.trim() && props.productImagePaths.length);
  const canStart = canGenerate && props.planConfirmed;
  const progress = useMemo(() => {
    if (!job) return { completed: 0, total: 6, success: 0, failed: 0 };
    return {
      completed: job.results.filter((result) => ["success", "failed", "korean-review", "product-review", "approved", "excluded"].includes(result.status)).length,
      total: job.results.length,
      success: job.results.filter((result) => result.status === "success" || result.status === "approved").length,
      failed: job.results.filter((result) => ["failed", "korean-review", "product-review"].includes(result.status)).length,
    };
  }, [job]);

  useEffect(() => {
    void fetch(`/api/codex/status?engine=${engine}`, { cache: "no-store" }).then(async (response) => {
      const payload = await response.json() as { status?: { detail?: string } };
      setProviderStatus(payload.status?.detail || (response.ok ? "사용 가능" : "사용 불가"));
    }).catch(() => setProviderStatus("연결 상태를 확인하지 못했습니다."));
  }, [engine]);
  const conceptMode = job
    ? job.creativePlan.mode === "concept-exploration"
    : explorationMode === "concept-exploration";
  async function refreshJob(jobId: string) {
    const response = await fetch(`/api/creative-generation/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store" });
    const payload = (await response.json()) as { ok?: boolean; job?: GenerationJob; error?: string; runnerActive?: boolean };
    if (!response.ok || !payload.job) throw new Error(payload.error || "작업 조회에 실패했습니다.");
    setJob(payload.job);
    setRunnerActive(Boolean(payload.runnerActive));
    window.localStorage.setItem(storedJobKey, payload.job.id);
    return payload.job;
  }

  useEffect(() => {
    let active = true;
    async function restore() {
      const queryJobId = new URLSearchParams(window.location.search).get("jobId");
      const storedId = queryJobId || window.localStorage.getItem(storedJobKey) || window.sessionStorage.getItem(legacyStoredJobKey);
      let targetId = storedId;
      if (!targetId) {
        const response = await fetch("/api/creative-generation/jobs/active", { cache: "no-store" });
        const payload = await response.json() as { activeJobs?: Array<{ jobId: string }> };
        targetId = payload.activeJobs?.[0]?.jobId || null;
      }
      if (!targetId || !active) return;
      const restored = await refreshJob(targetId);
      if (!active) return;
      setExplorationMode(restored.creativePlan.mode || "concept-exploration");
      setMessage("진행 중이던 광고 콘텐츠 작업을 불러왔습니다.");
      window.sessionStorage.removeItem(legacyStoredJobKey);
    }
    void restore().catch(() => {
      if (active) window.localStorage.removeItem(storedJobKey);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!job || !["pending", "running"].includes(job.status)) return;
    let active = true;
    let consecutiveErrors = 0;
    const poll = async () => {
      try {
        const refreshed = await refreshJob(job.id);
        consecutiveErrors = 0;
        if (!active) return;
        if (refreshed.status === "completed") setMessage(`광고 콘텐츠 ${refreshed.results.length}장이 완성됐어요.`);
        else if (refreshed.status === "partial") setMessage("완성된 광고를 확인하고 검수가 필요한 항목만 다시 제작할 수 있습니다.");
      } catch {
        consecutiveErrors += 1;
        if (consecutiveErrors >= 3 && active) setMessage("진행 상태 연결이 잠시 끊겼습니다. 작업은 서버에 저장되어 있습니다.");
      }
    };
    const interval = window.setInterval(() => {
      if (consecutiveErrors < 3) void poll();
    }, 2500);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
    // 동일 작업의 진행 상태만 polling하며 페이지 이동 시 타이머만 정리한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.status]);

  async function generateOne(
    activeJob: GenerationJob,
    resultId: string,
    copy?: EditableCopy,
    options: { regenerateScene?: boolean; action?: "generate" | "regenerate" | "revise"; feedback?: string } = {}
  ) {
    const generationRequestId = requestId();
    const response = await fetch(
      `/api/creative-generation/jobs/${encodeURIComponent(activeJob.id)}/results/${encodeURIComponent(resultId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(copy ? { copy } : {}),
          requestId: generationRequestId,
          regenerateScene: Boolean(options.regenerateScene),
          action: options.action || "generate",
          feedback: options.feedback,
        }),
      }
    );
    const payload = (await response.json()) as {
      ok?: boolean;
      job?: GenerationJob;
      result?: GenerationResult;
      error?: string;
    };
    if (payload.job) setJob((current) => mergeResult(current, payload.job!, payload.result));
    if (!response.ok || !payload.result) throw new Error(payload.error || "개별 광고 생성에 실패했습니다.");
    if (payload.result.status === "success") {
      setLatestCompletedResultId(payload.result.id);
      setMessage(`${payload.result.hookPlan.hookCode} 광고 콘텐츠를 완성해 화면에 전달했습니다.`);
    }
    return payload.result;
  }

  async function ensureResultAsset(activeJob: GenerationJob, result: GenerationResult) {
    if (result.creativeAsset) return result;
    const response = await fetch(
      `/api/creative-generation/jobs/${encodeURIComponent(activeJob.id)}/results/${encodeURIComponent(result.id)}/asset`,
      { method: "POST" }
    );
    const payload = (await response.json()) as {
      job?: GenerationJob;
      result?: GenerationResult;
      error?: string;
    };
    if (!response.ok || !payload.result?.creativeAsset) {
      throw new Error(payload.error || "기존 생성 결과의 소재코드 발급에 실패했습니다.");
    }
    if (payload.job) setJob(payload.job);
    return payload.result;
  }

  async function startGeneration(mode: "new" | "scene" = "new") {
    if (!canGenerate) {
      setMessage("상품정보와 실제 상품 이미지가 필요합니다.");
      return;
    }
    if (!props.planConfirmed) {
      setMessage("광고 목표와 제작 방식을 먼저 확정해 주세요.");
      return;
    }
    setLoading(true);
    setJob(null);
    setEdits({});
    setMessage(
      mode === "scene"
          ? "제품 모습은 유지하면서 후킹마다 다른 전체 콘텐츠를 다시 만들고 있어요."
        : "상품에 어울리는 광고 이미지를 만들고 있어요."
    );
    try {
      const response = await fetch("/api/creative-generation/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product: props.product,
          adBrief: props.adBrief,
          productImagePaths: props.productImagePaths,
          selectedAdImages: props.selectedAdImages,
          logoPath: props.logoPath,
          source: props.source,
          concurrency: 2,
          testCode: job?.creativePlan.testCode || "T01",
          generationModePreference,
          strategyVariation: mode === "scene" ? strategyVariation + 1 : strategyVariation,
          forceSceneRevision: mode === "scene",
          mode: "concept-exploration",
          engine,
        }),
      });
      const payload = (await response.json()) as { ok?: boolean; job?: GenerationJob; error?: string };
      if (!response.ok || !payload.job) throw new Error(payload.error || "후킹 실험 생성을 시작하지 못했습니다.");
      setJob(payload.job);
      setRunnerActive(true);
      setExplorationMode(payload.job.creativePlan.mode || explorationMode);
      if (mode === "scene") setStrategyVariation((current) => current + 1);
      window.localStorage.setItem(storedJobKey, payload.job.id);
      setMessage("광고 콘텐츠 생성을 시작했습니다. 다른 메뉴를 이용해도 백그라운드에서 계속 제작됩니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "후킹 실험 생성에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const becameConfirmed = !previousPlanConfirmed.current && props.planConfirmed;
    previousPlanConfirmed.current = props.planConfirmed;
    if (!becameConfirmed || job || loading || !canGenerate) return;
    void startGeneration();
    // startGeneration intentionally runs only when the confirmation edge changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canGenerate, job, loading, props.planConfirmed]);

  async function cancelJob() {
    if (!job) return;
    setLoading(true);
    const response = await fetch(`/api/creative-generation/jobs/${encodeURIComponent(job.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel" }),
    });
    const payload = (await response.json()) as { job?: GenerationJob; error?: string };
    if (payload.job) setJob(payload.job);
    setRunnerActive(false);
    setMessage(payload.error || "작업을 취소했습니다. 완료된 결과는 유지되며, 이미 시작한 한 장은 마무리될 수 있습니다.");
    setLoading(false);
  }

  async function resumeJob() {
    if (!job) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/creative-generation/jobs/${encodeURIComponent(job.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resume" }),
      });
      const payload = (await response.json()) as { job?: GenerationJob; error?: string };
      if (!response.ok || !payload.job) throw new Error(payload.error || "작업 재개 실패");
      setJob(payload.job);
      setRunnerActive(true);
      window.localStorage.setItem(storedJobKey, payload.job.id);
      setMessage("완료된 광고는 유지하고 중단된 카드부터 서버에서 생성을 재개합니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "작업 재개 실패");
    } finally {
      setLoading(false);
    }
  }

  async function retryResult(result: GenerationResult) {
    if (!job) return;
    setLoading(true);
    try {
      await generateOne(job, result.id, edits[result.id], { regenerateScene: true, action: "regenerate" });
      await refreshJob(job.id);
      setMessage(`${result.blueprintLabel} 카드를 다시 생성했습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "재생성 실패");
    } finally {
      setLoading(false);
    }
  }

  async function sendResultAction(result: GenerationResult, action: "approve" | "exclude" | "feedback", feedback?: string) {
    if (!job) return;
    const response = await fetch(`/api/creative-generation/jobs/${encodeURIComponent(job.id)}/results/${encodeURIComponent(result.id)}`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ action, feedback }) });
    const payload = await response.json() as { job?: GenerationJob; error?: string };
    if (!response.ok || !payload.job) throw new Error(payload.error || "피드백 저장 실패");
    setJob(payload.job);
    setMessage(action === "approve" ? "광고주 선호 방향으로 저장했습니다. 성과 데이터로 간주하지 않습니다." : action === "exclude" ? "다음 제작의 제외 방향으로 저장했습니다. 성과 데이터로 간주하지 않습니다." : "광고주 피드백을 저장했습니다.");
  }

  async function downloadAll(requireAllResults = false) {
    if (!job) return;
    const completedResults = job.results.filter((result) => result.status === "success" && result.imagePath);
    if (!completedResults.length || (requireAllResults && completedResults.length !== job.results.length)) return;
    setDownloading(true);
    try {
      const successes: GenerationResult[] = [];
      for (const result of completedResults) successes.push(await ensureResultAsset(job, result));
      const summaryJob: GenerationJob = {
        ...job,
        results: job.results.map(
          (result) => successes.find((success) => success.id === result.id) || result
        ),
      };
      const zip = new JSZip();
      await Promise.all(
        successes.map(async (result) => {
          const response = await fetch(`/api/creative-generation/jobs/${encodeURIComponent(job.id)}/results/${encodeURIComponent(result.id)}/download`);
          if (!response.ok) throw new Error(`${result.blueprintLabel} 다운로드 실패`);
          if (!result.creativeAsset) throw new Error(`${result.blueprintLabel} 소재코드가 없습니다.`);
          zip.file(result.creativeAsset.fileName, await response.blob());
          await markCreativeAssetExported(result.creativeAsset.assetCode);
        })
      );
      zip.file(
        "generation-summary.json",
        JSON.stringify(
          buildGenerationSummary(summaryJob),
          null,
          2
        )
      );
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `adatlas-${job.creativePlan.testCode}-${requireAllResults ? `all-${job.results.length}` : "passed"}-${job.id}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "전체 다운로드 실패");
    } finally {
      setDownloading(false);
    }
  }

  if (!props.productLoaded && !job) return null;
  const currentHookCode = job?.results.find((result) => result.status === "running")?.hookPlan.hookCode;
  const recoverable = Boolean(
    job &&
    job.status === "running" &&
    !runnerActive &&
    job.results.some((result) => result.status === "pending" || result.status === "running")
  );

  return (
    <section className="six-creative-generator" id="creative-results">
      <div className="six-creative-head">
        <div>
          <p className="eyebrow">3 · 광고 콘텐츠 생성</p>
          <h4>{generationPlan.objectiveLabel} 목표의 후킹별 AI 광고 만들기</h4>
          <p>후킹마다 장면·제품·한국어 문구·타이포그래피·레이아웃 전체를 AI가 별도로 완성합니다.</p>
          <label><span>생성 엔진</span><select value={engine} onChange={(event) => setEngine(event.target.value as "codex_local" | "openai_api")} disabled={loading}><option value="codex_local">Codex 로컬 로그인 (기본·API 키 미사용)</option><option value="openai_api">OpenAI 유료 API (명시 선택)</option></select><small>{providerStatus}</small></label>
          {engine === "openai_api" ? <p role="alert">유료 API를 명시적으로 선택했습니다. 기본 6회 이미지 생성과 품질 미달 이미지의 AI 수정 호출이 추가될 수 있으며, 자동 선택이나 자동 전환은 하지 않습니다.</p> : null}
        </div>
        <button disabled={!canStart || loading} onClick={() => void startGeneration()} type="button">
          {loading
            ? "작업 준비 중…"
            : props.planConfirmed
              ? job
                ? "후킹 광고 새로 만들기"
                : "후킹 6개로 광고 만들기"
              : "제작 계획을 먼저 확정해 주세요"}
        </button>
      </div>
      <div className="six-creative-plan-summary">
        <span><b>제작</b>후킹마다 전체 콘텐츠를 AI로 개별 생성</span>
        <span><b>보존</b>상세페이지 상품 형태·패키지·색상·확인된 사실</span>
        <span><b>전달</b>이미지·후킹·소재코드·광고명·UTM</span>
        <span><b>CTA</b>{generationPlan.cta}</span>
      </div>
      <div className="six-creative-status" role="status" aria-live="polite">
        <span>
          {job?.status === "running" && currentHookCode && runnerActive
            ? `광고 콘텐츠 생성 중 · ${currentHookCode} 제작 중 · ${progress.completed}/${progress.total} 완료`
            : recoverable
              ? "서버 실행이 멈춘 작업입니다. 중단 지점부터 재개할 수 있습니다."
              : message}
        </span>
        {job ? <strong>{progress.completed}/{progress.total} 완료 · 성공 {progress.success} · 실패 {progress.failed}</strong> : null}
      </div>
      {job ? <p className="six-creative-runtime-help">사이트 내 다른 메뉴를 이용해도 생성은 계속됩니다. 단, 개발 서버나 컴퓨터가 종료되면 작업이 일시 중단되며 다시 실행할 때 이어서 진행됩니다.</p> : null}
      {job ? (
        <>
          <div className="six-creative-progress" aria-label="광고 생성 진행률">
            <i style={{ width: `${Math.round((progress.completed / Math.max(1, progress.total)) * 100)}%` }} />
          </div>
          <div className="six-creative-actions">
            {(job.status === "running" || job.status === "pending") && !recoverable ? <button disabled={loading} onClick={() => void cancelJob()} type="button">생성 취소</button> : null}
            {job.status === "cancelled" || job.status === "partial" || job.status === "failed" || recoverable ? (
              <button disabled={loading} onClick={() => void resumeJob()} type="button">중단 지점부터 재개</button>
            ) : null}
            {job.status === "completed" ? <a href="#creative-results">결과 확인</a> : null}
            <button disabled={!progress.success || downloading} onClick={() => void downloadAll()} type="button">
              {downloading ? "ZIP 준비 중…" : `검수 완료 ${progress.success}장 ZIP 다운로드`}
            </button>
            <button disabled={progress.success !== progress.total || downloading} onClick={() => void downloadAll(true)} type="button">
              {conceptMode ? `광고 가설 ${progress.total}종 전체 ZIP` : `후킹 ${progress.total}종 전체 ZIP`}
            </button>
            <button disabled={loading} onClick={() => void startGeneration("scene")} type="button">전체 콘텐츠 새로 만들기</button>
          </div>
          <div className="hook-master-summary">
            <div>
              <strong>상품 원본</strong>
              {job.productTruth.confirmedProductImage ? <img alt="제작 기준 상품" src={job.productTruth.confirmedProductImage.path} /> : <span>확인 필요</span>}
              <small>제품 형태·패키지·색상 보존 기준</small>
            </div>
            <div>
              <strong>제작 방식</strong>
              <span>후킹별 AI 전체 콘텐츠</span>
              <small>기존 배경 라이브러리 미사용</small>
            </div>
            <div>
              <strong>상세페이지 레퍼런스</strong>
              <span>{job.productReferenceProfile?.referenceImages.length || job.productTruth.imageAssets.length}장 확인</span>
              <small>상품·사용·질감 사진을 제작 근거로 사용</small>
            </div>
            <div>
              <strong>개별 전달</strong>
              <span>이미지 + 후킹 + UTM</span>
              <small>완성된 카드부터 즉시 다운로드 가능</small>
            </div>
          </div>
          <div className="six-creative-grid">
            {job.results.map((result) => {
              const edit = edits[result.id] || initialEdit(result);
              return (
                <article className={`six-creative-card ${result.status} ${result.id === latestCompletedResultId ? "latest" : ""}`} key={result.id}>
                  <div className="six-creative-card-head">
                    <span>{result.hookPlan.hookCode}</span>
                    <div><strong>{conceptMode ? `광고 가설 ${result.order}` : result.hookPlan.hookType}</strong><small>{result.hookPlan.hypothesis}</small></div>
                    <b>{resultStatusLabels[result.status]}</b>
                  </div>
                  <div className="six-creative-preview">
                    {result.imagePath ? (
                      <img alt={`${result.blueprintLabel} 생성 결과`} src={result.imagePath} />
                    ) : (
                      <div>
                        <span>{result.generationStage ? generationStageLabels[result.generationStage] : result.status === "running" ? "렌더링 중" : "대기 중"}</span>
                        <small>{result.hookPlan.creativeBrief?.sceneDescription || result.scenePlan.sceneAsset.scene}</small>
                      </div>
                    )}
                  </div>
                  {result.qa ? (
                    <div className={`six-creative-qa ${result.qa.passed ? "pass" : "review"}`}>
                      이미지 품질 {result.qa.score}점 · {result.qa.width}×{result.qa.height} · {Math.ceil(result.qa.fileSizeBytes / 1024)}KB
                      <small>제품 확인 {result.masterScene?.productIdentityScore ?? job.masterScene?.productIdentityScore ?? "실제 상품 유지"}</small>
                    </div>
                  ) : null}
                  {result.nativeCreative?.validation ? (
                    <div className={`six-creative-qa ${["success", "approved"].includes(result.status) ? "pass" : "review"}`}>
                      한국어 {result.nativeCreative.validation.koreanTextAccuracy} · 상품 일치 {result.nativeCreative.validation.productIdentity} · 후킹 일치 {result.nativeCreative.validation.hookAlignment}
                      <small>
                        {result.nativeCreative.export
                          ? `${result.nativeCreative.export.width}×${result.nativeCreative.export.height} · ${Math.ceil(result.nativeCreative.export.fileSizeBytes / 1024)}KB · AI 수정 ${result.nativeCreative.revisionCount}회`
                          : `AI 수정 ${result.nativeCreative.revisionCount}회`}
                      </small>
                    </div>
                  ) : null}
                  <div className="hook-hypothesis">
                    <b>메인 후킹</b>
                    <strong>{result.hookPlan.headline}</strong>
                    <b>서브 문구</b>
                    <span>{result.hookPlan.body}</span>
                    {conceptMode ? <>
                      <b>선정 이유</b>
                      <span>{result.hookPlan.selectionReason}</span>
                      <b>광고 장면</b>
                      <span>{result.hookPlan.creativeBrief?.visualStory}</span>
                    </> : null}
                    <small>확인 근거 · {result.hookPlan.factIds.map((id) => job.productTruth.facts.find((fact) => fact.id === id)?.value).filter(Boolean).join(" · ") || "확인 가능한 상품 사실"}</small>
                  </div>
                  {result.error ? <p className="six-creative-error">{result.error}</p> : null}
                  {result.creativeAsset ? (
                    <CreativeAssetActions
                      asset={result.creativeAsset}
                      landingUrl={job.productTruth.product.landingUrl}
                      onMessage={setMessage}
                      downloadUrl={`/api/creative-generation/jobs/${encodeURIComponent(job.id)}/results/${encodeURIComponent(result.id)}/download`}
                    />
                  ) : result.imagePath && result.status === "success" ? (
                    <div className="creative-asset-migration">
                      <p>이전 생성 결과에는 아직 소재코드가 없습니다.</p>
                      <button
                        disabled={loading}
                        onClick={() => void ensureResultAsset(job, result).then(() => setMessage("소재코드를 발급했습니다.")).catch((error) => setMessage(error instanceof Error ? error.message : "소재코드 발급에 실패했습니다."))}
                        type="button"
                      >
                        소재코드 1회 발급
                      </button>
                    </div>
                  ) : null}
                  <div className="six-creative-card-actions">
                    <button disabled={loading || job.status === "cancelled"} onClick={() => void retryResult(result)} type="button">이 광고만 새 장면으로 재생성</button>
                    <button disabled={loading || !result.imagePath} onClick={() => job && void generateOne(job, result.id, undefined, { action: "revise", feedback: "한국어 철자·가독성·제품 동일성·상업 완성도를 검수 결과에 맞춰 수정" }).then(() => refreshJob(job.id)).catch((error) => setMessage(error instanceof Error ? error.message : "AI 수정 실패"))} type="button">이 광고만 AI로 수정</button>
                    <button disabled={!result.imagePath} onClick={() => void sendResultAction(result,"approve").catch((error)=>setMessage(error instanceof Error ? error.message : "승인 저장 실패"))} type="button">이 방향 승인</button>
                    <button disabled={!result.imagePath} onClick={() => void sendResultAction(result,"exclude").catch((error)=>setMessage(error instanceof Error ? error.message : "제외 저장 실패"))} type="button">다음 제작에서 제외</button>
                  </div>
                  <details className="six-creative-edit">
                    <summary>문구 수정·제작 정보 보기</summary>
                    {result.hookPlan.score ? <div className="hook-score-details">
                      <span>내부 태그 · {result.hookPlan.primaryTag}{result.hookPlan.secondaryTags?.length ? ` / ${result.hookPlan.secondaryTags.join(", ")}` : ""}</span>
                      <span>후보 점수 · {result.hookPlan.score.total}/100</span>
                      <span>근거 {result.hookPlan.score.evidenceStrength} · 구매이유 {result.hookPlan.score.purchaseReasonStrength} · 차별성 {result.hookPlan.score.distinctiveness} · 시각화 {result.hookPlan.score.visualizability} · 안전성 {result.hookPlan.score.claimSafety} · 과거 성과 보조값 {result.hookPlan.score.categoryPrior} · 새로움 {result.hookPlan.score.novelty}</span>
                    </div> : null}
                    {result.contentNoteCompliance ? <small>콘텐츠 참고사항 · {result.contentNoteCompliance.state === "passed" ? "준수" : result.contentNoteCompliance.state === "repaired" ? "자동 보정" : "확인 필요"}</small> : null}
                    {(["headline", "body"] as const).map((key) => (
                      <label key={key}>
                        <span>{key}</span>
                        <textarea
                          onChange={(event) => setEdits((current) => ({ ...current, [result.id]: { ...edit, [key]: event.target.value } }))}
                          rows={key === "headline" ? 2 : 1}
                          value={edit[key]}
                        />
                      </label>
                    ))}
                  </details>
                </article>
              );
            })}
          </div>
        </>
      ) : null}
    </section>
  );
}
