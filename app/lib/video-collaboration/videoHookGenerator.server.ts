import "server-only";

import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadCopyGuideForProduct } from "../mvp/copyGuideLoader.ts";
import {
  VIDEO_HOOK_TYPES,
  VIDEO_CONCEPT_FORMAT_OPTIONS,
  VIDEO_CONCEPT_ARCHETYPE_OPTIONS,
  type HookScore,
  type ProductAnalysisSnapshot,
  type VideoConcept,
  type VideoCut,
  type VideoDuration,
  type VideoHookCandidate,
  type VideoHookType,
  type VideoObjective,
  type BrandGuideline,
  type VideoCreativeStyle,
  type VideoReferenceAsset,
  type ReferenceVideoAnalysis,
  type VideoConceptFormat,
  type VideoConceptArchetype,
  type VideoParodyGenre,
} from "./types.ts";
import { createVideoMaterialCode, VIDEO_HOOK_LABELS, VIDEO_OBJECTIVE_LABELS } from "./workflow.ts";
import {
  assignPlanningTimeline,
  hasVerifiedVideoBenefit,
  repairDetailedPlanningAudienceCopy,
  repairDetailedPlanningCommercialRestraint,
  repairDetailedPlanningCta,
  repairDetailedPlanningOpeningHook,
  repairDetailedPlanningSceneDescriptions,
  segmentRange,
  validateConceptDiversity,
  validateDetailedPlanning,
} from "./planningValidation.ts";
import {
  getVideoPlanningProvider,
  runVideoPlanningAi,
  VideoPlanningGenerationError,
} from "./videoPlanningAi.server.ts";
import {
  requestFourVideoConcepts,
  REQUIRED_VIDEO_CONCEPT_ARCHETYPES,
  VideoConceptBatchValidationError,
} from "./videoPlanningConceptBatch.ts";
import {
  blueprintPrompt,
  getVideoPlanningBlueprint,
  selectVideoPlanningBlueprints,
} from "./videoPlanningBlueprints.ts";
import { buildCurrentProductSelfIntroductionHook } from "./videoPlanningHookFallback.ts";
import { currentVideoCreativePremiseIssue } from "./videoPlanningVersion.ts";
import { runWithSingleVideoPlanningCorrection } from "./videoPlanningCorrection.ts";
import {
  matchesVideoParodyGenre,
  selectVideoParodyGenre,
  videoParodyGenrePrompt,
} from "./videoParodyGenres.ts";

import {
  hookTypeSchema,
  clean,
  compact,
  promptFacts,
  stylePrinciples,
  internetVoiceRules,
  PRODUCT_SELF_INTRODUCTION_RULES,
  SPECIFIC_CREATIVE_WORLD_RULES,
  NATURAL_REFERENCE_DIALOGUE_RULES,
  FOUR_CONCEPT_STORY_MECHANISM_RULES,
  referenceVoiceSignals,
} from "./videoPlanningPromptSupport";

function scoreTotal(score: Omit<HookScore, "total">) {
  return Math.round(
    score.stopPower * 0.16 +
      score.specificity * 0.14 +
      score.productRelevance * 0.15 +
      score.visualPotential * 0.13 +
      score.evidenceStrength * 0.14 +
      score.conversionPotential * 0.13 +
      score.originality * 0.08 +
      score.policySafety * 0.07
  );
}

type AiHook = {
  hookType: VideoHookType;
  hook: string;
  customerProblem: string;
  evidenceIds: string[];
  visualIdea: string;
  scores: Omit<HookScore, "total">;
  rejectionReasons: string[];
};

const hookSchema = {
  type: "object",
  additionalProperties: false,
  required: ["hooks"],
  properties: {
    hooks: {
      type: "array",
      minItems: 10,
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "hookType",
          "hook",
          "customerProblem",
          "evidenceIds",
          "visualIdea",
          "scores",
          "rejectionReasons",
        ],
        properties: {
          hookType: hookTypeSchema,
          hook: { type: "string", minLength: 8, maxLength: 70 },
          customerProblem: { type: "string", minLength: 4, maxLength: 100 },
          evidenceIds: { type: "array", maxItems: 4, items: { type: "string" } },
          visualIdea: { type: "string", minLength: 30, maxLength: 260 },
          scores: {
            type: "object",
            additionalProperties: false,
            required: [
              "stopPower",
              "specificity",
              "productRelevance",
              "visualPotential",
              "evidenceStrength",
              "conversionPotential",
              "originality",
              "policySafety",
            ],
            properties: Object.fromEntries(
              [
                "stopPower",
                "specificity",
                "productRelevance",
                "visualPotential",
                "evidenceStrength",
                "conversionPotential",
                "originality",
                "policySafety",
              ].map((key) => [key, { type: "integer", minimum: 0, maximum: 100 }])
            ),
          },
          rejectionReasons: { type: "array", maxItems: 4, items: { type: "string" } },
        },
      },
    },
  },
} as const;

export async function generateVideoHookCandidatesAi(
  analysis: ProductAnalysisSnapshot,
  guideline: BrandGuideline,
  referenceAnalyses: ReferenceVideoAnalysis[] = []
) {
  const allowedEvidenceIds = new Set((analysis.verifiedFacts || []).map((fact) => fact.id));
  const payload = await runVideoPlanningAi<{ hooks: AiHook[] }>({
    stage: "hook-candidates",
    outputSchema: hookSchema as unknown as Record<string, unknown>,
    prompt: `당신은 한국 퍼포먼스 광고의 숏폼 후킹 전략가다. 아래 공개 상품 사실만으로 서로 다른 후킹 후보 10~12개를 만든다.

[상품 사실]
${JSON.stringify(promptFacts(analysis))}

[브랜드 기준]
${JSON.stringify({ tone: guideline.toneAndManner, audience: guideline.primaryAudience, forbidden: guideline.forbiddenPhrases })}

[참고 영상에서 재사용 가능한 구조·속도·자막 리듬]
${JSON.stringify(referenceVoiceSignals(referenceAnalyses))}

[필수 유형]
고객 문제, 가격과 양, 손해 회피, 예상 밖 비교, 원산지와 원물, 사용 전후, 후기와 신뢰, 계절과 상황, 궁금증, 상식 뒤집기, 감각 장면, 실제 사용자 독백을 폭넓게 사용한다. 이와 별도로 product-self-introduction 후보를 최소 1개 만든다. hookType은 제공된 enum 중 가장 가까운 값을 쓴다.

[상품 자기소개형 전용]
${PRODUCT_SELF_INTRODUCTION_RULES}

[평가]
첫 3초 주목도, 상품 구체성, 고객 문제 연결, 시각화, 근거, 차별성, 전환, 과장 안전성을 각각 0~100으로 평가한다. verifiedFacts의 id만 evidenceIds에 넣는다. 근거 없는 수치·효능·성과는 절대 쓰지 않는다. 상품명을 붙인 범용 문구, '프리미엄 퀄리티', '특별한 경험', '지금 만나보세요'는 탈락 사유다. JSON만 반환한다.`,
  });
  const unique = new Set<string>();
  const hooks = payload.hooks
    .map((item): VideoHookCandidate => {
      const scores = {
        stopPower: Number(item.scores.stopPower),
        specificity: Number(item.scores.specificity),
        productRelevance: Number(item.scores.productRelevance),
        visualPotential: Number(item.scores.visualPotential),
        evidenceStrength: Number(item.scores.evidenceStrength),
        conversionPotential: Number(item.scores.conversionPotential),
        originality: Number(item.scores.originality),
        policySafety: Number(item.scores.policySafety),
      };
      return {
        id: `hook-${crypto.randomUUID()}`,
        hookType: item.hookType,
        hook: clean(item.hook, 100),
        customerProblem: clean(item.customerProblem, 160),
        evidenceIds: compact(
          item.evidenceIds.filter((id) => allowedEvidenceIds.has(id)),
          4,
          120
        ),
        visualIdea: clean(item.visualIdea, 400),
        score: { ...scores, total: scoreTotal(scores) },
        rejectionReasons: compact(item.rejectionReasons, 4, 160),
      };
    })
    .filter((item) => {
      const key = item.hook.replace(/[^0-9a-z가-힣]/gi, "").toLowerCase();
      if (!item.hook || unique.has(key)) return false;
      unique.add(key);
      return true;
    });
  if (!hooks.some((item) => item.hookType === "product-self-introduction")) {
    hooks.push(buildCurrentProductSelfIntroductionHook(analysis));
  }
  if (hooks.length < 7) {
    throw new VideoPlanningGenerationError({
      stage: "schema-validation",
      code: "HOOK_CANDIDATES_INSUFFICIENT",
      message: `AI가 유효한 후킹을 ${hooks.length}개만 생성했습니다. 최소 7개가 필요합니다.`,
      retryable: true,
      attempts: 1,
      failedAt: new Date().toISOString(),
    });
  }
  return hooks;
}


