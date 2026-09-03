import { NextResponse } from "next/server";
import { creativeGenerationJobStore } from "../../../../../../lib/creative-generation/jobStore.server";
import type { CopyPlan } from "../../../../../../lib/creative-generation/types";
import { handleNativeResultGeneration } from "../../../../../../lib/creative-generation/nativeResultGeneration.server";
import { writeNativeManifest } from "../../../../../../lib/creative-generation/nativeCreativeStorage.server";
import { localAccessError, verifyLocalGenerationAccess } from "../../../../../../lib/creative-generation/localGenerationAccess.server";
import { toPublicGenerationError, toPublicGenerationJob } from "../../../../../../lib/creative-generation/publicJob.server";
import { isCurrentReferenceEditGenerationJob } from "../../../../../../lib/creative-generation/jobRunnerPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request, context: { params: Promise<{ jobId: string; resultId: string }> }) {
  const startedAtMs = Date.now();
  const { jobId, resultId } = await context.params;
  try {
    verifyLocalGenerationAccess(request);
    const body = (await request.json().catch(() => ({}))) as {
      copy?: Partial<CopyPlan>;
      requestId?: string;
      regenerateScene?: boolean;
      action?: "generate" | "regenerate" | "regenerate-new-reference" | "revise" | "revalidate" | "copy-update" | "approve" | "exclude" | "feedback" | "golden-reference";
      feedback?: string;
    };
    let job = await creativeGenerationJobStore.get(jobId);
    if (!job) return NextResponse.json({ ok: false, error: "작업을 찾지 못했습니다." }, { status: 404 });
    if (job.status === "cancelled") return NextResponse.json({ ok: false, error: "취소된 작업입니다." }, { status: 409 });
    const target = job.results.find((result) => result.id === resultId);
    if (!target) return NextResponse.json({ ok: false, error: "결과 항목을 찾지 못했습니다." }, { status: 404 });
    if (job.engine) {
      const executionActions = new Set(["generate", "regenerate", "regenerate-new-reference", "revise", "revalidate", "copy-update"]);
      if (executionActions.has(body.action || "generate") && !isCurrentReferenceEditGenerationJob(job)) {
        return NextResponse.json(
          { ok: false, error: "구버전 결과는 조회·다운로드만 가능합니다. 현재 상품을 다시 분석해 최신 제작 작업으로 시작해 주세요." },
          { status: 409 }
        );
      }
      const native = await handleNativeResultGeneration({ jobId, resultId, requestId: body.requestId, action: body.action, feedback: body.feedback, copy: body.copy });
      const ok = ["success", "approved", "excluded"].includes(native.result.status) || body.action === "feedback" || body.action === "golden-reference";
      const publicJob = toPublicGenerationJob(native.job);
      return NextResponse.json(
        {
          ok,
          job: publicJob,
          result: publicJob.results.find((result) => result.id === native.result.id),
        },
        { status: ok ? 200 : 422 }
      );
    }
    // 레거시 작업만 지연 로드한다. AI native-final 작업에서는 템플릿·Sharp
    // 합성 렌더러 모듈 자체를 불러오지 않는다.
    const [{ createAssetFromGenerationResult }, { creativeAssetRepository }, { toCreativeAssetSnapshot }, { renderCreativeResult }, { validateCopyAgainstTruth }, { messageSimilarity }, { planMasterScene }, { createOrReuseMasterScene }, { applyCreativeContentNotesToCopy }, { cremaMarketRepository }] = await Promise.all([
      import("../../../../../../lib/creative-assets/fromGeneration.server"),
      import("../../../../../../lib/creative-assets/repository.server"),
      import("../../../../../../lib/creative-assets/types"),
      import("../../../../../../lib/creative-generation/renderer.server"),
      import("../../../../../../lib/creative-generation/productTruth"),
      import("../../../../../../lib/creative-generation/hookMessages.server"),
      import("../../../../../../lib/creative-generation/masterScenePlanner"),
      import("../../../../../../lib/creative-generation/masterSceneService.server"),
      import("../../../../../../lib/creative-content-notes/service"),
      import("../../../../../../lib/crema-market/repository.server"),
    ]);
    const requestId = String(body.requestId || "")
      .trim()
      .slice(0, 160);
    const generationRequestKey = requestId ? `creative-result:${jobId}:${resultId}:${requestId}` : `creative-result:${jobId}:${resultId}:attempt-${target.attempts + 1}`;
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
        job: toPublicGenerationJob(job),
        result: toPublicGenerationJob(job).results.find((result) => result.id === resultId),
      });
    }
    const noteApplication = applyCreativeContentNotesToCopy(
      {
        headline: body.copy?.headline ?? target.hookPlan.headline,
        body: body.copy?.body ?? target.hookPlan.body,
        proof: body.copy?.proof ?? target.hookPlan.proof,
        offer: body.copy?.offer ?? target.hookPlan.offer,
        cta: body.copy?.cta ?? target.hookPlan.cta,
      },
      job.productTruth.product.creativeContext?.appliedContentNotes || []
    );
    if (noteApplication.compliance.state === "blocked") {
      return NextResponse.json(
        {
          ok: false,
          error: "광고 콘텐츠 참고사항의 필수·금지 규칙을 충족하지 못해 생성을 중단했습니다.",
          compliance: noteApplication.compliance,
        },
        { status: 409 }
      );
    }
    const copyText = Object.values(noteApplication.copy).join(" ");
    const factual = validateCopyAgainstTruth(copyText, job.productTruth);
    if (!factual.valid) {
      return NextResponse.json(
        {
          ok: false,
          error: `ProductTruth에 없는 수치 또는 금지 표현입니다: ${[...factual.unauthorizedNumericTokens, ...factual.blockedClaims].join(", ")}`,
        },
        { status: 400 }
      );
    }
    const duplicate = job.results.find((result) => result.id !== resultId && messageSimilarity(`${noteApplication.copy.headline} ${noteApplication.copy.body}`, `${result.hookPlan.headline} ${result.hookPlan.body}`) >= 0.68);
    if (duplicate) {
      return NextResponse.json(
        {
          ok: false,
          error: `${duplicate.hookPlan.hookCode}와 의미가 지나치게 유사합니다. 다른 메시지 가설로 수정해 주세요.`,
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
    let active = job.results.find((result) => result.id === resultId)!;
    if (job.productReferenceProfile && active.creativeDesign && (!active.masterScene || body.regenerateScene)) {
      const productReferenceProfile = job.productReferenceProfile;
      job = await creativeGenerationJobStore.update(jobId, (current) => ({
        ...current,
        results: current.results.map((result) => (result.id === resultId ? { ...result, generationStage: "scene-generating" } : result)),
      }));
      active = job.results.find((result) => result.id === resultId)!;
      const sceneSpec = planMasterScene({
        productId: job.productTruth.productId,
        profile: productReferenceProfile,
        masterDesign: active.creativeDesign!,
        aiFullCreative: true,
        strategyVariation: active.order,
        creativeBrief: active.hookPlan.creativeBrief,
      });
      const masterScene = await createOrReuseMasterScene({
        truth: job.productTruth,
        profile: productReferenceProfile,
        spec: sceneSpec,
        forceRevision: true,
        revision: Date.now() + active.order,
      });
      job = await creativeGenerationJobStore.update(jobId, (current) => ({
        ...current,
        results: current.results.map((result) =>
          result.id === resultId
            ? {
                ...result,
                masterScene,
                generationStage: "compositing",
                scenePlan: {
                  ...result.scenePlan,
                  sceneAsset: {
                    ...result.scenePlan.sceneAsset,
                    file: masterScene.file,
                    sourceType: "generated",
                    scene: result.hookPlan.creativeBrief?.sceneDescription || result.scenePlan.sceneAsset.scene,
                  },
                  promptVersion: masterScene.generationPromptVersion,
                  provider: "openai",
                  providerModel: masterScene.imageModel,
                  generated: masterScene.provider === "openai",
                  masterSceneId: masterScene.id,
                  generationMode: masterScene.generationMode,
                  reason: [result.scenePlan.reason, ...masterScene.warnings].filter(Boolean).join(" · "),
                },
              }
            : result
        ),
      }));
      active = job.results.find((result) => result.id === resultId)!;
    }
    const requestedCopy = noteApplication.copy;
    const autoRepairs: string[] = [];
    job = await creativeGenerationJobStore.update(jobId, (current) => ({
      ...current,
      results: current.results.map((result) => (result.id === resultId ? { ...result, generationStage: "copy-rendering" } : result)),
    }));
    active = job.results.find((result) => result.id === resultId)!;
    let rendered = await renderCreativeResult({
      job,
      result: active,
      overrides: requestedCopy,
      repairPass: 0,
    });
    const overflowSlots = new Set(rendered.qa.findings.filter((finding) => finding.id === "text-overflow").flatMap(() => rendered.renderPlan.renderedSlots.filter((slot) => slot.overflow).map((slot) => slot.id)));
    const repairCopy = { ...requestedCopy };
    if (overflowSlots.has("headline") && requestedCopy.headline !== active.hookPlan.headline) {
      repairCopy.headline = active.hookPlan.headline;
      autoRepairs.push("슬롯을 초과한 사용자 헤드라인을 검증된 H 후킹 원문으로 복구");
    }
    if (overflowSlots.has("body") && requestedCopy.body !== active.hookPlan.body) {
      repairCopy.body = active.hookPlan.body;
      autoRepairs.push("슬롯을 초과한 사용자 서브 문구를 검증된 H 서브 문구로 복구");
    }
    if (!rendered.qa.passed && autoRepairs.length) {
      rendered = await renderCreativeResult({
        job,
        result: active,
        overrides: repairCopy,
        repairPass: 1,
        autoRepairs,
      });
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
              generationStage: rendered.qa.passed ? "completed" : "quality-check",
              imagePath: rendered.imagePath,
              downloadName: assetResult?.asset.fileName || rendered.downloadName,
              creativeAsset: assetResult ? toCreativeAssetSnapshot(assetResult.asset) : result.creativeAsset,
              renderPlan: rendered.renderPlan,
              qa: rendered.qa,
              autoRepairs,
              contentNoteCompliance: noteApplication.compliance,
              error: rendered.qa.passed
                ? undefined
                : rendered.qa.findings
                    .filter((finding) => finding.severity === "error")
                    .map((finding) => finding.message)
                    .join(" · "),
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
    return NextResponse.json(
      {
        ok: rendered.qa.passed,
        job: toPublicGenerationJob(completed),
        result: toPublicGenerationJob(completed).results.find((result) => result.id === resultId),
      },
      { status: rendered.qa.passed ? 200 : 422 }
    );
  } catch (error) {
    const message = toPublicGenerationError(error, "광고 결과 생성 실패");
    try {
      const failed = await creativeGenerationJobStore.update(jobId, (current) => ({
        ...current,
        errors: [...current.errors, message].slice(-20),
        results: current.results.map((result) => (result.id === resultId ? { ...result, status: "failed", error: message, completedAt: new Date().toISOString(), durationMs: Date.now() - startedAtMs } : result)),
      }));
      if (failed.engine) await writeNativeManifest(failed).catch(() => undefined);
      return NextResponse.json({ ok: false, error: message, job: toPublicGenerationJob(failed) }, { status: localAccessError(error) ? 403 : 500 });
    } catch {
      return NextResponse.json({ ok: false, error: message }, { status: localAccessError(error) ? 403 : 500 });
    }
  }
}
