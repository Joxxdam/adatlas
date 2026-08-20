import type { GenerationJob, HookMessageCode } from "../creative-generation/types";
import type { AutoHookHypothesis } from "./types";

export function hookHypothesesFromJob(job: GenerationJob): AutoHookHypothesis[] {
  return job.results.map((result) => {
    const plan = result.hookPlan;
    const brief = plan.creativeBrief;
    return {
      code: plan.hookCode as HookMessageCode,
      hookType: plan.hookType,
      primaryTag: plan.primaryTag,
      mainHook: plan.headline,
      subCopy: plan.body,
      messageHypothesis: brief?.messageHypothesis || plan.hypothesis,
      customerInsight: brief?.customerInsight || plan.customerReason || plan.audience,
      productEvidence: brief?.verifiedFacts || (plan.evidenceSummary ? [plan.evidenceSummary] : []),
      recommendedScene: brief?.sceneDescription || plan.sceneIntent,
      selectionReason: plan.selectionReason || "상품 근거와 시각화 가능성을 함께 평가해 선정했습니다.",
    };
  });
}

export function resultIdsForHookCodes(job: GenerationJob, hookCodes: string[]) {
  const requested = new Set(hookCodes);
  return job.results
    .filter((result) => requested.has(result.hookPlan.hookCode))
    .map((result) => result.id);
}

export function allHookCodes(job: GenerationJob) {
  return job.results.map((result) => result.hookPlan.hookCode as HookMessageCode);
}
