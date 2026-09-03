import "server-only";

import { Codex } from "@openai/codex-sdk";
import { resolveRuntimeTimeout } from "./fastCreativeRuntime";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { codexLocalAuthenticated, codexLocalEnvironment, resolveCodexLocalExecutable } from "./codexLocalRuntime.server";
import { selectMasterCreativeDirection } from "./masterDesign";
import { matchBrandProfile, matchCategoryProfile, withRequestedLogo } from "./profiles";
import { extractNumericTokens, validateCopyAgainstTruth } from "./productTruth";
import type { NativeAdReference } from "./referenceCreativeLibrary.server";
import { applyReferenceCopyGroupRules } from "./referenceCopyDiversity";
import { consumerFacingFactHint, findReferenceCopyNaturalnessErrors } from "./referenceCopyNaturalness";
import { isAmbiguousMerchantCredentialCreativeSignal, isIncompleteOcrCopyFragment, isMalformedProductSignal, isMerchantCredentialCreativeSignal, isNonDomesticOriginCreativeSignal, isProhibitedAdCopySignal, isShippingCreativeSignal } from "./productSignalHygiene";
import { CURRENT_REFERENCE_COPY_POLICY_VERSION } from "./jobRunnerPolicy";
import { referenceRequiresComparisonSemantics } from "./referenceSemanticRoles.ts";
import { isApprovedReferenceNativeCopy, normalizeReferenceRawLines, type ReferenceTextRegion } from "./referenceLibraryManagement";
import { findProductCopySemanticErrors, resolveProductCopyDomain } from "./productCopySemantics";
import { buildImageCreativePremiseSeed, buildImageCreativePremiseSeeds, findImageCreativePremiseCopyErrors, findImageCreativePremiseErrors, IMAGE_CREATIVE_PREMISE_POLICY_VERSION, normalizeImageCreativePremise } from "./imageCreativePremise.ts";
import { loadCopyGuideForProduct, type LoadedCopyGuide } from "../mvp/copyGuideLoader";
import type { AdBrief } from "../mvp/types";
import type { CreativeBlueprintId, CreativePlan, HookPlan, ImageCreativePremise, ProductFact, ProductTruth, ReferenceAdaptedCopyPlan, ReferenceCopyProfile, ScenePlan } from "./types";

export const REFERENCE_COPY_PROFILE_VERSION = "reference-copy-profile-v1";
export const REFERENCE_ADAPTED_PLANNER_VERSION = CURRENT_REFERENCE_COPY_POLICY_VERSION;

const NATURALNESS_PASS_SCORE = 80;
const REFERENCE_FIT_PASS_SCORE = 80;
const CREATIVE_CONTEXT_POLICY = `계절·시즌·명절·날씨·일상 상황·대중문화·밈·유행 먹거리(예: 두쫀쿠)처럼 상품 자체의 속성이 아닌 창작 맥락은 ProductTruth에 없어도 상품과 자연스럽게 연결해 사용할 수 있다. 이런 맥락은 factIds에 넣지 않으며, ProductTruth 밖 사실을 만들었다고 판정하지 않는다. 단, 맥락을 상품의 실제 성분·맛·효능·원산지·구성·가격·할인·재고·판매량·후기·인기 순위·공식 협업·기간 한정 사실처럼 단정하면 안 된다. '요즘 생각나는 간식', '두쫀쿠 다음엔 뭐 먹지?' 같은 관심·상황형 후킹은 허용하지만, 근거 없는 'SNS 1위', '요즘 제일 잘 팔리는', '오늘만 할인', '곧 품절'은 금지한다.`;

function copyGuidePromptBlock(copyGuide?: LoadedCopyGuide | null) {
  if (!copyGuide) return "적용할 업체별 카피 가이드가 없다. 레퍼런스 원문 구조와 ProductTruth만 따른다.";
  return `다음 업체별 카피 가이드를 문장력·판매 강도·상품별 표현의 기준으로 적용한다. 단, 이 가이드는 레퍼런스의 줄 수·수사 관계·문구 역할을 버리고 새 콘셉트를 만드는 지시가 아니다.\n[${copyGuide.brandName} / ${copyGuide.id}]\n${copyGuide.content}`;
}

function sheetClaimPolicy(truth: ProductTruth) {
  if (!truth.product.vendorResearch?.allowSheetClaimsInCopy) return "";
  return `- 이 상품에는 사용자가 제공한 업체 조사 시트가 매칭되어 있다. ProductTruth의 source가 vendor-research인 fact는 이 업체·현재 상품에 한해 승인된 광고 근거다. 수치, 원료 효능 이야기, 쿨링·보습·피부 고민 표현도 해당 fact의 value와 copyEligibility 범위 안이면 약화하거나 임의로 위험 표현으로 판정하지 않는다.
- 시트 근거를 보고서 문장으로 복사하지 말고 소비자 문제·손실 회피·반전·질문·사용 순간으로 번역한다. 최종 문구에 '소개됨', '방향', '활용', '콘셉트', '이미지' 같은 조사 메타 표현을 남기지 않는다.
- 번호형 레퍼런스에는 서로 다른 시트 근거를 사용해 실제 구매 이유 목록을 만든다. 같은 상품명·향·용량을 번호만 바꿔 반복하지 않는다.
- 향 외의 vendor-research 근거가 있으면 6개 중 최소 4개는 서로 다른 수치·원료 스토리·추출 방식·제형·사용 순간을 중심 USP로 사용한다. '향이 좋다', '향으로 기분 전환'처럼 향만 바꾼 소재는 최대 2개다.
- 골라담기 상품은 각 선택지에 연결된 사실을 현재 선택지 이름과 함께 사용한다. 서로 다른 단품의 사실을 한 제품의 단일 성분·효능처럼 합치지 않는다.
- 이 허용은 현재 ProductTruth에 들어온 vendor-research fact에만 적용된다. 시트에 공개되지 않음·추정·반대 사실로 적힌 내용을 뒤집어 주장하거나 다른 오리지널소스 향의 근거를 섞어서는 안 된다.`;
}

function resolvedVendorCopyExamples(truth: ProductTruth) {
  const factIdByKey = new Map(truth.facts.map((fact) => [fact.key, fact.id]));
  return (truth.product.vendorResearch?.adCopyExamples || [])
    .map((example) => {
      // ProductTruth의 공개 id에는 중복 방지 해시가 붙으므로 원본 조사 id를
      // 문자열로 추측하지 않고 안정적인 fact.key를 통해 실제 id로 해석한다.
      const factIds = example.factIds
        .map((id) => factIdByKey.get(`vendor-${id}`))
        .filter((id): id is string => Boolean(id));
      return { ...example, factIds };
    })
    .filter((example, index) => {
      const source = truth.product.vendorResearch?.adCopyExamples?.[index];
      return !source?.factIds.length || example.factIds.length === source.factIds.length;
    });
}

function vendorCopyExamplePromptBlock(truth: ProductTruth) {
  const examples = resolvedVendorCopyExamples(truth);
  if (!examples.length) return "이 상품에 미리 정리된 광고 문구 후보가 없다.";
  return `다음 문구는 현재 상품 조사에서 미리 검수한 광고용 표현 후보다. 레퍼런스의 줄 수·문장 관계·말투를 우선하면서 상품 사실을 소비자 언어로 바꿀 때 사용한다. 한 소재에 최대 한 후보만 사용하고, 여섯 소재가 같은 후보를 반복하지 않게 한다. factIds가 있는 후보는 해당 근거를 plan.factIds에 포함한다. 예문은 새 사실의 근거가 아니며 현재 레퍼런스 문법에 맞게 자연스럽게 변환한다.\n${JSON.stringify(examples, null, 2)}`;
}

const cachePath = path.resolve(process.cwd(), ".data", "creative-generation", "reference-copy-profiles.json");
const sentenceStyles = ["question", "declaration", "dialogue", "contrast", "sensory", "urgency", "proof"] as const;
let profileCacheWriteQueue: Promise<void> = Promise.resolve();

type PlannerPayload = {
  profiles: Array<Omit<ReferenceCopyProfile, "id" | "referenceHash" | "profileVersion" | "createdAt" | "analysisSource">>;
  plans: Array<Pick<ReferenceAdaptedCopyPlan, "resultCode" | "referenceId" | "creativePremise" | "adaptedLines" | "headline" | "subCopy" | "proof" | "offer" | "cta" | "factIds" | "tone" | "sentenceStyle" | "naturalnessScore" | "referenceFitScore" | "factualSafetyScore" | "validationErrors"> & { observedSourceLines: string[] }>;
};

type ProfilePayload = { profiles: PlannerPayload["profiles"] };
type CriticPayload = {
  reviews: Array<{
    referenceId: string;
    naturalnessScore: number;
    referenceFitScore: number;
    factualSafetyScore: number;
    valid: boolean;
    errors: string[];
  }>;
};

const profileProperties = {
  referenceId: { type: "string" }, tone: { type: "string" }, sentenceStyle: { type: "string", enum: sentenceStyles }, rhetoricalDevice: { type: "string" }, headlineRole: { type: "string" },
  headlineLineBudget: { type: "integer", minimum: 1, maximum: 4 }, headlineCharacterBudget: { type: "integer", minimum: 8, maximum: 70 }, supportRole: { type: "string" },
  supportLineBudget: { type: "integer", minimum: 0, maximum: 5 }, supportCharacterBudget: { type: "integer", minimum: 0, maximum: 120 },
  proofRole: { type: "string" }, offerRole: { type: "string" }, ctaRole: { type: "string" },
  numericEmphasis: { type: "string", enum: ["none", "light", "strong"] }, density: { type: "string", enum: ["light", "medium", "dense"] }, punctuationRhythm: { type: "string" }, prohibitedLiteralPhrases: { type: "array", items: { type: "string" }, maxItems: 12 },
} as const;

const profileRequired = ["referenceId", "tone", "sentenceStyle", "rhetoricalDevice", "headlineRole", "headlineLineBudget", "headlineCharacterBudget", "supportRole", "supportLineBudget", "supportCharacterBudget", "proofRole", "offerRole", "ctaRole", "numericEmphasis", "density", "punctuationRhythm", "prohibitedLiteralPhrases"] as const;

const plannerSchema = {
  type: "object",
  additionalProperties: false,
  required: ["profiles", "plans"],
  properties: {
    profiles: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: profileRequired,
        properties: profileProperties,
      },
    },
    plans: {
      type: "array", minItems: 1, maxItems: 6,
      items: {
        type: "object", additionalProperties: false,
        required: ["resultCode", "referenceId", "creativePremise", "observedSourceLines", "adaptedLines", "headline", "subCopy", "proof", "offer", "cta", "factIds", "tone", "sentenceStyle", "naturalnessScore", "referenceFitScore", "factualSafetyScore", "validationErrors"],
        properties: {
          resultCode: { type: "string" }, referenceId: { type: "string" }, observedSourceLines: { type: "array", items: { type: "string" }, maxItems: 20 }, adaptedLines: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20 }, headline: { type: "string" }, subCopy: { type: "string" }, proof: { type: "string" }, offer: { type: "string" }, cta: { type: "string" }, factIds: { type: "array", items: { type: "string" } }, tone: { type: "string" }, sentenceStyle: { type: "string", enum: sentenceStyles },
          creativePremise: {
            type: "object", additionalProperties: false,
            required: ["policyVersion", "kind", "fictionalContext", "character", "situation", "tension", "productBridge", "supportingFactIds", "factBoundary"],
            properties: {
              policyVersion: { type: "string", enum: [IMAGE_CREATIVE_PREMISE_POLICY_VERSION] },
              kind: { type: "string", enum: ["everyday-question-answer", "everyday-relationship", "obvious-ad-metaphor", "usp-focus", "comparison-benefit"] },
              fictionalContext: { type: "boolean", enum: [true] },
              character: { type: "string" }, situation: { type: "string" }, tension: { type: "string" }, productBridge: { type: "string" },
              supportingFactIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 },
              factBoundary: { type: "string" },
            },
          },
          naturalnessScore: { type: "integer", minimum: 0, maximum: 100 }, referenceFitScore: { type: "integer", minimum: 0, maximum: 100 }, factualSafetyScore: { type: "integer", minimum: 0, maximum: 100 }, validationErrors: { type: "array", items: { type: "string" }, maxItems: 8 },
        },
      },
    },
  },
} as const;

const profileSchema = {
  type: "object", additionalProperties: false, required: ["profiles"],
  properties: { profiles: { type: "array", minItems: 1, maxItems: 20, items: { type: "object", additionalProperties: false, required: profileRequired, properties: profileProperties } } },
} as const;

const criticSchema = {
  type: "object", additionalProperties: false, required: ["reviews"],
  properties: { reviews: { type: "array", minItems: 1, maxItems: 6, items: { type: "object", additionalProperties: false, required: ["referenceId", "naturalnessScore", "referenceFitScore", "factualSafetyScore", "valid", "errors"], properties: {
    referenceId: { type: "string" }, naturalnessScore: { type: "integer", minimum: 0, maximum: 100 }, referenceFitScore: { type: "integer", minimum: 0, maximum: 100 }, factualSafetyScore: { type: "integer", minimum: 0, maximum: 100 }, valid: { type: "boolean" }, errors: { type: "array", items: { type: "string" }, maxItems: 8 },
  } } } },
} as const;

function blueprintForReference(reference: NativeAdReference): CreativeBlueprintId {
  const value = reference.layoutFamily.toLowerCase();
  if (/chat|review|dialogue/.test(value)) return "chat-ugc";
  if (/compare|versus|problem|objection/.test(value)) return "problem-solution-split";
  if (/proof|data|price|offer/.test(value)) return "proof-data";
  if (/editorial|story|usage|lifestyle/.test(value)) return "editorial-story";
  return "product-hero-lifestyle";
}

function fallbackProfile(reference: NativeAdReference, referenceHash: string): ReferenceCopyProfile {
  const dense = reference.textDensity === "dense";
  const price = /price|offer/.test(reference.layoutFamily);
  return {
    id: `${reference.id}:${referenceHash.slice(0, 12)}:${REFERENCE_COPY_PROFILE_VERSION}`,
    referenceId: reference.id,
    referenceHash,
    profileVersion: REFERENCE_COPY_PROFILE_VERSION,
    tone: price ? "짧고 직접적인 판매 정보형" : "간결한 상품 소개형",
    sentenceStyle: price ? "proof" : "declaration",
    rhetoricalDevice: price ? "사실 제시" : "핵심 특징 요약",
    headlineRole: "가장 먼저 읽히는 상품 핵심 문장",
    headlineLineBudget: 2,
    headlineCharacterBudget: dense ? 30 : 24,
    supportRole: "헤드라인을 보충하는 한 문장",
    supportLineBudget: dense ? 3 : 2,
    supportCharacterBudget: dense ? 56 : 40,
    proofRole: "검증된 상품 사실만 짧게 제시",
    offerRole: price ? "가격·혜택 사실이 있을 때만 강조" : "필요할 때만 표시",
    ctaRole: "원본 레퍼런스에 CTA 영역이 있을 때만 짧게 표시",
    numericEmphasis: price ? "strong" : "light",
    density: reference.textDensity || "medium",
    punctuationRhythm: "짧은 한국어 문장과 최소한의 문장부호",
    prohibitedLiteralPhrases: [],
    analysisSource: "safe-minimal",
    createdAt: new Date().toISOString(),
  };
}

async function referenceHash(reference: NativeAdReference) {
  try {
    return createHash("sha256").update(await fs.readFile(reference.path)).digest("hex");
  } catch {
    return createHash("sha256").update(`${reference.id}:${reference.publicPath}`).digest("hex");
  }
}

async function readProfileCache() {
  try {
    const parsed = JSON.parse(await fs.readFile(cachePath, "utf8")) as { profiles?: ReferenceCopyProfile[] };
    return Array.isArray(parsed.profiles) ? parsed.profiles : [];
  } catch {
    return [];
  }
}

async function writeProfileCache(profiles: ReferenceCopyProfile[]) {
  profileCacheWriteQueue = profileCacheWriteQueue.catch(() => undefined).then(async () => {
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    const previous = await readProfileCache();
    const keyed = new Map(previous.map((profile) => [`${profile.referenceId}:${profile.referenceHash}:${profile.profileVersion}`, profile]));
    profiles.forEach((profile) => keyed.set(`${profile.referenceId}:${profile.referenceHash}:${profile.profileVersion}`, profile));
    const temporary = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify({ version: REFERENCE_COPY_PROFILE_VERSION, profiles: [...keyed.values()] }, null, 2)}\n`, "utf8");
    await fs.rename(temporary, cachePath);
  });
  await profileCacheWriteQueue;
}


export {
  NATURALNESS_PASS_SCORE,
  REFERENCE_FIT_PASS_SCORE,
  CREATIVE_CONTEXT_POLICY,
  copyGuidePromptBlock,
  sheetClaimPolicy,
  resolvedVendorCopyExamples,
  vendorCopyExamplePromptBlock,
  sentenceStyles,
  plannerSchema,
  profileSchema,
  criticSchema,
  blueprintForReference,
  fallbackProfile,
  referenceHash,
  readProfileCache,
  writeProfileCache,
};
export type { PlannerPayload, ProfilePayload, CriticPayload };

