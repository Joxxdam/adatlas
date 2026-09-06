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
  compactPlanningCta,
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

type AiConceptSummary = {
  conceptArchetype: VideoConceptArchetype;
  hookId: string;
  hookType: VideoHookType;
  title: string;
  openingHook: string;
  coreTarget: string;
  customerProblem: string;
  usp: string;
  speaker: string;
  creativeStyle: VideoCreativeStyle;
  narrativeStructure: string;
  narrativeSummary: string;
  recommendationReason: string;
  evidenceIds: string[];
  claimsToVerify: string[];
  cta: string;
  centralIncident: string;
  speakerPointOfView: string;
  keyAppeal: string;
  recommendedVisualStyle: string;
  supportingDevices: string[];
  differenceFromPrevious: string;
  copyVoiceDirection: string;
  targetCallout: string;
  distinctiveCharacter: string;
  socialWorld: string;
  storyTrigger: string;
  truthBridge: string;
  dramatizationBoundary: string;
};

function conceptSummarySchema(options: { count: number; archetypes?: VideoConceptArchetype[] }) {
  const archetypes = options.archetypes?.length
    ? options.archetypes
    : [...REQUIRED_VIDEO_CONCEPT_ARCHETYPES];
  return {
    type: "object",
    additionalProperties: false,
    required: ["concepts"],
    properties: {
      concepts: {
        type: "array",
        minItems: options.count,
        maxItems: options.count,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "conceptArchetype",
            "hookId",
            "hookType",
            "title",
            "openingHook",
            "coreTarget",
            "customerProblem",
            "usp",
            "speaker",
            "creativeStyle",
            "narrativeStructure",
            "narrativeSummary",
            "recommendationReason",
            "evidenceIds",
            "claimsToVerify",
            "cta",
            "centralIncident",
            "speakerPointOfView",
            "keyAppeal",
            "recommendedVisualStyle",
            "supportingDevices",
            "differenceFromPrevious",
            "copyVoiceDirection",
            "targetCallout",
            "distinctiveCharacter",
            "socialWorld",
            "storyTrigger",
            "truthBridge",
            "dramatizationBoundary",
          ],
          properties: {
            conceptArchetype: { type: "string", enum: archetypes },
            hookId: { type: "string" },
            hookType: hookTypeSchema,
            title: { type: "string", minLength: 6, maxLength: 70 },
            openingHook: { type: "string", minLength: 8, maxLength: 48 },
            coreTarget: { type: "string", minLength: 4, maxLength: 100 },
            customerProblem: { type: "string", minLength: 4, maxLength: 120 },
            usp: { type: "string", minLength: 4, maxLength: 120 },
            speaker: { type: "string", minLength: 2, maxLength: 80 },
            creativeStyle: {
              type: "string",
              enum: [
                "auto",
                "smartphone-ugc",
                "ad-real",
                "clay-miniature",
                "3d",
                "live-ai",
                "mixed",
              ],
            },
            narrativeStructure: { type: "string", minLength: 12, maxLength: 150 },
            narrativeSummary: { type: "string", minLength: 30, maxLength: 320 },
            recommendationReason: { type: "string", minLength: 20, maxLength: 300 },
            evidenceIds: { type: "array", maxItems: 6, items: { type: "string" } },
            claimsToVerify: { type: "array", maxItems: 6, items: { type: "string" } },
            cta: { type: "string", minLength: 4, maxLength: 34 },
            centralIncident: { type: "string", minLength: 12, maxLength: 240 },
            speakerPointOfView: { type: "string", minLength: 4, maxLength: 100 },
            keyAppeal: { type: "string", minLength: 4, maxLength: 140 },
            recommendedVisualStyle: { type: "string", minLength: 4, maxLength: 140 },
            supportingDevices: {
              type: "array",
              maxItems: 4,
              items: { type: "string", maxLength: 100 },
            },
            differenceFromPrevious: { type: "string", minLength: 8, maxLength: 180 },
            copyVoiceDirection: { type: "string", minLength: 12, maxLength: 180 },
            targetCallout: { type: "string", minLength: 8, maxLength: 60 },
            distinctiveCharacter: { type: "string", minLength: 12, maxLength: 220 },
            socialWorld: { type: "string", minLength: 12, maxLength: 220 },
            storyTrigger: { type: "string", minLength: 18, maxLength: 300 },
            truthBridge: { type: "string", minLength: 18, maxLength: 300 },
            dramatizationBoundary: { type: "string", minLength: 16, maxLength: 300 },
          },
        },
      },
    },
  } as const;
}

function conceptScore(hook?: VideoHookCandidate) {
  const fallback: HookScore = {
    stopPower: 0,
    specificity: 0,
    productRelevance: 0,
    visualPotential: 0,
    evidenceStrength: 0,
    conversionPotential: 0,
    originality: 0,
    policySafety: 0,
    total: 0,
  };
  const score = hook?.score || fallback;
  return {
    ...score,
    narrativeFlow: Math.round((score.productRelevance + score.visualPotential) / 2),
  };
}

export class VideoConceptPartialGenerationError extends VideoPlanningGenerationError {
  readonly partialConcepts: VideoConcept[];
  readonly failedArchetypes: VideoConceptArchetype[];

  constructor(input: {
    failure: ConstructorParameters<typeof VideoPlanningGenerationError>[0];
    partialConcepts: VideoConcept[];
    failedArchetypes: VideoConceptArchetype[];
    cause?: unknown;
  }) {
    super(input.failure, input.cause);
    this.name = "VideoConceptPartialGenerationError";
    this.partialConcepts = input.partialConcepts;
    this.failedArchetypes = [...new Set(input.failedArchetypes)];
  }
}

export async function generateVideoConceptSummariesAi(input: {
  advertiserName: string;
  analysis: ProductAnalysisSnapshot;
  guideline: BrandGuideline;
  duration: VideoDuration;
  objective: VideoObjective;
  hooks: VideoHookCandidate[];
  existingConcepts?: VideoConcept[];
  referenceAnalyses?: ReferenceVideoAnalysis[];
  conceptFormat?: VideoConceptFormat;
  requiredContent?: string;
  excludedContent?: string;
  requestedArchetype?: VideoConceptArchetype;
  recentParodyGenres?: VideoParodyGenre[];
  selectionSeed?: string;
  onConceptProgress?: (input: {
    concepts: VideoConcept[];
    unresolvedArchetypes: VideoConceptArchetype[];
    repairRounds: number;
  }) => void | Promise<void>;
}) {
  const candidates = [...input.hooks]
    .filter(
      (hook) =>
        !hook.rejectionReasons.length && hook.hookType !== "product-self-introduction"
    )
    .sort((left, right) => right.score.total - left.score.total)
    .slice(0, 10);
  const evidenceIds = new Set((input.analysis.verifiedFacts || []).map((fact) => fact.id));
  const copyGuide = await loadCopyGuideForProduct({
    advertiserName: input.advertiserName,
    brandName: input.analysis.brandName,
    productUrl: input.analysis.productUrl,
    category: input.analysis.category,
    productName: input.analysis.productName,
  });
  const selectedFormat = VIDEO_CONCEPT_FORMAT_OPTIONS.find(
    (item) => item.id === input.conceptFormat
  );
  const selectedParodyGenre = selectVideoParodyGenre({
    analysis: input.analysis,
    recentGenres: input.recentParodyGenres,
    seed: `${input.advertiserName}:${input.analysis.productName}`,
  });
  const blueprintSelections = selectVideoPlanningBlueprints({
    analysis: input.analysis,
    archetypes: input.requestedArchetype ? [input.requestedArchetype] : [...REQUIRED_VIDEO_CONCEPT_ARCHETYPES],
    parodyGenre: selectedParodyGenre.id,
    selectionSeed: input.selectionSeed,
  });
  const request = async (archetypes: VideoConceptArchetype[] | undefined, correction = "") =>
    runVideoPlanningAi<{ concepts: AiConceptSummary[] }>({
      stage: "concept-summaries",
      purpose: "concept",
      outputSchema: conceptSummarySchema({
        count: archetypes?.length || 1,
        archetypes,
      }) as unknown as Record<string, unknown>,
      prompt: `당신은 한국 퍼포먼스 광고 영상 기획자다. 아래 상품 근거와 평가된 후킹을 사용해 ${archetypes?.length ? `${archetypes.map((archetype) => VIDEO_CONCEPT_ARCHETYPE_OPTIONS.find((item) => item.id === archetype)?.label).join(" · ")} 기획안을 각각 1개씩, 총 ${archetypes.length}개` : "사용자가 선택한 형식의 기획안 1개"} 만든다.

[상품]
${JSON.stringify(promptFacts(input.analysis))}
[후킹 후보]
${JSON.stringify(candidates)}
[목표와 길이]
${input.duration}초, ${VIDEO_OBJECTIVE_LABELS[input.objective]}
${
  selectedFormat
    ? `[사용자가 선택한 영상 콘셉트]
${selectedFormat.title} · ${selectedFormat.description}
전개: ${selectedFormat.flow}
연출 규칙: ${selectedFormat.direction}
creativeStyle은 반드시 ${selectedFormat.creativeStyle}을 사용한다.`
    : ""
}
${
  archetypes?.length
    ? `[반드시 지킬 중심 유형]
${archetypes.map((archetype) => `${archetype} = ${VIDEO_CONCEPT_ARCHETYPE_OPTIONS.find((item) => item.id === archetype)?.label}: ${VIDEO_CONCEPT_ARCHETYPE_OPTIONS.find((item) => item.id === archetype)?.direction}`).join("\n")}
conceptArchetype은 위 유형을 정확히 한 번씩 사용한다.`
    : ""
}
[카테고리 연출 원칙]
${stylePrinciples(input.analysis.category)}
[브랜드 가이드]
${clean(copyGuide?.content || input.guideline.toneAndManner, 3000)}
[참고 영상의 구조·속도·자막 리듬]
${JSON.stringify(referenceVoiceSignals(input.referenceAnalyses))}
[레퍼런스 말투 전용 규칙]
${internetVoiceRules(input.analysis.category)}
[모든 상품에 적용하는 상품 중심 UGC 구체화 규칙]
${SPECIFIC_CREATIVE_WORLD_RULES}
[최신 4개 이야기 작동 방식]
${FOUR_CONCEPT_STORY_MECHANISM_RULES}
[레퍼런스 수준의 시청자 전달형 구어체·자막 규칙]
${NATURAL_REFERENCE_DIALOGUE_RULES}
[상세 분석 완료 영상 22개·617장면의 큐레이션 레퍼런스]
${JSON.stringify((archetypes || []).map((archetype) => ({ archetype, blueprint: blueprintPrompt(blueprintSelections[archetype]) })))}
${
  archetypes?.includes("parody")
    ? `[가벼운 콘셉트 장치형의 자동 선택 세부 장르]
${videoParodyGenrePrompt(selectedParodyGenre.id, input.recentParodyGenres)}`
    : ""
}
[반드시 넣을 내용]
${clean(input.requiredContent, 1500) || "없음"}
[제외할 내용]
${clean(input.excludedContent, 1500) || "없음"}
[이 프로젝트의 기존 기획안]
${JSON.stringify((input.existingConcepts || []).map((item) => ({ opening: item.openingHook, incident: item.centralIncident, speaker: item.speakerPointOfView || item.speaker, appeal: item.keyAppeal || item.usp })))}

첫 문장부터 상품명을 설명하지 말고 실제 숏폼에서 사람이 꺼낼 법한 짧은 한마디와 촬영 가능한 행동으로 시작한다. openingHook은 한 번에 말할 수 있는 8~32자의 완결문으로 쓰고, narrativeSummary·copyVoiceDirection은 주 화자가 카메라 너머 시청자에게 질문→상품 확인→보이는 증거→판단→행동을 이어 말하는 흐름이어야 한다. speakerPointOfView와 speaker는 장황한 인물 설정 대신 누가 어떤 상품 행동을 보여주는지만 적는다. 신규 자동 4안에서는 product-self-introduction을 선택하지 않는다.
title은 드라마 제목이 아니라 첫 화면과 상품 확인 행동이 떠오르는 짧은 광고 제목으로 쓴다. ‘사건’, ‘위기’, ‘사라진’, ‘비밀 장부’, ‘운명’, ‘구출’ 같은 극적 제목은 쓰지 않는다. ProductTruth는 사용할 상품 사실의 상한선이며 레퍼런스 원문은 말의 연결과 화면 순서의 기준이다. 장르 장치는 첫 1~3초에만 가볍게 쓰고 3초 이후 전체의 최소 70%를 상품 실물·개봉·조리·사용·질감·구성·가격 확인에 배정한다. 고유 이름과 가상 지역은 꼭 필요할 때만 쓰며, 가상 세계 설명이나 여러 인물이 대화하는 드라마를 만들지 않는다. 가상의 의사 가족 추천은 real-review에서 한 번의 짧은 개인 반응으로 허용하지만 가상 인물임을 dramatizationBoundary에 명시하고 의학적 효능·치료·보증으로 확대하지 않는다. 콘셉트 하나는 핵심 구매 이유 하나와 이를 받치는 상품 사실 두세 개만 고른다. 배송 정보는 완전히 제외한다. 네 안은 첫 화면·장소·상품을 처음 만지는 행동·핵심 증거·결말을 다르게 하고, 가족·주방·불판 조합은 최대 한 안에만 쓴다. CTA는 공백 제외 24자 이내의 완결된 한 문장으로 쓰고 반드시 ‘확인하세요’, ‘비교하세요’, ‘구매하세요’, ‘예약하세요’ 같은 행동 동사로 끝낸다. 모든 텍스트 필드는 허용 길이를 채우려 하지 말고 반드시 문장을 끝낸다. 배정된 주 블루프린트의 sourceTranscriptAndScenes 전체에서 자막 연결·행동·증거·반응·CTA 순서를 읽되 원문의 드라마 강도는 낮추고 상품 증거 비중은 높인다. 원문의 상품·가격·효능·인물·대사는 복제하지 않는다. 확인되지 않은 수치나 효능은 claimsToVerify에만 쓴다. hookId와 evidenceIds는 입력에 존재하는 값만 쓴다.
${correction} JSON만 반환한다.`,
    });
  const toConcepts = (rows: AiConceptSummary[]) => {
    const occupiedCodes = [...(input.existingConcepts || []).map((item) => item.materialCode)];
    return rows.map((row): VideoConcept => {
      const hook =
        input.hooks.find((item) => item.id === row.hookId) ||
        input.hooks.find((item) => item.hookType === row.hookType);
      const previous =
        input.existingConcepts?.find((item) => item.conceptArchetype === row.conceptArchetype);
      const now = new Date().toISOString();
      return {
        id: previous?.id || crypto.randomUUID(),
        title: clean(row.title, 100),
        hookType: row.hookType,
        coreTarget: clean(row.coreTarget, 140),
        objective: input.objective,
        openingHook: clean(row.openingHook, 100),
        fullScript: "",
        cuts: [],
        requiredSources: [],
        cta: compactPlanningCta(row.cta, "상품 정보를 확인하세요", 28),
        productionCautions: compact(input.analysis.cautionPhrases, 8, 240),
        materialCode:
          previous?.materialCode ||
          (() => {
            const code = createVideoMaterialCode({
              advertiserName: input.advertiserName,
              productName: input.analysis.productName,
              hookType: row.hookType,
              existingCodes: occupiedCodes,
            });
            occupiedCodes.push(code);
            return code;
          })(),
        generationSource: getVideoPlanningProvider() === "openai-api" ? "openai" : "codex-local",
        generationWarnings: [],
        revision: (previous?.revision || 0) + 1,
        createdAt: previous?.createdAt || now,
        updatedAt: now,
        customerProblem: clean(row.customerProblem, 180),
        usp: clean(row.usp, 180),
        creativeStyle: selectedFormat?.creativeStyle || row.creativeStyle,
        narrativeSummary: clean(row.narrativeSummary, 600),
        narrativeStructure: clean(row.narrativeStructure, 260),
        speaker: clean(row.speaker, 120),
        recommendationReason: clean(row.recommendationReason, 400),
        claimsToVerify: compact(row.claimsToVerify, 6, 200),
        evidenceIds: compact(
          row.evidenceIds.filter((id) => evidenceIds.has(id)),
          6,
          120
        ),
        score: { ...conceptScore(hook), total: hook?.score.total || 0 },
        detailStatus: "not-generated",
        conceptFormat: input.conceptFormat,
        conceptArchetype: row.conceptArchetype,
        centralIncident: clean(row.centralIncident, 320),
        speakerPointOfView: clean(row.speakerPointOfView, 140),
        keyAppeal: clean(row.keyAppeal, 200),
        recommendedVisualStyle: clean(row.recommendedVisualStyle, 200),
        supportingDevices: compact(row.supportingDevices, 4, 120),
        differenceFromPrevious: clean(row.differenceFromPrevious, 240),
        copyVoiceDirection: clean(row.copyVoiceDirection, 300),
        targetCallout: clean(row.targetCallout, 100),
        distinctiveCharacter: clean(row.distinctiveCharacter, 300),
        socialWorld: clean(row.socialWorld, 300),
        storyTrigger: clean(row.storyTrigger, 400),
        truthBridge: clean(row.truthBridge, 400),
        dramatizationBoundary: clean(row.dramatizationBoundary, 400),
        blueprintSelection: blueprintSelections[row.conceptArchetype],
        parodyGenre:
          row.conceptArchetype === "parody" ? selectedParodyGenre.id : undefined,
      };
    });
  };
  if (input.requestedArchetype) {
    let payload = await request([input.requestedArchetype]);
    const initialSpecificityIssue = currentVideoCreativePremiseIssue(payload.concepts[0]);
    const initialGenreMismatch =
      input.requestedArchetype === "parody" &&
      !matchesVideoParodyGenre(
        [
          payload.concepts[0]?.title,
          payload.concepts[0]?.openingHook,
          payload.concepts[0]?.centralIncident,
          payload.concepts[0]?.narrativeSummary,
          payload.concepts[0]?.narrativeStructure,
          payload.concepts[0]?.speaker,
          payload.concepts[0]?.speakerPointOfView,
          payload.concepts[0]?.recommendedVisualStyle,
          ...(payload.concepts[0]?.supportingDevices || []),
        ].join(" "),
        selectedParodyGenre.id
      );
    if (initialSpecificityIssue || initialGenreMismatch) {
      payload = await request(
        [input.requestedArchetype],
        [
          initialSpecificityIssue
            ? `이전 응답의 주 화자·촬영 환경·상품 확인 행동이 부적합했다: ${initialSpecificityIssue} 한 장소의 한 명 화자와 실제 상품 행동 중심으로 다시 구체화하고 드라마 서사는 만들지 않는다.`
            : "",
          initialGenreMismatch
            ? `자동 선택된 화면 장치 '${selectedParodyGenre.label}'가 보이지 않았다. 다른 장르나 드라마 줄거리를 섞지 말고 첫 1~3초의 소품·자막·말투에서만 이 장치를 분명하게 사용한다.`
            : "",
        ].filter(Boolean).join(" ")
      );
    }
    const finalSpecificityIssue = currentVideoCreativePremiseIssue(payload.concepts[0]);
    if (finalSpecificityIssue) {
      throw new VideoPlanningGenerationError({
        stage: "schema-validation",
        code: "CREATIVE_PREMISE_TOO_GENERIC",
        message: finalSpecificityIssue,
        retryable: true,
        attempts: 2,
        failedAt: new Date().toISOString(),
      });
    }
    if (
      input.requestedArchetype === "parody" &&
      !matchesVideoParodyGenre(
        payload.concepts.map((row) => [row.title, row.centralIncident, row.narrativeSummary, row.recommendedVisualStyle].join(" ")).join(" "),
        selectedParodyGenre.id
      )
    ) {
      throw new VideoPlanningGenerationError({
        stage: "schema-validation",
        code: "PARODY_GENRE_MISMATCH",
        message: "가벼운 콘셉트 장치형 기획안이 자동 선택된 화면 문법을 따르지 않았습니다.",
        retryable: true,
        attempts: 2,
        failedAt: new Date().toISOString(),
      });
    }
    return toConcepts(payload.concepts);
  }
  const findInvalidArchetypes = (rows: AiConceptSummary[]) => {
    const invalid = new Set<VideoConceptArchetype>();
    for (const row of rows) {
      // Unknown hook/evidence IDs are deterministically resolved or removed in
      // toConcepts(). They must not discard an otherwise distinct, fact-safe set.
      if (currentVideoCreativePremiseIssue(row)) invalid.add(row.conceptArchetype);
      if (
        row.conceptArchetype === "parody" &&
        !matchesVideoParodyGenre(
          [
            row.title,
            row.openingHook,
            row.centralIncident,
            row.narrativeSummary,
            row.narrativeStructure,
            row.speaker,
            row.speakerPointOfView,
            row.recommendedVisualStyle,
            ...row.supportingDevices,
          ].join(" "),
          selectedParodyGenre.id
        )
      ) {
        invalid.add("parody");
      }
    }
    const fields = rows.map((row) => [
      row.hookType,
      row.openingHook,
      row.centralIncident,
      row.distinctiveCharacter,
      row.socialWorld,
      row.storyTrigger,
      row.truthBridge,
      row.customerProblem,
      row.usp,
      row.speakerPointOfView || row.speaker,
      row.recommendedVisualStyle,
      row.narrativeStructure,
      row.cta,
    ]);
    for (let left = 0; left < fields.length; left += 1) {
      for (let right = left + 1; right < fields.length; right += 1) {
        const same = fields[left].filter(
          (value, index) => value && value === fields[right][index]
        ).length;
        if (same / fields[left].length >= 0.45) invalid.add(rows[right].conceptArchetype);
      }
    }
    return [...invalid];
  };

  let rows: AiConceptSummary[];
  try {
    rows = await requestFourVideoConcepts({
      requestBatch: async () => (await request([...REQUIRED_VIDEO_CONCEPT_ARCHETYPES])).concepts,
      requestOne: async (archetype, correction, preservedRows) =>
        (
          await request(
            [archetype],
            `${correction}
[그대로 보존할 다른 기획안]
${JSON.stringify(
  preservedRows.map((row) => ({
    conceptArchetype: row.conceptArchetype,
    openingHook: row.openingHook,
    distinctiveCharacter: row.distinctiveCharacter,
    socialWorld: row.socialWorld,
    storyTrigger: row.storyTrigger,
    centralIncident: row.centralIncident,
    truthBridge: row.truthBridge,
    keyAppeal: row.keyAppeal,
    speakerPointOfView: row.speakerPointOfView || row.speaker,
    recommendedVisualStyle: row.recommendedVisualStyle,
    cta: row.cta,
  }))
)}
위 기획안은 수정하거나 섞지 말고, 지금 요청한 ${archetype} 한 개만 완전히 다른 첫 화면·촬영 장소·상품 확인 행동·핵심 증거·결말로 작성한다. 인물 이름과 세계관을 바꾸는 방식으로만 차별화하지 않는다.`
          )
        ).concepts[0],
      initialStrategy: "per-archetype",
      concurrency: 2,
      findInvalidArchetypes,
      onProgress: async ({ preservedRows, unresolvedArchetypes, repairRounds }) => {
        await input.onConceptProgress?.({
          concepts: toConcepts(preservedRows),
          unresolvedArchetypes,
          repairRounds,
        });
      },
    });
  } catch (error) {
    if (error instanceof VideoPlanningGenerationError) throw error;
    const batchFailure =
      error instanceof VideoConceptBatchValidationError ? error : undefined;
    const failedArchetypes = [
      ...(batchFailure?.missingArchetypes || []),
      ...(batchFailure?.invalidArchetypes || []),
    ];
    const failedLabels = [...new Set(failedArchetypes)]
      .map(
        (archetype) =>
          VIDEO_CONCEPT_ARCHETYPE_OPTIONS.find((item) => item.id === archetype)?.label ||
          archetype
      )
      .join(" · ");
    const upstreamFailure = batchFailure?.requestFailures
      .map((item) => item.error)
      .find((item): item is VideoPlanningGenerationError =>
        item instanceof VideoPlanningGenerationError
      )?.failure;
    const failure = upstreamFailure || {
      stage: "schema-validation" as const,
      code: "CONCEPTS_NOT_DISTINCT",
      message: failedLabels
        ? `기획안 4개 중 ${failedLabels} 유형이 구체성·차별성 검수를 통과하지 못했습니다. 통과한 기획안은 보존했고 부적합 유형만 ${batchFailure?.repairRounds || 0}회 다시 생성했습니다.`
        : "기획안 4개는 생성했지만 구체성·차별성 검수를 통과하지 못했습니다.",
      retryable: true,
      attempts: 1 + (batchFailure?.repairRounds || 0),
      failedAt: new Date().toISOString(),
    };
    if (batchFailure?.preservedRows.length) {
      throw new VideoConceptPartialGenerationError({
        failure,
        partialConcepts: toConcepts(batchFailure.preservedRows as AiConceptSummary[]),
        failedArchetypes: [...new Set(failedArchetypes)],
        cause: error,
      });
    }
    throw new VideoPlanningGenerationError(failure, error);
  }
  const concepts = toConcepts(rows);
  if (!validateConceptDiversity(concepts).valid) {
    throw new VideoPlanningGenerationError({
      stage: "schema-validation",
      code: "CONCEPTS_NOT_DISTINCT",
      message: "기획안 4개는 생성했지만 최종 저장 전 차별성 검수를 통과하지 못했습니다.",
      retryable: true,
      attempts: 3,
      failedAt: new Date().toISOString(),
    });
  }
  return concepts;
}

