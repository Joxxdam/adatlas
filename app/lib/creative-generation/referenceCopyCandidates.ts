import { creativeAngles, referenceCopyClaimModes, type ReferenceAdaptedCopyPlan, type ReferenceCopyCandidate, type ReferenceCopyHookIdea, type ReferenceCopyProfile } from "./types.ts";

export type PlannerPlanPayload = Pick<ReferenceAdaptedCopyPlan,
  "resultCode" | "referenceId" | "creativePremise" | "adaptedLines" | "headline" | "subCopy" | "proof" | "offer" | "cta" | "factIds" | "tone" | "sentenceStyle" | "naturalnessScore" | "referenceFitScore" | "factualSafetyScore" | "validationErrors" |
  "creativeAngle" | "hookIdea" | "candidateMode" | "claimModes" | "copyRiskFlags" | "copyReviewRequired" | "fullCopy" | "copyBlocks" | "candidateScore" | "candidateSelectionReason" | "copyCandidates"
> & { observedSourceLines: string[]; candidates: ReferenceCopyCandidate[]; selectedCandidateId: string };

export type PlannerPayload = {
  profiles: Array<Omit<ReferenceCopyProfile, "id" | "referenceHash" | "profileVersion" | "createdAt" | "analysisSource">>;
  hookIdeas: ReferenceCopyHookIdea[];
  plans: PlannerPlanPayload[];
};

/**
 * 생성 모델은 광고 문구만 작성합니다. 근거 연결, 후보 메타데이터, 점수,
 * 레퍼런스 슬롯 fitting은 서버가 결정적으로 복원합니다.
 */
export type LeanReferenceCopyPayload = {
  resultCode: string;
  referenceId: string;
  headline: string;
  support: string;
  proof: string;
  offer: string;
  cta: string;
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
        required: ["resultCode", "referenceId", "headline", "support", "proof", "offer", "cta"],
        properties: {
          resultCode: { type: "string" },
          referenceId: { type: "string" },
          headline: { type: "string" },
          support: { type: "string" },
          proof: { type: "string" },
          offer: { type: "string" },
          cta: { type: "string" },
        },
      },
    },
  },
} as const;

const blockRoleSchema = { type: "string", enum: ["headline", "support", "proof", "offer", "cta", "badge", "other"] } as const;
const claimModeSchema = { type: "string", enum: referenceCopyClaimModes } as const;

const premiseSchema = {
  type: "object", additionalProperties: false,
  required: ["policyVersion", "kind", "fictionalContext", "character", "situation", "tension", "productBridge", "supportingFactIds", "factBoundary"],
  properties: {
    policyVersion: { type: "string", enum: ["image-creative-premise-v2"] },
    kind: { type: "string", enum: ["everyday-question-answer", "everyday-relationship", "obvious-ad-metaphor", "usp-focus", "comparison-benefit"] },
    fictionalContext: { type: "boolean", enum: [true] },
    character: { type: "string" }, situation: { type: "string" }, tension: { type: "string" }, productBridge: { type: "string" },
    supportingFactIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 }, factBoundary: { type: "string" },
  },
} as const;

const copyBlockSchema = {
  type: "object", additionalProperties: false, required: ["role", "text", "coreFactIds"],
  properties: { role: blockRoleSchema, text: { type: "string" }, coreFactIds: { type: "array", items: { type: "string" }, maxItems: 5 } },
} as const;

const candidateSchema = {
  type: "object", additionalProperties: false,
  required: ["id", "creativeAngle", "candidateMode", "claimModes", "coreFactIds", "fullCopy", "copyBlocks", "copyRiskFlags", "copyReviewRequired", "safeAlternative", "referenceFitReason", "productDifferenceReason", "noveltyReason"],
  properties: {
    id: { type: "string" }, creativeAngle: { type: "string", enum: creativeAngles }, candidateMode: { type: "string", enum: ["reference-faithful", "performance-bold", "natural-conversation"] },
    claimModes: { type: "array", items: claimModeSchema, minItems: 1, maxItems: 6 }, coreFactIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 },
    fullCopy: { type: "string" }, copyBlocks: { type: "array", items: copyBlockSchema, minItems: 1, maxItems: 12 },
    copyRiskFlags: { type: "array", items: { type: "string" }, maxItems: 8 }, copyReviewRequired: { type: "boolean" }, safeAlternative: { type: "string" },
    referenceFitReason: { type: "string" }, productDifferenceReason: { type: "string" }, noveltyReason: { type: "string" },
  },
} as const;

const hookIdeaSchema = {
  type: "object", additionalProperties: false,
  required: ["id", "creativeAngle", "consumerSituation", "tension", "reaction", "productBridge", "supportingFactIds", "referenceMechanism", "claimMode"],
  properties: {
    id: { type: "string" }, creativeAngle: { type: "string", enum: creativeAngles }, consumerSituation: { type: "string" }, tension: { type: "string" }, reaction: { type: "string" }, productBridge: { type: "string" },
    supportingFactIds: { type: "array", items: { type: "string" }, maxItems: 3 }, referenceMechanism: { type: "string" }, claimMode: claimModeSchema,
  },
} as const;

export const plannerSchema = {
  type: "object", additionalProperties: false, required: ["profiles", "hookIdeas", "plans"],
  properties: {
    profiles: { type: "array", maxItems: 0, items: { type: "object", additionalProperties: false, properties: {} } },
    // 신규 기본 경로는 후보 발상 묶음을 생성하지 않는다. 서버가 레퍼런스별
    // 배정 아이디어를 이미 제공하므로 모델은 최종 6개 문구에만 집중한다.
    hookIdeas: { type: "array", minItems: 0, maxItems: 0, items: hookIdeaSchema },
    plans: {
      type: "array", minItems: 1, maxItems: 6,
      items: {
        type: "object", additionalProperties: false,
        required: ["resultCode", "referenceId", "creativePremise", "observedSourceLines", "adaptedLines", "headline", "subCopy", "proof", "offer", "cta", "factIds", "tone", "sentenceStyle", "naturalnessScore", "referenceFitScore", "factualSafetyScore", "validationErrors", "creativeAngle", "hookIdea", "candidateMode", "claimModes", "copyRiskFlags", "copyReviewRequired", "fullCopy", "copyBlocks", "candidates", "selectedCandidateId"],
        properties: {
          resultCode: { type: "string" }, referenceId: { type: "string" }, creativePremise: premiseSchema,
          observedSourceLines: { type: "array", items: { type: "string" }, maxItems: 20 }, adaptedLines: { type: "array", items: { type: "string" }, maxItems: 20 },
          headline: { type: "string" }, subCopy: { type: "string" }, proof: { type: "string" }, offer: { type: "string" }, cta: { type: "string" }, factIds: { type: "array", items: { type: "string" } },
          tone: { type: "string" }, sentenceStyle: { type: "string", enum: ["question", "declaration", "dialogue", "contrast", "sensory", "urgency", "proof"] },
          naturalnessScore: { type: "integer", minimum: 0, maximum: 100 }, referenceFitScore: { type: "integer", minimum: 0, maximum: 100 }, factualSafetyScore: { type: "integer", minimum: 0, maximum: 100 }, validationErrors: { type: "array", items: { type: "string" }, maxItems: 8 },
          creativeAngle: { type: "string", enum: creativeAngles }, hookIdea: hookIdeaSchema, candidateMode: { type: "string", enum: ["reference-faithful", "performance-bold", "natural-conversation"] }, claimModes: { type: "array", items: claimModeSchema },
          copyRiskFlags: { type: "array", items: { type: "string" } }, copyReviewRequired: { type: "boolean" }, fullCopy: { type: "string" }, copyBlocks: { type: "array", items: copyBlockSchema },
          candidates: { type: "array", minItems: 1, maxItems: 1, items: candidateSchema }, selectedCandidateId: { type: "string" },
        },
      },
    },
  },
} as const;

export type SelectorPayload = {
  rankings: Array<{
    referenceId: string;
    candidates: Array<{
      candidateId: string;
      stopPower: number;
      productDifference: number;
      humanVoice: number;
      concretePurchaseReason: number;
      referenceFit: number;
      novelty: number;
      selectionReason: string;
      rejectionReasons: string[];
    }>;
  }>;
};

export const selectorSchema = {
  type: "object", additionalProperties: false, required: ["rankings"],
  properties: {
    rankings: {
      type: "array", minItems: 1, maxItems: 6,
      items: {
        type: "object", additionalProperties: false, required: ["referenceId", "candidates"],
        properties: {
          referenceId: { type: "string" },
          candidates: {
            type: "array", minItems: 1, maxItems: 3,
            items: {
              type: "object", additionalProperties: false,
              required: ["candidateId", "stopPower", "productDifference", "humanVoice", "concretePurchaseReason", "referenceFit", "novelty", "selectionReason", "rejectionReasons"],
              properties: {
                candidateId: { type: "string" }, stopPower: { type: "integer", minimum: 0, maximum: 100 }, productDifference: { type: "integer", minimum: 0, maximum: 100 },
                humanVoice: { type: "integer", minimum: 0, maximum: 100 }, concretePurchaseReason: { type: "integer", minimum: 0, maximum: 100 }, referenceFit: { type: "integer", minimum: 0, maximum: 100 }, novelty: { type: "integer", minimum: 0, maximum: 100 },
                selectionReason: { type: "string" }, rejectionReasons: { type: "array", items: { type: "string" }, maxItems: 6 },
              },
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
