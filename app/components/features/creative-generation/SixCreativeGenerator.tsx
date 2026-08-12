"use client";

import JSZip from "jszip";
import { useEffect, useMemo, useRef, useState } from "react";
import { CreativeAssetActions, markCreativeAssetExported } from "../creative-assets/CreativeAssetActions";
import { getGenerationPlanSummary } from "../../../lib/mvp/adObjective";
import type { AdBrief, ProductInfoForPrompt } from "../../../lib/mvp/types";
import {
  CREATIVE_PLANNER_VERSION,
  type CopyPlan,
  type GenerationJob,
  type GenerationResult,
} from "../../../lib/creative-generation/types";

type EditableCopy = Pick<CopyPlan, "headline" | "body" | "proof" | "offer" | "cta">;

type Props = {
  product: ProductInfoForPrompt;
  productImagePaths: string[];
  selectedAdImages: string[];
  logoPath?: string;
  adBrief: AdBrief;
  planConfirmed: boolean;
  source: "landing-page" | "user-input";
};

const storedJobKey = `adatlas-six-creative-job-id-${CREATIVE_PLANNER_VERSION}`;

const resultStatusLabels: Record<GenerationResult["status"], string> = {
  pending: "대기",
  running: "생성 중",
  success: "생성 완료",
  failed: "실패",
  cancelled: "취소됨",
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

export function SixCreativeGenerator(props: Props) {
  const [job, setJob] = useState<GenerationJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [message, setMessage] = useState("상품정보를 확인하고 광고 목표와 제작 방식을 확정해 주세요.");
  const [edits, setEdits] = useState<Record<string, EditableCopy>>({});
  const cancelRequested = useRef(false);
  const briefKey = JSON.stringify({
    objective: props.adBrief.adObjective,
    approach: props.adBrief.creativeIntensity,
    emphasis: props.adBrief.additionalEmphasis || "",
    mandatory: props.adBrief.mandatoryInfo,
    prohibited: props.adBrief.prohibitedClaims,
  });
  const productKey = `${props.product.landingUrl}|${props.product.productName}|${briefKey}`;
  const generationPlan = getGenerationPlanSummary(props.adBrief);
  const canGenerate = Boolean(props.product.productName.trim() && props.productImagePaths.length);
  const canStart = canGenerate && props.planConfirmed;
  const progress = useMemo(() => {
    if (!job) return { completed: 0, total: 6, success: 0, failed: 0 };
    return {
      completed: job.results.filter((result) => ["success", "failed", "cancelled"].includes(result.status)).length,
      total: job.results.length,
      success: job.results.filter((result) => result.status === "success").length,
      failed: job.results.filter((result) => result.status === "failed").length,
    };
  }, [job]);

  async function refreshJob(jobId: string) {
    const response = await fetch(`/api/creative-generation/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store" });
    const payload = (await response.json()) as { ok?: boolean; job?: GenerationJob; error?: string };
    if (!response.ok || !payload.job) throw new Error(payload.error || "작업 조회에 실패했습니다.");
    setJob(payload.job);
    return payload.job;
  }

  useEffect(() => {
    let active = true;
    const storedId = window.sessionStorage.getItem(storedJobKey);
    if (!storedId) return;
    void fetch(`/api/creative-generation/jobs/${encodeURIComponent(storedId)}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { job?: GenerationJob }) => {
        if (!active || !payload.job) return;
        const sameProduct =
          payload.job.productTruth.product.productName === props.product.productName &&
          payload.job.productTruth.product.landingUrl === props.product.landingUrl;
        const restoredBrief = payload.job.creativePlan.adBrief;
        const restoredBriefKey = restoredBrief
          ? JSON.stringify({
              objective: restoredBrief.adObjective,
              approach: restoredBrief.creativeIntensity,
              emphasis: restoredBrief.additionalEmphasis || "",
              mandatory: restoredBrief.mandatoryInfo,
              prohibited: restoredBrief.prohibitedClaims,
            })
          : "";
        const samePlan = restoredBriefKey === briefKey;
        const samePlanner = payload.job.creativePlan.plannerVersion === CREATIVE_PLANNER_VERSION;
        if (sameProduct && samePlan && samePlanner) {
          setJob(payload.job);
          setMessage("이전에 진행하던 6장 생성 작업을 복구했습니다.");
        } else {
          setJob(null);
          setEdits({});
          setMessage("변경한 광고 목표와 제작 방식으로 새 광고를 만들어 주세요.");
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [briefKey, productKey, props.product.landingUrl, props.product.productName]);

  async function generateOne(activeJob: GenerationJob, resultId: string, copy?: EditableCopy) {
    const generationRequestId = requestId();
    const response = await fetch(
      `/api/creative-generation/jobs/${encodeURIComponent(activeJob.id)}/results/${encodeURIComponent(resultId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(copy ? { copy } : {}), requestId: generationRequestId }),
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

  async function runPending(activeJob: GenerationJob) {
    cancelRequested.current = false;
    const pending = activeJob.results.filter((result) => result.status === "pending" || result.status === "failed");
    let cursor = 0;
    const worker = async () => {
      while (!cancelRequested.current) {
        const next = pending[cursor];
        cursor += 1;
        if (!next) break;
        setJob((current) =>
          current
            ? {
                ...current,
                status: "running",
                results: current.results.map((result) =>
                  result.id === next.id ? { ...result, status: "running" } : result
                ),
              }
            : current
        );
        try {
          await generateOne(activeJob, next.id);
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "일부 광고 생성에 실패했습니다.");
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(activeJob.concurrency, pending.length) }, () => worker()));
    const refreshed = await refreshJob(activeJob.id);
    if (refreshed.status === "completed") setMessage("광고 콘텐츠 6장이 모두 생성되었습니다.");
    else if (refreshed.status === "partial") setMessage("생성된 결과를 먼저 확인하고 실패한 카드만 재시도할 수 있습니다.");
    return refreshed;
  }

  async function startGeneration() {
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
    setMessage("ProductTruth와 6개 광고 방향을 계획하고 있습니다.");
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
        }),
      });
      const payload = (await response.json()) as { ok?: boolean; job?: GenerationJob; error?: string };
      if (!response.ok || !payload.job) throw new Error(payload.error || "6장 생성 작업을 시작하지 못했습니다.");
      setJob(payload.job);
      window.sessionStorage.setItem(storedJobKey, payload.job.id);
      setMessage("6개 블루프린트를 순차적으로 렌더링하고 있습니다.");
      await runPending(payload.job);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "6장 생성 작업에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function cancelJob() {
    if (!job) return;
    cancelRequested.current = true;
    const response = await fetch(`/api/creative-generation/jobs/${encodeURIComponent(job.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel" }),
    });
    const payload = (await response.json()) as { job?: GenerationJob; error?: string };
    if (payload.job) setJob(payload.job);
    setMessage(payload.error || "작업을 취소했습니다. 완료된 결과는 그대로 유지됩니다.");
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
      setMessage("중단된 카드부터 생성을 재개합니다.");
      await runPending(payload.job);
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
      await generateOne(job, result.id, edits[result.id]);
      await refreshJob(job.id);
      setMessage(`${result.blueprintLabel} 카드를 다시 생성했습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "재생성 실패");
    } finally {
      setLoading(false);
    }
  }

  async function downloadAll() {
    if (!job) return;
    const completedResults = job.results.filter((result) => result.status === "success" && result.imagePath);
    if (!completedResults.length) return;
    setDownloading(true);
    try {
      const successes: GenerationResult[] = [];
      for (const result of completedResults) successes.push(await ensureResultAsset(job, result));
      const zip = new JSZip();
      await Promise.all(
        successes.map(async (result) => {
          const response = await fetch(result.imagePath!);
          if (!response.ok) throw new Error(`${result.blueprintLabel} 다운로드 실패`);
          if (!result.creativeAsset) throw new Error(`${result.blueprintLabel} 소재코드가 없습니다.`);
          zip.file(result.creativeAsset.fileName, await response.blob());
          await markCreativeAssetExported(result.creativeAsset.assetCode);
        })
      );
      zip.file(
        "generation-summary.json",
        JSON.stringify(
          {
            jobId: job.id,
            product: job.productTruth.product.productName,
            results: successes.map((result) => ({
              order: result.order,
              assetCode: result.creativeAsset?.assetCode,
              recommendedAdName: result.creativeAsset?.recommendedAdName,
              utmContent: result.creativeAsset?.utmContent,
              blueprintId: result.blueprintId,
              qa: result.qa,
              scene: result.scenePlan.sceneAsset,
            })),
          },
          null,
          2
        )
      );
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `adatlas-assets-${job.id}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "전체 다운로드 실패");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <section className="six-creative-generator">
      <div className="six-creative-head">
        <div>
          <p className="eyebrow">3 · 광고 콘텐츠 생성</p>
          <h4>{generationPlan.objectiveLabel} 목표로 광고 콘텐츠 6장 만들기</h4>
          <p>{generationPlan.approachLabel} 방식으로 문구·근거·배경을 서로 다른 가설에 맞춰 자동 구성합니다.</p>
        </div>
        <button disabled={!canStart || loading} onClick={() => void startGeneration()} type="button">
          {loading ? "6장 생성 중…" : props.planConfirmed ? "광고 콘텐츠 6장 만들기" : "제작 계획을 먼저 확정해 주세요"}
        </button>
      </div>
      <div className="six-creative-plan-summary">
        <span><b>문구</b>{generationPlan.copy}</span>
        <span><b>배경</b>각 후킹과 상품 카테고리에 맞는 장면을 자동 선택</span>
        <span><b>CTA</b>{generationPlan.cta}</span>
      </div>
      <div className="six-creative-status">
        <span>{message}</span>
        {job ? <strong>{progress.completed}/{progress.total} 완료 · 성공 {progress.success} · 실패 {progress.failed}</strong> : null}
      </div>
      {job ? (
        <>
          <div className="six-creative-progress" aria-label="광고 생성 진행률">
            <i style={{ width: `${Math.round((progress.completed / Math.max(1, progress.total)) * 100)}%` }} />
          </div>
          <div className="six-creative-actions">
            {job.status === "running" && loading ? <button onClick={() => void cancelJob()} type="button">생성 취소</button> : null}
            {job.status === "cancelled" || job.status === "partial" || job.status === "failed" ? (
              <button disabled={loading} onClick={() => void resumeJob()} type="button">중단 지점부터 재개</button>
            ) : null}
            <button disabled={!progress.success || downloading} onClick={() => void downloadAll()} type="button">
              {downloading ? "ZIP 준비 중…" : `성공 결과 ${progress.success}장 전체 다운로드`}
            </button>
          </div>
          <div className="six-creative-grid">
            {job.results.map((result) => {
              const edit = edits[result.id] || initialEdit(result);
              return (
                <article className={`six-creative-card ${result.status}`} key={result.id}>
                  <div className="six-creative-card-head">
                    <span>{String(result.order).padStart(2, "0")}</span>
                    <div><strong>{result.blueprintLabel}</strong><small>{result.hookPlan.title}</small></div>
                    <b>{resultStatusLabels[result.status]}</b>
                  </div>
                  <div className="six-creative-preview">
                    {result.imagePath ? (
                      // Runtime-generated local files intentionally bypass Next image optimization.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img alt={`${result.blueprintLabel} 생성 결과`} src={result.imagePath} />
                    ) : <div><span>{result.status === "running" ? "렌더링 중" : "대기 중"}</span><small>{result.scenePlan.sceneAsset.scene}</small></div>}
                  </div>
                  {result.qa ? (
                    <div className={`six-creative-qa ${result.qa.passed ? "pass" : "review"}`}>
                      QA {result.qa.score} · {result.qa.width}×{result.qa.height} · {Math.ceil(result.qa.fileSizeBytes / 1024)}KB
                    </div>
                  ) : null}
                  {result.contentNoteCompliance ? (
                    <div className={`six-creative-compliance ${result.contentNoteCompliance.state}`}>
                      참고사항 {result.contentNoteCompliance.appliedNoteIds.length}개 · {result.contentNoteCompliance.state === "passed" ? "준수" : result.contentNoteCompliance.state === "repaired" ? "자동 보정" : "차단"}
                      {result.contentNoteCompliance.repairs.length ? <small>{result.contentNoteCompliance.repairs.join(" · ")}</small> : null}
                    </div>
                  ) : null}
                  {result.error ? <p className="six-creative-error">{result.error}</p> : null}
                  {result.creativeAsset ? (
                    <CreativeAssetActions asset={result.creativeAsset} onMessage={setMessage} />
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
                    <button disabled={loading || job.status === "cancelled"} onClick={() => void retryResult(result)} type="button">이 카드 재생성</button>
                  </div>
                  <details className="six-creative-edit">
                    <summary>문구 수정 후 재생성</summary>
                    {(["headline", "body", "proof", "offer", "cta"] as const).map((key) => (
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
