"use client";

/* Runtime-generated and product-page images intentionally bypass Next image optimization. */
/* eslint-disable @next/next/no-img-element */

import JSZip from "jszip";
import { useEffect, useMemo, useRef, useState } from "react";
import { CreativeAssetActions, markCreativeAssetExported } from "../creative-assets/CreativeAssetActions";
import type { AdBrief, ProductInfoForPrompt } from "../../../lib/mvp/types";
import {
  CREATIVE_PLANNER_VERSION,
  type CopyPlan,
  type GenerationJob,
  type GenerationResult,
} from "../../../lib/creative-generation/types";
import { buildGenerationSummary } from "../../../lib/creative-generation/generationSummary";
import { ProductAdCopyPanel } from "../../ad-copy/ProductAdCopyPanel";
import { normalizeCreativeProductUrl } from "../../../lib/creative-generation/jobRunnerPolicy";

type Props = {
  product: ProductInfoForPrompt;
  productImagePaths: string[];
  selectedAdImages: string[];
  logoPath?: string;
  adBrief: AdBrief;
  analyzedProductUrl: string;
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
  "quality-review": "완성도 검토 필요",
  "group-review": "그룹 다양성 확인 필요",
  approved: "승인",
  excluded: "제외",
};

const generationStageLabels: Record<NonNullable<GenerationResult["generationStage"]>, string> = {
  planned: "생성 대기",
  "scene-generating": "이전 작업 호환 처리 중",
  compositing: "이전 작업 호환 처리 중",
  "copy-rendering": "이전 작업 호환 처리 중",
  "quality-check": "AI 완성 광고 검수 중",
  completed: "완료",
  "reference-preparing": "상품 분석 중",
  "ai-generating": "AI 전체 광고 생성 중",
  "ai-revising": "AI 전체 광고 다시 생성 중",
  exporting: "1200×1200 다운로드 파일 준비 중",
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

export function HookExperimentCreativeGenerator(props: Props) {
  const [job, setJob] = useState<GenerationJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [message, setMessage] = useState("상품 상세페이지를 확인하면 고유 후킹 6개와 광고 제작을 시작할 수 있습니다.");
  const [feedbacks, setFeedbacks] = useState<Record<string, string>>({});
  const [copyEdits, setCopyEdits] = useState<Record<string, Partial<CopyPlan>>>({});
  const [showMoreConcepts, setShowMoreConcepts] = useState(false);
  const generationModePreference = "ai-full-scene" as const;
  const [strategyVariation, setStrategyVariation] = useState(0);
  const [providerStatus, setProviderStatus] = useState("로컬 Codex 상태 확인 중…");
  const [latestCompletedResultId, setLatestCompletedResultId] = useState<string>();
  const [runnerActive, setRunnerActive] = useState(false);
  const previousPlanConfirmed = useRef(props.planConfirmed);
  const creatingJob = useRef(false);
  const currentProductUrl = normalizeCreativeProductUrl(props.analyzedProductUrl);
  const canGenerate = Boolean(props.product.productName.trim() && props.productImagePaths.length);
  const canStart = canGenerate && props.planConfirmed;
  const progress = useMemo(() => {
    if (!job) return { completed: 0, total: 6, success: 0, failed: 0 };
    return {
      completed: job.results.filter((result) => ["success", "failed", "korean-review", "product-review", "quality-review", "group-review", "approved", "excluded"].includes(result.status)).length,
      total: job.results.length,
      success: job.results.filter((result) => result.status === "success" || result.status === "approved").length,
      failed: job.results.filter((result) => ["failed", "korean-review", "product-review", "quality-review", "group-review"].includes(result.status)).length,
    };
  }, [job]);

  useEffect(() => {
    void fetch("/api/codex/status", { cache: "no-store" }).then(async (response) => {
      const payload = await response.json() as { status?: { detail?: string } };
      setProviderStatus(payload.status?.detail || (response.ok ? "사용 가능" : "사용 불가"));
    }).catch(() => setProviderStatus("연결 상태를 확인하지 못했습니다."));
  }, []);
  async function refreshJob(jobId: string) {
    const response = await fetch(`/api/creative-generation/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store" });
    const payload = (await response.json()) as { ok?: boolean; job?: GenerationJob; error?: string; runnerActive?: boolean };
    if (!response.ok || !payload.job) throw new Error(payload.error || "작업 조회에 실패했습니다.");
    setJob(payload.job);
    setRunnerActive(Boolean(payload.runnerActive));
    window.localStorage.setItem(storedJobKey, payload.job.id);
    const restoredProductUrl = normalizeCreativeProductUrl(payload.job.productTruth.product.landingUrl);
    if (restoredProductUrl) {
      window.localStorage.setItem(`${storedJobKey}:${restoredProductUrl}`, payload.job.id);
    }
    return payload.job;
  }

  useEffect(() => {
    let active = true;
    async function restore() {
      const queryJobId = new URLSearchParams(window.location.search).get("jobId");
      const productStoredJobId = currentProductUrl
        ? window.localStorage.getItem(`${storedJobKey}:${currentProductUrl}`)
        : null;
      let targetId =
        queryJobId || productStoredJobId || window.localStorage.getItem(storedJobKey);
      if (targetId) {
        try {
          const restored = await refreshJob(targetId);
          if (!active) return;
          const restoredUrl = normalizeCreativeProductUrl(restored.productTruth.product.landingUrl);
          if (!currentProductUrl || restoredUrl === currentProductUrl) {
            setMessage("진행 중이던 광고 콘텐츠 작업을 불러왔습니다.");
            window.sessionStorage.removeItem(legacyStoredJobKey);
            return;
          }
          setJob(null);
        } catch {
          // 오래된 로컬 작업 ID는 지우고 서버에 저장된 활성 작업을 계속 조회합니다.
        }
        if (productStoredJobId === targetId && currentProductUrl) {
          window.localStorage.removeItem(`${storedJobKey}:${currentProductUrl}`);
        }
        if (window.localStorage.getItem(storedJobKey) === targetId) {
          window.localStorage.removeItem(storedJobKey);
        }
        targetId = null;
      }
      if (!targetId && currentProductUrl) {
        const response = await fetch(
          `/api/creative-generation/jobs/active?productUrl=${encodeURIComponent(currentProductUrl)}`,
          { cache: "no-store" }
        );
        const payload = await response.json() as { activeJobs?: Array<{ jobId: string; productUrl: string }> };
        targetId = payload.activeJobs?.find(
          (candidate) => normalizeCreativeProductUrl(candidate.productUrl) === currentProductUrl
        )?.jobId || null;
      }
      if (!targetId || !active) return;
      await refreshJob(targetId);
      if (!active) return;
      setMessage("진행 중이던 광고 콘텐츠 작업을 불러왔습니다.");
      window.sessionStorage.removeItem(legacyStoredJobKey);
    }
    void restore().catch(() => undefined);
    return () => {
      active = false;
    };
  }, [currentProductUrl]);

  useEffect(() => {
    if (!job || !currentProductUrl) return;
    const currentUrl = currentProductUrl;
    const jobUrl = normalizeCreativeProductUrl(job.productTruth.product.landingUrl);
    if (!jobUrl || jobUrl === currentUrl) return;
    window.localStorage.removeItem(storedJobKey);
    window.localStorage.removeItem(`${storedJobKey}:${jobUrl}`);
    const resetTimer = window.setTimeout(() => {
      setJob(null);
      setFeedbacks({});
      setCopyEdits({});
      setLatestCompletedResultId(undefined);
      setMessage("새 상품 분석이 완료되어 이전 상품의 생성 카드를 비웠습니다. 아카이브의 기존 결과는 유지됩니다.");
    }, 0);
    return () => window.clearTimeout(resetTimer);
  }, [currentProductUrl, job]);

  useEffect(() => {
    if (!job || (!["pending", "running"].includes(job.status) && job.adCopy?.status !== "generating")) return;
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
  }, [job?.id, job?.status, job?.adCopy?.status]);

  async function generateOne(
    activeJob: GenerationJob,
    resultId: string,
    options: { regenerateScene?: boolean; action?: "generate" | "regenerate" | "revise" | "copy-update"; feedback?: string; copy?: Partial<CopyPlan> } = {}
  ) {
    const generationRequestId = requestId();
    const response = await fetch(
      `/api/creative-generation/jobs/${encodeURIComponent(activeJob.id)}/results/${encodeURIComponent(resultId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: generationRequestId,
          regenerateScene: Boolean(options.regenerateScene),
          action: options.action || "generate",
          feedback: options.feedback,
          copy: options.copy,
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
    if (creatingJob.current || job?.status === "pending" || job?.status === "running") {
      setMessage("현재 후킹 광고 작업이 이미 생성 중입니다. 완료하거나 취소한 뒤 새로 만들어 주세요.");
      return;
    }
    if (!canGenerate) {
      setMessage("상품정보와 실제 상품 이미지가 필요합니다.");
      return;
    }
    if (!props.planConfirmed) {
      setMessage("상세페이지 상품 분석을 먼저 완료해 주세요.");
      return;
    }
    creatingJob.current = true;
    setLoading(true);
    setJob(null);
    setFeedbacks({});
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
          concurrency: 3,
          testCode: job?.creativePlan.testCode || "T01",
          generationModePreference,
          strategyVariation: mode === "scene" ? strategyVariation + 1 : strategyVariation,
          forceSceneRevision: mode === "scene",
          mode: "concept-exploration",
        }),
      });
      const payload = (await response.json()) as { ok?: boolean; job?: GenerationJob; error?: string };
      if (!response.ok || !payload.job) throw new Error(payload.error || "후킹 실험 생성을 시작하지 못했습니다.");
      setJob(payload.job);
      setRunnerActive(true);
      if (mode === "scene") setStrategyVariation((current) => current + 1);
      window.localStorage.setItem(storedJobKey, payload.job.id);
      if (currentProductUrl) {
        window.localStorage.setItem(`${storedJobKey}:${currentProductUrl}`, payload.job.id);
      }
      setMessage("광고 콘텐츠 생성을 시작했습니다. 다른 메뉴를 이용해도 백그라운드에서 계속 제작됩니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "후킹 실험 생성에 실패했습니다.");
    } finally {
      creatingJob.current = false;
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
      await generateOne(job, result.id, { regenerateScene: true, action: "regenerate" });
      await refreshJob(job.id);
      setMessage(`${result.blueprintLabel} 카드를 다시 생성했습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "재생성 실패");
    } finally {
      setLoading(false);
    }
  }

  async function applyCopyUpdate(result: GenerationResult) {
    if (!job) return;
    setLoading(true);
    try {
      await generateOne(job, result.id, { action:"copy-update", copy:copyEdits[result.id] || {} });
      await refreshJob(job.id);
      setMessage(`${result.hookPlan.hookCode} 수정 문구로 전체 광고를 다시 생성했습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "문구 적용 실패");
    } finally {
      setLoading(false);
    }
  }

  async function sendResultAction(result: GenerationResult, action: "approve" | "exclude" | "feedback" | "golden-reference", feedback?: string) {
    if (!job) return;
    const response = await fetch(`/api/creative-generation/jobs/${encodeURIComponent(job.id)}/results/${encodeURIComponent(result.id)}`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ action, feedback }) });
    const payload = await response.json() as { job?: GenerationJob; error?: string };
    if (!response.ok || !payload.job) throw new Error(payload.error || "피드백 저장 실패");
    setJob(payload.job);
    setMessage(action === "approve" ? "광고주 선호 방향으로 저장했습니다. 성과 데이터로 간주하지 않습니다." : action === "exclude" ? "다음 제작의 제외 방향으로 저장했습니다. 성과 데이터로 간주하지 않습니다." : action === "golden-reference" ? "골든 레퍼런스로 등록했습니다. 다음 제작에서는 추상적인 스타일 특성만 참고합니다." : "광고주 피드백을 저장했습니다.");
  }

  async function downloadAll(requireAllResults = false) {
    if (!job) return;
    const completedResults = job.results.filter((result) => ["success", "approved"].includes(result.status) && result.imagePath);
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
      zip.file("manifest.json",JSON.stringify({
        version:"daywiz-creative-download-v2",
        jobId:job.id,
        productId:job.productTruth.productId,
        landingUrl:job.productTruth.product.landingUrl,
        productUrl:job.productTruth.product.landingUrl,
        productName:job.productTruth.normalized?.cleanProductName || job.productTruth.product.productName,
        exportedAt:new Date().toISOString(),
        files:successes.map((result)=>({
          fileName:result.creativeAsset?.fileName,
          creativeCode:result.creativeAsset?.assetCode,
          hookCode:result.hookPlan.hookCode,
          mainHook:result.hookPlan.headline,
          subCopy:result.hookPlan.body,
          materialCode:result.creativeAsset?.assetCode,
          creativeGrammar:result.hookPlan.creativeGrammarId || result.nativeCreative?.composition?.creativeGrammarId,
          utm:result.creativeAsset?.utmContent,
          createdAt:result.creativeAsset?.createdAt || result.completedAt,
        })),
        missing:job.results.filter((result)=>!successes.some((success)=>success.id===result.id)).map((result)=>({
          hookCode:result.hookPlan.hookCode,
          status:result.status,
          reason:result.error || "검수 완료 결과가 아닙니다.",
        })),
      },null,2));
      if (job.adCopy?.primaryText && job.adCopy.status !== "needs-review") {
        const copyResponse = await fetch(`/api/creative-generation/jobs/${encodeURIComponent(job.id)}/ad-copy?format=txt`);
        if (copyResponse.ok) zip.file("meta-primary-text.txt", await copyResponse.blob());
        const csvResponse = await fetch(`/api/creative-generation/jobs/${encodeURIComponent(job.id)}/ad-copy?format=csv`);
        if (csvResponse.ok) zip.file("meta-ad-settings.csv", await csvResponse.blob());
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `daywiz-${job.creativePlan.testCode}-${requireAllResults ? `all-${job.results.length}` : "passed"}-${job.id}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "전체 다운로드 실패");
    } finally {
      setDownloading(false);
    }
  }

  if (!props.productLoaded && !job) return null;
  const currentHookCodes = job?.results
    .filter((result) => result.status === "running")
    .map((result) => result.hookPlan.hookCode) || [];
  const recoverable = Boolean(
    job &&
    job.status === "running" &&
    !runnerActive &&
    job.results.some((result) => result.status === "pending" || result.status === "running")
  );
  const generationInProgress = Boolean(job && ["pending", "running"].includes(job.status));

  return (
    <section className="six-creative-generator" id="creative-results">
      <div className="six-creative-head">
        <div>
          <p className="eyebrow">3 · 광고 콘텐츠 생성</p>
          <h4>상세페이지 고유 후킹 6개로 AI 광고 만들기</h4>
          <p>상세페이지 근거에서 상품마다 다른 후킹 6개를 만들고, 장면·상품·정확한 한국어까지 완성 광고로 제작합니다.</p>
          <small>{providerStatus} · 후킹별 장면을 최대 3장 동시에 제작하며 완성된 카드부터 바로 보여드립니다.</small>
        </div>
        <button disabled={!canStart || loading || generationInProgress} onClick={() => void startGeneration()} type="button">
          {loading
            ? "작업 준비 중…"
            : generationInProgress
              ? "광고 생성 진행 중"
            : props.planConfirmed
              ? job
                ? "후킹 광고 새로 만들기"
                : "후킹 6개로 광고 만들기"
              : "상품 확인을 먼저 완료해 주세요"}
        </button>
      </div>
      <div className="six-creative-plan-summary">
        <span><b>제작</b>후킹마다 장면·제품 역할·타이포그래피가 다른 완성 광고</span>
        <span><b>참조</b>상세페이지 원본 상품·확인된 가격과 혜택</span>
        <span><b>전달</b>이미지·후킹·소재코드·광고명·UTM</span>
        <span><b>후킹</b>상세페이지 고유 근거·상황·감각·반전</span>
      </div>
      <div className="six-creative-status" role="status" aria-live="polite">
        <span>
          {job?.status === "running" && currentHookCodes.length && runnerActive
            ? `광고 콘텐츠 생성 중 · ${currentHookCodes.join(" · ")} ${currentHookCodes.length > 1 ? "병렬 " : ""}제작 중 · ${progress.completed}/${progress.total} 완료`
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
              {`후킹 ${progress.total}종 전체 ZIP`}
            </button>
            <button disabled={loading || generationInProgress} onClick={() => void startGeneration("scene")} type="button">전체 콘텐츠 새로 만들기</button>
          </div>
          <div className="hook-master-summary">
            <div>
              <strong>상품 원본</strong>
              {job.productTruth.confirmedProductImage ? <img alt="제작 기준 상품" src={job.productTruth.confirmedProductImage.path} /> : <span>확인 필요</span>}
              <small>제품 형태·패키지·색상 보존 기준</small>
            </div>
            <div>
              <strong>제작 방식</strong>
              <span>{job.creativePlan.categoryCreativeProfile?.label || "상품별"} 후킹 광고 6종</span>
              <small>상품·장면·한국어 카피·타이포그래피를 AI가 한 번에 완성</small>
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
          {job.groupValidation ? (
            <div className={`six-creative-qa ${job.groupValidation.recommendation === "approve" ? "pass" : "review"}`}>
              그룹 다양성 검수 · 장면 {job.groupValidation.sceneDiversity} · 배치 {job.groupValidation.productPlacementDiversity} · 카메라 {job.groupValidation.cameraDiversity} · 타이포 {job.groupValidation.typographyDiversity} · 문법 {job.groupValidation.visualArchetypeDiversity} · 메시지 분리 {job.groupValidation.messageSeparation}
              <small>{job.groupValidation.recommendation === "approve" ? "6개 후킹이 서로 다른 완성 광고로 확인됐습니다." : "중복 가능성이 있는 광고만 다시 만들거나 확인합니다."}</small>
            </div>
          ) : null}
          <div className="six-creative-actions">
            <button onClick={() => setShowMoreConcepts((value) => !value)} type="button">다른 콘셉트 더 보기</button>
          </div>
          {showMoreConcepts ? <div className="six-creative-plan-summary">
            <span>현재 6장은 가격·감각·상황·후기·기능·반전 중 상품 근거가 강한 방향을 우선 사용합니다.</span>
            <small>다른 콘셉트는 전체 새로 만들기에서 상품 근거를 다시 평가해 적용합니다.</small>
          </div> : null}
          <div className="six-creative-grid">
            {job.results.map((result) => {
              return (
                <article className={`six-creative-card ${result.status} ${result.id === latestCompletedResultId ? "latest" : ""}`} key={result.id}>
                  <div className="six-creative-card-head">
                    <span>{result.hookPlan.hookCode}</span>
                    <div><strong>후킹 콘텐츠 {result.order}</strong><small>{result.hookPlan.headline}</small></div>
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
                  <div className="hook-hypothesis">
                    <b>메인 후킹</b>
                    <strong>{result.hookPlan.headline}</strong>
                    <b>서브 문구</b>
                    <span>{result.hookPlan.body}</span>
                  </div>
                  {result.error ? <p className="six-creative-error">{result.error}</p> : null}
                  {result.creativeAsset ? (
                    <CreativeAssetActions
                      asset={result.creativeAsset}
                      compact
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
                    <button disabled={loading || job.status === "cancelled"} onClick={() => void retryResult(result)} type="button">이 콘텐츠 다시 만들기</button>
                    <label>
                      <span>장면 수정 요청</span>
                      <textarea value={feedbacks[result.id] || ""} onChange={(event) => setFeedbacks((current) => ({ ...current, [result.id]: event.target.value }))} placeholder="예: 제품을 더 크게, 모델 없이 시원한 샤워 장면으로 바꿔줘" rows={2} />
                    </label>
                    <button disabled={loading || !result.imagePath || !feedbacks[result.id]?.trim()} onClick={() => job && void generateOne(job, result.id, { action: "revise", feedback: feedbacks[result.id].trim() }).then(() => refreshJob(job.id)).catch((error) => setMessage(error instanceof Error ? error.message : "장면 수정 실패"))} type="button">장면 다시 만들기</button>
                  </div>
                  <details className="six-creative-edit">
                    <summary>문구 수정·검수 정보 보기</summary>
                    <div className="six-creative-copy-editor">
                      <label><span>메인 후킹</span><input value={copyEdits[result.id]?.headline ?? result.hookPlan.headline} onChange={(event)=>setCopyEdits((current)=>({...current,[result.id]:{...current[result.id],headline:event.target.value}}))} /></label>
                      <label><span>서브 문구</span><textarea rows={2} value={copyEdits[result.id]?.body ?? result.hookPlan.body} onChange={(event)=>setCopyEdits((current)=>({...current,[result.id]:{...current[result.id],body:event.target.value}}))} /></label>
                      <label><span>혜택·가격</span><input value={copyEdits[result.id]?.offer ?? result.hookPlan.offer} onChange={(event)=>setCopyEdits((current)=>({...current,[result.id]:{...current[result.id],offer:event.target.value}}))} /></label>
                      <label><span>CTA</span><input value={copyEdits[result.id]?.cta ?? result.hookPlan.cta} onChange={(event)=>setCopyEdits((current)=>({...current,[result.id]:{...current[result.id],cta:event.target.value}}))} /></label>
                      <button disabled={loading || !result.imagePath} onClick={()=>void applyCopyUpdate(result)} type="button">수정 문구로 전체 광고 재생성</button>
                      <small>사후 문구 합성 없이 상품·장면·문구·타이포그래피 전체를 AI가 새로 생성합니다.</small>
                    </div>
                    {result.nativeCreative?.validation ? <small>
                      자동 규격 검수 {result.nativeCreative.validation.failures.length ? "확인 필요" : "완료"} · 인물·손·질감은 최종 시각 검수 대기
                    </small> : null}
                    {result.contentNoteCompliance ? <small>콘텐츠 참고사항 · {result.contentNoteCompliance.state === "passed" ? "준수" : result.contentNoteCompliance.state === "repaired" ? "자동 보정" : "확인 필요"}</small> : null}
                    <div className="six-creative-card-actions">
                      <button disabled={!result.imagePath} onClick={() => void sendResultAction(result,"approve").catch((error)=>setMessage(error instanceof Error ? error.message : "선호 결과 저장 실패"))} type="button">선호 결과로 저장</button>
                      <button disabled={!result.imagePath || !["success", "approved"].includes(result.status)} onClick={() => void sendResultAction(result,"golden-reference", feedbacks[result.id]?.trim()).catch((error)=>setMessage(error instanceof Error ? error.message : "업체 레퍼런스 등록 실패"))} type="button">업체 레퍼런스로 저장</button>
                      <button disabled={!result.imagePath} onClick={() => void sendResultAction(result,"exclude").catch((error)=>setMessage(error instanceof Error ? error.message : "제외 저장 실패"))} type="button">다음 제작에서 제외</button>
                    </div>
                  </details>
                </article>
              );
            })}
          </div>
          <details className="six-creative-edit six-creative-meta-copy">
            <summary>Meta 광고 문구·광고명·UTM 만들기</summary>
            <ProductAdCopyPanel adCopy={job.adCopy} jobId={job.id} onChanged={(changed) => setJob(changed)} productName={job.productTruth.product.productName} />
          </details>
        </>
      ) : null}
    </section>
  );
}
