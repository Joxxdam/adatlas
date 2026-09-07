"use client";

/* Runtime-generated and product-page images intentionally bypass Next image optimization. */
/* eslint-disable @next/next/no-img-element */

import JSZip from "jszip";
import { useEffect, useMemo, useRef, useState } from "react";
import { CreativeAssetActions, markCreativeAssetExported } from "../creative-assets/CreativeAssetActions";
import type { AdBrief, ProductInfoForPrompt } from "../../../lib/mvp/types";
import { CREATIVE_PLANNER_VERSION, type GenerationJob, type GenerationJobSummary, type GenerationResult, type ManualGenerationQueueInfo, type ReferenceCategoryOverride } from "../../../lib/creative-generation/types";
import { CURRENT_REFERENCE_EDIT_JOB_VERSION, failedGenerationResultStatuses, normalizeCreativeProductUrl, terminalGenerationResultStatuses } from "../../../lib/creative-generation/jobRunnerPolicy";
import { ACTIVE_CREATIVE_JOB_STORAGE_KEY, activeCreativeProductJobStorageKey } from "../../../lib/creative-generation/activeCreativeJob.client";
import { numberedProductImageFileName, productDownloadStem } from "../../../lib/creative-generation/downloadNaming";
import { buildDefaultCodexGenerationPrompt, DEFAULT_CODEX_GENERATION_PIPELINE } from "../../../lib/creative-generation/codexDirectTest";

type Props = {
  analysisRevision: number;
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

const legacyStoredJobKey = `adatlas-hook-experiment-job-id-${CREATIVE_PLANNER_VERSION}`;

type ReferenceCategoryChoice = "" | ReferenceCategoryOverride;

const referenceCategoryOptions: Array<{ value: ReferenceCategoryOverride; label: string }> = [
  { value: "fashion", label: "패션" },
  { value: "food", label: "식품" },
  { value: "food-meat", label: "식품 · 육류" },
  { value: "food-snack", label: "식품 · 간식" },
  { value: "beauty", label: "화장품 · 건강/웰니스" },
];

function referenceCategoryLabel(value: ReferenceCategoryChoice) {
  if (value === "food-produce") return "식품 · 간식(기존 작업)";
  if (value === "food-other") return "식품(기존 작업)";
  return referenceCategoryOptions.find((option) => option.value === value)?.label || "자동 매칭";
}

function storedFoodSubcategoryLabel(value: string) {
  if (value === "meat") return "육류";
  if (value === "snack") return "간식";
  return "일반 식품";
}

const resultStatusLabels: Record<GenerationResult["status"], string> = {
  pending: "대기",
  running: "생성 중",
  success: "생성 완료",
  failed: "실패",
  cancelled: "취소됨",
  "korean-review": "한국어 검수 필요",
  "product-review": "상품 확인 필요",
  "quality-review": "품질 확인 필요",
  "group-review": "품질 확인 필요",
  approved: "승인",
  excluded: "제외",
};

const generationStageLabels: Record<NonNullable<GenerationResult["generationStage"]>, string> = {
  planned: "생성 대기",
  "reference-selecting": "참고 이미지 불러오는 중",
  "structure-recreating": "원본 구조 적용 중",
  "product-replacing": "상품 교체 중",
  "copy-replacing": "문구 교체 중",
  "qa-repairing": "품질 확인 중 · 치명 오류 1회 보정",
  "codex-direct-generating": "Codex에 선택 이미지와 프롬프트 전달 중",
  "scene-generating": "이전 작업 호환 처리 중",
  compositing: "이전 작업 호환 처리 중",
  "copy-rendering": "이전 작업 호환 처리 중",
  "quality-check": "품질 확인 중",
  completed: "완료",
  "reference-preparing": "상품 분석 중",
  "ai-generating": "AI 전체 광고 생성 중",
  "ai-revising": "AI 전체 광고 다시 생성 중",
  exporting: "1200×1200 다운로드 파일 준비 중",
};

const generationStageProgress: Record<NonNullable<GenerationResult["generationStage"]>, number> = {
  planned: 0,
  "reference-preparing": 5,
  "reference-selecting": 10,
  "structure-recreating": 28,
  "product-replacing": 52,
  "copy-replacing": 74,
  "qa-repairing": 86,
  "codex-direct-generating": 55,
  "quality-check": 90,
  exporting: 96,
  completed: 100,
  "scene-generating": 25,
  compositing: 55,
  "copy-rendering": 75,
  "ai-generating": 45,
  "ai-revising": 78,
};

function requestId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function mergeResult(current: GenerationJob | null, incoming: GenerationJob, result?: GenerationResult) {
  if (!current || current.id !== incoming.id) return incoming;
  return {
    ...current,
    ...incoming,
    results: result ? current.results.map((item) => (item.id === result.id ? result : item)) : incoming.results,
  };
}

function hasGenerationWorkRemaining(job: GenerationJob) {
  return Boolean(["pending", "running"].includes(job.status) && job.results.some((result) => ["pending", "running"].includes(result.status)));
}

function shouldPersistGenerationJob(job: GenerationJob) {
  return hasGenerationWorkRemaining(job);
}

export function ReferenceFirstCreativeGenerator(props: Props) {
  const [job, setJob] = useState<GenerationJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [startError, setStartError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [referenceCategoryOverride, setReferenceCategoryOverride] = useState<ReferenceCategoryChoice>("");
  const [message, setMessage] = useState("상품 상세페이지를 확인하면 같은 상품군의 ZIP 레퍼런스 6장으로 광고 제작을 시작할 수 있습니다.");
  const [feedbacks, setFeedbacks] = useState<Record<string, string>>({});
  const [directProductImagePath, setDirectProductImagePath] = useState("");
  const [directSupportingImagePath, setDirectSupportingImagePath] = useState("");
  const [directPackagingImagePath, setDirectPackagingImagePath] = useState("");
  const [directAdditionalInstructionsOverride, setDirectAdditionalInstructionsOverride] = useState<{ productUrl: string; value: string } | null>(null);
  const [providerStatus, setProviderStatus] = useState("로컬 Codex 상태 확인 중…");
  const [latestCompletedResultId, setLatestCompletedResultId] = useState<string>();
  const [runnerActive, setRunnerActive] = useState(false);
  const [manualQueue, setManualQueue] = useState<ManualGenerationQueueInfo>();
  const previousAnalysisRevision = useRef(props.analysisRevision);
  const creatingJob = useRef(false);
  const restoreRequestVersion = useRef(0);
  const restoredReferenceCategoryJobId = useRef("");
  const dismissedJobIds = useRef(new Set<string>());
  const activeJobIdRef = useRef("");
  const currentProductUrl = normalizeCreativeProductUrl(props.analyzedProductUrl);
  const previousAnalyzedProductUrl = useRef(currentProductUrl);
  const availableProductImagePaths = useMemo(
    () => Array.from(new Set([
      ...props.productImagePaths,
      ...(props.product.confirmedProductImagePaths || []),
      ...(props.product.productImagePaths || []),
      props.product.productImagePath,
      props.product.extractedMainImage,
      props.product.selectedSourceImagePath,
      ...(props.product.extractedGalleryImages || []),
      ...(props.product.sourceImageCandidates || []).map((candidate) => candidate.imagePath),
    ].filter((value): value is string => Boolean(value?.trim())))),
    [props.product, props.productImagePaths]
  );
  const storedProductImagePath = job?.codexDirectTest?.productImagePath || "";
  const storedSupportingImagePath = job?.codexDirectTest?.supportingImagePath || "";
  const storedPackagingImagePath = job?.codexDirectTest?.packagingImagePath || "";
  const storedAdditionalInstructions = job?.codexDirectTest?.additionalInstructions || "";
  const selectedDirectProductImagePath = availableProductImagePaths.includes(directProductImagePath || storedProductImagePath)
    ? directProductImagePath || storedProductImagePath
    : availableProductImagePaths[0] || "";
  const selectedDirectSupportingImagePath = availableProductImagePaths.includes(directSupportingImagePath || storedSupportingImagePath) && (directSupportingImagePath || storedSupportingImagePath) !== selectedDirectProductImagePath
    ? directSupportingImagePath || storedSupportingImagePath
    : "";
  const selectedDirectPackagingImagePath = availableProductImagePaths.includes(directPackagingImagePath || storedPackagingImagePath)
    && (directPackagingImagePath || storedPackagingImagePath) !== selectedDirectProductImagePath
    && (directPackagingImagePath || storedPackagingImagePath) !== selectedDirectSupportingImagePath
    ? directPackagingImagePath || storedPackagingImagePath
    : "";
  const directAdditionalInstructions = directAdditionalInstructionsOverride?.productUrl === currentProductUrl
    ? directAdditionalInstructionsOverride.value
    : storedAdditionalInstructions;
  const directPrompt = buildDefaultCodexGenerationPrompt({
    landingUrl: props.product.landingUrl || props.analyzedProductUrl,
    hasSupportingImage: Boolean(selectedDirectSupportingImagePath),
    hasPackagingImage: Boolean(selectedDirectPackagingImagePath),
  });
  const canGenerate = Boolean(props.product.productName.trim() && availableProductImagePaths.length);
  const defaultGenerationReady = Boolean(selectedDirectProductImagePath);
  const canStart = canGenerate && props.planConfirmed && defaultGenerationReady;
  const progress = useMemo(() => {
    if (!job) return { completed: 0, total: 6, success: 0, failed: 0 };
    return {
      completed: job.results.filter((result) => terminalGenerationResultStatuses.has(result.status)).length,
      total: job.results.length,
      success: job.results.filter((result) => Boolean(result.imagePath)).length,
      failed: job.results.filter((result) => !result.imagePath && failedGenerationResultStatuses.has(result.status)).length,
    };
  }, [job]);

  const generationPercent = useMemo(() => {
    if (!job?.results.length) return 0;
    const total = job.results.reduce((sum, result) => {
      if (terminalGenerationResultStatuses.has(result.status)) return sum + 100;
      return sum + generationStageProgress[result.generationStage || "planned"];
    }, 0);
    return Math.round(total / job.results.length);
  }, [job]);

  useEffect(() => {
    void fetch("/api/codex/status", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as { status?: { detail?: string } };
        setProviderStatus(payload.status?.detail || (response.ok ? "사용 가능" : "사용 불가"));
      })
      .catch(() => setProviderStatus("연결 상태를 확인하지 못했습니다."));
  }, []);

  useEffect(() => {
    activeJobIdRef.current = job?.id || "";
  }, [job?.id]);

  function chooseDirectSupportingImage(imagePath: string) {
    const next = selectedDirectSupportingImagePath === imagePath ? "" : imagePath;
    setDirectSupportingImagePath(next);
    if (next && selectedDirectPackagingImagePath === next) setDirectPackagingImagePath("");
  }

  function chooseDirectPackagingImage(imagePath: string) {
    const next = selectedDirectPackagingImagePath === imagePath ? "" : imagePath;
    setDirectPackagingImagePath(next);
    if (next && selectedDirectSupportingImagePath === next) setDirectSupportingImagePath("");
  }

  async function fetchJob(jobId: string) {
    const response = await fetch(`/api/creative-generation/jobs/${encodeURIComponent(jobId)}`, {
      cache: "no-store",
    });
    const payload = (await response.json()) as {
      ok?: boolean;
      job?: GenerationJob;
      error?: string;
      runnerActive?: boolean;
      manualQueue?: ManualGenerationQueueInfo;
    };
    if (!response.ok || !payload.job) throw new Error(payload.error || "작업 조회에 실패했습니다.");
    return { job: payload.job, runnerActive: Boolean(payload.runnerActive), manualQueue: payload.manualQueue };
  }

  function commitFetchedJob(payload: { job: GenerationJob; runnerActive: boolean; manualQueue?: ManualGenerationQueueInfo }) {
    if (dismissedJobIds.current.has(payload.job.id)) return;
    activeJobIdRef.current = payload.job.id;
    setJob(payload.job);
    setRunnerActive(payload.runnerActive);
    setManualQueue(payload.manualQueue);
    if (restoredReferenceCategoryJobId.current !== payload.job.id) {
      restoredReferenceCategoryJobId.current = payload.job.id;
      setReferenceCategoryOverride(payload.job.referenceCategoryOverride || "");
    }
    const restoredProductUrl = normalizeCreativeProductUrl(payload.job.productTruth.product.landingUrl);
    if (shouldPersistGenerationJob(payload.job)) {
      window.localStorage.setItem(ACTIVE_CREATIVE_JOB_STORAGE_KEY, payload.job.id);
      if (restoredProductUrl) window.localStorage.setItem(activeCreativeProductJobStorageKey(restoredProductUrl), payload.job.id);
    } else {
      window.localStorage.removeItem(ACTIVE_CREATIVE_JOB_STORAGE_KEY);
      if (restoredProductUrl) window.localStorage.removeItem(activeCreativeProductJobStorageKey(restoredProductUrl));
    }
  }

  async function refreshJob(jobId: string) {
    const payload = await fetchJob(jobId);
    commitFetchedJob(payload);
    return payload.job;
  }

  async function findActiveJobId(productUrl = "") {
    const query = productUrl ? `?productUrl=${encodeURIComponent(productUrl)}` : "";
    const response = await fetch(`/api/creative-generation/jobs/active${query}`, { cache: "no-store" });
    const payload = (await response.json()) as {
      activeJobs?: Array<{ jobId: string; productUrl: string; runnerActive: boolean }>;
    };
    const activeJobs = payload.activeJobs || [];
    const activeMatch = productUrl ? activeJobs.find((candidate) => normalizeCreativeProductUrl(candidate.productUrl) === productUrl) : activeJobs.find((candidate) => candidate.runnerActive) || activeJobs[0];
    if (activeMatch) return activeMatch.jobId;

    const recentResponse = await fetch("/api/creative-generation/jobs/recent?limit=10", { cache: "no-store" });
    const recentPayload = (await recentResponse.json()) as { jobs?: GenerationJobSummary[] };
    if (!recentResponse.ok) return null;
    const restorable = (recentPayload.jobs || []).filter((candidate) => candidate.sourceType !== "auto-production" && candidate.pipeline === DEFAULT_CODEX_GENERATION_PIPELINE && ["pending", "running"].includes(candidate.status) && candidate.generatedCount < candidate.totalCount);
    return (productUrl ? restorable.find((candidate) => normalizeCreativeProductUrl(candidate.productUrl) === productUrl) : restorable[0])?.jobId || null;
  }

  useEffect(() => {
    let active = true;
    const requestVersion = ++restoreRequestVersion.current;
    const isCurrentRequest = () => active && restoreRequestVersion.current === requestVersion;
    async function restore() {
      const queryJobId = new URLSearchParams(window.location.search).get("jobId");
      const productStoredJobId = currentProductUrl ? window.localStorage.getItem(activeCreativeProductJobStorageKey(currentProductUrl)) : null;
      const globalStoredJobId = window.localStorage.getItem(ACTIVE_CREATIVE_JOB_STORAGE_KEY);
      let targetId = queryJobId || productStoredJobId || globalStoredJobId;
      const restoringGlobalWithoutProduct = Boolean(!queryJobId && !productStoredJobId && globalStoredJobId && !currentProductUrl);
      if (targetId) {
        try {
          const restored = await fetchJob(targetId);
          if (!isCurrentRequest()) return;
          const restoredUrl = normalizeCreativeProductUrl(restored.job.productTruth.product.landingUrl);
          if ((Boolean(queryJobId) || restoringGlobalWithoutProduct || (currentProductUrl && restoredUrl === currentProductUrl)) && (Boolean(queryJobId) || shouldPersistGenerationJob(restored.job))) {
            commitFetchedJob(restored);
            setMessage("진행 중이던 광고 콘텐츠 작업을 불러왔습니다.");
            window.sessionStorage.removeItem(legacyStoredJobKey);
            return;
          }
        } catch {
          // 오래된 로컬 작업 ID는 지우고 서버에 저장된 활성 작업을 계속 조회합니다.
        }
        if (productStoredJobId === targetId && currentProductUrl) {
          window.localStorage.removeItem(activeCreativeProductJobStorageKey(currentProductUrl));
        }
        if (window.localStorage.getItem(ACTIVE_CREATIVE_JOB_STORAGE_KEY) === targetId) {
          window.localStorage.removeItem(ACTIVE_CREATIVE_JOB_STORAGE_KEY);
        }
        targetId = null;
      }
      if (!targetId) {
        targetId = await findActiveJobId(currentProductUrl);
      }
      if (!targetId || !isCurrentRequest()) return;
      const restored = await fetchJob(targetId);
      if (!isCurrentRequest()) return;
      const restoredUrl = normalizeCreativeProductUrl(restored.job.productTruth.product.landingUrl);
      if (currentProductUrl && restoredUrl !== currentProductUrl) return;
      commitFetchedJob(restored);
      setMessage("진행 중이던 광고 콘텐츠 작업을 불러왔습니다.");
      window.sessionStorage.removeItem(legacyStoredJobKey);
    }
    void restore().catch(() => undefined);
    return () => {
      active = false;
    };
  }, [currentProductUrl]);

  useEffect(() => {
    if (previousAnalysisRevision.current === props.analysisRevision) return;
    previousAnalysisRevision.current = props.analysisRevision;
    const previousUrl = previousAnalyzedProductUrl.current;
    previousAnalyzedProductUrl.current = currentProductUrl;
    // 사용자가 URL 분석을 다시 눌렀다는 것은 같은 URL 여부와 관계없이 새
    // 제작 흐름을 시작한다는 명시적 신호다. 기존 서버 작업은 기록·백그라운드
    // 실행을 보존하지만 이 화면에서는 다시 복원하지 않는다.
    restoreRequestVersion.current += 1;
    if (activeJobIdRef.current) dismissedJobIds.current.add(activeJobIdRef.current);
    activeJobIdRef.current = "";
    window.localStorage.removeItem(ACTIVE_CREATIVE_JOB_STORAGE_KEY);
    for (const productUrl of new Set([previousUrl, currentProductUrl].filter(Boolean))) {
      window.localStorage.removeItem(activeCreativeProductJobStorageKey(productUrl));
    }
    setJob(null);
    setStartError("");
    setRunnerActive(false);
    setManualQueue(undefined);
    setFeedbacks({});
    setReferenceCategoryOverride("");
    restoredReferenceCategoryJobId.current = "";
    setLatestCompletedResultId(undefined);
    setMessage("상품 분석을 다시 완료해 이전 제작 카드를 비웠습니다. 이 상품으로 새 광고 6장을 제작합니다.");
  }, [currentProductUrl, props.analysisRevision]);

  useEffect(() => {
    if (!job || !currentProductUrl) return;
    const currentUrl = currentProductUrl;
    const jobUrl = normalizeCreativeProductUrl(job.productTruth.product.landingUrl);
    if (!jobUrl || jobUrl === currentUrl) return;
    window.localStorage.removeItem(ACTIVE_CREATIVE_JOB_STORAGE_KEY);
    window.localStorage.removeItem(activeCreativeProductJobStorageKey(jobUrl));
    const resetTimer = window.setTimeout(() => {
      setJob(null);
      setStartError("");
      setManualQueue(undefined);
      setFeedbacks({});
      setReferenceCategoryOverride("");
      restoredReferenceCategoryJobId.current = "";
      setLatestCompletedResultId(undefined);
      setMessage("새 상품 분석이 완료되어 이전 상품의 생성 카드를 비웠습니다. 아카이브의 기존 결과는 유지됩니다.");
    }, 0);
    return () => window.clearTimeout(resetTimer);
  }, [currentProductUrl, job]);

  useEffect(() => {
    if (!job || (!["pending", "running"].includes(job.status) && !runnerActive)) return;
    let active = true;
    let consecutiveErrors = 0;
    const poll = async () => {
      try {
        const refreshed = await refreshJob(job.id);
        consecutiveErrors = 0;
        if (!active) return;
        if (refreshed.status === "cancelled" && currentProductUrl) {
          const activeJobId = await findActiveJobId(currentProductUrl);
          if (activeJobId && activeJobId !== refreshed.id) {
            const replacement = await fetchJob(activeJobId);
            if (!active) return;
            commitFetchedJob(replacement);
            setMessage("상품군 레퍼런스로 다시 시작한 최신 광고 작업을 불러왔습니다.");
            return;
          }
        }
        if (refreshed.results.every((result) => Boolean(result.imagePath))) setMessage(`광고 콘텐츠 ${refreshed.results.length}장이 완성됐어요. 바로 다운로드할 수 있습니다.`);
        else if (refreshed.status === "partial") setMessage("생성된 광고는 바로 다운로드할 수 있고, 이미지가 없는 항목만 다시 제작할 수 있습니다.");
      } catch {
        consecutiveErrors += 1;
        if (consecutiveErrors >= 3 && active) setMessage("진행 상태 연결이 잠시 끊겼습니다. 작업은 서버에 저장되어 있습니다.");
      }
    };
    const interval = window.setInterval(() => {
      void poll();
    }, 2500);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
    // 동일 작업의 진행 상태만 polling하며 페이지 이동 시 타이머만 정리한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.status, runnerActive]);

  async function generateOne(
    activeJob: GenerationJob,
    resultId: string,
    options: {
      regenerateScene?: boolean;
      action?: "generate" | "regenerate" | "regenerate-new-reference" | "revise";
      feedback?: string;
    } = {}
  ) {
    const generationRequestId = requestId();
    const response = await fetch(`/api/creative-generation/jobs/${encodeURIComponent(activeJob.id)}/results/${encodeURIComponent(resultId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId: generationRequestId,
        regenerateScene: Boolean(options.regenerateScene),
        action: options.action || "generate",
        feedback: options.feedback,
      }),
    });
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
      setMessage(`소재 ${String(payload.result.order).padStart(2, "0")}를 완성해 화면에 전달했습니다.`);
    }
    return payload.result;
  }

  async function ensureResultAsset(activeJob: GenerationJob, result: GenerationResult) {
    if (result.creativeAsset) return result;
    const response = await fetch(`/api/creative-generation/jobs/${encodeURIComponent(activeJob.id)}/results/${encodeURIComponent(result.id)}/asset`, { method: "POST" });
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
    if (creatingJob.current || (job && ["pending", "running"].includes(job.status) && runnerActive)) {
      setMessage("현재 광고 작업이 이미 생성 중입니다. 완료하거나 취소한 뒤 새로 만들어 주세요.");
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
    if (!defaultGenerationReady) {
      setMessage("Codex에 전달할 상품 이미지를 먼저 선택해 주세요.");
      return;
    }
    creatingJob.current = true;
    restoreRequestVersion.current += 1;
    setLoading(true);
    setStartError("");
    setJob(null);
    setManualQueue(undefined);
    setFeedbacks({});
    setMessage(mode === "scene"
      ? "호환 레퍼런스 6장을 새로 추첨해 Codex 광고 작업을 등록하고 있어요."
      : "선택한 상품 이미지와 프롬프트로 Codex 광고 작업을 등록하고 있어요.");
    try {
      const response = await fetch("/api/creative-generation/jobs", {
        method: "POST",
        // 개발 서버나 네트워크가 비정상 상태여도 버튼이 영구 로딩으로 남지
        // 않습니다. 정상 사전점검의 네트워크 상한보다 넉넉하게 두고, 서버가
        // 뒤늦게 저장한 작업은 전역 active polling이 다시 복원합니다.
        signal: AbortSignal.timeout(90_000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product: props.product,
          adBrief: props.adBrief,
          productImagePaths: availableProductImagePaths,
          selectedAdImages: props.selectedAdImages,
          logoPath: props.logoPath,
          source: props.source,
          referenceCategoryOverride: referenceCategoryOverride || undefined,
          concurrency: 3,
          codexDirectTest: {
            prompt: directPrompt,
            productImagePath: selectedDirectProductImagePath,
            supportingImagePath: selectedDirectSupportingImagePath || undefined,
            packagingImagePath: selectedDirectPackagingImagePath || undefined,
            additionalInstructions: directAdditionalInstructions.trim() || undefined,
          },
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        job?: GenerationJob;
        error?: string;
        runnerActive?: boolean;
        manualQueue?: ManualGenerationQueueInfo;
      };
      if (!response.ok || !payload.job) throw new Error(payload.error || "광고 제작을 시작하지 못했습니다.");
      setJob(payload.job);
      setStartError("");
      setRunnerActive(Boolean(payload.runnerActive));
      setManualQueue(payload.manualQueue);
      window.localStorage.setItem(ACTIVE_CREATIVE_JOB_STORAGE_KEY, payload.job.id);
      if (currentProductUrl) {
        window.localStorage.setItem(activeCreativeProductJobStorageKey(currentProductUrl), payload.job.id);
      }
      setMessage(payload.manualQueue?.state === "waiting"
        ? `수동 제작 대기 ${payload.manualQueue.waitingPosition || 1}번째로 등록됐습니다. 앞선 요청부터 순서대로 시작합니다.`
        : payload.runnerActive
        ? "Codex 광고 생성을 시작했습니다. 소재마다 새 스레드에 레퍼런스·상품·추가 참고 이미지와 프롬프트를 한 번 전달합니다."
        : "광고 작업은 저장됐지만 생성기가 아직 연결되지 않았습니다. 중단 지점부터 재개해 주세요.");
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError" || /timed?\s*out|시간.*초과/iu.test(error.message));
      const errorMessage = timedOut
        ? "서버가 90초 안에 작업 등록에 응답하지 못했습니다. 작업 등록 여부를 자동으로 다시 확인하며, 계속 표시되면 3000 서버 상태를 확인해 주세요."
        : error instanceof Error ? error.message : "광고 제작에 실패했습니다.";
      setStartError(errorMessage);
      setMessage(errorMessage);
    } finally {
      creatingJob.current = false;
      setLoading(false);
    }
  }

  async function cancelJob() {
    if (!job) return;
    const cancelledJobId = job.id;
    const cancelledProductUrl = normalizeCreativeProductUrl(job.productTruth.product.landingUrl);
    setLoading(true);
    try {
      const response = await fetch(`/api/creative-generation/jobs/${encodeURIComponent(cancelledJobId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      const payload = (await response.json()) as { job?: GenerationJob; error?: string };
      if (!response.ok || !payload.job) throw new Error(payload.error || "작업 취소에 실패했습니다.");

      dismissedJobIds.current.add(cancelledJobId);
      restoreRequestVersion.current += 1;
      if (window.localStorage.getItem(ACTIVE_CREATIVE_JOB_STORAGE_KEY) === cancelledJobId) {
        window.localStorage.removeItem(ACTIVE_CREATIVE_JOB_STORAGE_KEY);
      }
      for (const productUrl of new Set([currentProductUrl, cancelledProductUrl].filter(Boolean))) {
        const storageKey = activeCreativeProductJobStorageKey(productUrl);
        if (window.localStorage.getItem(storageKey) === cancelledJobId) window.localStorage.removeItem(storageKey);
      }
      const currentLocation = new URL(window.location.href);
      if (currentLocation.searchParams.get("jobId") === cancelledJobId) {
        currentLocation.searchParams.delete("jobId");
        window.history.replaceState(window.history.state, "", `${currentLocation.pathname}${currentLocation.search}${currentLocation.hash}`);
      }

      setJob(null);
      setStartError("");
      setRunnerActive(false);
      setManualQueue(undefined);
      setFeedbacks({});
      setLatestCompletedResultId(undefined);
      restoredReferenceCategoryJobId.current = "";
      setMessage("진행 중 작업을 취소했습니다. 완료된 결과는 아카이브에 유지되며, 지금 새 광고 제작을 시작할 수 있습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "작업 취소에 실패했습니다.");
    } finally {
      setLoading(false);
    }
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
      const payload = (await response.json()) as { job?: GenerationJob; error?: string; manualQueue?: ManualGenerationQueueInfo };
      if (!response.ok || !payload.job) throw new Error(payload.error || "작업 재개 실패");
      setJob(payload.job);
      setRunnerActive(true);
      setManualQueue(payload.manualQueue);
      window.localStorage.setItem(ACTIVE_CREATIVE_JOB_STORAGE_KEY, payload.job.id);
      setMessage("완료된 광고는 유지하고 중단된 카드부터 서버에서 생성을 재개합니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "작업 재개 실패");
    } finally {
      setLoading(false);
    }
  }

  async function startOrResumeGeneration(mode: "new" | "scene" = "new") {
    const jobUrl = normalizeCreativeProductUrl(job?.productTruth.product.landingUrl || "");
    const matchesCurrentProduct = Boolean(job && currentProductUrl && jobUrl === currentProductUrl);
    const usesRandomReferencePipeline = job?.version === CURRENT_REFERENCE_EDIT_JOB_VERSION && job?.pipeline === DEFAULT_CODEX_GENERATION_PIPELINE;
    const resumableStatus = Boolean(job && usesRandomReferencePipeline && ["pending", "running", "cancelled", "partial", "failed"].includes(job.status) && job.results.some((result) => ["pending", "running", "cancelled", "failed"].includes(result.status)));
    if (mode === "new" && matchesCurrentProduct && resumableStatus && !runnerActive) {
      await resumeJob();
      return;
    }
    await startGeneration(mode);
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

  async function retryResultWithNewReference(result: GenerationResult) {
    if (!job) return;
    setLoading(true);
    try {
      await generateOne(job, result.id, { action: "regenerate-new-reference" });
      await refreshJob(job.id);
      setMessage(`소재 ${String(result.order).padStart(2, "0")}에 다른 호환 레퍼런스를 배정해 다시 생성했습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "다른 레퍼런스 재생성 실패");
    } finally {
      setLoading(false);
    }
  }

  async function sendResultAction(result: GenerationResult, action: "approve" | "exclude" | "feedback" | "golden-reference", feedback?: string) {
    if (!job) return;
    const response = await fetch(`/api/creative-generation/jobs/${encodeURIComponent(job.id)}/results/${encodeURIComponent(result.id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, feedback }),
    });
    const payload = (await response.json()) as { job?: GenerationJob; error?: string };
    if (!response.ok || !payload.job) throw new Error(payload.error || "피드백 저장 실패");
    setJob(payload.job);
    setMessage(action === "approve" ? "광고주 선호 방향으로 저장했습니다. 성과 데이터로 간주하지 않습니다." : action === "exclude" ? "다음 제작의 제외 방향으로 저장했습니다. 성과 데이터로 간주하지 않습니다." : action === "golden-reference" ? "골든 레퍼런스로 등록했습니다. 다음 제작에서는 추상적인 스타일 특성만 참고합니다." : "광고주 피드백을 저장했습니다.");
  }

  async function downloadAll(requireAllResults = false) {
    if (!job) return;
    // finalPath는 서버 로컬 경로라 공개 작업 응답에서 의도적으로 제거됩니다.
    // 클라이언트는 공개 이미지 URL만 확인하고, 실제 원본 파일 검증은 다운로드 API가 담당합니다.
    const completedResults = job.results.filter((result) => Boolean(result.imagePath));
    if (!completedResults.length || (requireAllResults && completedResults.length !== job.results.length)) return;
    setDownloading(true);
    try {
      const successes: GenerationResult[] = [];
      for (const result of completedResults) successes.push(await ensureResultAsset(job, result));
      const zip = new JSZip();
      await Promise.all(
        successes.map(async (result, index) => {
          const response = await fetch(`/api/creative-generation/jobs/${encodeURIComponent(job.id)}/results/${encodeURIComponent(result.id)}/download`);
          if (!response.ok) throw new Error(`${result.blueprintLabel} 다운로드 실패`);
          if (!result.creativeAsset) throw new Error(`${result.blueprintLabel} 소재코드가 없습니다.`);
          zip.file(numberedProductImageFileName(job.productTruth.normalized?.cleanProductName || job.productTruth.product.productName, index + 1), await response.blob());
          await markCreativeAssetExported(result.creativeAsset.assetCode);
        })
      );
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${productDownloadStem(job.productTruth.normalized?.cleanProductName || job.productTruth.product.productName)}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
      window.localStorage.removeItem(ACTIVE_CREATIVE_JOB_STORAGE_KEY);
      if (currentProductUrl) window.localStorage.removeItem(activeCreativeProductJobStorageKey(currentProductUrl));
      setMessage("다운로드가 완료됐습니다. 같은 상품 URL을 다시 분석하면 새 광고 6장을 제작합니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "전체 다운로드 실패");
    } finally {
      setDownloading(false);
    }
  }

  if (!props.productLoaded && !job) return null;
  const awaitingReferenceConfirmation = Boolean(!job && !props.planConfirmed);
  const defaultCodexJob = job?.pipeline === DEFAULT_CODEX_GENERATION_PIPELINE;
  const historicalJob = Boolean(job && !defaultCodexJob);
  const recoverable = Boolean(job && defaultCodexJob && job.version === CURRENT_REFERENCE_EDIT_JOB_VERSION && ["pending", "running"].includes(job.status) && !runnerActive && job.results.some((result) => result.status === "pending" || result.status === "running"));
  const generationQueued = Boolean(job && ["pending", "running"].includes(job.status) && manualQueue?.state === "waiting");
  const generationInProgress = Boolean(job && ["pending", "running"].includes(job.status) && runnerActive && !generationQueued);
  const generationActive = generationQueued || generationInProgress;
  const storedReference = job?.results.find((result) => result.nativeCreative?.adReference)?.nativeCreative?.adReference;
  const selectedCategoryLabel = job?.referenceCategoryOverride
    ? referenceCategoryLabel(job.referenceCategoryOverride)
    : storedReference
      ? `${storedReference.categoryLabel}${storedReference.foodSubcategory ? ` · ${storedFoodSubcategoryLabel(storedReference.foodSubcategory)}` : ""} (자동)`
      : undefined;
  const activeResults = [...(job?.results || [])].filter((result) => result.status === "running").sort((left, right) => left.order - right.order);
  const completedResults = [...(job?.results || [])].filter((result) => Boolean(result.imagePath)).sort((left, right) => left.order - right.order);
  const visibleGeneratedResults = [...(job?.results || [])].filter((result) => Boolean(result.imagePath)).sort((left, right) => left.order - right.order);
  const attentionResults = [...(job?.results || [])].filter((result) => failedGenerationResultStatuses.has(result.status)).sort((left, right) => left.order - right.order);
  const attentionResultsWithoutImage = attentionResults.filter((result) => !result.imagePath);
  const missingImageResults = [...(job?.results || [])].filter((result) => !result.imagePath);
  const canCancelJob = Boolean(job && ["pending", "running"].includes(job.status) && missingImageResults.length > 0);
  const nextPendingResult = job?.results.filter((result) => result.status === "pending").sort((left, right) => left.order - right.order)[0];
  const currentOrder = activeResults[0]?.order || nextPendingResult?.order || Math.min(progress.completed + 1, progress.total);
  const allCreativesReady = Boolean(job && progress.total === 6 && completedResults.length === progress.total);
  const currentStage = activeResults[0]
      ? generationStageLabels[activeResults[0].generationStage || "planned"]
      : generationInProgress
        ? "다음 광고 준비 중"
        : "";
  const progressHeadline = loading && !job
    ? "광고 제작 작업을 등록하고 있습니다"
    : allCreativesReady
      ? "광고 6장이 모두 완성됐습니다"
      : generationQueued
        ? `수동 제작 대기 ${manualQueue?.waitingPosition || 1}번째입니다`
      : activeResults.length
        ? `${currentOrder}장째 광고를 제작 중입니다`
        : generationInProgress
          ? `${currentOrder}장째 광고 제작을 준비 중입니다`
          : recoverable
            ? "광고 생성이 잠시 멈췄습니다"
            : attentionResultsWithoutImage.length
              ? "다시 제작할 광고가 있습니다"
              : startError
                ? "광고 제작을 시작하지 못했습니다"
                : historicalJob
                  ? "구버전 제작 결과입니다"
                  : awaitingReferenceConfirmation
                    ? "자동 매칭을 확인·수정해 주세요"
                    : !job
                      ? "상품 이미지와 추가 사항을 확인해 주세요"
                      : message;

  return (
    <section className="six-creative-generator" id="creative-results">
      <div className={`simple-generation-status ${allCreativesReady ? "complete" : generationActive || loading ? "working" : ""} ${generationQueued ? "queued" : ""}`} role="status" aria-live="polite">
        <div className="simple-generation-status-icon" aria-hidden="true">
          {allCreativesReady ? "✓" : generationActive || loading ? <i /> : !job ? "⇄" : "!"}
        </div>
        <div>
          <p className="eyebrow">{historicalJob ? "이전 광고 제작 결과" : "기본 Codex 광고 제작 · 6장"}</p>
          <h4>{progressHeadline}</h4>
          <p>
            {allCreativesReady
              ? "완성된 광고를 확인한 뒤 한 번에 ZIP으로 내려받으세요."
              : generationQueued
                ? `현재 수동 요청 ${manualQueue?.totalCount || 1}건 · 앞에 ${manualQueue?.aheadCount || 0}건이 있습니다. 접수 순서대로 자동 시작됩니다.`
              : currentStage
                ? `${currentStage}${activeResults.length > 1 ? ` · ${activeResults.length}장 동시 처리 중` : ""}`
                : startError
                  ? startError
                  : awaitingReferenceConfirmation
                  ? "아래에서 자동 매칭을 그대로 쓰거나 다른 상품군으로 바꾼 뒤, 상품 선택을 완료해 주세요."
                  : historicalJob
                    ? "기존 결과는 그대로 열람·다운로드할 수 있습니다. 새 제작은 현재 기본 방식으로 시작됩니다."
                    : !job
                    ? loading ? message : "레퍼런스 상품군과 상품 이미지를 확인하고, 필요하면 추가/강조 사항을 입력한 뒤 제작 시작 버튼을 눌러주세요."
                    : message}
          </p>
        </div>
        <strong>{allCreativesReady ? "완료 6/6 · 다운로드 가능" : generationQueued ? `대기 ${manualQueue?.waitingPosition || 1}번째 · 앞선 요청 ${manualQueue?.aheadCount || 0}건` : !job ? "제작 전 · 수정 가능" : `현재 진행 ${Math.max(1, currentOrder)}/${progress.total} · 생성 완료 ${visibleGeneratedResults.length}/${progress.total}`}</strong>
      </div>
      {!job ? (
        <div className="codex-direct-test-panel">
          <div className="codex-direct-test-heading">
            <div>
              <strong>Codex에 전달할 상품 이미지 선택</strong>
              <small>첫 번째 첨부는 자동 추첨된 광고 레퍼런스입니다. 2번 상품 이미지는 필수이며, 3번 라벨·분위기와 4번 포장상품 이미지는 선택입니다.</small>
            </div>
            <span>수동·자동 공통 기본 방식</span>
          </div>
          <div className="codex-direct-test-images">
            {availableProductImagePaths.map((imagePath, index) => {
              const primary = selectedDirectProductImagePath === imagePath;
              const supporting = selectedDirectSupportingImagePath === imagePath;
              const packaging = selectedDirectPackagingImagePath === imagePath;
              return (
                <article className={primary || supporting || packaging ? "selected" : ""} key={`${imagePath}-${index}`}>
                  <img alt={`상세페이지 상품 후보 ${index + 1}`} src={imagePath} />
                  <div>
                    <button
                      className={primary ? "active" : ""}
                      onClick={() => {
                        setDirectProductImagePath(imagePath);
                        if (supporting) chooseDirectSupportingImage(imagePath);
                        if (packaging) chooseDirectPackagingImage(imagePath);
                      }}
                      type="button"
                    >
                      {primary ? "✓ 2번 상품 이미지" : "2번 상품 이미지"}
                    </button>
                    <button
                      className={supporting ? "active" : ""}
                      disabled={primary}
                      onClick={() => chooseDirectSupportingImage(imagePath)}
                      type="button"
                    >
                      {supporting ? "✓ 3번 추가 참고" : "3번 라벨·추가 참고"}
                    </button>
                    <button
                      className={packaging ? "active" : ""}
                      disabled={primary}
                      onClick={() => chooseDirectPackagingImage(imagePath)}
                      type="button"
                    >
                      {packaging ? "✓ 4번 포장상품" : "4번 포장상품"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          <label className="codex-direct-test-url">
            <span>선택 상품 URL · 자동 전달</span>
            <input readOnly value={props.product.landingUrl || props.analyzedProductUrl} />
          </label>
          <label className="codex-direct-test-prompt">
            <span>추가/강조 사항 <small>(선택)</small></span>
            <textarea
              maxLength={2_000}
              onChange={(event) => {
                setDirectAdditionalInstructionsOverride({ productUrl: currentProductUrl, value: event.target.value });
              }}
              placeholder="예: 선물용 구성을 더 강조해줘. 인물 대신 상품 마스코트 캐릭터로 표현해줘."
              rows={3}
              value={directAdditionalInstructions}
            />
            <small>입력한 내용은 이미지제작 6장에 동시에 적용됩니다.</small>
          </label>
          <p>실제 첨부 순서 · 1 광고 레퍼런스 → 2 상품 이미지{selectedDirectSupportingImagePath ? " → 3 라벨·추가 참고 이미지" : ""}{selectedDirectPackagingImagePath ? ` → ${selectedDirectSupportingImagePath ? "4" : "3"} 포장상품 이미지` : ""}</p>
        </div>
      ) : null}
      <div className="simple-reference-category-picker">
        <div>
          <strong>참고할 레퍼런스 상품군</strong>
          <small>제작 시작 전까지 자동 매칭을 그대로 쓰거나, 이번 6장에 사용할 레퍼런스 풀을 직접 바꿀 수 있습니다.</small>
        </div>
        <label>
          <span className="sr-only">참고할 레퍼런스 상품군 선택</span>
          <select
            aria-label="참고할 레퍼런스 상품군"
            disabled={loading || Boolean(job)}
            onChange={(event) => setReferenceCategoryOverride(event.target.value as ReferenceCategoryChoice)}
            value={referenceCategoryOverride}
          >
            <option value="">자동 매칭 (상품 분석 기준)</option>
            {referenceCategoryOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <p>
          {job
            ? `현재 작업은 ${selectedCategoryLabel || referenceCategoryLabel(referenceCategoryOverride)} 풀로 고정되어 있습니다.`
            : referenceCategoryOverride
              ? `${referenceCategoryLabel(referenceCategoryOverride)} 풀 안에서 상품 형태가 맞는 6장을 선택합니다.`
              : "상품명·카테고리·상품 형태를 분석해 가장 잘 맞는 풀을 자동 선택합니다."}
        </p>
      </div>
      {job ? (
        <>
          <div className="six-creative-progress" aria-label="광고 생성 진행률">
            <i
              className={generationInProgress ? "active" : ""}
              style={{
                width: `${generationInProgress ? Math.max(2, generationPercent) : generationPercent}%`,
              }}
            />
          </div>
          <ol className="simple-generation-steps" aria-label="광고 6장 제작 상태">
            {job.results.map((result) => {
              const active = result.status === "running";
              const done = Boolean(result.imagePath);
              const needsAttention = !result.imagePath && failedGenerationResultStatuses.has(result.status);
              return (
                <li className={done ? "done" : active ? "active" : needsAttention ? "attention" : "pending"} key={result.id}>
                  <span>{done ? "✓" : result.order}</span>
                  <b>{done ? "완료" : active ? "제작 중" : needsAttention ? "확인 필요" : "대기"}</b>
                </li>
              );
            })}
          </ol>
          <p className="six-creative-runtime-help">다른 메뉴로 이동해도 백그라운드에서 계속 제작되며, 완성된 광고는 한 장씩 바로 표시됩니다.</p>
          {canCancelJob || recoverable || (missingImageResults.length > 0 && ["cancelled", "partial", "failed"].includes(job.status)) ? (
            <div className="simple-generation-controls">
              {canCancelJob ? (
                <button disabled={loading} onClick={() => void cancelJob()} type="button">
                  진행 취소
                </button>
              ) : null}
              {recoverable || (missingImageResults.length > 0 && ["cancelled", "partial", "failed"].includes(job.status)) ? (
                <button disabled={loading} onClick={() => void resumeJob()} type="button">
                  이미지 없는 항목 다시 제작
                </button>
              ) : null}
            </div>
          ) : null}
          {visibleGeneratedResults.length ? (
            <div className="simple-completed-results">
              <div className="simple-completed-head">
                <div>
                  <span>생성된 광고</span>
                  <h5>{visibleGeneratedResults.length}/6장을 확인할 수 있습니다</h5>
                </div>
                <small>이미지가 만들어지는 즉시 표시되고 다운로드할 수 있습니다.</small>
              </div>
              <div className="six-creative-grid">
                {visibleGeneratedResults.map((result) => {
                  return (
                    <article className={`six-creative-card ${result.status} ${result.id === latestCompletedResultId ? "latest" : ""}`} key={result.id}>
                      <div className="six-creative-card-head">
                        <span>{result.order}</span>
                        <div>
                          <strong>소재 {String(result.order).padStart(2, "0")} 완성</strong>
                          <small>{defaultCodexJob ? "레퍼런스·선택 상품 이미지 기반" : result.hookPlan.headline}</small>
                        </div>
                        <b>{["quality-review", "group-review"].includes(result.status) ? "품질 확인 필요 · 다운로드 가능" : "다운로드 가능"}</b>
                      </div>
                      <div className="six-creative-preview">
                        <img alt={`${result.blueprintLabel} 생성 결과`} src={`${result.imagePath}?v=${encodeURIComponent(result.deliveryBranding?.updatedAt || result.completedAt || job.updatedAt)}`} />
                      </div>
                      <details className="six-creative-edit">
                        <summary>이 광고 수정·다운로드</summary>
                        {!defaultCodexJob ? (
                          <div className="hook-hypothesis">
                            <b>이전 작업 문구</b>
                            <strong>{result.hookPlan.headline}</strong>
                            <b>서브 문구</b>
                            <span>{result.hookPlan.body}</span>
                          </div>
                        ) : null}
                        {result.creativeAsset ? (
                          <CreativeAssetActions asset={result.creativeAsset} compact landingUrl={job.productTruth.product.landingUrl} onMessage={setMessage} downloadUrl={`/api/creative-generation/jobs/${encodeURIComponent(job.id)}/results/${encodeURIComponent(result.id)}/download`} />
                        ) : (
                          <div className="creative-asset-migration">
                            <button
                              disabled={loading}
                              onClick={() =>
                                void ensureResultAsset(job, result)
                                  .then(() => setMessage("소재코드를 발급했습니다."))
                                  .catch((error) => setMessage(error instanceof Error ? error.message : "소재코드 발급에 실패했습니다."))
                              }
                              type="button"
                            >
                              다운로드 준비
                            </button>
                          </div>
                        )}
                        <div className="six-creative-card-actions">
                          <button disabled={loading || historicalJob || job.status === "cancelled"} onClick={() => void retryResult(result)} type="button">
                            동일 레퍼런스로 다시 만들기
                          </button>
                          <button disabled={loading || historicalJob || job.status === "cancelled"} onClick={() => void retryResultWithNewReference(result)} type="button">
                            다른 레퍼런스로 다시 만들기
                          </button>
                          <label>
                            <span>광고 수정 요청</span>
                            <textarea
                              value={feedbacks[result.id] || ""}
                              onChange={(event) =>
                                setFeedbacks((current) => ({
                                  ...current,
                                  [result.id]: event.target.value,
                                }))
                              }
                              placeholder="예: 현재 레이아웃은 유지하고 상품만 조금 더 크게 보여줘"
                              rows={2}
                            />
                          </label>
                          <button
                            disabled={loading || historicalJob || !feedbacks[result.id]?.trim()}
                            onClick={() =>
                              void generateOne(job, result.id, {
                                action: "revise",
                                feedback: feedbacks[result.id].trim(),
                              })
                                .then(() => refreshJob(job.id))
                                .catch((error) => setMessage(error instanceof Error ? error.message : "광고 수정 실패"))
                            }
                            type="button"
                          >
                            수정 반영하기
                          </button>
                        </div>
                        {result.nativeCreative?.adReference ? (
                          <details className="six-creative-source-reference">
                            <summary>원본 레퍼런스 보기</summary>
                            {result.nativeCreative.adReference.publicPath ? (
                              <img alt={`소재 ${String(result.order).padStart(2, "0")} 원본 레퍼런스`} src={result.nativeCreative.adReference.publicPath} />
                            ) : null}
                            <small>{result.nativeCreative.adReference.sourceFile || result.nativeCreative.adReference.id}</small>
                          </details>
                        ) : null}
                        <div className="six-creative-card-actions">
                          <button disabled={!result.imagePath} onClick={() => void sendResultAction(result, "approve").catch((error) => setMessage(error instanceof Error ? error.message : "선호 결과 저장 실패"))} type="button">
                            선호 결과로 저장
                          </button>
                          <button disabled={!result.imagePath || !["success", "approved"].includes(result.status)} onClick={() => void sendResultAction(result, "golden-reference", feedbacks[result.id]?.trim()).catch((error) => setMessage(error instanceof Error ? error.message : "업체 레퍼런스 등록 실패"))} type="button">
                            업체 레퍼런스로 저장
                          </button>
                          <button disabled={!result.imagePath} onClick={() => void sendResultAction(result, "exclude").catch((error) => setMessage(error instanceof Error ? error.message : "제외 저장 실패"))} type="button">
                            다음 제작에서 제외
                          </button>
                        </div>
                      </details>
                    </article>
                  );
                })}
              </div>
            </div>
          ) : null}
          {attentionResultsWithoutImage.length ? (
            <div className="simple-generation-attention">
              <strong>{attentionResultsWithoutImage.length}장은 이미지 생성에 실패해 다시 제작해야 합니다.</strong>
              {attentionResultsWithoutImage.map((result) => (
                <div key={result.id}>
                  <span>
                    {result.order}장 · {resultStatusLabels[result.status]}
                    {result.error ? ` · ${result.error}` : ""}
                  </span>
                  <button disabled={loading} onClick={() => void retryResult(result)} type="button">
                    다시 만들기
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className={`simple-zip-download ${allCreativesReady ? "ready" : "locked"}`}>
            <div>
              <strong>{allCreativesReady ? "6장 ZIP 다운로드" : "생성된 이미지 ZIP 다운로드"}</strong>
              <small>{allCreativesReady ? "다운로드하면 이번 제작은 끝납니다. 같은 URL을 다시 분석하면 새로 제작합니다." : `현재 ${completedResults.length}장 생성 완료 · 6장이 모두 나오면 한 번에 받을 수 있습니다.`}</small>
            </div>
            <button disabled={!allCreativesReady || downloading} onClick={() => void downloadAll(true)} type="button">
              {downloading ? "ZIP 준비 중…" : "ZIP으로 받기"}
            </button>
          </div>
          <details className="six-creative-edit simple-generation-details">
            <summary>제작 정보와 고급 도구 보기</summary>
            <p>선택 카테고리 · {selectedCategoryLabel || "상품군 자동 분류"}</p>
            <p>{providerStatus}</p>
            {!historicalJob ? (
              <button disabled={loading || generationInProgress} onClick={() => void startGeneration("scene")} type="button">
                새 랜덤 레퍼런스로 6장 다시 만들기
              </button>
            ) : null}
          </details>
        </>
      ) : (
        <div className="simple-generation-preflight">
          <p>{props.planConfirmed ? `선택값 · ${referenceCategoryLabel(referenceCategoryOverride)}. 제작을 시작하면 이번 6장에는 이 설정이 고정됩니다.` : "위 상품 카드에서 ‘이 상품으로 광고 만들기’를 눌러 상품 선택을 완료하면 제작을 시작할 수 있습니다."}</p>
          {startError ? <p className="simple-generation-start-error" role="alert">{startError}</p> : null}
          <button className="simple-generation-start" disabled={!canStart || loading} onClick={() => void startOrResumeGeneration()} type="button">
            {loading ? "광고 제작 준비 중…" : props.planConfirmed ? "광고 6장 생성 시작" : "상품 선택 후 제작 가능"}
          </button>
        </div>
      )}
    </section>
  );
}

// 과거 import 경로 호환용 별칭입니다. 신규 화면과 작업은 기본 Codex 파이프라인을 사용합니다.
export const HookExperimentCreativeGenerator = ReferenceFirstCreativeGenerator;
