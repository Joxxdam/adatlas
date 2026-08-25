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
  type VideoParodyGenre,
} from "./types.ts";
import { createVideoMaterialCode, VIDEO_HOOK_LABELS, VIDEO_OBJECTIVE_LABELS } from "./workflow.ts";
import {
  assignPlanningTimeline,
  hasVerifiedVideoBenefit,
  repairDetailedPlanningAudienceCopy,
  repairDetailedPlanningCta,
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
} from "./videoPlanningConceptBatch.ts";
import {
  blueprintPrompt,
  getVideoPlanningBlueprint,
  selectVideoPlanningBlueprints,
} from "./videoPlanningBlueprints.ts";
import { runWithSingleVideoPlanningCorrection } from "./videoPlanningCorrection.ts";
import { analyzeReferenceAssets } from "./planningPipeline.ts";
import {
  matchesVideoParodyGenre,
  selectVideoParodyGenre,
  videoParodyGenrePrompt,
} from "./videoParodyGenres.ts";

const hookTypes = [...VIDEO_HOOK_TYPES];
const hookTypeSchema = { type: "string", enum: hookTypes } as const;

function clean(value: unknown, max = 1200) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
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

function internetVoiceRules(category: string) {
  const categoryExamples = /육류|축산|고기|식품|먹거리|과일|채소|농산|수산|음료/i.test(
    category
  )
    ? "예: ‘형님들 이 양 맞아요..?’, ‘아버지가 또 집어가심ㅎㅎ’처럼 식탁·가족·양·가격 상황에 붙인다."
    : /뷰티|바디|샤워|화장|세정|생활/i.test(category)
      ? "예: ‘땀 줄줄 흐르는 형님들 잠깐;;’, ‘운동 끝나면 겨냄새부터 신경 쓰이는 분들..?’처럼 타깃의 실제 행동·불편을 직접 부른다."
      : /패션|의류|신발|가방|주얼리/i.test(category)
        ? "예: ‘나만 핏 왜 이럼..?’ ‘이 조합 은근 반칙인데ㅎㅎ’처럼 착용·핏·코디 상황에 붙인다."
        : "예: ‘이거 나만 이제 알았나..?’ ‘잠깐;; 이게 된다고?’처럼 실제 사용 상황에 붙인다.";
  return `레퍼런스의 인터넷 구어체를 광고 문장으로 순화하거나 일반화하지 않는다. 타깃을 ‘20~40대 고객’처럼 인구통계로 부르지 말고, 상품과 맞닿은 행동·불편·욕망이 바로 보이는 별칭이나 호칭으로 찌른다. 예: ‘땀 줄줄 흐르는 형님들’, ‘냉장고 열 때마다 고기 찾는 분들ㅎㅎ’. ㅎㅎ, ..., ..?, ;;, 말줄임, 문장 파편, 직접 호칭을 콘셉트에 맞춰 2~4개 선택하고 간헐적으로 쓴다. 모든 문장에 기호를 붙이지 말고, 설명문보다 실제 사람이 댓글·독백으로 내뱉는 말처럼 쓴다. ${categoryExamples} targetCallout은 첫 3초 자막에 그대로 쓸 수 있는 8~28자의 한 문장으로 만든다. 예시는 말투만 참고하며 상품 근거에 없는 수치·체형·효능은 만들지 않고, 실존 인물 비하나 보호 특성에 대한 혐오 표현은 쓰지 않는다.`;
}

function referenceVoiceSignals(referenceAnalyses: ReferenceVideoAnalysis[] = []) {
  return referenceAnalyses
    .filter((item) => item.analysisStatus === "analyzed")
    .map((item) => ({
      opening: item.openingHookMethod,
      timing: item.timingMap,
      pace: item.averageCutLength,
      emotionalTone: item.emotionalTone,
      informationDensity: item.informationDensity,
      principles: item.reusablePrinciples,
    }));
}

type AiReferenceAnalysis = Omit<
  ReferenceVideoAnalysis,
  "analysisStatus" | "cutCount" | "averageCutLength"
> & {
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
          "assetId",
          "assetName",
          "analysisStatus",
          "openingHookMethod",
          "openingTiming",
          "cutCount",
          "averageCutLength",
          "cameraAndGaze",
          "actions",
          "informationDensity",
          "subtitlePosition",
          "transitions",
          "timingMap",
          "compositionRatio",
          "emotionalTone",
          "reusablePrinciples",
          "limitations",
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
              problem: { type: "string" },
              product: { type: "string" },
              usp: { type: "string" },
              cta: { type: "string" },
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
  // The Responses API receives no tools and cannot dereference a server-local video path.
  // Keep the uploaded reference in the project, but do not present an unobserved video as
  // AI-analyzed. The explicit codex-local provider retains the existing local media path.
  if (getVideoPlanningProvider() === "openai-api") {
    return analyzeReferenceAssets(assets);
  }

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
      purpose: "analysis",
      outputSchema: referenceAnalysisSchema as unknown as Record<string, unknown>,
      timeoutMs: Number(process.env.VIDEO_PLANNING_ANALYSIS_TIMEOUT_MS || 45_000),
      prompt: `당신은 숏폼 퍼포먼스 광고 편집 분석가다. 아래 로컬 참고 영상을 운영체제에서 사용할 수 있는 읽기 전용 미디어 정보 도구와 샘플 프레임으로 분석한다. 특정 명령어가 없으면 다른 읽기 전용 도구를 사용하고, 확인하지 못한 값은 추측하지 않는다. 새 이미지나 영상을 생성하지 않으며 원본 파일을 수정하지 않는다.

[로컬 참고 영상]
${JSON.stringify(videoAssets.map((asset) => ({ assetId: asset.id, assetName: asset.name, localPath: asset.localPath })))}

각 파일의 첫 장면 후킹 방식, 컷 전환 속도, 평균 자막 길이, 문제 제기 시점, 상품 등장 시점, 인물 말투, 장면 구성, 시각 변화, USP와 CTA 시점을 분석한다. emotionalTone에는 단순히 ‘친근함’이라고 일반화하지 말고 반말/존댓말, 직접 호칭, 문장 파편, 머뭇거림, 과장 직전의 직설성 같은 화법을 구체적으로 적는다. reusablePrinciples에는 구조·속도뿐 아니라 ㅎㅎ, ..., ..?, ;; 같은 말끝 장치, 호칭 방식, 댓글·독백 리듬을 원문 전체를 복제하지 않는 짧은 패턴으로 기록한다. 브랜드·인물·장면과 완성 문장을 복제하지 않는다. 실제로 확인하지 못한 항목은 추측하지 말고 analysisStatus를 limited로 두고 limitations에 이유를 쓴다. JSON만 반환한다.`,
    });
    const allowed = new Set(videoAssets.map((asset) => asset.id));
    const analyses = payload.analyses
      .filter((analysis) => allowed.has(analysis.assetId))
      .map((analysis): ReferenceVideoAnalysis => ({
        ...analysis,
        cutCount: analysis.cutCount || null,
        averageCutLength: analysis.averageCutLength || null,
      }));
    const completed = videoAssets.map(
      (asset) =>
        analyses.find((analysis) => analysis.assetId === asset.id) || {
          assetId: asset.id,
          assetName: asset.name,
          analysisStatus: "limited" as const,
          openingHookMethod: "확인 불가",
          openingTiming: "확인 불가",
          cutCount: null,
          averageCutLength: null,
          cameraAndGaze: [],
          actions: [],
          informationDensity: "확인 불가",
          subtitlePosition: "확인 불가",
          transitions: [],
          timingMap: {
            problem: "확인 불가",
            product: "확인 불가",
            usp: "확인 불가",
            cta: "확인 불가",
          },
          compositionRatio: { liveAction: null, animation: null, composite: null },
          emotionalTone: "확인 불가",
          reusablePrinciples: [],
          limitations: ["참고 영상의 프레임 구조를 완전히 확인하지 못했습니다."],
        }
    );
    return [...completed, ...nonVideos];
  } catch (error) {
    console.info(
      `[video-planning] stage=reference-analysis event=limited code=${error instanceof VideoPlanningGenerationError ? error.failure.code : "REFERENCE_ANALYSIS_LIMITED"}`
    );
    return [
      ...videoAssets.map((asset): ReferenceVideoAnalysis => ({
        assetId: asset.id,
        assetName: asset.name,
        analysisStatus: "limited",
        openingHookMethod: "첨부 영상 확인 필요",
        openingTiming: "확인 불가",
        cutCount: null,
        averageCutLength: null,
        cameraAndGaze: [],
        actions: [],
        informationDensity: "확인 불가",
        subtitlePosition: "확인 불가",
        transitions: [],
        timingMap: {
          problem: "확인 불가",
          product: "확인 불가",
          usp: "확인 불가",
          cta: "확인 불가",
        },
        compositionRatio: { liveAction: null, animation: null, composite: null },
        emotionalTone: "확인 불가",
        reusablePrinciples: [],
        limitations: [
          "참고 영상 분석만 제한되었습니다. 상품 근거 기반 4개 콘셉트 생성은 계속할 수 있습니다.",
        ],
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
${JSON.stringify(referenceVoiceSignals(referenceAnalyses))}

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
  copyVoiceDirection: string;
  targetCallout: string;
  benefitAvailability: "verified" | "insufficient";
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
            "benefitAvailability",
          ],
          properties: {
            conceptArchetype: { type: "string", enum: archetypes },
            hookId: { type: "string" },
            hookType: hookTypeSchema,
            title: { type: "string", minLength: 6, maxLength: 70 },
            openingHook: { type: "string", minLength: 8, maxLength: 70 },
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
            supportingDevices: {
              type: "array",
              maxItems: 4,
              items: { type: "string", maxLength: 100 },
            },
            differenceFromPrevious: { type: "string", minLength: 8, maxLength: 180 },
            copyVoiceDirection: { type: "string", minLength: 12, maxLength: 240 },
            targetCallout: { type: "string", minLength: 8, maxLength: 60 },
            benefitAvailability: { type: "string", enum: ["verified", "insufficient"] },
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
  requestedArchetype?: VideoConceptArchetype;
  recentParodyGenres?: VideoParodyGenre[];
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
  const selectedFormat = VIDEO_CONCEPT_FORMAT_OPTIONS.find(
    (item) => item.id === input.conceptFormat
  );
  const fourConceptMode =
    !input.requestedArchetype && (input.planningMode === "four-concepts" || !selectedFormat);
  const hasVerifiedBenefit = hasVerifiedVideoBenefit(input.analysis);
  const blueprintSelections = selectVideoPlanningBlueprints({
    analysis: input.analysis,
    archetypes: input.requestedArchetype
      ? [input.requestedArchetype]
      : [...REQUIRED_VIDEO_CONCEPT_ARCHETYPES],
  });
  const selectedParodyGenre = selectVideoParodyGenre({
    analysis: input.analysis,
    recentGenres: input.recentParodyGenres,
    seed: `${input.advertiserName}:${input.analysis.productName}`,
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
[분석 완료 영상 11개의 큐레이션 블루프린트]
${JSON.stringify((archetypes || []).map((archetype) => ({ archetype, blueprint: blueprintPrompt(blueprintSelections[archetype]) })))}
${
  archetypes?.includes("parody")
    ? `[사건·상황극형의 자동 선택 세부 장르]
${videoParodyGenrePrompt(selectedParodyGenre.id, input.recentParodyGenres)}`
    : ""
}
[반드시 넣을 내용]
${clean(input.requiredContent, 1500) || "없음"}
[제외할 내용]
${clean(input.excludedContent, 1500) || "없음"}
[이 프로젝트의 기존 기획안]
${JSON.stringify((input.existingConcepts || []).map((item) => ({ opening: item.openingHook, incident: item.centralIncident, speaker: item.speakerPointOfView || item.speaker, appeal: item.keyAppeal || item.usp })))}

첫 문장부터 상품명을 설명하지 말고 실제 숏폼에서 사람이 멈춰 볼 센 사건이나 한마디로 시작한다. title은 ‘정체를 확인합니다’, ‘차이를 알아봅니다’ 같은 설명형 제목이 아니라 누가 어떤 상황에서 무슨 일을 겪는지 한눈에 보이는 사건형 제목으로 쓴다. 상품 사실은 바꾸지 않되 표현과 상황은 과감하게 창작한다. coreTarget은 분석용 고객 정의로 쓰고, targetCallout은 그 고객의 행동·불편·욕망을 찌르는 자극적인 직접 호명으로 별도 작성한다. targetCallout은 ‘운동하는 남성’ 같은 일반 명사가 아니라 ‘땀 줄줄 흐르는 형님들 잠깐;;’처럼 첫 3초 자막에 바로 쓸 수 있어야 한다. 첫 자막, 중심 사건, 화자 시점, 갈등 원인, 상품 등장 방식, 핵심 소구, 결말·CTA, 화면 스타일을 기존 기획안과 다르게 만든다. copyVoiceDirection에는 이 콘셉트에서 실제로 사용할 호칭·말끝·문장 파편·직설 강도를 구체적으로 적고 ‘친근한 말투’, ‘자연스러운 구어체’처럼 일반화하지 않는다. 각 콘셉트는 배정된 주 블루프린트의 전체 전개를 우선하고 보조 블루프린트에서는 훅 또는 CTA 장치 하나만 가져온다. 사건·상황극형은 서버가 지정한 세부 장르를 블루프린트보다 우선하며 다른 장르로 바꾸거나 혼합하지 않는다. 참고 영상은 사건 구조와 말투 장치를 현재 상품에 맞게 변환하되 원문 전체·특정 인물·상품 사실은 복제하지 않는다. 확인되지 않은 수치나 효능은 claimsToVerify에만 쓰고 확정 문구로 쓰지 않는다. hookId와 evidenceIds는 입력에 존재하는 값만 쓴다. 실제 이미지나 영상을 생성하지 않으며 상세 대본은 아직 만들지 않는다.
${archetypes?.includes("secret-benefit") && !hasVerifiedBenefit ? "secret-benefit 기획안은 확인된 혜택이 없으므로 benefitAvailability를 insufficient로 두고, keyAppeal과 narrativeSummary에는 ‘확인 가능한 혜택 정보가 부족합니다’를 포함하며 가격·할인·배송·증정을 창작하지 않는다." : ""}
${correction} JSON만 반환한다.`,
    });
  const toConcepts = (rows: AiConceptSummary[]) => {
    const occupiedCodes = [...(input.existingConcepts || []).map((item) => item.materialCode)];
    return rows.map((row): VideoConcept => {
      const hook =
        input.hooks.find((item) => item.id === row.hookId) ||
        input.hooks.find((item) => item.hookType === row.hookType);
      const previous =
        input.existingConcepts?.find((item) => item.conceptArchetype === row.conceptArchetype) ||
        input.existingConcepts?.find((item) => item.hookType === row.hookType);
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
        benefitAvailability: row.benefitAvailability,
        blueprintSelection: blueprintSelections[row.conceptArchetype],
        parodyGenre:
          row.conceptArchetype === "parody" ? selectedParodyGenre.id : undefined,
      };
    });
  };
  if (input.requestedArchetype) {
    let payload = await request([input.requestedArchetype]);
    if (
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
      )
    ) {
      payload = await request(
        [input.requestedArchetype],
        `이전 응답이 자동 선택 장르 '${selectedParodyGenre.label}'을 따르지 않았다. 법정 등 다른 장르를 섞지 말고 선택 장르의 사건·인물·화면 문법이 제목과 중심 사건에 명시적으로 드러나게 다시 작성한다.`
      );
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
        message: "사건·상황극 기획안이 자동 선택된 세부 장르를 따르지 않았습니다.",
        retryable: true,
        attempts: 2,
        failedAt: new Date().toISOString(),
      });
    }
    return toConcepts(payload.concepts);
  }
  if (!fourConceptMode) {
    const payload = await request(undefined);
    return toConcepts(payload.concepts);
  }

  const findInvalidArchetypes = (rows: AiConceptSummary[]) => {
    const invalid = new Set<VideoConceptArchetype>();
    for (const row of rows) {
      // Unknown hook/evidence IDs are deterministically resolved or removed in
      // toConcepts(). They must not discard an otherwise distinct, fact-safe set.
      if (
        row.conceptArchetype === "secret-benefit" &&
        !hasVerifiedBenefit &&
        row.benefitAvailability !== "insufficient"
      ) {
        invalid.add(row.conceptArchetype);
      }
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
      requestOne: async (archetype, correction) =>
        (await request([archetype], correction)).concepts[0],
      findInvalidArchetypes,
    });
  } catch (error) {
    throw new VideoPlanningGenerationError(
      {
        stage: "schema-validation",
        code: "CONCEPTS_NOT_DISTINCT",
        message: "AI가 서로 충분히 다른 기획안 4개를 만들지 못했습니다.",
        retryable: true,
        attempts: 2,
        failedAt: new Date().toISOString(),
      },
      error
    );
  }
  const concepts = toConcepts(rows);
  if (!validateConceptDiversity(concepts).valid) {
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
            caption: { type: "string", minLength: 4, maxLength: 46 },
            sceneDescription: { type: "string", minLength: 80, maxLength: 700 },
          },
        },
      },
      fullScript: { type: "string", minLength: 40, maxLength: 3000 },
    },
  } as const;
}

function rowsToCuts(
  rows: AiScriptRow[],
  duration: VideoDuration,
  existing?: VideoCut[],
  concept?: VideoConcept
) {
  const blueprint = getVideoPlanningBlueprint(concept?.blueprintSelection?.primaryId);
  return assignPlanningTimeline(rows, duration).map((row, index): VideoCut => {
    const beat =
      blueprint?.beats[
        Math.min(
          blueprint.beats.length - 1,
          Math.floor((index / rows.length) * blueprint.beats.length)
        )
      ];
    return {
      id: existing?.[index]?.id || crypto.randomUUID(),
      cutNumber: index + 1,
      sceneName: `구간 ${String(index + 1).padStart(2, "0")}`,
      startSecond: row.startSecond,
      endSecond: row.endSecond,
      caption: clean(row.caption, 80),
      narration: "",
      sceneDescription: clean(row.sceneDescription, 1000),
      requiredSources: beat ? [beat.visual] : [],
      referenceImages: [],
      productionMemo: beat
        ? `${blueprint?.title}의 ${beat.role} 리듬 참고. 원문 자막과 원본 인물은 복제하지 않음.`
        : "",
      sceneFormat: blueprint?.format.includes("클레이") ? "AI 클레이·미니어처" : "실사·상품 B-roll",
      cameraComposition: beat?.visual || "장면의 핵심 행동이 한눈에 보이는 세로형 구도",
      motionDirection: beat?.direction || "한 화면에 하나의 행동이 명확히 보이게 연출",
      transition:
        index === rows.length - 1
          ? "CTA에서 종료"
          : `다음 ${blueprint?.beats[Math.min(blueprint.beats.length - 1, Math.floor(((index + 1) / rows.length) * blueprint.beats.length))]?.role || "장면"}으로 빠르게 전환`,
    };
  });
}

function removeLiteralForbidden(value: string, forbidden: string[]) {
  let next = value;
  for (const phrase of forbidden.map((item) => clean(item, 180)).filter(Boolean)) {
    next = next
      .replaceAll(phrase, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }
  return next;
}

function sanitizeGeneratedConceptCopy(concept: VideoConcept, forbidden: string[]): VideoConcept {
  const apply = (value: string) => removeLiteralForbidden(value, forbidden);
  return {
    ...concept,
    title: apply(concept.title),
    openingHook: apply(concept.openingHook),
    fullScript: apply(concept.fullScript),
    cta: apply(concept.cta),
    cuts: concept.cuts.map((cut) => ({
      ...cut,
      caption: apply(cut.caption),
      narration: apply(cut.narration),
      sceneDescription: apply(cut.sceneDescription),
    })),
  };
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
  parodyGenre: input.concept.parodyGenre,
  narrative: input.concept.narrativeStructure,
  incident: input.concept.centralIncident,
  pointOfView: input.concept.speakerPointOfView,
  keyAppeal: input.concept.keyAppeal,
  visualStyle: input.concept.recommendedVisualStyle,
  supportingDevices: input.concept.supportingDevices,
  copyVoiceDirection: input.concept.copyVoiceDirection,
  targetCallout: input.concept.targetCallout,
  cta: input.concept.cta,
  evidenceIds: input.concept.evidenceIds,
})}
${
  input.concept.conceptFormat
    ? `[선택 형식 연출 규칙]
${VIDEO_CONCEPT_FORMAT_OPTIONS.find((item) => item.id === input.concept.conceptFormat)?.direction || "선택 형식의 연출 문법을 일관되게 유지한다."}`
    : ""
}
${
  input.concept.conceptArchetype
    ? `[중심 콘셉트 규칙]
${VIDEO_CONCEPT_ARCHETYPE_OPTIONS.find((item) => item.id === input.concept.conceptArchetype)?.direction || "선택된 중심 유형의 사건과 시점을 끝까지 유지한다."}`
    : ""
}
${
  input.concept.conceptArchetype === "parody" && input.concept.parodyGenre
    ? `[선택된 사건·상황극 세부 장르]
${videoParodyGenrePrompt(input.concept.parodyGenre)}`
    : ""
}
[브랜드 기준]
${JSON.stringify({ tone: input.guideline.toneAndManner, required: input.guideline.requiredPhrases, forbidden: input.guideline.forbiddenPhrases })}
[카테고리 원칙]
${stylePrinciples(input.analysis.category)}
[참고 영상에서 재사용할 전개 원칙]
${JSON.stringify(referenceVoiceSignals(input.referenceAnalyses))}
[레퍼런스 말투 전용 규칙]
${internetVoiceRules(input.analysis.category)}
[이 콘셉트에 배정된 큐레이션 블루프린트]
${blueprintPrompt(input.concept.blueprintSelection)}
[사용자 수정 요청]
${clean(input.revisionFeedback, 1600) || "없음"}

정확히 ${count}개 구간을 만든다. 첫 3개 행은 각각 첫 1초, 2초, 3초에 해당하고 최소 2번 화면이 확실히 바뀐다. 배정된 주 블루프린트의 장면 역할과 전체 리듬을 상품에 맞게 전용하고, 보조 블루프린트는 훅 또는 CTA 장치 하나만 참고한다. 첫 자막부터 상품명을 설명하지 않는다. 첫 3개 자막 중 하나에는 targetCallout을 그대로 또는 말맛만 유지한 짧은 변형으로 반드시 넣는다.

[자막 분량과 완성도]
- 첫 1~3초 자막은 화면 전환 속도에 맞춰 공백 제외 8~18자로 쓴다. 짧아도 타깃 호명·문제·반응 중 하나가 완결되어야 한다.
- 4번째부터 마지막 직전까지는 공백 제외 14~34자를 기본으로 한다. UI에서 2줄로 보일 수 있는 한 문장 또는 자연스럽게 이어지는 두 문장 파편으로 쓴다.
- 자막 전체는 46자를 넘지 않는다. 한 단어짜리 표제, 두세 단어짜리 기획 메모, 주어와 맥락이 없는 라벨은 금지한다.
- 한 화면에는 하나의 생각만 두되, 시청자가 그 자막만 읽어도 누구의 어떤 불편·반응·구매 이유인지 이해할 수 있어야 한다.
- copyVoiceDirection을 대본 전체에 유지하고, 첫 8개 자막 중 최소 4개에는 그 방향의 직접 호칭·말끝·문장 파편 가운데 하나가 실제로 드러나야 한다.
- ‘담당자:’, ‘진행자:’, ‘정보 부족’, ‘확인부터요’, ‘검증’, ‘도장’, ‘태블릿’, ‘표’, ‘USP’, ‘CTA’처럼 제작자만 이해하는 화자 라벨·기획 용어·장면 소품을 자막으로 쓰지 않는다. 이런 정보는 sceneDescription에만 쓴다.
- [상품의 검증된 사실]은 사실값만 가져오는 내부 근거다. ‘상세페이지 구성 표기는’, ‘상세페이지에서 확인된’, ‘확인 결과’, ‘근거상’, ‘~로 보입니다’, ‘~표기에요’처럼 출처를 판독하는 검수 문장은 절대 자막에 쓰지 않는다.
- 확인된 중량·가격·할인 값은 내부 출처를 설명하지 말고 시청자 반응으로 바로 말한다. 나쁜 예: ‘상세페이지 구성 표기는 5KG로 보입니다’, ‘71% 할인 표기에요’. 좋은 방향: ‘5KG라고..? 이건 좀 놀랍죠?’, ‘71% 할인이라니 그냥 지나치기 어렵죠;;’.
- 나쁜 예: ‘담당자: 확인부터요’, ‘할인? 정보 부족’. 좋은 방향: ‘형님들.. 씻었는데도 이 냄새 남았죠?’, ‘가격 얘긴 빼고 사용감부터 까볼게요ㅎㅎ’. 예시는 말투와 정보량만 참고하고 현재 상품 사실과 타깃에 맞게 새로 쓴다.

‘이 제품의 정체를 확인합니다’, ‘핵심 차이를 살펴봅니다’ 같은 진행자 설명문으로 순화하지 않는다. ㅎㅎ, ..., ..?, ;;는 감정이 생기는 자막에만 간헐적으로 사용한다. 상세페이지 문장을 잘라 붙이지 않고 같은 문장과 상품명을 반복하지 않는다. 마지막 행의 caption에는 기획안의 CTA 문구를 정확히 포함한다.

참고 영상의 품질 원칙처럼 첫 1~3초에는 인물·상품·검증된 가격 중 하나를 강하게 노출하고, 6초 전에는 다른 피사체 또는 B-roll로 전환한다. 발표자와 원물·생산·사용·가격·신뢰 장면을 교차하고 상품은 초반부터 반복 노출한다. 원문 자막과 특정 인물·장면은 복제하지 않는다.

각 sceneDescription은 100자 이상이며 촬영팀이 그대로 실행할 수 있게 등장인물·사물, 장소·배경, 구체 행동, 표정·반응, 카메라 구도, 필요한 제품 노출, 활용 B-roll, 전환·편집 방식, 기존 촬영본 재사용 가능 여부를 자연스러운 문장으로 모두 쓴다. 각 행에 '첫 화면', '장소', '주체', '행동', '관찰 가능한 반응', '다음 전환'이 반드시 문장으로 드러나야 한다. 사람이 없는 제품·원물 B-roll의 반응은 표면 변화·윤기·색감·거품·물방울·수증기·질감처럼 카메라로 확인할 수 있는 시각 반응으로 쓴다. 반드시 무엇이 먼저 보이고 다음 구간에서 무엇으로 바뀌는지도 명시한다. '고객의 문제 상황을 보여준다', 'USP를 클로즈업한다', '근거를 제시한다', '사용 전후를 비교한다', '제품 전체와 CTA를 보여준다' 같은 추상 문장은 금지한다.

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
    purpose: input.correction ? "correction" : "script",
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
  const toValidatedConcept = (
    payload: { rows: AiScriptRow[]; fullScript: string },
    previous: VideoConcept,
    revised: boolean
  ) => {
    let concept: VideoConcept = {
      ...previous,
      cuts: rowsToCuts(payload.rows, input.duration, input.concept.cuts, input.concept),
      fullScript: clean(payload.fullScript, 4000),
      detailStatus: "ready",
      generationFailure: undefined,
      revision: previous.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    concept = repairDetailedPlanningSceneDescriptions(concept, input.analysis);
    concept = sanitizeGeneratedConceptCopy(concept, input.guideline.forbiddenPhrases);
    concept = repairDetailedPlanningAudienceCopy(concept);
    concept = repairDetailedPlanningCta(concept);
    concept.validation = {
      ...validateDetailedPlanning(concept, input.analysis, input.duration),
      revised,
    };
    return concept;
  };
  const result = await runWithSingleVideoPlanningCorrection({
    requestInitial: async () =>
      toValidatedConcept(await requestDetailedRows(input), input.concept, false),
    isValid: (concept) => concept.validation?.valid === true,
    requestCorrection: async (concept) => {
      const failures =
        concept.validation?.checks.filter((check) => !check.passed).map((check) => check.message) ||
        [];
      const payload = await requestDetailedRows({
        ...input,
        concept,
        correction: `자동 검수에서 다음 문제가 발견됐다. 다른 항목은 유지하고 문제를 모두 수정해 전체 대본을 다시 반환한다: ${failures.join(" / ")}`,
        referenceAnalyses: input.referenceAnalyses,
      });
      return toValidatedConcept(payload, concept, true);
    },
  });
  const concept = result.value;
  const validation = concept.validation!;
  if (!validation.valid) {
    throw new VideoPlanningGenerationError({
      stage: "quality-review",
      code: "SCRIPT_QUALITY_FAILED",
      message: validation.checks
        .filter((check) => !check.passed)
        .map((check) => check.message)
        .join(" "),
      retryable: true,
      attempts: 2,
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
      ? {
          caption: input.concept.cuts[index - 1].caption,
          scene: input.concept.cuts[index - 1].sceneDescription,
        }
      : null,
    current: { caption: current.caption, scene: current.sceneDescription },
    next: input.concept.cuts[index + 1]
      ? {
          caption: input.concept.cuts[index + 1].caption,
          scene: input.concept.cuts[index + 1].sceneDescription,
        }
      : null,
  };
  const fieldSchema =
    input.field === "caption"
      ? {
          type: "object",
          additionalProperties: false,
          required: ["caption"],
          properties: { caption: { type: "string", minLength: 4, maxLength: 46 } },
        }
      : {
          type: "object",
          additionalProperties: false,
          required: ["sceneDescription"],
          properties: { sceneDescription: { type: "string", minLength: 80, maxLength: 700 } },
        };
  const result = await runVideoPlanningAi<{ caption?: string; sceneDescription?: string }>({
    stage: "detailed-script",
    purpose: "segment",
    reasoningEffort: "low",
    outputSchema: fieldSchema,
    prompt: `아래 영상 대본에서 ${index + 1}번째 구간의 ${input.field === "caption" ? "자막" : "영상 장면 설명"}만 다시 쓴다. 다른 행은 바꾸지 않는다. 상품 근거에 없는 수치나 효능을 쓰지 않고 앞뒤 흐름을 자연스럽게 잇는다. 자막이라면 기획안의 말투 방향과 타깃 호명을 유지하고 일반적인 광고 설명문으로 순화하지 않는다. 첫 1~3초 자막은 공백 제외 8~18자, 그 뒤 마지막 CTA 전 자막은 공백 제외 14~34자의 완결된 시청자용 구어체로 쓰며 전체 46자를 넘지 않는다. ‘담당자:’, ‘진행자:’, ‘정보 부족’, ‘확인부터요’, ‘검증’, ‘도장’, ‘태블릿’, ‘표’, ‘USP’, ‘CTA’ 같은 내부 화자 라벨·기획 용어·장면 소품은 자막으로 쓰지 않는다. ProductTruth와 상세페이지는 사실 확인용 내부 근거일 뿐이다. ‘상세페이지 구성 표기는’, ‘확인된 표기’, ‘확인 결과’, ‘근거상’, ‘~로 보입니다’, ‘~표기에요’ 같은 검수 문장을 자막에 쓰지 말고, 확인된 사실값을 시청자 반응형 문장으로 바로 표현한다. ${internetVoiceRules(input.analysis.category)} 장면 설명이라면 구체적인 장소·배경·인물/상품·행동·표정·첫 시각 요소·자막과 연결되는 사건·다음 변화/전환을 80자 이상으로 모두 포함한다. JSON만 반환한다.\n상품=${JSON.stringify(promptFacts(input.analysis))}\n기획안=${JSON.stringify({ title: input.concept.title, hook: input.concept.openingHook, cta: input.concept.cta, copyVoiceDirection: input.concept.copyVoiceDirection, targetCallout: input.concept.targetCallout })}\n앞뒤=${JSON.stringify(neighbor)}`,
  });
  const cuts = input.concept.cuts.map((cut) =>
    cut.id === input.cutId
      ? {
          ...cut,
          ...(input.field === "caption"
            ? { caption: clean(result.caption, 80) }
            : { sceneDescription: clean(result.sceneDescription, 1000) }),
        }
      : cut
  );
  let concept: VideoConcept = {
    ...input.concept,
    cuts,
    fullScript: cuts.map((cut) => cut.narration || cut.caption).join(" "),
    revision: input.concept.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  concept = repairDetailedPlanningSceneDescriptions(concept, input.analysis);
  concept = sanitizeGeneratedConceptCopy(concept, input.guideline.forbiddenPhrases);
  concept = repairDetailedPlanningAudienceCopy(concept);
  concept = repairDetailedPlanningCta(concept);
  concept.validation = validateDetailedPlanning(concept, input.analysis, input.duration);
  return concept;
}
