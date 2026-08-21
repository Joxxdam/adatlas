import "server-only";

import crypto from "node:crypto";
import { existsSync } from "node:fs";
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
} from "./types.ts";
import { createVideoMaterialCode, VIDEO_HOOK_LABELS, VIDEO_OBJECTIVE_LABELS } from "./workflow.ts";
import {
  assignPlanningTimeline,
  hasVerifiedVideoBenefit,
  segmentRange,
  validateConceptDiversity,
  validateDetailedPlanning,
} from "./planningValidation.ts";
import { runVideoPlanningAi, VideoPlanningGenerationError } from "./videoPlanningAi.server.ts";

const hookTypes = [...VIDEO_HOOK_TYPES];
const hookTypeSchema = { type: "string", enum: hookTypes } as const;

function clean(value: unknown, max = 1200) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function compact(values: unknown[], limit = 12, max = 240) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const item = clean(value, max);
    const key = item.replace(/[^0-9a-z가-힣]/gi, "").toLowerCase();
    if (!item || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

function promptFacts(analysis: ProductAnalysisSnapshot) {
  return {
    productName: analysis.productName,
    brandName: analysis.brandName,
    category: analysis.category,
    price: analysis.price,
    promotion: analysis.promotion || analysis.discountInfo,
    volumeOrOption: analysis.volumeOrOption || "",
    composition: compact(analysis.composition || [], 8),
    minimumOrderQuantity: analysis.minimumOrderQuantity || "",
    shippingConditions: compact(analysis.shippingConditions || [], 6),
    origin: analysis.countryOfOrigin || "",
    ingredients: compact(analysis.ingredients || [], 8),
    manufacturingProcess: compact(analysis.manufacturingProcess || [], 8),
    certifications: compact(analysis.certifications || [], 6),
    actualBenefits: compact(analysis.actualBenefits || [], 8),
    verifiedBenefits: compact(analysis.coreUsps, 8),
    productFeatures: compact(analysis.keyFeatures, 10),
    customerProblems: compact(analysis.customerProblems, 6),
    targetSituations: compact(analysis.useSituations || [], 6),
    targetCustomers: compact(analysis.targetCustomers, 6),
    expectedChanges: compact(analysis.expectedChanges || [], 6),
    reviews: compact(analysis.repeatedReviewPhrases || analysis.trustSignals, 6),
    differentiators: compact(analysis.differentiators || [], 6),
    visualizableElements: compact(analysis.visualizableElements || [], 8),
    verifiedNumbers: compact(analysis.verifiedNumbers || [], 12),
    verifiedFacts: (analysis.verifiedFacts || []).slice(0, 24).map((fact) => ({
      id: fact.id,
      label: fact.label,
      value: fact.value,
      source: fact.source,
    })),
    inferredAngles: (analysis.inferredAngles || []).slice(0, 12).map((fact) => ({
      id: fact.id,
      label: fact.label,
      value: fact.value,
    })),
    unsupportedClaims: (analysis.unsupportedClaims || []).slice(0, 12).map((fact) => fact.value),
    cautionPhrases: compact(analysis.cautionPhrases, 10),
    rawDescription: clean(analysis.rawDescription, 2400),
  };
}

function stylePrinciples(category: string) {
  if (/육류|축산|고기|식품|먹거리/i.test(category)) {
    return "외식비·실제 먹는 양·조리 과정·육즙과 식감·가족 식사·캠핑·선물·원산지와 부위 중 확인된 사실만 사용한다.";
  }
  if (/뷰티|바디|샤워|화장|생활/i.test(category)) {
    return "사용 전 불편·운동이나 외출 뒤 샤워·향과 질감과 쿨링 같은 감각·원료와 확인된 수치·사용 후 체감·후기·브랜드 배경을 구체적인 일상 장면으로 만든다.";
  }
  if (/농산|과일|채소|수산/i.test(category)) {
    return "산지·생산자·수확·크기와 양·신선도·일반 상품과 차이·실제 요리와 식사 중 확인된 사실을 장면화한다.";
  }
  if (/패션|의류|신발|가방/i.test(category)) {
    return "체형과 핏·착용 전후·소재·움직이는 실루엣·출근과 여행 등 상황·코디·디테일을 장면화한다.";
  }
  return "상품의 실제 사용 장소와 고객 행동을 중심으로 카테고리에 맞는 구체적인 장면을 만든다.";
}

type AiReferenceAnalysis = Omit<ReferenceVideoAnalysis, "analysisStatus" | "cutCount" | "averageCutLength"> & {
  analysisStatus: "analyzed" | "limited";
  cutCount: number;
  averageCutLength: number;
};

const referenceAnalysisSchema = {
  type: "object",
  additionalProperties: false,
  required: ["analyses"],
  properties: {
    analyses: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "assetId", "assetName", "analysisStatus", "openingHookMethod", "openingTiming",
          "cutCount", "averageCutLength", "cameraAndGaze", "actions", "informationDensity",
          "subtitlePosition", "transitions", "timingMap", "compositionRatio", "emotionalTone",
          "reusablePrinciples", "limitations",
        ],
        properties: {
          assetId: { type: "string" },
          assetName: { type: "string" },
          analysisStatus: { type: "string", enum: ["analyzed", "limited"] },
          openingHookMethod: { type: "string", minLength: 4, maxLength: 240 },
          openingTiming: { type: "string", minLength: 2, maxLength: 80 },
          cutCount: { type: "integer", minimum: 0, maximum: 500 },
          averageCutLength: { type: "number", minimum: 0, maximum: 120 },
          cameraAndGaze: { type: "array", maxItems: 10, items: { type: "string" } },
          actions: { type: "array", maxItems: 12, items: { type: "string" } },
          informationDensity: { type: "string", maxLength: 240 },
          subtitlePosition: { type: "string", maxLength: 200 },
          transitions: { type: "array", maxItems: 10, items: { type: "string" } },
          timingMap: {
            type: "object",
            additionalProperties: false,
            required: ["problem", "product", "usp", "cta"],
            properties: {
              problem: { type: "string" }, product: { type: "string" },
              usp: { type: "string" }, cta: { type: "string" },
            },
          },
          compositionRatio: {
            type: "object",
            additionalProperties: false,
            required: ["liveAction", "animation", "composite"],
            properties: {
              liveAction: { type: "integer", minimum: 0, maximum: 100 },
              animation: { type: "integer", minimum: 0, maximum: 100 },
              composite: { type: "integer", minimum: 0, maximum: 100 },
            },
          },
          emotionalTone: { type: "string", maxLength: 200 },
          reusablePrinciples: { type: "array", maxItems: 10, items: { type: "string" } },
          limitations: { type: "array", maxItems: 10, items: { type: "string" } },
        },
      },
    },
  },
} as const;

function localReferencePath(asset: VideoReferenceAsset) {
  const referencesRoot = path.resolve(process.cwd(), "public", "video-collaboration", "references");
  const relative = asset.filePath.replace(/^\/+/, "");
  const resolved = path.resolve(process.cwd(), "public", relative);
  if (!resolved.startsWith(`${referencesRoot}${path.sep}`) || !existsSync(resolved)) return "";
  return resolved;
}

export async function analyzeVideoReferencesAi(assets: VideoReferenceAsset[]) {
  const videoAssets = assets
    .filter((asset) => asset.mimeType.startsWith("video/"))
    .map((asset) => ({ ...asset, localPath: localReferencePath(asset) }))
    .filter((asset) => Boolean(asset.localPath))
    .slice(0, 3);
  const nonVideos: ReferenceVideoAnalysis[] = assets
    .filter((asset) => !asset.mimeType.startsWith("video/"))
    .map((asset) => ({
      assetId: asset.id,
      assetName: asset.name,
      analysisStatus: "not-applicable",
      openingHookMethod: "정지 자료",
      openingTiming: "해당 없음",
      cutCount: null,
      averageCutLength: null,
      cameraAndGaze: [],
      actions: [],
      informationDensity: "해당 없음",
      subtitlePosition: "해당 없음",
      transitions: [],
      timingMap: { problem: "해당 없음", product: "해당 없음", usp: "해당 없음", cta: "해당 없음" },
      compositionRatio: { liveAction: null, animation: null, composite: null },
      emotionalTone: "해당 없음",
      reusablePrinciples: [],
      limitations: ["정지 자료는 영상 컷 타이밍 분석 대상이 아닙니다."],
    }));
  if (!videoAssets.length) return nonVideos;

  try {
    const payload = await runVideoPlanningAi<{ analyses: AiReferenceAnalysis[] }>({
      stage: "reference-analysis",
      outputSchema: referenceAnalysisSchema as unknown as Record<string, unknown>,
      timeoutMs: Number(process.env.VIDEO_PLANNING_REFERENCE_TIMEOUT_MS || 180_000),
      prompt: `당신은 숏폼 퍼포먼스 광고 편집 분석가다. 아래 로컬 참고 영상을 운영체제에서 사용할 수 있는 읽기 전용 미디어 정보 도구와 샘플 프레임으로 분석한다. 특정 명령어가 없으면 다른 읽기 전용 도구를 사용하고, 확인하지 못한 값은 추측하지 않는다. 새 이미지나 영상을 생성하지 않으며 원본 파일을 수정하지 않는다.

[로컬 참고 영상]
${JSON.stringify(videoAssets.map((asset) => ({ assetId: asset.id, assetName: asset.name, localPath: asset.localPath })))}

각 파일의 첫 장면 후킹 방식, 컷 전환 속도, 평균 자막 길이, 문제 제기 시점, 상품 등장 시점, 인물 말투를 추정할 수 있는 화면 리듬, 장면 구성, 시각 변화, USP와 CTA 시점을 분석한다. 브랜드·인물·장면을 복제할 지시가 아니라 현재 상품에 재사용할 구조·속도·자막 리듬만 reusablePrinciples에 쓴다. 실제로 확인하지 못한 항목은 추측하지 말고 analysisStatus를 limited로 두고 limitations에 이유를 쓴다. JSON만 반환한다.`,
    });
    const allowed = new Set(videoAssets.map((asset) => asset.id));
    const analyses = payload.analyses
      .filter((analysis) => allowed.has(analysis.assetId))
      .map((analysis): ReferenceVideoAnalysis => ({
        ...analysis,
        cutCount: analysis.cutCount || null,
        averageCutLength: analysis.averageCutLength || null,
      }));
    const completed = videoAssets.map((asset) => analyses.find((analysis) => analysis.assetId === asset.id) || ({
      assetId: asset.id,
      assetName: asset.name,
      analysisStatus: "limited" as const,
      openingHookMethod: "확인 불가",
      openingTiming: "확인 불가",
      cutCount: null,
      averageCutLength: null,
      cameraAndGaze: [], actions: [], informationDensity: "확인 불가", subtitlePosition: "확인 불가",
      transitions: [], timingMap: { problem: "확인 불가", product: "확인 불가", usp: "확인 불가", cta: "확인 불가" },
      compositionRatio: { liveAction: null, animation: null, composite: null }, emotionalTone: "확인 불가",
      reusablePrinciples: [], limitations: ["참고 영상의 프레임 구조를 완전히 확인하지 못했습니다."],
    }));
    return [...completed, ...nonVideos];
  } catch (error) {
    console.info(`[video-planning] stage=reference-analysis event=limited code=${error instanceof VideoPlanningGenerationError ? error.failure.code : "REFERENCE_ANALYSIS_LIMITED"}`);
    return [
      ...videoAssets.map((asset): ReferenceVideoAnalysis => ({
        assetId: asset.id,
        assetName: asset.name,
        analysisStatus: "limited",
        openingHookMethod: "첨부 영상 확인 필요",
        openingTiming: "확인 불가",
        cutCount: null,
        averageCutLength: null,
        cameraAndGaze: [], actions: [], informationDensity: "확인 불가", subtitlePosition: "확인 불가",
        transitions: [], timingMap: { problem: "확인 불가", product: "확인 불가", usp: "확인 불가", cta: "확인 불가" },
        compositionRatio: { liveAction: null, animation: null, composite: null }, emotionalTone: "확인 불가",
        reusablePrinciples: [], limitations: ["참고 영상 분석만 제한되었습니다. 상품 근거 기반 4개 콘셉트 생성은 계속할 수 있습니다."],
      })),
      ...nonVideos,
    ];
  }
}

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
${JSON.stringify(referenceAnalyses.filter((item) => item.analysisStatus === "analyzed").map((item) => ({ opening: item.openingHookMethod, timing: item.timingMap, pace: item.averageCutLength, principles: item.reusablePrinciples })))}

[필수 유형]
고객 문제, 가격과 양, 손해 회피, 예상 밖 비교, 원산지와 원물, 사용 전후, 후기와 신뢰, 계절과 상황, 궁금증, 상식 뒤집기, 감각 장면, 실제 사용자 독백을 폭넓게 사용한다. hookType은 제공된 enum 중 가장 가까운 값을 쓴다.

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
        evidenceIds: compact(item.evidenceIds.filter((id) => allowedEvidenceIds.has(id)), 4, 120),
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
  benefitAvailability: "verified" | "insufficient";
};

function conceptSummarySchema(archetype?: VideoConceptArchetype) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["concepts"],
    properties: {
      concepts: {
        type: "array",
        minItems: 1,
        maxItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "conceptArchetype", "hookId", "hookType", "title", "openingHook", "coreTarget", "customerProblem",
            "usp", "speaker", "creativeStyle", "narrativeStructure", "narrativeSummary",
            "recommendationReason", "evidenceIds", "claimsToVerify", "cta", "centralIncident",
            "speakerPointOfView", "keyAppeal", "recommendedVisualStyle", "supportingDevices",
            "differenceFromPrevious", "benefitAvailability",
          ],
          properties: {
            conceptArchetype: { type: "string", enum: archetype ? [archetype] : ["parody", "real-review", "usp-focus", "secret-benefit"] },
            hookId: { type: "string" },
            hookType: hookTypeSchema,
            title: { type: "string", minLength: 6, maxLength: 70 },
            openingHook: { type: "string", minLength: 8, maxLength: 70 },
            coreTarget: { type: "string", minLength: 4, maxLength: 100 },
            customerProblem: { type: "string", minLength: 4, maxLength: 120 },
            usp: { type: "string", minLength: 4, maxLength: 120 },
            speaker: { type: "string", minLength: 2, maxLength: 80 },
            creativeStyle: { type: "string", enum: ["auto", "smartphone-ugc", "ad-real", "clay-miniature", "3d", "live-ai", "mixed"] },
            narrativeStructure: { type: "string", minLength: 12, maxLength: 180 },
            narrativeSummary: { type: "string", minLength: 30, maxLength: 400 },
            recommendationReason: { type: "string", minLength: 20, maxLength: 300 },
            evidenceIds: { type: "array", maxItems: 6, items: { type: "string" } },
            claimsToVerify: { type: "array", maxItems: 6, items: { type: "string" } },
            cta: { type: "string", minLength: 4, maxLength: 50 },
            centralIncident: { type: "string", minLength: 12, maxLength: 240 },
            speakerPointOfView: { type: "string", minLength: 4, maxLength: 100 },
            keyAppeal: { type: "string", minLength: 4, maxLength: 140 },
            recommendedVisualStyle: { type: "string", minLength: 4, maxLength: 140 },
            supportingDevices: { type: "array", maxItems: 4, items: { type: "string", maxLength: 100 } },
            differenceFromPrevious: { type: "string", minLength: 8, maxLength: 180 },
            benefitAvailability: { type: "string", enum: ["verified", "insufficient"] },
          },
        },
      },
    },
  } as const;
}

function conceptScore(hook?: VideoHookCandidate) {
  const fallback: HookScore = {
    stopPower: 0, specificity: 0, productRelevance: 0, visualPotential: 0,
    evidenceStrength: 0, conversionPotential: 0, originality: 0, policySafety: 0, total: 0,
  };
  const score = hook?.score || fallback;
  return { ...score, narrativeFlow: Math.round((score.productRelevance + score.visualPotential) / 2) };
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
  planningMode?: "legacy" | "four-concepts";
  requiredContent?: string;
  excludedContent?: string;
}) {
  const candidates = [...input.hooks]
    .filter((hook) => !hook.rejectionReasons.length)
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
  const selectedFormat = VIDEO_CONCEPT_FORMAT_OPTIONS.find((item) => item.id === input.conceptFormat);
  const fourConceptMode = input.planningMode === "four-concepts" || !selectedFormat;
  const archetypes: Array<VideoConceptArchetype | undefined> = fourConceptMode
    ? VIDEO_CONCEPT_ARCHETYPE_OPTIONS.map((item) => item.id)
    : [undefined];
  const hasVerifiedBenefit = hasVerifiedVideoBenefit(input.analysis);
  const request = async (archetype: VideoConceptArchetype | undefined, correction = "") => runVideoPlanningAi<{ concepts: AiConceptSummary[] }>({
    stage: "concept-summaries",
    outputSchema: conceptSummarySchema(archetype) as unknown as Record<string, unknown>,
    prompt: `당신은 한국 퍼포먼스 광고 영상 기획자다. 아래 상품 근거와 평가된 후킹을 사용해 ${archetype ? `${VIDEO_CONCEPT_ARCHETYPE_OPTIONS.find((item) => item.id === archetype)?.label} 기획안 1개` : "사용자가 선택한 형식의 기획안 1개"}만 만든다.

[상품]
${JSON.stringify(promptFacts(input.analysis))}
[후킹 후보]
${JSON.stringify(candidates)}
[목표와 길이]
${input.duration}초, ${VIDEO_OBJECTIVE_LABELS[input.objective]}
${selectedFormat ? `[사용자가 선택한 영상 콘셉트]
${selectedFormat.title} · ${selectedFormat.description}
전개: ${selectedFormat.flow}
연출 규칙: ${selectedFormat.direction}
creativeStyle은 반드시 ${selectedFormat.creativeStyle}을 사용한다.` : ""}
${archetype ? `[반드시 지킬 중심 유형]
${VIDEO_CONCEPT_ARCHETYPE_OPTIONS.find((item) => item.id === archetype)?.label}: ${VIDEO_CONCEPT_ARCHETYPE_OPTIONS.find((item) => item.id === archetype)?.direction}
conceptArchetype은 반드시 ${archetype}이다.` : ""}
[카테고리 연출 원칙]
${stylePrinciples(input.analysis.category)}
[브랜드 가이드]
${clean(copyGuide?.content || input.guideline.toneAndManner, 3000)}
[참고 영상의 구조·속도·자막 리듬]
${JSON.stringify((input.referenceAnalyses || []).filter((item) => item.analysisStatus === "analyzed").map((item) => ({ opening: item.openingHookMethod, timing: item.timingMap, pace: item.averageCutLength, principles: item.reusablePrinciples })))}
[반드시 넣을 내용]
${clean(input.requiredContent, 1500) || "없음"}
[제외할 내용]
${clean(input.excludedContent, 1500) || "없음"}
[이 프로젝트의 기존 기획안]
${JSON.stringify((input.existingConcepts || []).map((item) => ({ opening: item.openingHook, incident: item.centralIncident, speaker: item.speakerPointOfView || item.speaker, appeal: item.keyAppeal || item.usp })))}

첫 문장부터 상품명을 설명하지 말고 실제 숏폼에서 사람이 멈춰 볼 센 사건이나 한마디로 시작한다. 상품 사실은 바꾸지 않되 표현과 상황은 과감하게 창작한다. 첫 자막, 중심 사건, 화자 시점, 갈등 원인, 상품 등장 방식, 핵심 소구, 결말·CTA, 화면 스타일을 기존 기획안과 다르게 만든다. 참고 영상은 첫 1~3초 강한 인물/상품/가격 후킹, 6초 전후 B-roll 전환, 상품의 이른 반복 노출, 중반의 원산지·과정·가격 근거, 마지막 직접 CTA라는 편집 원리만 참고하고 원문은 복제하지 않는다. 확인되지 않은 수치나 효능은 claimsToVerify에만 쓰고 확정 문구로 쓰지 않는다. hookId와 evidenceIds는 입력에 존재하는 값만 쓴다. 실제 이미지나 영상을 생성하지 않으며 상세 대본은 아직 만들지 않는다.
${archetype === "secret-benefit" && !hasVerifiedBenefit ? "확인된 혜택이 없으므로 benefitAvailability는 insufficient, keyAppeal과 narrativeSummary에는 ‘확인 가능한 혜택 정보가 부족합니다’를 포함하고 가격·할인·배송·증정을 창작하지 않는다." : ""}
${correction} JSON만 반환한다.`,
  });
  const toConcepts = (rows: AiConceptSummary[]) => {
    const occupiedCodes = [...(input.existingConcepts || []).map((item) => item.materialCode)];
    return rows.map((row): VideoConcept => {
    const hook = input.hooks.find((item) => item.id === row.hookId) ||
      input.hooks.find((item) => item.hookType === row.hookType);
    const previous = input.existingConcepts?.find((item) => item.hookType === row.hookType);
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
      cta: clean(row.cta, 80),
      productionCautions: compact(input.analysis.cautionPhrases, 8, 240),
      materialCode: previous?.materialCode || (() => {
        const code = createVideoMaterialCode({
          advertiserName: input.advertiserName,
          productName: input.analysis.productName,
          hookType: row.hookType,
          existingCodes: occupiedCodes,
        });
        occupiedCodes.push(code);
        return code;
      })(),
      generationSource: "codex-local",
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
      evidenceIds: compact(row.evidenceIds.filter((id) => evidenceIds.has(id)), 6, 120),
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
      benefitAvailability: row.benefitAvailability,
    };
    });
  };
  const rows: AiConceptSummary[] = [];
  for (const archetype of archetypes) {
    const payload = await request(archetype);
    rows.push(...payload.concepts);
  }
  let concepts = toConcepts(rows);
  if (fourConceptMode && !validateConceptDiversity(concepts).valid) {
    const retryRows: AiConceptSummary[] = [];
    for (const archetype of archetypes) {
      const payload = await request(archetype, "이전 결과와 첫 자막·중심 사건·화자·갈등·상품 등장·핵심 소구·결말·화면 스타일이 겹쳤다. 이 중심 유형의 문법을 유지하면서 완전히 다른 사건으로 다시 구성한다.");
      retryRows.push(...payload.concepts);
    }
    concepts = toConcepts(retryRows);
  }
  if (fourConceptMode && !validateConceptDiversity(concepts).valid) {
    throw new VideoPlanningGenerationError({
      stage: "schema-validation",
      code: "CONCEPTS_NOT_DISTINCT",
      message: "AI가 서로 충분히 다른 기획안 4개를 만들지 못했습니다.",
      retryable: true,
      attempts: 2,
      failedAt: new Date().toISOString(),
    });
  }
  return concepts;
}

type AiScriptRow = { caption: string; sceneDescription: string };

function scriptSchema(duration: VideoDuration) {
  const count = segmentRange(duration).preferred;
  return {
    type: "object",
    additionalProperties: false,
    required: ["rows", "fullScript"],
    properties: {
      rows: {
        type: "array",
        minItems: count,
        maxItems: count,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["caption", "sceneDescription"],
          properties: {
            caption: { type: "string", minLength: 2, maxLength: 34 },
            sceneDescription: { type: "string", minLength: 80, maxLength: 700 },
          },
        },
      },
      fullScript: { type: "string", minLength: 40, maxLength: 3000 },
    },
  } as const;
}

function rowsToCuts(rows: AiScriptRow[], duration: VideoDuration, existing?: VideoCut[]) {
  return assignPlanningTimeline(rows, duration).map((row, index): VideoCut => ({
    id: existing?.[index]?.id || crypto.randomUUID(),
    cutNumber: index + 1,
    sceneName: `구간 ${String(index + 1).padStart(2, "0")}`,
    startSecond: row.startSecond,
    endSecond: row.endSecond,
    caption: clean(row.caption, 80),
    narration: "",
    sceneDescription: clean(row.sceneDescription, 1000),
    requiredSources: [],
    referenceImages: [],
    productionMemo: "",
  }));
}

function detailedPrompt(input: {
  analysis: ProductAnalysisSnapshot;
  guideline: BrandGuideline;
  concept: VideoConcept;
  duration: VideoDuration;
  correction?: string;
  referenceAnalyses?: ReferenceVideoAnalysis[];
  revisionFeedback?: string;
}) {
  const count = segmentRange(input.duration).preferred;
  return `당신은 촬영팀이 추가 질문 없이 실행할 수 있는 한국 퍼포먼스 광고 숏폼 대본을 쓴다.

[상품의 검증된 사실]
${JSON.stringify(promptFacts(input.analysis))}
[선택한 기획안]
${JSON.stringify({
    title: input.concept.title,
    hookType: VIDEO_HOOK_LABELS[input.concept.hookType],
    openingHook: input.concept.openingHook,
    target: input.concept.coreTarget,
    problem: input.concept.customerProblem,
    usp: input.concept.usp,
    speaker: input.concept.speaker,
    style: input.concept.creativeStyle,
    selectedConceptFormat: input.concept.conceptFormat,
    conceptArchetype: input.concept.conceptArchetype,
    narrative: input.concept.narrativeStructure,
    incident: input.concept.centralIncident,
    pointOfView: input.concept.speakerPointOfView,
    keyAppeal: input.concept.keyAppeal,
    visualStyle: input.concept.recommendedVisualStyle,
    supportingDevices: input.concept.supportingDevices,
    cta: input.concept.cta,
  evidenceIds: input.concept.evidenceIds,
})}
${input.concept.conceptFormat ? `[선택 형식 연출 규칙]
${VIDEO_CONCEPT_FORMAT_OPTIONS.find((item) => item.id === input.concept.conceptFormat)?.direction || "선택 형식의 연출 문법을 일관되게 유지한다."}` : ""}
${input.concept.conceptArchetype ? `[중심 콘셉트 규칙]
${VIDEO_CONCEPT_ARCHETYPE_OPTIONS.find((item) => item.id === input.concept.conceptArchetype)?.direction || "선택된 중심 유형의 사건과 시점을 끝까지 유지한다."}` : ""}
[브랜드 기준]
${JSON.stringify({ tone: input.guideline.toneAndManner, required: input.guideline.requiredPhrases, forbidden: input.guideline.forbiddenPhrases })}
[카테고리 원칙]
${stylePrinciples(input.analysis.category)}
[참고 영상에서 재사용할 전개 원칙]
${JSON.stringify((input.referenceAnalyses || []).filter((item) => item.analysisStatus === "analyzed").map((item) => ({ opening: item.openingHookMethod, timing: item.timingMap, pace: item.averageCutLength, principles: item.reusablePrinciples })))}
[사용자 수정 요청]
${clean(input.revisionFeedback, 1600) || "없음"}

정확히 ${count}개 구간을 만든다. 첫 3개 행은 각각 첫 1초, 2초, 3초에 해당하고 최소 2번 화면이 확실히 바뀐다. 강한 첫마디→사건 또는 의심→갈등 확대→상품 등장→확인된 근거→반전 또는 납득→확인된 혜택→CTA를 중심 유형에 맞게 변주한다. 첫 자막부터 상품명을 설명하지 않는다. 자막은 보통 6~22자의 실제 릴스 구어체이며 같은 문장과 상품명을 반복하지 않는다. 상세페이지 문장을 잘라 붙이지 않고 한 화면에 하나의 행동과 한 문장만 둔다. 마지막 행의 caption에는 기획안의 CTA 문구를 정확히 포함한다.

참고 영상의 품질 원칙처럼 첫 1~3초에는 인물·상품·검증된 가격 중 하나를 강하게 노출하고, 6초 전에는 다른 피사체 또는 B-roll로 전환한다. 발표자와 원물·생산·사용·가격·신뢰 장면을 교차하고 상품은 초반부터 반복 노출한다. 원문 자막과 특정 인물·장면은 복제하지 않는다.

각 sceneDescription은 100자 이상이며 촬영팀이 그대로 실행할 수 있게 등장인물·사물, 장소·배경, 구체 행동, 표정·반응, 카메라 구도, 필요한 제품 노출, 활용 B-roll, 전환·편집 방식, 기존 촬영본 재사용 가능 여부를 자연스러운 문장으로 모두 쓴다. 반드시 무엇이 먼저 보이고 다음 구간에서 무엇으로 바뀌는지도 명시한다. '고객의 문제 상황을 보여준다', 'USP를 클로즈업한다', '근거를 제시한다', '사용 전후를 비교한다', '제품 전체와 CTA를 보여준다' 같은 추상 문장은 금지한다.

검증된 사실에 없는 숫자·효능·원산지·후기·성과는 쓰지 않는다. 이미지, 이미지 프롬프트, 이미지 생성, visualBible, productLockedAsset은 만들지 않는다. ${input.correction || ""} JSON만 반환한다.`;
}

async function requestDetailedRows(input: {
  analysis: ProductAnalysisSnapshot;
  guideline: BrandGuideline;
  concept: VideoConcept;
  duration: VideoDuration;
  correction?: string;
  referenceAnalyses?: ReferenceVideoAnalysis[];
  revisionFeedback?: string;
}) {
  return runVideoPlanningAi<{ rows: AiScriptRow[]; fullScript: string }>({
    stage: input.correction ? "automatic-revision" : "detailed-script",
    outputSchema: scriptSchema(input.duration) as unknown as Record<string, unknown>,
    prompt: detailedPrompt(input),
  });
}

export async function generateDetailedVideoScriptAi(input: {
  analysis: ProductAnalysisSnapshot;
  guideline: BrandGuideline;
  concept: VideoConcept;
  duration: VideoDuration;
  referenceAnalyses?: ReferenceVideoAnalysis[];
  revisionFeedback?: string;
}) {
  let payload = await requestDetailedRows(input);
  let concept: VideoConcept = {
    ...input.concept,
    cuts: rowsToCuts(payload.rows, input.duration, input.concept.cuts),
    fullScript: clean(payload.fullScript, 4000),
    detailStatus: "ready",
    generationFailure: undefined,
    revision: input.concept.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  concept.validation = validateDetailedPlanning(concept, input.analysis, input.duration);
  for (let revisionAttempt = 1; revisionAttempt <= 2 && !concept.validation.valid; revisionAttempt += 1) {
    const failures = concept.validation.checks.filter((check) => !check.passed).map((check) => check.message);
    payload = await requestDetailedRows({
      ...input,
      concept,
      correction: `자동 검수 ${revisionAttempt}차에서 다음 문제가 발견됐다. 다른 항목은 유지하고 문제를 모두 수정해 전체 대본을 다시 반환한다: ${failures.join(" / ")}`,
      referenceAnalyses: input.referenceAnalyses,
    });
    concept = {
      ...concept,
      cuts: rowsToCuts(payload.rows, input.duration, input.concept.cuts),
      fullScript: clean(payload.fullScript, 4000),
      revision: concept.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    concept.validation = { ...validateDetailedPlanning(concept, input.analysis, input.duration), revised: true };
  }
  if (!concept.validation.valid) {
    throw new VideoPlanningGenerationError({
      stage: "quality-review",
      code: "SCRIPT_QUALITY_FAILED",
      message: concept.validation.checks.filter((check) => !check.passed).map((check) => check.message).join(" "),
      retryable: true,
      attempts: 3,
      failedAt: new Date().toISOString(),
    });
  }
  return concept;
}

export async function regeneratePlanningSegmentAi(input: {
  analysis: ProductAnalysisSnapshot;
  guideline: BrandGuideline;
  concept: VideoConcept;
  cutId: string;
  field: "caption" | "sceneDescription";
  duration: VideoDuration;
}) {
  const index = input.concept.cuts.findIndex((cut) => cut.id === input.cutId);
  if (index < 0) throw new Error("다시 생성할 구간을 찾지 못했습니다.");
  const current = input.concept.cuts[index];
  const neighbor = {
    previous: input.concept.cuts[index - 1]
      ? { caption: input.concept.cuts[index - 1].caption, scene: input.concept.cuts[index - 1].sceneDescription }
      : null,
    current: { caption: current.caption, scene: current.sceneDescription },
    next: input.concept.cuts[index + 1]
      ? { caption: input.concept.cuts[index + 1].caption, scene: input.concept.cuts[index + 1].sceneDescription }
      : null,
  };
  const fieldSchema = input.field === "caption"
    ? { type: "object", additionalProperties: false, required: ["caption"], properties: { caption: { type: "string", minLength: 2, maxLength: 34 } } }
    : { type: "object", additionalProperties: false, required: ["sceneDescription"], properties: { sceneDescription: { type: "string", minLength: 80, maxLength: 700 } } };
  const result = await runVideoPlanningAi<{ caption?: string; sceneDescription?: string }>({
    stage: "detailed-script",
    outputSchema: fieldSchema,
    prompt: `아래 영상 대본에서 ${index + 1}번째 구간의 ${input.field === "caption" ? "자막" : "영상 장면 설명"}만 다시 쓴다. 다른 행은 바꾸지 않는다. 상품 근거에 없는 수치나 효능을 쓰지 않고 앞뒤 흐름을 자연스럽게 잇는다. 장면 설명이라면 구체적인 장소·배경·인물/상품·행동·표정·첫 시각 요소·자막과 연결되는 사건·다음 변화/전환을 80자 이상으로 모두 포함한다. JSON만 반환한다.\n상품=${JSON.stringify(promptFacts(input.analysis))}\n기획안=${JSON.stringify({ title: input.concept.title, hook: input.concept.openingHook, cta: input.concept.cta })}\n앞뒤=${JSON.stringify(neighbor)}`,
  });
  const cuts = input.concept.cuts.map((cut) => cut.id === input.cutId
    ? {
        ...cut,
        ...(input.field === "caption"
          ? { caption: clean(result.caption, 80) }
          : { sceneDescription: clean(result.sceneDescription, 1000) }),
      }
    : cut);
  const concept = {
    ...input.concept,
    cuts,
    fullScript: cuts.map((cut) => cut.narration || cut.caption).join(" "),
    revision: input.concept.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  concept.validation = validateDetailedPlanning(concept, input.analysis, input.duration);
  return concept;
}
