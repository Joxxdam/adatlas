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
      targetCustomer: brief?.targetCustomer || plan.audience,
      customerSituation: brief?.customerSituation || plan.customerReason || "상품을 비교하고 선택하는 순간",
      productEvidence: brief?.verifiedFacts || (plan.evidenceSummary ? [plan.evidenceSummary] : []),
      verifiedEvidence: brief?.verifiedFacts || (plan.evidenceSummary ? [plan.evidenceSummary] : []),
      intendedReaction: brief?.intendedReaction || "상품의 구매 이유를 빠르게 이해한다.",
      visualConcept: brief?.heroScene || brief?.visualStory || plan.sceneIntent,
      recommendedScene: brief?.sceneDescription || plan.sceneIntent,
      selectionReason: plan.selectionReason || "상품 근거와 시각화 가능성을 함께 평가해 선정했습니다.",
      prohibitedClaims: brief?.prohibitedClaims || [],
    };
  });
}

export function resultIdsForHookCodes(job: GenerationJob, hookCodes: string[]) {
  const requested = new Set(hookCodes);
  return job.results.filter((result) => requested.has(result.hookPlan.hookCode)).map((result) => result.id);
}

export function allHookCodes(job: GenerationJob) {
  return job.results.map((result) => result.hookPlan.hookCode as HookMessageCode);
}
