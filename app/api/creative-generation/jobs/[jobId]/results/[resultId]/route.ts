import { NextResponse } from "next/server";
import { createAssetFromGenerationResult } from "../../../../../../lib/creative-assets/fromGeneration.server";
import { creativeAssetRepository } from "../../../../../../lib/creative-assets/repository.server";
import { toCreativeAssetSnapshot } from "../../../../../../lib/creative-assets/types";
import { creativeGenerationJobStore } from "../../../../../../lib/creative-generation/jobStore.server";
import { renderCreativeResult } from "../../../../../../lib/creative-generation/renderer.server";
import { validateCopyAgainstTruth } from "../../../../../../lib/creative-generation/productTruth";
import type { CopyPlan } from "../../../../../../lib/creative-generation/types";
import { applyCreativeContentNotesToCopy } from "../../../../../../lib/creative-content-notes/service";
import { cremaMarketRepository } from "../../../../../../lib/crema-market/repository.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string; resultId: string }> }
) {
  const startedAtMs = Date.now();
  const { jobId, resultId } = await context.params;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      copy?: Partial<CopyPlan>;
      requestId?: string;
    };
    let job = await creativeGenerationJobStore.get(jobId);
    if (!job) return NextResponse.json({ ok: false, error: "작업을 찾지 못했습니다." }, { status: 404 });
    if (job.status === "cancelled") return NextResponse.json({ ok: false, error: "취소된 작업입니다." }, { status: 409 });
    const target = job.results.find((result) => result.id === resultId);
    if (!target) return NextResponse.json({ ok: false, error: "결과 항목을 찾지 못했습니다." }, { status: 404 });
    const requestId = String(body.requestId || "").trim().slice(0, 160);
    const generationRequestKey = requestId
      ? `creative-result:${jobId}:${resultId}:${requestId}`
      : `creative-result:${jobId}:${resultId}:attempt-${target.attempts + 1}`;
    const idempotentAsset = await creativeAssetRepository.getByGenerationRequestKey(generationRequestKey);
    if (idempotentAsset) {
      if (!target.creativeAsset) {
        job = await creativeGenerationJobStore.update(jobId, (current) => ({
          ...current,
          results: current.results.map((result) =>
            result.id === resultId && !result.creativeAsset
              ? {
                  ...result,
                  status: "success",
                  imagePath: idempotentAsset.generatedImageUrl,
                  downloadName: idempotentAsset.fileName,
                  creativeAsset: toCreativeAssetSnapshot(idempotentAsset),
                  completedAt: result.completedAt || new Date().toISOString(),
                }
              : result
          ),
        }));
      }
      return NextResponse.json({
        ok: true,
        idempotent: true,
        job,
        result: job.results.find((result) => result.id === resultId),
      });
    }
    const noteApplication = applyCreativeContentNotesToCopy({
      headline: body.copy?.headline ?? target.hookPlan.headline,
      body: body.copy?.body ?? target.hookPlan.body,
      proof: body.copy?.proof ?? target.hookPlan.proof,
      offer: body.copy?.offer ?? target.hookPlan.offer,
      cta: body.copy?.cta ?? target.hookPlan.cta,
    }, job.productTruth.product.creativeContext?.appliedContentNotes || []);
    if (noteApplication.compliance.state === "blocked") {
      return NextResponse.json({
        ok: false,
        error: "광고 콘텐츠 참고사항의 필수·금지 규칙을 충족하지 못해 생성을 중단했습니다.",
        compliance: noteApplication.compliance,
      }, { status: 409 });
    }
    const copyText = Object.values(noteApplication.copy).join(" ");
    const factual = validateCopyAgainstTruth(copyText, job.productTruth);
    if (!factual.valid) {
      return NextResponse.json(
        {
          ok: false,
          error: `ProductTruth에 없는 수치 또는 금지 표현입니다: ${[
            ...factual.unauthorizedNumericTokens,
            ...factual.blockedClaims,
          ].join(", ")}`,
        },
        { status: 400 }
      );
    }
    job = await creativeGenerationJobStore.update(jobId, (current) => ({
      ...current,
      status: "running",
      startedAt: current.startedAt || new Date().toISOString(),
      results: current.results.map((result) =>
        result.id === resultId
          ? {
              ...result,
              status: "running",
              attempts: result.attempts + 1,
              error: undefined,
              startedAt: new Date().toISOString(),
            }
          : result
      ),
    }));
    const active = job.results.find((result) => result.id === resultId)!;
    let rendered = await renderCreativeResult({ job, result: active, overrides: noteApplication.copy, repairPass: 0 });
    if (!rendered.qa.passed && rendered.qa.findings.some((finding) => finding.repairable)) {
      rendered = await renderCreativeResult({ job, result: active, overrides: noteApplication.copy, repairPass: 1 });
    }
    const assetResult = rendered.qa.passed
      ? await createAssetFromGenerationResult({
          job,
          result: active,
          generatedImageUrl: rendered.imagePath,
          generationRequestKey,
          copy: rendered.renderPlan.copy,
        })
      : null;
    const completed = await creativeGenerationJobStore.update(jobId, (current) => ({
      ...current,
      results: current.results.map((result) =>
        result.id === resultId
          ? {
              ...result,
              status: rendered.qa.passed ? "success" : "failed",
              imagePath: rendered.imagePath,
              downloadName: assetResult?.asset.fileName || rendered.downloadName,
              creativeAsset: assetResult ? toCreativeAssetSnapshot(assetResult.asset) : result.creativeAsset,
              renderPlan: rendered.renderPlan,
              qa: rendered.qa,
              contentNoteCompliance: noteApplication.compliance,
              error: rendered.qa.passed
                ? undefined
                : rendered.qa.findings.filter((finding) => finding.severity === "error").map((finding) => finding.message).join(" · "),
              completedAt: new Date().toISOString(),
              durationMs: Date.now() - startedAtMs,
            }
          : result
      ),
    }));
    const opportunityId = completed.productTruth.product.creativeContext?.opportunityId;
    if (opportunityId && rendered.qa.passed && assetResult) {
      await cremaMarketRepository.updateOpportunity(opportunityId, { status: "creative_generated" }).catch(() => undefined);
    }
    return NextResponse.json({
      ok: rendered.qa.passed,
      job: completed,
      result: completed.results.find((result) => result.id === resultId),
    }, { status: rendered.qa.passed ? 200 : 422 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "광고 결과 생성 실패";
    try {
      const failed = await creativeGenerationJobStore.update(jobId, (current) => ({
        ...current,
        errors: [...current.errors, message].slice(-20),
        results: current.results.map((result) =>
          result.id === resultId
            ? { ...result, status: "failed", error: message, completedAt: new Date().toISOString(), durationMs: Date.now() - startedAtMs }
            : result
        ),
      }));
      return NextResponse.json({ ok: false, error: message, job: failed }, { status: 500 });
    } catch {
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  }
}
