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
  const provider = getVideoPlanningProvider();
  const mediaAssets = assets
    .filter((asset) => asset.mimeType.startsWith("image/") || (provider === "codex-local" && asset.mimeType.startsWith("video/")))
    .map((asset) => ({ ...asset, localPath: localReferencePath(asset) }))
    .filter((asset) => Boolean(asset.localPath))
    .slice(0, 3);
  const selectedAssetIds = new Set(mediaAssets.map((asset) => asset.id));
  const unavailableAssets: ReferenceVideoAnalysis[] = assets
    .filter((asset) => !selectedAssetIds.has(asset.id))
    .map((asset) => ({
      assetId: asset.id,
      assetName: asset.name,
      analysisStatus: asset.mimeType.startsWith("video/") || asset.mimeType.startsWith("image/") ? "limited" : "not-applicable",
      openingHookMethod: "확인 불가",
      openingTiming: "확인 불가",
      cutCount: null,
      averageCutLength: null,
      cameraAndGaze: [],
      actions: [],
      informationDensity: "확인 불가",
      subtitlePosition: "확인 불가",
      transitions: [],
      timingMap: { problem: "해당 없음", product: "해당 없음", usp: "해당 없음", cta: "해당 없음" },
      compositionRatio: { liveAction: null, animation: null, composite: null },
      emotionalTone: "확인 불가",
      reusablePrinciples: [],
      limitations: [
        provider === "openai-api" && asset.mimeType.startsWith("video/")
          ? "현재 Responses API 영상 기획 경로는 정지 이미지 레퍼런스만 직접 판독합니다."
          : "참고 자료 파일을 읽지 못했거나 지원하지 않는 형식입니다.",
      ],
    }));
  if (!mediaAssets.length) return unavailableAssets;

  try {
    const payload = await runVideoPlanningAi<{ analyses: AiReferenceAnalysis[] }>({
      stage: "reference-analysis",
      purpose: "analysis",
      outputSchema: referenceAnalysisSchema as unknown as Record<string, unknown>,
      timeoutMs: Number(process.env.VIDEO_PLANNING_ANALYSIS_TIMEOUT_MS || 45_000),
      imageDataUrls:
        provider === "openai-api"
          ? await Promise.all(
              mediaAssets.map(async (asset) =>
                `data:${asset.mimeType};base64,${(await readFile(asset.localPath)).toString("base64")}`
              )
            )
          : undefined,
      prompt: `당신은 숏폼 퍼포먼스 광고 편집 분석가다. ${provider === "openai-api" ? "첨부된 정지 광고 이미지를 직접 확인한다." : "아래 로컬 참고 영상 또는 정지 광고 이미지를 읽기 전용 도구로 직접 확인한다."} 확인하지 못한 값은 추측하지 않는다. 새 이미지나 영상을 생성하지 않으며 원본 파일을 수정하지 않는다.

[참고 자료]
${JSON.stringify(mediaAssets.map((asset) => ({ assetId: asset.id, assetName: asset.name, mimeType: asset.mimeType, ...(provider === "codex-local" ? { localPath: asset.localPath } : {}) })))}

영상은 첫 장면 후킹, 컷 속도, 자막 길이, 문제·상품·USP·CTA 시점, 인물 말투와 시각 변화를 분석한다. 정지 광고 이미지는 cutCount=1, averageCutLength=0으로 두고 openingTiming에는 ‘첫 화면’을 쓴다. 이미지 안에서 실제로 읽히는 헤드라인·가격·보조 문구, 가장 먼저 보이는 피사체, 상품의 식감·사용 욕구 또는 사람의 반응을 어떻게 후킹으로 만든 것인지, 가격이 주인공인지 보조 근거인지를 분석한다. 이미지에 없는 움직임이나 대사를 창작하지 않는다.

emotionalTone에는 단순히 ‘친근함’이라고 일반화하지 말고 반말/존댓말, 직접 호칭, 문장 파편, 머뭇거림, 과장 직전의 직설성 같은 화법을 구체적으로 적는다. reusablePrinciples에는 원문 전체를 복제하지 않는 범위에서 ‘관찰 가능한 맛의 이유 → 한입 반응’, ‘가격은 마지막 확신’처럼 맥락과 욕구가 이어지는 원리를 적는다. 브랜드·인물·완성 문장을 복제하지 않는다. 실제로 확인하지 못한 항목은 추측하지 말고 analysisStatus를 limited로 두고 limitations에 이유를 쓴다. JSON만 반환한다.`,
    });
    const allowed = new Set(mediaAssets.map((asset) => asset.id));
    const analyses = payload.analyses
      .filter((analysis) => allowed.has(analysis.assetId))
      .map((analysis): ReferenceVideoAnalysis => ({
        ...analysis,
        cutCount: analysis.cutCount || null,
        averageCutLength: analysis.averageCutLength || null,
      }));
    const completed = mediaAssets.map(
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
          limitations: ["참고 자료의 시각 구조를 완전히 확인하지 못했습니다."],
        }
    );
    return [...completed, ...unavailableAssets];
  } catch (error) {
    console.info(
      `[video-planning] stage=reference-analysis event=limited code=${error instanceof VideoPlanningGenerationError ? error.failure.code : "REFERENCE_ANALYSIS_LIMITED"}`
    );
    return [
      ...mediaAssets.map((asset): ReferenceVideoAnalysis => ({
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
          "참고 자료 분석만 제한되었습니다. 상품 근거 기반 4개 콘셉트 생성은 계속할 수 있습니다.",
        ],
      })),
      ...unavailableAssets,
    ];
  }
}


