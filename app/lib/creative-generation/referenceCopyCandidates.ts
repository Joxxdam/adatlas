import { referenceCopyClaimModes, type ReferenceAdaptedCopyPlan, type ReferenceCopyCandidate, type ReferenceCopyHookIdea, type ReferenceCopyProfile } from "./types.ts";

export type PlannerPlanPayload = Pick<ReferenceAdaptedCopyPlan,
  "resultCode" | "referenceId" | "creativePremise" | "sceneAdaptation" | "adaptedLines" | "headline" | "subCopy" | "proof" | "offer" | "cta" | "factIds" | "tone" | "sentenceStyle" | "naturalnessScore" | "referenceFitScore" | "factualSafetyScore" | "validationErrors" |
  "creativeAngle" | "hookIdea" | "candidateMode" | "claimModes" | "copyRiskFlags" | "copyReviewRequired" | "fullCopy" | "copyBlocks" | "candidateScore" | "candidateSelectionReason" | "copyCandidates"
> & { observedSourceLines: string[]; candidates: ReferenceCopyCandidate[]; selectedCandidateId: string };

export type PlannerPayload = {
  profiles: Array<Omit<ReferenceCopyProfile, "id" | "referenceHash" | "profileVersion" | "createdAt" | "analysisSource">>;
  hookIdeas: ReferenceCopyHookIdea[];
  plans: PlannerPlanPayload[];
};

/**
 * 생성 모델은 광고 문구만 작성합니다. 근거 연결, 메타데이터, 점수와
 * 레퍼런스 슬롯 역할 매핑은 서버가 결정적으로 복원합니다.
 */
export type LeanReferenceCopyPayload = {
  resultCode: string;
  referenceId: string;
  /** 저장된 OCR 원문과 같은 순서·개수의 최종 렌더 문구입니다. */
  adaptedLines: string[];
  headline: string;
  support: string;
  proof: string;
  offer: string;
  cta: string;
  /** 실제 문구에 사용한 ProductTruth fact id만 기록합니다. */
  factIds: string[];
  /** 확정 문구와 동시에 정하는 최소 장면 계약입니다. */
  scene: {
    expressionPrinciple: string;
    subjectMode: "none" | "new-adult" | "product-character";
    subjectRole: string;
    action: string;
    setting: string;
  };
};

export type LeanPlannerPayload = {
  copies: LeanReferenceCopyPayload[];
};

export const leanPlannerSchema = {
  type: "object", additionalProperties: false, required: ["copies"],
  properties: {
    copies: {
      type: "array", minItems: 1, maxItems: 6,
      items: {
        type: "object", additionalProperties: false,
        required: ["resultCode", "referenceId", "adaptedLines", "headline", "support", "proof", "offer", "cta", "factIds", "scene"],
        properties: {
          resultCode: { type: "string" },
          referenceId: { type: "string" },
          adaptedLines: { type: "array", items: { type: "string" }, maxItems: 20 },
          headline: { type: "string" },
          support: { type: "string" },
          proof: { type: "string" },
          offer: { type: "string" },
          cta: { type: "string" },
          factIds: { type: "array", items: { type: "string" }, maxItems: 12 },
          scene: {
            type: "object", additionalProperties: false,
            required: ["expressionPrinciple", "subjectMode", "subjectRole", "action", "setting"],
            properties: {
              expressionPrinciple: { type: "string" },
              subjectMode: { type: "string", enum: ["none", "new-adult", "product-character"] },
              subjectRole: { type: "string" },
              action: { type: "string" },
              setting: { type: "string" },
            },
          },
        },
      },
    },
  },
} as const;

/** 저장된 v1 plan에 신규 후보 메타데이터가 없어도 소비 코드가 배열/불리언을 안전하게 읽게 합니다. */
export function normalizeReferenceCopyPlanMetadata(plan: ReferenceAdaptedCopyPlan): ReferenceAdaptedCopyPlan {
  return {
    ...plan,
    claimModes: Array.isArray(plan.claimModes) ? plan.claimModes.filter((mode) => referenceCopyClaimModes.includes(mode)) : [],
    copyRiskFlags: Array.isArray(plan.copyRiskFlags) ? plan.copyRiskFlags.filter((flag) => typeof flag === "string") : [],
    copyReviewRequired: plan.copyReviewRequired === true,
    copyBlocks: Array.isArray(plan.copyBlocks) ? plan.copyBlocks : [],
    copyCandidates: Array.isArray(plan.copyCandidates) ? plan.copyCandidates : [],
  };
}
