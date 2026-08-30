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
import { isNonDomesticOriginCreativeSignal, isProhibitedAdCopySignal, isShippingCreativeSignal } from "./productSignalHygiene";
import { referenceRequiresComparisonSemantics } from "./referenceSemanticRoles.ts";
import { isApprovedReferenceNativeCopy, normalizeReferenceRawLines, type ReferenceTextRegion } from "./referenceLibraryManagement";
import { loadCopyGuideForProduct, type LoadedCopyGuide } from "../mvp/copyGuideLoader";
import type { AdBrief } from "../mvp/types";
import type { CreativeBlueprintId, CreativePlan, HookPlan, ProductFact, ProductTruth, ReferenceAdaptedCopyPlan, ReferenceCopyProfile, ScenePlan } from "./types";

export const REFERENCE_COPY_PROFILE_VERSION = "reference-copy-profile-v1";
export const REFERENCE_ADAPTED_PLANNER_VERSION = "reference-native-copy-adapter-v21-meat-only-origin";

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
- 이 허용은 현재 ProductTruth에 들어온 vendor-research fact에만 적용된다. 시트에 공개되지 않음·추정·반대 사실로 적힌 내용을 뒤집어 주장하거나 다른 오리지널소스 향의 근거를 섞어서는 안 된다.`;
}

const cachePath = path.resolve(process.cwd(), ".data", "creative-generation", "reference-copy-profiles.json");
const sentenceStyles = ["question", "declaration", "dialogue", "contrast", "sensory", "urgency", "proof"] as const;
let profileCacheWriteQueue: Promise<void> = Promise.resolve();

type PlannerPayload = {
  profiles: Array<Omit<ReferenceCopyProfile, "id" | "referenceHash" | "profileVersion" | "createdAt" | "analysisSource">>;
  plans: Array<Pick<ReferenceAdaptedCopyPlan, "resultCode" | "referenceId" | "adaptedLines" | "headline" | "subCopy" | "proof" | "offer" | "cta" | "factIds" | "tone" | "sentenceStyle" | "naturalnessScore" | "referenceFitScore" | "factualSafetyScore" | "validationErrors"> & { observedSourceLines: string[] }>;
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
        required: ["resultCode", "referenceId", "observedSourceLines", "adaptedLines", "headline", "subCopy", "proof", "offer", "cta", "factIds", "tone", "sentenceStyle", "naturalnessScore", "referenceFitScore", "factualSafetyScore", "validationErrors"],
        properties: {
          resultCode: { type: "string" }, referenceId: { type: "string" }, observedSourceLines: { type: "array", items: { type: "string" }, maxItems: 20 }, adaptedLines: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20 }, headline: { type: "string" }, subCopy: { type: "string" }, proof: { type: "string" }, offer: { type: "string" }, cta: { type: "string" }, factIds: { type: "array", items: { type: "string" } }, tone: { type: "string" }, sentenceStyle: { type: "string", enum: sentenceStyles },
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

function factsForPlanning(truth: ProductTruth) {
  const seen = new Set<string>();
  return truth.facts
    .filter((fact) => fact.key !== "brand-name" && fact.usableInCopy && fact.verification !== "unverified" && fact.copyEligibility !== "blocked")
    .filter((fact) => !isProhibitedAdCopySignal(fact.value) && fact.evidenceType !== "shipping" && !isShippingCreativeSignal(fact.value) && !isNonDomesticOriginCreativeSignal(fact.value))
    .filter((fact) => {
      const signature = comparableCopy(fact.value);
      if (!signature || seen.has(signature)) return false;
      seen.add(signature);
      return true;
    })
    .map((fact) => ({ id: fact.id, label: fact.label, value: fact.value, copyHint: consumerFacingFactHint(fact.value), role: fact.copyEligibility || "headlineEligible" }));
}

function comparableCopy(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, "").replace(/["'“”‘’.,!?;:()[\]{}<>]/g, "").toLowerCase();
}

function sourceLineRole(reference: NativeAdReference, sourceLine: string, index: number): NonNullable<ReferenceAdaptedCopyPlan["copySlots"]>[number]["role"] {
  const normalized = comparableCopy(sourceLine);
  const region = reference.nativeCopy?.textRegions.find((candidate) =>
    candidate.lines.some((line) => comparableCopy(line) === normalized) || comparableCopy(candidate.text).includes(normalized)
  );
  if (region) return region.role;
  if (index === 0) return "headline";
  if (/구매|보러|보기|확인|신청|shop|buy/i.test(sourceLine)) return "cta";
  if (/\d[\d,.]*\s*(?:원|%|개|병|팩|세트|g|kg|ml|l)\b|할인|특가|증정|무료/i.test(sourceLine)) return "offer";
  return "support";
}

function isSourceDisclosureText(value: string, regionId?: string) {
  const normalized = String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
  return /(?:^|\s)(?:연출|예시|참고|합성|생성)\s*(?:이미지|사진)(?:$|\s)|이해를\s*돕기\s*위한\s*(?:연출|예시)|실제와\s*다를\s*수|AI(?:를|가)?\s*(?:활용|사용|생성)/iu.test(normalized) || /(?:image[-_\s]*)?disclaimer|disclosure/iu.test(regionId || "");
}

function isSourceBrandRemovalRegion(region: ReferenceTextRegion | undefined, sourceText = "") {
  return region?.sourceType === "source-brand" || region?.replacePolicy === "remove" || isSourceDisclosureText(sourceText || region?.text || "", region?.id);
}

function buildCopySlots(reference: NativeAdReference, sourceLines: string[], targetLines: string[]): NonNullable<ReferenceAdaptedCopyPlan["copySlots"]> {
  return sourceLines.map((sourceText, index) => {
    const role = sourceLineRole(reference, sourceText, index);
    const region = reference.nativeCopy?.textRegions.find((candidate) =>
      candidate.lines.some((line) => comparableCopy(line) === comparableCopy(sourceText)) || comparableCopy(candidate.text).includes(comparableCopy(sourceText))
    );
    const removeSourceRegion = isSourceBrandRemovalRegion(region, sourceText);
    return {
      index,
      regionId: region?.id,
      readingOrder: region?.readingOrder,
      role,
      sourceType: region?.sourceType,
      replacePolicy: removeSourceRegion ? "remove" as const : region?.replacePolicy,
      sourceText,
      // 기존 광고주의 로고·워드마크는 현재 상품명으로 치환하지 않는다.
      // 빈 target은 생성 단계에서 이 작은 영역의 주변 배경 복원을 뜻하며,
      // 실제 업체 로고는 사용자가 선택한 투명 원본만 후처리로 적용한다.
      targetText: removeSourceRegion ? "" : targetLines[index] || "",
      emphasis: region?.emphasis || (role === "headline" ? "strong" : "none"),
      box: region?.box,
      align: region?.align,
      colorHint: region?.colorHint,
      backgroundHint: region?.backgroundHint,
      outlineHint: region?.outlineHint,
      sizeClass: region?.sizeClass,
      characterBudget: region?.characterBudget,
    };
  });
}

function canonicalCopyFields(
  copySlots: NonNullable<ReferenceAdaptedCopyPlan["copySlots"]>,
  raw: Pick<PlannerPayload["plans"][number], "headline" | "subCopy" | "proof" | "offer" | "cta">
) {
  const lines = (...roles: Array<NonNullable<ReferenceAdaptedCopyPlan["copySlots"]>[number]["role"]>) =>
    copySlots
      .filter((slot) => roles.includes(slot.role) && slot.targetText.trim())
      .map((slot) => slot.targetText.trim())
      .join("\n")
      .trim();
  return {
    // 실제 이미지 편집 계약은 adaptedLines/copySlots이다. 모델이 별도로 반환한
    // 요약 필드가 슬롯 문구와 조금 달라도 전체 계획을 폐기하지 않고 슬롯을
    // 단일 진실 소스로 삼는다.
    headline: lines("headline") || raw.headline.trim(),
    subCopy: lines("support") || raw.subCopy.trim(),
    proof: lines("proof", "badge", "other") || raw.proof.trim(),
    offer: lines("offer") || raw.offer.trim(),
    cta: lines("cta") || raw.cta.trim(),
  };
}

function resolvedPlanFactIds(
  truth: ProductTruth,
  requestedIds: string[],
  copyFields: ReturnType<typeof canonicalCopyFields>,
  adaptedLines: string[]
) {
  const known = new Map(truth.facts.map((fact) => [fact.id, fact]));
  const resolved = new Set(requestedIds.filter((id) => known.has(id)));
  const copy = [copyFields.headline, copyFields.subCopy, copyFields.proof, copyFields.offer, copyFields.cta, ...adaptedLines].join(" ");
  const copySignature = comparableCopy(copy);
  const numericTokens = new Set(extractNumericTokens(copy));
  truth.facts
    .filter((fact) => fact.usableInCopy && fact.verification !== "unverified" && fact.copyEligibility !== "blocked" && fact.evidenceType !== "shipping" && !isShippingCreativeSignal(fact.value))
    .forEach((fact) => {
      const factSignature = comparableCopy(fact.value);
      const literalUsed = factSignature.length >= 3 && copySignature.includes(factSignature);
      const numericUsed = fact.copyEligibility === "offerOnly" && extractNumericTokens(fact.value).some((token) => numericTokens.has(token));
      if (literalUsed || numericUsed) resolved.add(fact.id);
    });
  return [...resolved];
}

function plannerDeclaredSafetyErrors(errors: string[]) {
  return errors.filter((error) => /ProductTruth|근거(?:가| 없이| 없는)|확인되지|허위|수치|가격|할인|혜택|효능|함량|원산지|후기|배송/u.test(error));
}

function fallbackSlotRoles(reference: NativeAdReference, profile: ReferenceCopyProfile, hasOffer: boolean) {
  const observedRoles = (reference.nativeCopy?.textRegions || [])
    .map((region) => region.role)
    .filter((role, index, roles) => roles.indexOf(role) === index);
  if (observedRoles.length) return observedRoles;
  const layout = reference.layoutFamily.toLowerCase();
  if (/price|offer|deal|commerce/.test(layout)) return ["headline", "support", "proof", "offer"] as const;
  if (profile.density === "dense") return hasOffer ? ["headline", "support", "proof", "offer", "cta"] as const : ["headline", "support", "proof", "cta"] as const;
  if (profile.density === "light") return ["headline", "support"] as const;
  return hasOffer ? ["headline", "support", "proof", "offer"] as const : ["headline", "support", "proof"] as const;
}

function preserveRhetoricalEnding(source: string, value: string) {
  const clean = value.trim().replace(/[.!?]+$/u, "");
  const punctuation = source.match(/([!?]{1,3})\s*$/u)?.[1];
  return `${clean}${punctuation || ""}`;
}

function factCharacterCount(value: string) {
  return Array.from(value.replace(/\s/g, "")).length;
}

function isCleanFallbackHeadlineFact(fact: ProductFact, truth: ProductTruth, budget: number) {
  if (fact.copyEligibility !== "headlineEligible") return false;
  if (fact.key === "base-product-name") return false;
  const copyHint = consumerFacingFactHint(fact.value);
  if (/[*★]|[ㄱ-ㅎㅏ-ㅣ]|\([^)]*[!?]{2,}[^)]*\)/u.test(copyHint)) return false;
  if (comparableCopy(copyHint) === comparableCopy(truth.normalized.cleanProductName || truth.product.productName)) return false;
  const length = factCharacterCount(copyHint);
  return length >= 6 && length <= Math.min(34, budget + 8);
}

function uniqueFacts(facts: ProductFact[]) {
  const seen = new Set<string>();
  return facts.filter((fact) => {
    const signature = comparableCopy(fact.value);
    if (!signature || seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function automaticOfferLine(facts: ProductFact[]) {
  const salePrice = facts.find((fact) => fact.key === "price") || facts.find((fact) => fact.copyEligibility === "offerOnly" && fact.evidenceType === "price" && !/기존|정가|original|old/i.test(`${fact.key} ${fact.label}`));
  const originalPrice = facts.find((fact) => fact.key === "original-price") || facts.find((fact) => fact.copyEligibility === "offerOnly" && /기존|정가|original|old/i.test(`${fact.key} ${fact.label}`));
  const discount = facts.find((fact) => fact.key === "discount" || fact.evidenceType === "offer");
  if (originalPrice && salePrice && comparableCopy(originalPrice.value) !== comparableCopy(salePrice.value)) {
    return { text: `${originalPrice.value} → ${salePrice.value}`, facts: [originalPrice, salePrice] };
  }
  if (discount && salePrice) return { text: `${discount.value} · ${salePrice.value}`, facts: [discount, salePrice] };
  const single = salePrice || discount || facts.find((fact) => fact.copyEligibility === "offerOnly");
  return { text: single?.value || "", facts: single ? [single] : [] };
}

function shortProductIdentity(truth: ProductTruth) {
  let value = String(truth.normalized.baseProductName || truth.normalized.cleanProductName || truth.product.productName || "상품")
    .replace(/\([^)]*(?:g|kg|ml|l|개|팩|세트)[^)]*\)/giu, " ")
    .replace(/\d[\d,.]*\s*(?:g|kg|ml|l|개|팩|세트)\b/giu, " ")
    .replace(/(?:오늘만|지금만|추석맞이특가|초특가|한정특가|특별구성|지방\s*손질|로스\s*제거|대한\s*선별|특급\s*선별|프리미엄|재구매|최고의\s*간식|인기\s*간식|추천\s*상품|대용량|괴물\s*용량)/giu, " ")
    .replace(/[★☆*✅⚡💥&＆·/+]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = value.split(" ").filter(Boolean);
  while (tokens.length > 1 && Array.from(tokens.join(" ").replace(/\s/g, "")).length > 18) tokens.shift();
  value = tokens.join(" ").trim();
  return value || truth.normalized.baseProductName || truth.normalized.cleanProductName || truth.product.productName || "상품";
}

function reasonTextForFact(fact: ProductFact, identity: string, truth?: ProductTruth) {
  const clean = consumerFacingFactHint(fact.value)
    .replace(/[★☆*✅⚡💥]+/gu, " ")
    .replace(/\s*[&＆]\s*/g, " · ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  const productContext = `${truth?.product.category || ""} ${truth?.product.detectedProductType || ""} ${truth?.normalized.category || ""} ${truth?.normalized.cleanProductName || ""}`;
  const foodProduct = /식품|음식|간식|스낵|과일|농산|육류|snack|food|fruit|meat/iu.test(productContext);
  const sensory = clean.match(/^(?:식감|맛|풍미)(?:은|는|이|가)?\s*(.+?)(?:\s*(?:합니다|입니다))?$/u)?.[1]?.trim();
  if (sensory) return `한입부터 ${sensory}`;
  const usage = clean.match(/^(?:사용감|향)(?:은|는|이|가)?\s*(.+?)(?:\s*(?:합니다|입니다))?$/u)?.[1]?.trim();
  if (usage) return `${usage}, 직접 느껴보세요`;
  if (fact.key === "title-composition") {
    const pack = clean.match(/(\d[\d,.]*\s*(?:g|kg|ml|l))\s*[×x]\s*(\d+)\s*팩/iu);
    return pack ? `${pack[1].replace(/\s+/g, "")}씩 ${pack[2]}팩 구성` : clean;
  }
  // 단일 용량은 세트가 아니므로 `총 250ml 구성`처럼 부풀리지 않는다.
  if (fact.key === "quantity") return clean;
  if (fact.key === "verified-descriptor") {
    if (foodProduct && /바삭|쫄깃|쫀득|달콤|고소|촉촉|부드러|매콤|담백/u.test(clean)) return `한입부터 ${clean}`;
    return comparableCopy(identity).includes(comparableCopy(clean)) ? identity : clean;
  }
  if (fact.key === "origin") return clean;
  if (factCharacterCount(clean) > 38) return "";
  return clean;
}

function fallbackHeadlineForSource(value: string, source: string) {
  const clean = String(value || "").replace(/[.!?~]+$/u, "").trim();
  if (!clean) return clean;
  if (/\?/u.test(source)) {
    if (/^(?:한입|씹을수록|먹을수록)/u.test(clean)) return `${clean}, 드셔보실래요?`;
    if (/(?:분|사람)$/u.test(clean)) return `${clean}?`;
    if (/(?:향|사용감|보습|구성|제품)$/u.test(clean)) return `${clean} 찾고 계세요?`;
    return `${clean}, 찾고 계세요?`;
  }
  return preserveRhetoricalEnding(source, clean);
}

function referenceAwareFallbackText(input: {
  sourceLine: string;
  preferred: string;
  candidates: string[];
  role: NonNullable<ReferenceAdaptedCopyPlan["copySlots"]>[number]["role"];
  identity: string;
  usedSignatures: Set<string>;
}) {
  const sourceLength = factCharacterCount(input.sourceLine);
  const preferredSignature = comparableCopy(input.preferred);
  const strongSourceHook = /[?!]|왜|어떻게|찾|없다|아니|한정|마감|특가|할인|손해|놓치|역대급|미친|최고|%/iu.test(input.sourceLine);
  const candidates = [input.preferred, ...input.candidates]
    .map((value) => String(value || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((value, index, values) => values.findIndex((candidate) => comparableCopy(candidate) === comparableCopy(value)) === index)
    .filter((value) => !input.usedSignatures.has(comparableCopy(value)));
  const maxLength = Math.max(18, sourceLength + 8);
  const minimumUsefulLength = sourceLength >= 18 ? Math.min(18, Math.ceil(sourceLength * 0.5)) : 0;
  const ranked = candidates
    .filter((value) => factCharacterCount(value) <= maxLength)
    .filter((value) => !strongSourceHook || comparableCopy(value) !== comparableCopy(input.identity))
    .sort((left, right) => {
      const leftLength = factCharacterCount(left);
      const rightLength = factCharacterCount(right);
      const leftDensityPenalty = leftLength < minimumUsefulLength ? 30 : 0;
      const rightDensityPenalty = rightLength < minimumUsefulLength ? 30 : 0;
      const leftPreferred = preferredSignature && comparableCopy(left).includes(preferredSignature) ? -8 : 0;
      const rightPreferred = preferredSignature && comparableCopy(right).includes(preferredSignature) ? -8 : 0;
      return (Math.abs(sourceLength - leftLength) + leftDensityPenalty + leftPreferred) - (Math.abs(sourceLength - rightLength) + rightDensityPenalty + rightPreferred);
    });
  const selected = ranked[0] || candidates[0] || input.preferred || input.identity;
  input.usedSignatures.add(comparableCopy(selected));
  if (input.role === "headline") return fallbackHeadlineForSource(selected, input.sourceLine);
  const quoted = input.sourceLine.match(/^\s*([“"'])(.+?)([”"'])\s*$/u);
  if (quoted) return `${quoted[1]}${preserveRhetoricalEnding(input.sourceLine, selected)}${quoted[3]}`;
  return preserveRhetoricalEnding(input.sourceLine, selected);
}

function contextualFallbackCandidates(truth: ProductTruth, identity: string, index: number) {
  const context = `${truth.product.category || ""} ${truth.product.detectedProductType || ""} ${truth.normalized.cleanProductName || ""}`;
  const food = /식품|음식|간식|스낵|과일|농산|육류|수산|반찬|김치|food|snack|fruit|meat/iu.test(context);
  const snack = /간식|스낵|과자|전병|과일|사과|배|복숭아|무화과|곶감|견과|디저트|빵|떡|snack|fruit|dessert/iu.test(context);
  const beauty = /화장품|뷰티|스킨|로션|크림|세럼|샴푸|바디|세정|beauty|cosmetic|personal\s*care/iu.test(context);
  const candidates = snack
    ? [
        `간식 생각날 때 꺼내는 ${identity}`,
        `오늘 간식으로 ${identity} 어때요?`,
        `집에 두고 하나씩 즐기는 ${identity}`,
        `가족과 나눠 먹기 좋은 ${identity}`,
        `출출한 오후, ${identity} 한입`,
        `간식 고를 때 ${identity}부터`,
      ]
    : food
      ? [
          `오늘 식탁에 ${identity} 어때요?`,
          `메뉴 고민될 때 꺼내는 ${identity}`,
          `가족과 함께 즐기는 ${identity}`,
          `한 끼 생각날 때 ${identity}`,
          `오늘 메뉴는 ${identity}로`,
          `식탁 위에 더하는 ${identity}`,
        ]
      : beauty
        ? [
            `매일 손이 가는 ${identity}`,
            `오늘 루틴에 ${identity} 어때요?`,
            `바쁜 일상에 더하는 ${identity}`,
            `나를 위한 루틴, ${identity}`,
            `매일 쓰는 만큼 ${identity}`,
            `필요한 순간 꺼내는 ${identity}`,
          ]
        : [
            `오늘 필요한 ${identity}`,
            `일상에 더하는 ${identity}`,
            `고민될 때 고르는 ${identity}`,
            `매일 함께하는 ${identity}`,
            `지금 살펴볼 ${identity}`,
            `필요한 순간의 ${identity}`,
          ];
  return [...candidates.slice(index % candidates.length), ...candidates.slice(0, index % candidates.length)];
}

function fallbackTextCandidates(truth: ProductTruth, facts: ProductFact[], identity: string, offerText: string, index: number) {
  const brand = String(truth.normalized.brandName || truth.product.brandName || truth.product.advertiserName || "").trim();
  const singles = uniqueFacts(facts)
    .filter((fact) => !["category", "target", "season-event", "package-option", "quantity"].includes(fact.key))
    .filter((fact) => fact.copyEligibility !== "blocked" && fact.copyEligibility !== "offerOnly")
    .filter((fact) => fact.evidenceType !== "price" && fact.evidenceType !== "offer" && fact.evidenceType !== "numeric")
    .map((fact) => reasonTextForFact(fact, identity, truth))
    .filter((value) => value && factCharacterCount(value) <= 32);
  const contexts = contextualFallbackCandidates(truth, identity, index);
  const values = [...contexts, ...singles, identity, brand && !comparableCopy(identity).includes(comparableCopy(brand)) ? `${brand} ${identity}` : "", offerText]
    .map((value) => String(value || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const combined: string[] = [];
  for (let left = 0; left < Math.min(values.length, 8); left += 1) {
    for (let right = left + 1; right < Math.min(values.length, 8); right += 1) {
      const value = `${values[left]} · ${values[right]}`;
      if (factCharacterCount(value) <= 38) combined.push(value);
    }
  }
  const seen = new Set<string>();
  return [...values, ...combined].filter((value) => {
    const signature = comparableCopy(value);
    if (!signature || seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function buildNumberedReasonFallback(truth: ProductTruth, reference: NativeAdReference, sourceLines: string[], facts: ProductFact[]) {
  const numberedIndexes = sourceLines
    .map((line, index) => (/^\s*\d{1,2}\s*[.)]\s*/u.test(line) ? index : -1))
    .filter((index) => index >= 0);
  if (numberedIndexes.length < 2) return null;

  const identity = shortProductIdentity(truth);
  const excludedKeys = new Set(["base-product-name", "brand-name", "category", "target", "season-event", "package-option"]);
  const priority = (fact: ProductFact) =>
    fact.key.startsWith("title-benefit") ? 100 :
      fact.key === "title-composition" ? 95 :
        fact.key === "verified-descriptor" ? 90 :
          fact.key === "quantity" ? 82 :
            fact.key === "origin" ? 78 :
              fact.key === "main-benefit" ? 72 :
                fact.key.startsWith("verified-benefit") ? 68 : 40;
  const candidates = uniqueFacts(facts)
    .filter((fact) => !excludedKeys.has(fact.key) && fact.copyEligibility !== "offerOnly" && fact.copyEligibility !== "identityOnly")
    .map((fact) => ({ fact, text: reasonTextForFact(fact, identity, truth) }))
    .filter(({ text }) => text && factCharacterCount(text) >= 4 && factCharacterCount(text) <= 38)
    .sort((left, right) => priority(right.fact) - priority(left.fact));
  const reasonCandidates: Array<{ fact: ProductFact; text: string }> = [];
  const usedReasonTexts = new Set<string>();
  for (const candidate of candidates) {
    const signature = comparableCopy(candidate.text);
    if (!signature || usedReasonTexts.has(signature) || [...usedReasonTexts].some((used) => used.includes(signature) || signature.includes(used))) continue;
    usedReasonTexts.add(signature);
    reasonCandidates.push(candidate);
    if (reasonCandidates.length >= numberedIndexes.length) break;
  }

  const identityFact = facts.find((fact) => fact.key === "base-product-name");
  const selectedFacts = [identityFact, ...reasonCandidates.map((candidate) => candidate.fact)].filter((fact): fact is ProductFact => Boolean(fact));
  const headlineIndexes = sourceLines.map((line, index) => sourceLineRole(reference, line, index) === "headline" ? index : -1).filter((index) => index >= 0);
  let reasonIndex = 0;
  const lines = sourceLines.map((sourceLine, lineIndex) => {
    const region = reference.nativeCopy?.textRegions.find((candidate) => candidate.lines.some((regionLine) => comparableCopy(regionLine) === comparableCopy(sourceLine)));
    if (isSourceBrandRemovalRegion(region)) return "";
    const numbered = sourceLine.match(/^\s*(\d{1,2}\s*[.)])\s*/u)?.[1];
    if (numbered) {
      const candidate = reasonCandidates[reasonIndex++] || reasonCandidates.at(-1);
      return `${numbered} ${candidate?.text || identity}`;
    }
    const headlineOrder = headlineIndexes.indexOf(lineIndex);
    if (headlineOrder === 0) return `${identity},`;
    if (headlineOrder === 1) return "고를 때 보는 이유";
    return preserveRhetoricalEnding(sourceLine, reasonCandidates[reasonIndex++ % Math.max(1, reasonCandidates.length)]?.text || identity);
  });
  return { lines, selectedFacts };
}

function fallbackPlan(truth: ProductTruth, reference: NativeAdReference, profile: ReferenceCopyProfile, index: number): ReferenceAdaptedCopyPlan {
  const facts = truth.facts.filter((fact) => fact.usableInCopy && fact.verification !== "unverified" && fact.copyEligibility !== "blocked" && fact.evidenceType !== "shipping" && !isShippingCreativeSignal(fact.value) && !isNonDomesticOriginCreativeSignal(fact.value) && !isProhibitedAdCopySignal(fact.value));
  const headlineCandidates = uniqueFacts(facts.filter((fact) => isCleanFallbackHeadlineFact(fact, truth, profile.headlineCharacterBudget)));
  const prioritizedHeadlineCandidates = uniqueFacts([
    ...headlineCandidates.filter((fact) => fact.key === "verified-descriptor"),
    ...headlineCandidates.filter((fact) => fact.key === "main-benefit"),
    ...headlineCandidates.filter((fact) => fact.evidenceType === "usp"),
    ...headlineCandidates,
  ]);
  // OCR 원문이 아직 없는 안전 fallback도 여섯 장이 같은 첫 사실만 반복하지
  // 않도록 결과 순번별로 검증된 사실을 회전한다. 사실을 새로 만들지는 않는다.
  const headlineFact = prioritizedHeadlineCandidates[index % Math.max(1, prioritizedHeadlineCandidates.length)] || facts.find((fact) => fact.copyEligibility === "headlineEligible");
  const supportFact = prioritizedHeadlineCandidates.length > 1
    ? prioritizedHeadlineCandidates[(index + 1) % prioritizedHeadlineCandidates.length]
    : headlineCandidates.find((fact) => fact.id !== headlineFact?.id);
  const proofFacts = uniqueFacts(facts.filter((fact) =>
    fact.copyEligibility === "proofOnly" &&
    !["base-product-name", "category", "target"].includes(fact.key) &&
    factCharacterCount(fact.value) <= 38
  ));
  const proofFact = proofFacts[index % Math.max(1, proofFacts.length)] || supportFact;
  // fallback에서도 여섯 장 모두 가격으로 수렴하지 않게 가격·할인형은 앞의
  // 두 소재에만 배정한다. 나머지 offer 슬롯은 검증된 다른 구매 이유로 채운다.
  const offer = index % 6 < 2 ? automaticOfferLine(facts) : { text: "", facts: [] as ProductFact[] };
  const offerFact = offer.facts[0];
  const identity = shortProductIdentity(truth);
  const contextualCandidates = contextualFallbackCandidates(truth, identity, index);
  const sourceLines = reference.nativeCopy?.useForCopyAdaptation === false ? [] : reference.nativeCopy?.rawLines || [];
  const contentFacts = uniqueFacts([headlineFact, supportFact, proofFact, ...prioritizedHeadlineCandidates, ...proofFacts]
    .filter((fact): fact is ProductFact => Boolean(fact))
    .filter((fact) => !["category", "target", "season-event", "package-option", "quantity"].includes(fact.key))
    .filter((fact) => factCharacterCount(consumerFacingFactHint(fact.value)) <= 32));
  const usedFacts = new Map<string, ProductFact>();
  const numberedFallback = sourceLines.length ? buildNumberedReasonFallback(truth, reference, sourceLines, facts) : null;
  numberedFallback?.selectedFacts.forEach((fact) => usedFacts.set(fact.id, fact));
  let contentIndex = 0;
  let offerIndex = 0;
  const fallbackOfferFacts = uniqueFacts(facts.filter((fact) => fact.copyEligibility === "offerOnly"));
  const contentFallbackCandidates = fallbackTextCandidates(truth, facts, identity, "", index)
    .filter((candidate) => !offer.facts.some((fact) => comparableCopy(candidate).includes(comparableCopy(fact.value))));
  const offerFallbackCandidates = [offer.text, ...offer.facts.map((fact) => fact.value)].filter(Boolean);
  const usedTargetSignatures = new Set<string>();
  const recordFactsForTarget = (target: string) => {
    const signature = comparableCopy(target);
    facts.forEach((fact) => {
      const literal = comparableCopy(fact.value);
      const hint = comparableCopy(reasonTextForFact(fact, identity, truth));
      if ((literal.length >= 3 && signature.includes(literal)) || (hint.length >= 3 && signature.includes(hint))) usedFacts.set(fact.id, fact);
    });
  };
  const headlineFallbackText = headlineFact ? reasonTextForFact(headlineFact, identity, truth) || contextualCandidates[0] : contextualCandidates[0];
  const supportFallbackText = supportFact ? reasonTextForFact(supportFact, identity, truth) || contextualCandidates[1] : contextualCandidates[1];
  const proofFallbackText = proofFact && !["quantity", "numeric", "price", "offer"].includes(proofFact.evidenceType || "")
    ? reasonTextForFact(proofFact, identity, truth) || contextualCandidates[2]
    : contextualCandidates[2];
  let adaptedLines = numberedFallback?.lines || (sourceLines.length
    ? sourceLines.map((sourceLine, lineIndex) => {
        const region = reference.nativeCopy?.textRegions.find((candidate) =>
          candidate.lines.some((line) => comparableCopy(line) === comparableCopy(sourceLine)) || comparableCopy(candidate.text).includes(comparableCopy(sourceLine))
        );
        if (isSourceBrandRemovalRegion(region)) return "";
        const role = sourceLineRole(reference, sourceLine, lineIndex);
        if (role === "cta") {
          const target = referenceAwareFallbackText({ sourceLine, preferred: "상품 자세히 보기", candidates: ["상품 자세히 보기", "구성 확인하기"], role, identity, usedSignatures: usedTargetSignatures });
          recordFactsForTarget(target);
          return target;
        }
        if (role === "offer" && offer.text) {
          const offerReplacement = offerIndex === 0 ? undefined : fallbackOfferFacts[offerIndex - 1];
          offerIndex += 1;
          offer.facts.forEach((fact) => usedFacts.set(fact.id, fact));
          const target = referenceAwareFallbackText({ sourceLine, preferred: offerReplacement?.value || offer.text, candidates: offerFallbackCandidates, role, identity, usedSignatures: usedTargetSignatures });
          recordFactsForTarget(target);
          return target;
        }
        const fact = role === "offer" && offerFact ? offerFact : contentFacts[contentIndex++ % Math.max(1, contentFacts.length)];
        if (fact) usedFacts.set(fact.id, fact);
        const contextualPreferred = role === "headline" ? contextualCandidates[0] : role === "support" ? contextualCandidates[1] : "";
        const preferred = contextualPreferred || (fact ? reasonTextForFact(fact, identity, truth) : contextualCandidates[2]);
        const target = referenceAwareFallbackText({ sourceLine, preferred: preferred || identity, candidates: contentFallbackCandidates, role, identity, usedSignatures: usedTargetSignatures });
        recordFactsForTarget(target);
        return target;
      })
    : [headlineFallbackText, supportFallbackText, proofFallbackText, offer.text, /없음|미사용|none/i.test(profile.ctaRole) ? "" : "상품 자세히 보기"].filter(Boolean));
  let copySlots = buildCopySlots(reference, sourceLines, adaptedLines);
  // OCR가 비어도 이미지 생성을 빈 문구 계약으로 시작하지 않는다. 레퍼런스의
  // 밀도·구성 태그로 예상 슬롯을 만들고, 실제 편집 단계에서는 원본 이미지의
  // 대응 문구 영역을 직접 읽어 이 검증된 ProductTruth 문구로 교체한다.
  if (!copySlots.length) {
    const slotRoles = fallbackSlotRoles(reference, profile, Boolean(offer.text));
    const fallbackByRole = {
      headline: headlineFallbackText,
      support: supportFallbackText,
      proof: proofFallbackText,
      offer: offer.text || supportFallbackText,
      cta: "상품 자세히 보기",
      badge: proofFallbackText,
      other: proofFallbackText,
    } as const;
    const usedTargets = new Set<string>();
    copySlots = slotRoles
      .map((role) => ({ role, targetText: fallbackByRole[role] }))
      .filter(({ targetText }) => {
        const signature = comparableCopy(targetText);
        if (!signature || usedTargets.has(signature)) return false;
        usedTargets.add(signature);
        return true;
      })
      .map(({ role, targetText }, slotIndex) => ({
        index: slotIndex,
        role,
        sourceText: "",
        targetText,
        emphasis: role === "headline" || role === "offer" ? "strong" as const : "none" as const,
      }));
    [headlineFact, supportFact, proofFact, ...offer.facts]
      .filter((fact): fact is ProductFact => Boolean(fact))
      .forEach((fact) => usedFacts.set(fact.id, fact));
  }
  adaptedLines = copySlots.map((slot) => slot.targetText);
  const headlineLines = copySlots.filter((slot) => slot.role === "headline").map((slot) => slot.targetText).filter(Boolean);
  const supportLines = copySlots.filter((slot) => slot.role === "support").map((slot) => slot.targetText).filter(Boolean);
  const proofLines = copySlots.filter((slot) => slot.role === "proof" || slot.role === "badge").map((slot) => slot.targetText).filter(Boolean);
  const offerLines = offer.text ? copySlots.filter((slot) => slot.role === "offer").map((slot) => slot.targetText).filter(Boolean) : [];
  const ctaLines = copySlots.filter((slot) => slot.role === "cta").map((slot) => slot.targetText).filter(Boolean);
  // 완결된 상세페이지 사실만 후보에 넣었으므로 여기서 문자열을 기계적으로
  // 자르지 않는다. 중간 잘림은 광고 문구 품질과 사실 전달을 함께 훼손한다.
  const headline = headlineLines.join(" ") || headlineFallbackText;
  const selected = [...usedFacts.values()];
  if (!selected.length) [headlineFact, supportFact, proofFact, ...offer.facts].filter((fact): fact is ProductFact => Boolean(fact)).forEach((fact) => selected.push(fact));
  const candidate: ReferenceAdaptedCopyPlan = {
    id: `reference-copy-${truth.productId}-${index + 1}`,
    resultCode: `H${String(index + 1).padStart(2, "0")}`,
    referenceId: reference.id,
    referenceCopyProfileId: profile.id,
    referenceRawCopy: sourceLines.join("\n"),
    referenceRawLines: sourceLines,
    adaptedLines,
    copySlots,
    headline,
    subCopy: supportLines.join(" "),
    proof: proofLines.join(" "),
    offer: offerLines.join(" "),
    cta: ctaLines.join(" "),
    factIds: selected.map((fact) => fact.id),
    sourceFactValues: selected.map((fact) => fact.value),
    tone: profile.tone,
    sentenceStyle: profile.sentenceStyle,
    naturalnessScore: numberedFallback ? 90 : 82,
    referenceFitScore: numberedFallback ? 88 : 82,
    factualSafetyScore: 100,
    validationStatus: "valid",
    validationErrors: [],
    repairCount: 0,
    generationSource: "reference-best-effort",
  };
  const validationErrors = [...new Set(validatePlan(candidate, truth, profile))];
  return {
    ...candidate,
    validationStatus: validationErrors.length ? "invalid" : "valid",
    validationErrors,
  };
}

export function hasExecutableReferenceCopyContract(plan: ReferenceAdaptedCopyPlan | undefined) {
  if (!plan) return false;
  // 편집 가능한 최소 계약이다. 실제 신규 제작에는 아래 publishable 계약을
  // 추가 적용해 품질 점수·중복·레퍼런스 적합성까지 확인한다. 비브랜드 광고 슬롯의 빈값과
  // ProductTruth 근거 오류는 최소 계약에서도 허용하지 않는다.
  const targetLines = (plan.adaptedLines || []).filter((line) => line.trim());
  const targetSlots = (plan.copySlots || []).filter((slot) => slot.targetText.trim());
  if (!plan.headline.trim() || !targetLines.length || !targetSlots.length) return false;
  const blankNonBrandSlots = (plan.copySlots || []).filter((slot) =>
    slot.sourceText.trim() &&
    slot.sourceType !== "source-brand" &&
    slot.replacePolicy !== "remove" &&
    !slot.targetText.trim()
  );
  if (blankNonBrandSlots.length) return false;
  const groundingErrors = (plan.validationErrors || []).filter((error) =>
    /ProductTruth|근거(?:가| 없이| 없는)|확인되지|허위|원산지|산지(?:\s*특가)?\s*근거|배송/u.test(error)
  );
  if (groundingErrors.length) return false;
  const renderedCopy = [plan.headline, plan.subCopy, plan.proof, plan.offer, plan.cta, ...targetLines]
    .filter(Boolean)
    .join("\n");
  if (isShippingCreativeSignal(renderedCopy)) return false;
  return true;
}

export function hasPublishableReferenceCopyContract(plan: ReferenceAdaptedCopyPlan | undefined) {
  if (!hasExecutableReferenceCopyContract(plan) || !plan) return false;
  return plan.validationStatus === "valid" &&
    plan.naturalnessScore >= NATURALNESS_PASS_SCORE &&
    plan.referenceFitScore >= REFERENCE_FIT_PASS_SCORE &&
    plan.factualSafetyScore >= 90 &&
    !(plan.validationErrors || []).length;
}

export async function createBestEffortReferenceCopyPlan(input: {
  truth: ProductTruth;
  reference: NativeAdReference;
  index: number;
  previous?: ReferenceAdaptedCopyPlan;
}) {
  const profile = fallbackProfile(input.reference, await referenceHash(input.reference));
  // 사실이 매우 적거나 원본 레퍼런스가 고밀도여도 이미지 제작을 포기하지
  // 않도록 서로 다른 안전 사용 맥락을 최대 6번 회전해 완전한 문구 계약을 찾는다.
  // 가격 토큰을 반복하는 방식이 아니라 상품군별 자연스러운 기본 문장만 회전한다.
  const candidates = Array.from({ length: 6 }, (_, offset) => fallbackPlan(input.truth, input.reference, profile, input.index + offset));
  const fallback = candidates.find((candidate) => hasPublishableReferenceCopyContract(candidate)) || candidates[0];
  return {
    ...fallback,
    id: input.previous?.id || `reference-copy-${input.truth.productId}-${input.index + 1}`,
    resultCode: input.previous?.resultCode || `H${String(input.index + 1).padStart(2, "0")}`,
    // 이전 계획의 빈 슬롯·근거 오류는 fallback 문구에 승계하지 않는다. 승계하면
    // 안전하게 복구된 계획도 매 실행마다 다시 편집 불가능 판정을 받는다.
    validationErrors: fallback.validationErrors,
    repairCount: Math.max(input.previous?.repairCount || 0, fallback.repairCount),
  };
}

// Turbopack 개발 캐시와 저장된 서버 모듈이 이전 export 이름을 참조해도
// 빌드를 중단하지 않는다. 구현은 항상 현재 reference-best-effort 정책을 쓴다.
export const createTruthFallbackReferenceCopyPlan = createBestEffortReferenceCopyPlan;

function ensureRenderableReferencePlans(input: {
  truth: ProductTruth;
  references: NativeAdReference[];
  profiles: ReferenceCopyProfile[];
  plans: ReferenceAdaptedCopyPlan[];
}) {
  return input.references.map((reference, index) => {
    const plan = input.plans[index];
    if (hasPublishableReferenceCopyContract(plan)) return plan;
    const fallback = fallbackPlan(input.truth, reference, input.profiles[index], index);
    return {
      ...fallback,
      repairCount: Math.max(plan?.repairCount || 0, fallback.repairCount),
    };
  });
}

function validatePlan(plan: ReferenceAdaptedCopyPlan, truth: ProductTruth, profile: ReferenceCopyProfile) {
  const errors: string[] = [];
  errors.push(...findReferenceCopyNaturalnessErrors(plan));
  const facts = new Map(truth.facts.map((fact) => [fact.id, fact]));
  const selectedFacts = plan.factIds.map((id) => facts.get(id)).filter((fact): fact is ProductFact => Boolean(fact));
  if (!plan.headline.trim()) errors.push("헤드라인이 비어 있습니다.");
  if (!plan.factIds.length) errors.push("문구의 근거가 되는 ProductTruth fact id가 없습니다.");
  if (Array.from(plan.headline.replace(/\s/g, "")).length > profile.headlineCharacterBudget + 8) errors.push("레퍼런스 헤드라인 길이 예산을 초과했습니다.");
  if (plan.factIds.some((id) => !facts.has(id))) errors.push("존재하지 않는 ProductTruth fact id가 포함됐습니다.");
  if (selectedFacts.some((fact) => fact.copyEligibility === "blocked" || !fact.usableInCopy)) errors.push("문구 사용이 차단된 사실이 포함됐습니다.");
  if (selectedFacts.some((fact) => fact.evidenceType === "shipping" || isShippingCreativeSignal(fact.value))) errors.push("배송 관련 정보는 광고 문구로 사용할 수 없습니다.");
  if (selectedFacts.some((fact) => fact.copyEligibility === "offerOnly" && `${plan.headline} ${plan.subCopy} ${plan.proof}`.includes(fact.value))) errors.push("가격·혜택 사실이 offer 이외 영역에 사용됐습니다.");
  if (plan.offer && !selectedFacts.some((fact) => fact.copyEligibility === "offerOnly")) errors.push("offer 문구에 연결된 가격·혜택 사실이 없습니다.");
  if (plan.proof && !selectedFacts.some((fact) => ["headlineEligible", "proofOnly"].includes(fact.copyEligibility || "headlineEligible"))) errors.push("proof 문구에 연결된 근거 사실이 없습니다.");
  const factual = validateCopyAgainstTruth([...(plan.adaptedLines || []), plan.headline, plan.subCopy, plan.proof, plan.offer, plan.cta].join(" "), truth);
  if (!factual.valid) errors.push("ProductTruth에 없는 수치 또는 차단 표현이 포함됐습니다.");
  const sourceCopy = plan.referenceRawCopy || "";
  const adaptedCopy = [plan.headline, plan.subCopy, plan.proof, plan.offer, plan.cta].join(" ");
  const standaloneMarker = (text: string, marker: string) => new RegExp(`(?:^|\\s|[?!.,;:'"“”‘’()\\[\\]])${marker}(?:$|\\s|[?!.,;:'"“”‘’()\\[\\]])`, "u").test(text);
  for (const marker of ["ㅋㅋ", "ㅎㅎ", "ㅠㅠ", "ㅜㅜ", ";;", "...", "..", "??", "?!", "!?", "ㄷㄷ", "헐", "뭐임", "왜 이럼", "못 참지", "겨"]) {
    const sourceHas = ["헐", "겨"].includes(marker) ? standaloneMarker(sourceCopy, marker) : sourceCopy.includes(marker);
    const adaptedHas = ["헐", "겨"].includes(marker) ? standaloneMarker(adaptedCopy, marker) : adaptedCopy.includes(marker);
    if (sourceHas && !adaptedHas) errors.push(`레퍼런스 고유 말투·기호(${marker})가 사라졌습니다.`);
    if (!sourceHas && adaptedHas) errors.push(`레퍼런스에 없는 말투·기호(${marker})를 새로 추가했습니다.`);
  }
  const sourceLines = plan.referenceRawLines || [];
  const targetLines = plan.adaptedLines || [];
  const slots = plan.copySlots || [];
  const removalIndexes = new Set(
    slots
      .filter((slot) => slot.sourceType === "source-brand" || slot.replacePolicy === "remove")
      .map((slot) => slot.index)
  );
  if (sourceLines.length && targetLines.length !== sourceLines.length) errors.push("레퍼런스 원문과 적응 문구의 줄 수가 다릅니다.");
  if (sourceLines.some((line, index) => !removalIndexes.has(index) && line.trim() && !targetLines[index]?.trim())) errors.push("레퍼런스의 문구 블록이 빈 문구로 삭제됐습니다.");
  if (slots.some((slot) => removalIndexes.has(slot.index) && slot.targetText.trim())) errors.push("기존 광고주 로고 제거 슬롯에 새 로고 문구가 지정됐습니다.");
  const sourceNonBlank = sourceLines.filter((line, index) => !removalIndexes.has(index) && line.trim());
  const targetNonBlank = targetLines.filter((line, index) => !removalIndexes.has(index) && line.trim());
  if (sourceNonBlank.length && targetNonBlank.length < Math.ceil(sourceNonBlank.length * 0.9)) errors.push("레퍼런스 대비 문구 정보 밀도가 지나치게 낮아졌습니다.");
  const sourceCharacterCount = sourceNonBlank.join("").replace(/\s/g, "").length;
  const targetCharacterCount = targetNonBlank.join("").replace(/\s/g, "").length;
  const minimumDensityRatio = profile.density === "dense" ? 0.68 : profile.density === "medium" ? 0.58 : 0.48;
  if (sourceCharacterCount >= 20 && targetCharacterCount < Math.floor(sourceCharacterCount * minimumDensityRatio)) errors.push("레퍼런스 문구의 시각적 분량이 과도하게 축약됐습니다.");
  const sourceHeadline = slots.filter((slot) => slot.role === "headline").map((slot) => slot.sourceText).join(" ") || sourceLines.slice(0, profile.headlineLineBudget).join(" ");
  const sourceHasStrongHook = /[?!]|\b1\s*\+\s*1\b|전후|탈출|찾았다|왜|어떻게|없다|아니|만에|한정|특가|증정|무료|%/i.test(sourceHeadline);
  const normalizedHeadline = comparableCopy(plan.headline);
  const normalizedProductName = comparableCopy(truth.normalized.cleanProductName || truth.product.productName);
  if (sourceHasStrongHook && normalizedHeadline && (normalizedHeadline === normalizedProductName || normalizedProductName.includes(normalizedHeadline))) {
    errors.push("강한 레퍼런스 헤드라인이 단순 상품명으로 축약됐습니다.");
  }
  const sourceHeadlineCharacterCount = factCharacterCount(sourceHeadline);
  const targetHeadlineCharacterCount = factCharacterCount(plan.headline);
  if (sourceHasStrongHook && sourceHeadlineCharacterCount >= 10 && targetHeadlineCharacterCount < Math.max(7, Math.floor(sourceHeadlineCharacterCount * 0.55))) {
    errors.push("강한 레퍼런스 헤드라인의 질문·반전·판매 강도가 지나치게 단순화됐습니다.");
  }
  const flattenedTarget = comparableCopy(targetLines.join(" "));
  if (targetLines.length && normalizedHeadline && !flattenedTarget.includes(normalizedHeadline)) errors.push("최종 헤드라인이 줄별 편집 계약에 포함되지 않았습니다.");
  const copy = [...targetLines, plan.headline, plan.subCopy, plan.proof, plan.offer, plan.cta].join(" ");
  if (isShippingCreativeSignal(copy)) errors.push("배송·출고·도착 관련 표현은 광고 문구에서 제외해야 합니다.");
  if (isProhibitedAdCopySignal(copy)) errors.push("부정·배송·CS·양해·판매주체 또는 상세페이지 운영 문구가 광고 문구에 포함됐습니다.");
  const bannedGenericPhrases = ["구매 조건 보기", "이 선택", "핵심 이유", "고를 이유", "한눈에", "새로운 사용 이유", "지금 확인하세요"];
  if (bannedGenericPhrases.some((phrase) => copy.includes(phrase))) errors.push("상품과 무관한 범용 광고 문구가 포함됐습니다.");
  if (plan.subCopy && Array.from(plan.subCopy.replace(/\s/g, "")).length > profile.supportCharacterBudget + 12) errors.push("레퍼런스 보조 문구 길이 예산을 초과했습니다.");
  const slotBudgets: Partial<Record<NonNullable<ReferenceAdaptedCopyPlan["copySlots"]>[number]["role"], number>> = {
    headline: profile.headlineCharacterBudget + 8,
    support: Math.max(24, profile.supportCharacterBudget + 12),
    proof: 46,
    offer: 32,
    cta: 18,
    badge: 24,
    other: 46,
  };
  for (const slot of plan.copySlots || []) {
    const explicitBudget = Number(slot.characterBudget);
    const budget = Number.isFinite(explicitBudget) && explicitBudget > 0 ? explicitBudget + 8 : slotBudgets[slot.role] || 46;
    if (factCharacterCount(slot.targetText) > budget) errors.push(`레퍼런스 ${slot.role} 슬롯의 문구 길이 예산을 초과했습니다.`);
  }
  const cleanIdentity = String(truth.normalized.cleanProductName || truth.product.productName || "").trim();
  const identitySignature = comparableCopy(cleanIdentity);
  if (factCharacterCount(cleanIdentity) > 24 && identitySignature && (plan.copySlots || []).some((slot) => comparableCopy(slot.targetText).includes(identitySignature))) {
    errors.push("긴 SEO 상품명이 문구 슬롯에 그대로 사용됐습니다.");
  }
  const baseIdentity = comparableCopy(truth.normalized.baseProductName || cleanIdentity);
  const identityMentions = (plan.copySlots || [])
    .map((slot) => comparableCopy(slot.targetText))
    .filter((text) => baseIdentity.length >= 5 && text.includes(baseIdentity));
  if (identityMentions.length > 1) errors.push("같은 상품명이 한 이미지의 여러 문구 블록에 반복됐습니다.");
  const slotSignatures = new Set<string>();
  for (const slot of plan.copySlots || []) {
    if (slot.role === "cta" || slot.sourceType === "source-brand" || slot.replacePolicy === "remove") continue;
    const signature = comparableCopy(slot.targetText);
    if (signature.length < 5) continue;
    if (slotSignatures.has(signature)) errors.push("같은 핵심 문구가 한 이미지의 여러 문구 블록에 반복됐습니다.");
    slotSignatures.add(signature);
  }
  return errors;
}

function normalizePlan(raw: PlannerPayload["plans"][number] | undefined, truth: ProductTruth, reference: NativeAdReference, profile: ReferenceCopyProfile, index: number, source: "codex-local" | "repaired-codex-local"): ReferenceAdaptedCopyPlan {
  if (!raw || raw.referenceId !== reference.id) return fallbackPlan(truth, reference, profile, index);
  const known = new Map(truth.facts.map((fact) => [fact.id, fact]));
  const storedSourceLines = reference.nativeCopy?.useForCopyAdaptation === false ? [] : normalizeReferenceRawLines(reference.nativeCopy?.rawLines || []);
  const referenceRawLines = storedSourceLines;
  const proposedAdaptedLines = normalizeReferenceRawLines(raw.adaptedLines);
  const copySlots = buildCopySlots(reference, referenceRawLines, proposedAdaptedLines);
  const adaptedLines = copySlots.map((slot) => slot.targetText);
  const copyFields = canonicalCopyFields(copySlots, raw);
  const factIds = resolvedPlanFactIds(truth, raw.factIds, copyFields, adaptedLines);
  const plan: ReferenceAdaptedCopyPlan = {
    id: `reference-copy-${truth.productId}-${index + 1}`,
    resultCode: `H${String(index + 1).padStart(2, "0")}`,
    referenceId: reference.id,
    referenceCopyProfileId: profile.id,
    referenceRawCopy: reference.nativeCopy?.useForCopyAdaptation === false ? "" : reference.nativeCopy?.rawText || "",
    referenceRawLines,
    adaptedLines,
    copySlots,
    ...copyFields,
    factIds,
    sourceFactValues: factIds.map((id) => known.get(id)?.value || ""),
    tone: raw.tone.trim() || profile.tone,
    sentenceStyle: sentenceStyles.includes(raw.sentenceStyle) ? raw.sentenceStyle : profile.sentenceStyle,
    naturalnessScore: raw.naturalnessScore,
    referenceFitScore: raw.referenceFitScore,
    factualSafetyScore: raw.factualSafetyScore,
    validationStatus: "valid",
    validationErrors: [],
    repairCount: source === "repaired-codex-local" ? 1 : 0,
    generationSource: source,
  };
  // 모델의 자체 validationErrors에는 이미 수정한 과거 지적이 섞일 수 있다.
  // 현재 슬롯의 결정적 검증과 별도 critic 결과만 실행 여부에 사용한다.
  const errors = [...new Set(validatePlan(plan, truth, profile))];
  if (plan.naturalnessScore < NATURALNESS_PASS_SCORE) errors.push(`한국어 문구 자연스러움 ${NATURALNESS_PASS_SCORE}점 기준을 통과하지 못했습니다.`);
  if (plan.referenceFitScore < REFERENCE_FIT_PASS_SCORE) errors.push(`레퍼런스 문구 구조 적합도 ${REFERENCE_FIT_PASS_SCORE}점 기준을 통과하지 못했습니다.`);
  if (plan.factualSafetyScore < 90) errors.push("상품 사실 안전성 기준을 통과하지 못했습니다.");
  return { ...plan, validationStatus: errors.length ? "invalid" : "valid", validationErrors: [...new Set(errors)] };
}

function planningPrompt(input: { truth: ProductTruth; references: NativeAdReference[]; profiles: ReferenceCopyProfile[]; missingProfileIds: string[]; copyGuide?: LoadedCopyGuide | null; repairPlans?: ReferenceAdaptedCopyPlan[] }) {
  const productionDate = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return `한국 광고 제작용 레퍼런스 원문 적응 문구를 한 번의 배치로 작성한다. 레퍼런스와 무관한 별도 후킹 전략·성과 가설·장면 콘셉트는 만들지 않되, 레퍼런스의 수사 골격 안에서 상품 사실을 소비자가 반응할 광고 후킹으로 번역한다.

현재 제작 날짜(Asia/Seoul): ${productionDate}

업체별 문구 가이드:
${copyGuidePromptBlock(input.copyGuide)}

작업 원칙:
- 목표는 맞춤법만 통과하는 안전 문구가 아니라 사람의 추가 수정 없이 광고에 넣을 수 있는 최소 7/10 이상의 문장력이다. 각 안은 자연스러움과 레퍼런스 수사 적합도 모두 80점 이상을 목표로 하고, 상품명·특징·가격을 단순 나열한 문구는 통과시키지 않는다.
- 각 레퍼런스의 rawText/rawLines가 유일한 문구 출발점이다. 일반화된 청사진이나 새 후킹을 만들지 않는다.
- observedSourceLines에는 저장된 rawLines를 글자와 빈 줄까지 그대로 복사한다. 이 단계에서는 이미지 파일을 열거나 OCR하지 않는다.
- adaptedLines는 rawLines와 같은 개수·순서·빈 줄을 유지하고, 각 줄에서 상품에 맞지 않는 사실만 교체한다.
- textRegions의 sourceType이 source-brand이거나 replacePolicy가 remove인 줄은 예외적으로 adaptedLines를 빈 문자열로 둔다. '연출 이미지', '예시 이미지', '이해를 돕기 위한 이미지', 원본 AI 활용 고지처럼 레퍼런스에 붙은 출처성 이미지 고지도 remove 영역으로 취급한다. 이 영역에는 현재 상품명·브랜드명·광고 문구를 넣지 않고 주변 배경만 복원한다. 실제 결과의 AI 고지는 사용자가 선택한 별도 후처리에서만 적용한다.
- 저장 rawLines가 비어 있는 레퍼런스는 이 배치에 전달되지 않으며 별도의 ProductTruth 안전 최소 문구를 사용한다.
- source-brand/remove 영역을 제외한 원본의 모든 비어 있지 않은 문구 블록은 최종 문구에서도 비어 있지 않아야 한다. 가격·할인·증정처럼 현재 상품에 근거가 없는 슬롯은 삭제하거나 수치를 만들지 말고, 비슷한 길이의 검증된 USP·사용 사실·상품 식별 문구로 역할을 바꿔 시각적 밀도를 유지한다.
- 원문의 단어 순서, 줄 수, 문장부호, 이모지, ㅋㅋ, ㅎㅎ, ㅠㅠ, ;;, .., ㄷㄷ, 헐, 뭐임, 겨 같은 구어체를 최대한 그대로 둔다.
- 기존 상품·가격·혜택·업체·상품별 근거만 ProductTruth의 현재 상품 사실로 치환한다. 다만 레퍼런스의 수사 의도와 말투를 보존하는 것이 목적이지, 명사를 슬롯처럼 바꾸는 것이 목적이 아니다.
- 업체별 문구 가이드는 레퍼런스 구조 안에서 어떤 상품 사실을 어떤 소비자 언어로 강조할지 결정하는 품질 기준이다. 가이드의 강한 문제 제기·손실 회피·감각 표현을 사실 범위 안에서 충분히 살리고, 무난한 상품 소개문으로 순화하지 않는다.
${sheetClaimPolicy(input.truth)}
- ${CREATIVE_CONTEXT_POLICY}
- 계절·시즌 맥락은 위 제작 날짜와 맞아야 한다. 유행 표현은 모델이 의미와 사용 맥락을 확실히 아는 경우에만 사용하고, 모르는 신조어를 지어내지 않는다.
- 창작 맥락은 상품명을 꾸미는 계절 단어 하나로 끝내지 말고, 소비자가 실제로 겪는 질문·선택·먹는 순간·선물 상황·유행과의 비교처럼 문장 안에서 역할을 갖게 한다. 상품과 연결이 억지스럽거나 소비자가 관계를 추측해야 하면 naturalness 오류로 본다.
- ProductTruth의 value는 사실 근거이고 copyHint는 조사 보고서 말투를 제거한 작성 힌트다. 둘을 문구 칸에 그대로 복사하지 말고 레퍼런스의 질문·대화·반전·비교·사용 장면 문법으로 압축한다.
- 배송, 무료배송, 배송비, 출고, 도착 예정, 택배 관련 정보는 ProductTruth에 있더라도 광고 문구에 절대 사용하지 않는다. 원본 레퍼런스에 배송 슬롯이 있으면 현재 상품의 다른 검증된 구매 이유나 CTA로 바꾼다.
- 부정적인 상품 경험·하자·파손·흠집 문장, CS·교환·환불·반품 안내, 소비자에게 양해·주의·확인을 구하는 공지, 판매원·제조원·공급원·판매자·사업자 정보는 이미지 OCR에 실제로 있어도 광고 문구에 절대 사용하지 않는다.
- productConstraints는 상품을 더 좋게 과장하지 않기 위한 내부 시각·표현 제한이다. 해당 원문을 광고 카피로 옮기지 말고, 제한과 모순되는 프리미엄·완벽한 외관·선물용 같은 주장을 만들지 않는다.
- 원산지는 현재 상품이 육류이고 국내산·국산 근거가 확인된 경우에만 광고에 표기한다. 과일·채소·간식·가공식품·화장품 등 비육류에서는 국내산이어도 원산지를 헤드라인·근거·배지·이미지 내 문구에 사용하지 않는다. 수입산·외국산은 상품군과 관계없이 사용하지 않는다.
- '~으로 소개됨', '~라고 정리됨', '~에게 어울리는 방향'은 업체 조사 문장이지 광고 문구가 아니다. 최종 문구에는 '소개됨·정리됨·방향' 같은 조사 보고서 어미를 남기지 않는다.
- 단일 상품의 250ml·500g 같은 용량은 '총 250ml 구성'처럼 세트로 표현하지 않는다. 용량은 레퍼런스에 수치 슬롯이 있을 때 한 이미지 안에서 한 번만 작게 사용하고 헤드라인으로 삼지 않는다.
- 동일한 정식 상품명은 한 이미지에서 최대 한 블록에만 사용한다. 나머지 블록은 사용 상황·향·성분·추출 방식·가격·CTA처럼 서로 다른 역할을 맡긴다.
- 여섯 소재는 레퍼런스 구조가 다를 뿐 아니라 핵심 주장도 달라야 한다. 같은 헤드라인·같은 감각 표현·같은 가격 결론을 어순이나 조사만 바꿔 반복하지 않는다. 각 소재가 담당할 대표 메시지를 먼저 서로 다르게 배분한 뒤 작성한다.
- 원문이 중간·고밀도이면 source-brand/remove를 제외한 문구 블록 수와 시각적 글자량을 유지한다. 긴 질문·비교·문제 제기를 짧은 상품명, 카테고리명, '구성 확인' 같은 범용 문구 하나로 축약하지 않는다.
- '향 그대로네요'처럼 비교 대상이나 앞선 경험이 없는 지시 표현을 독립 헤드라인으로 쓰지 않는다.
- 화장품·바디워시의 상세 사실은 소비자 선택 장면으로 바꾼다. 해당 사실이 ProductTruth에 있을 때만 '꽃향 말고, 산뜻한 시트러스 향 찾는 분?', '무거운 아침, 라임 향으로 깨워볼까요?', '레몬보다 쌉싸름하고 선명한 라임 향', '열 없이 눌러 얻은 라임·오렌지 껍질 오일' 같은 압축 방향을 사용할 수 있다. 예문을 다른 상품에 복사하지 않는다.
- 생성한 단어를 한 글자씩 확인한다. '소개됨'을 '소거됨'처럼 바꾸거나 원문에 없는 유사 단어를 만들면 치명 오류다.
- 상품 사실을 바꾼 뒤에는 주어·서술어, 조사, 수식 관계와 문장 완결성을 현재 상품 기준으로 반드시 다시 조립한다. 자연스러운 문법을 위해 같은 줄 안의 어순과 조사를 바꿀 수 있으며, 이 수정은 레퍼런스 훼손으로 보지 않는다.
- 사람 주어를 계절·상품·가격 명사로 바꾸지 않는다. 예: ‘남편이 먼저 더 사자고 졸라요’의 ‘남편’을 ‘추석’으로 치환한 ‘추석이 먼저 더 사자고 졸라요’는 금지한다. 사람 근거가 없으면 ‘명절 준비라면 한 세트 더 챙기고 싶어요’처럼 확인된 상품 상황으로 문장 전체를 다시 쓴다.
- 여러 줄이 한 문장을 이루면 줄바꿈을 제거해 이어 읽었을 때도 자연스러워야 한다. ‘명절 특별구성에 / 소 찜갈비 대용량으로 / 드셔보신 적 있으세요?’처럼 조사 연결이 깨진 문구, ‘갈비찜으로 간편해결,’처럼 미완성 쉼표·붙여 쓴 명사로 끝나는 문구를 금지한다.
- 명절·식사·선물처럼 소비 상황이 있는 상품은 상품명 앞에 계절 단어만 붙이지 말고, 소비자가 실제로 고민하거나 묻는 장면으로 바꾼다. 나쁜 예: ‘명절 메뉴 없더니...’. 좋은 방향: ‘명절 갈비, 언제 손질해요...’, ‘명절 음식 언제 만들어요...’. 단, 손질·간편 준비 같은 구체 내용은 ProductTruth에 근거가 있을 때만 쓴다.
- 사람 반응형 원문의 핵심은 사람과 행동의 관계다. 나쁜 예: ‘추석이 먼저 사자고 졸라요’. 좋은 방향: ‘먹어본 사람은 계속 달라고 졸라요’. 단, 먹어본 사람의 반응·재구매·후기 표현은 ProductTruth에 실제 후기 근거가 있을 때만 허용하고, 근거가 없으면 ‘명절 갈비, 한 팩 더 준비할까요?’처럼 검증된 상품 상황의 질문으로 바꾼다.
- 광고 문구는 맞춤법만 맞는 설명문이 아니라, 처음 보는 소비자가 1초 안에 상황·대상·행동을 이해할 수 있는 구어체여야 한다. ‘명절 특별구성’, ‘대용량으로 준비’ 같은 범용 단어를 이어 붙인 문장보다 구체적인 질문·대화·사용 장면을 우선한다.
- 원문 헤드라인이 질문·반전·비교·문제 제기·긴급성·수치 강조형이면 그 수사 장치와 판매 강도를 유지한다. 강한 헤드라인을 현재 상품명만 적은 소개 문구로 약화하지 않는다.
- 원문의 헤드라인/서브/근거/혜택/CTA/배지 블록 수, 읽기 순서, 상대적 글자 분량을 유지한다. 전체 문구량을 원문의 절반 이하로 축약하지 않는다.
- 원문에 채팅/댓글/밈 문법이 있을 때만 그 형식을 유지하고, 없으면 새로 추가하지 않는다.
- ProductTruth는 사실 상한선이다. 제공된 fact 이외의 가격, 할인, 구성, 후기, 효능, 원산지, 수치를 만들지 않는다.
- 후기 카드의 작성 날짜·시각·작성자·닉네임 같은 UI 메타데이터는 광고 사실이 아니다. ProductTruth에 실수로 남아 있더라도 문구로 옮기지 않는다.
- 레퍼런스 문장의 관계가 작성의 골격이다. 문제→해결, 질문→대답, 비교→결론, 경험→추천처럼 여러 줄 사이의 수사 관계를 유지하고, 상품 사실을 나열한 상세페이지 요약문으로 바꾸지 않는다.
- semanticComparison=true인 VS 레퍼런스는 좌측/문제 문구와 우측/해결 문구의 역할을 절대 합치지 않는다. 불리한 쪽은 현재 상품과 같은 카테고리의 익명·일반 대안이 양이 적거나 만족감·가성비가 아쉬운 구체적 선택 상황을 말하고, 유리한 쪽은 현재 상품의 검증된 구성·식감·가격·사용 이점으로 답한다. 불리한 쪽에 고기·채소·화장품처럼 다른 상품군을 넣거나, 양쪽 모두 현재 상품을 칭찬하거나, 이름 있는 경쟁사를 비방하거나, 근거 없는 비교 수치를 만들지 않는다.
- 같은 상품명·구성·중량 설명을 여러 블록에 반복하지 않는다. 원문에서 역할이 다른 블록은 현재 상품의 서로 다른 검증 사실이나 CTA로 그 역할을 유지한다.
- headlineEligible은 헤드라인/보조 문구에, proofOnly는 근거에, offerOnly는 offer에만 쓴다. identityOnly는 상품 식별에만 쓴다.
- 애매한 상투어보다 ProductTruth의 구체 사실을 우선하고, 확인된 사실 안에서는 판매형 말투를 충분히 강하게 유지한다.
- CTA는 레퍼런스에 실제 CTA 역할이 있을 때만 짧게 작성한다.
- 여섯 결과가 같은 의미가 되지 않게 서로 다른 원문 의미 구조를 유지한다.
- 가격은 최대 2장, 할인율은 최대 2장, 쿠폰/증정 등 혜택은 최대 3장, 수량·중량은 최대 2장에서만 메인 강조한다.
- 각 plan은 스스로 점검한 naturalnessScore, referenceFitScore, factualSafetyScore와 validationErrors를 반드시 포함한다. naturalnessScore는 주어·서술어·조사·문장 완결성과 소비자가 한 번에 이해하는지를 기준으로 엄격하게 채점하며 ${NATURALNESS_PASS_SCORE}점 미만이면 스스로 invalid 사유를 적는다.
- 결과 코드는 내부 순번 H01~H06일 뿐 후킹 유형이 아니다.

상품 사실:
${JSON.stringify({ productName: shortProductIdentity(input.truth), facts: factsForPlanning(input.truth), productConstraints: input.truth.productCopyConstraints || [] }, null, 2)}

레퍼런스:
${JSON.stringify(input.references.map((reference, index) => ({ resultCode: `H${String(index + 1).padStart(2, "0")}`, referenceId: reference.id, layoutFamily: reference.layoutFamily, textDensity: reference.textDensity, compositionType: reference.compositionType, productSlotCount: reference.productSlotCount, semanticComparison: referenceRequiresComparisonSemantics(reference), rawText: reference.nativeCopy?.useForCopyAdaptation === false ? "" : reference.nativeCopy?.rawText || "", rawLines: reference.nativeCopy?.useForCopyAdaptation === false ? [] : reference.nativeCopy?.rawLines || [], textRegions: reference.nativeCopy?.useForCopyAdaptation === false ? [] : reference.nativeCopy?.textRegions || [] })), null, 2)}

이미 분석된 프로필:
${JSON.stringify(input.profiles.filter((profile) => !input.missingProfileIds.includes(profile.referenceId)), null, 2)}

profiles는 과거 저장 구조 호환용이므로 빈 배열로 반환한다. 각 plan의 headline/subCopy/proof/offer/cta는 adaptedLines의 같은 역할 문구와 반드시 일치해야 한다.
${input.repairPlans?.length ? `다음 검증 실패 문구만 한 번 수정한다. 나머지 resultCode는 plans에 포함하지 않는다. 각 validationErrors를 체크리스트로 모두 해결하고, 고친 결과의 validationErrors는 빈 배열로 반환한다. factIds에는 실제 사용한 가격·혜택·상품 사실을 빠짐없이 넣는다. 원문 슬롯 수와 역할은 그대로 유지하며 문구를 삭제해 오류를 피하지 않는다: ${JSON.stringify(input.repairPlans, null, 2)}` : "여섯 레퍼런스 각각의 plans를 작성한다."}
JSON 스키마만 반환한다.`;
}

function profilePrompt(references: NativeAdReference[]) {
  return `광고 레퍼런스 이미지의 문구 구조만 분석한다. 상품 전략이나 새 문구는 생성하지 않는다. 각 imagePath를 확인해 headline/support/proof/offer/CTA 역할, 줄 수와 글자 수 예산, 말투, 문장형, 수치 강조, 문장부호 리듬을 기록한다. 원문의 핵심 리터럴 문구는 prohibitedLiteralPhrases에 기록한다. JSON 스키마만 반환한다.\n${JSON.stringify(references.map((reference) => ({ referenceId: reference.id, imagePath: reference.path, layoutFamily: reference.layoutFamily, textDensity: reference.textDensity })), null, 2)}`;
}

function criticPrompt(input: { truth: ProductTruth; profiles: ReferenceCopyProfile[]; plans: ReferenceAdaptedCopyPlan[]; copyGuide?: LoadedCopyGuide | null }) {
  return `아래 6개 한국 광고 문구를 한 번에 독립 검수한다. 새 문구를 만들지 말고 점수와 오류만 반환한다.\n창작 맥락 허용 규칙: ${CREATIVE_CONTEXT_POLICY} 따라서 자연스럽게 연결된 계절·시즌·유행·밈·사용 상황이 ProductTruth에 없다는 이유만으로 factualSafety를 감점하거나 오류로 판정하지 않는다.\n${sheetClaimPolicy(input.truth)}\n업체별 문구 품질 기준:\n${copyGuidePromptBlock(input.copyGuide)}\n검수 기준: 자연스러운 한국어, 업체별 가이드에 맞는 판매 강도와 최소 7/10 문장력, referenceRawCopy/referenceRawLines의 줄 수·기호·구어체와 수사 의도 보존, source-brand/remove를 제외한 원본 문구 블록과 정보 밀도 보존, 질문→대답·문제→해결·비교→결론·경험→추천 같은 줄 사이 관계 보존, 질문·반전·비교·문제 제기·긴급성 같은 헤드라인 판매 강도 보존, 상품의 사실 주장만 ProductTruth 안에 있는지, ProductTruth 밖 수치·혜택·효능 금지, 후기 작성 날짜·시각·작성자·닉네임 같은 UI 메타데이터 금지, 장면과 문구의 일치, 여섯 결과의 의미 중복 억제. ProductTruth에 승인된 vendor-research fact가 있으면 그 수치·효능·사용 상황은 정당한 근거이며 강하게 썼다는 이유만으로 감점하지 않는다. source-brand/remove 슬롯은 빈 targetText가 정답이며 현재 상품명·브랜드명으로 채우거나 새 로고 문구로 바꾸면 치명 오류다. 원문 어순을 기계적으로 유지하는 것보다 현재 상품 문장의 주어·서술어·조사·수식 관계·완결성이 우선이다. adaptedLines를 줄바꿈 없이 이어 읽어도 하나의 자연스러운 소비자 문장이 되어야 한다. 사람 주어를 추석·명절·가격·상품 같은 무생물 명사로 단순 치환하거나, 연결 조사·쉼표에서 문장이 끊기거나, 소비자가 의미를 추측해야 하면 naturalness 치명 오류다. ‘명절 메뉴 없더니...’처럼 상황과 주체가 빠진 문구, 계절 단어와 범용 판매어를 이어 붙인 문구도 naturalness 실패다. 처음 보는 소비자가 1초 안에 누가 어떤 상황에서 무엇을 말하는지 이해할 수 있어야 한다. ‘명절 갈비, 언제 손질해요...’, ‘명절 음식 언제 만들어요...’처럼 실제 질문·고민 장면으로 재구성한 문장은 좋은 방향이다. ‘먹어본 사람은 계속 달라고 졸라요’ 같은 반응·후기 문구는 ProductTruth에 후기 근거가 있을 때만 factualSafety를 통과시킨다. 강한 원문 헤드라인을 단순 상품명으로 바꾸거나, 레퍼런스 문장 관계를 버리고 상품 스펙 목록으로 바꾸거나, 동일 상품명·중량을 여러 블록에 반복하거나, 근거 없는 가격·혜택 슬롯을 빈칸으로 지우거나, 전체 문구량을 과도하게 줄이면 referenceFit 실패다. 원문의 말투와 수사 의도를 자연스럽게 보존한 사실 자체는 오류가 아니다. valid는 naturalness ${NATURALNESS_PASS_SCORE}, referenceFit ${REFERENCE_FIT_PASS_SCORE}, factualSafety 90 이상이고 치명 오류가 없을 때만 true다.\nProductTruth: ${JSON.stringify(factsForPlanning(input.truth))}\nPlans: ${JSON.stringify(input.plans)}\nJSON 스키마만 반환한다.`;
}

async function runCodexJson<T>(prompt: string, outputSchema: object) {
  if (!(await codexLocalAuthenticated({ force: true }))) throw new Error("로컬 Codex 로그인이 없습니다.");
  const codex = new Codex({ env: codexLocalEnvironment(), codexPathOverride: resolveCodexLocalExecutable() });
  const thread = codex.startThread({ workingDirectory: process.cwd(), sandboxMode: "read-only", approvalPolicy: "never", networkAccessEnabled: false, model: process.env.ADATLAS_CODEX_MODEL?.trim() || "gpt-5.6-sol", modelReasoningEffort: "medium" });
  const response = await thread.run(prompt, { outputSchema, signal: AbortSignal.timeout(resolveRuntimeTimeout(process.env.ADATLAS_CODEX_REFERENCE_COPY_TIMEOUT_MS, 180_000, 30_000)) });
  return JSON.parse(response.finalResponse) as T;
}

async function runPlanner(prompt: string) {
  return runCodexJson<PlannerPayload>(prompt, plannerSchema);
}

async function reviewPlans(input: { truth: ProductTruth; profiles: ReferenceCopyProfile[]; plans: ReferenceAdaptedCopyPlan[]; copyGuide?: LoadedCopyGuide | null }) {
  const critic = await runCodexJson<CriticPayload>(criticPrompt(input), criticSchema);
  return input.plans.map((plan) => {
    const review = critic.reviews.find((candidate) => candidate.referenceId === plan.referenceId);
    if (!review) return { ...plan, validationStatus: "invalid" as const, validationErrors: [...plan.validationErrors, "일괄 자연스러움 검수 결과가 누락됐습니다."] };
    const deterministicErrors = findReferenceCopyNaturalnessErrors(plan);
    const reviewErrors = [...new Set([...plan.validationErrors, ...review.errors, ...deterministicErrors])];
    const reviewSafetyErrors = plannerDeclaredSafetyErrors(review.errors);
    // critic의 valid 불리언은 같은 점수에서도 흔들릴 수 있다. 서버의 결정적
    // 사실·문장 검증과 명시적 점수를 실행 여부의 기준으로 사용하되, critic이
    // 구체적으로 지적한 사실 안전 오류는 점수와 무관하게 차단한다.
    const valid = plan.validationStatus === "valid" && review.naturalnessScore >= NATURALNESS_PASS_SCORE && review.referenceFitScore >= REFERENCE_FIT_PASS_SCORE && review.factualSafetyScore >= 90 && deterministicErrors.length === 0 && reviewSafetyErrors.length === 0;
    return {
      ...plan,
      naturalnessScore: review.naturalnessScore,
      referenceFitScore: review.referenceFitScore,
      factualSafetyScore: review.factualSafetyScore,
      validationStatus: valid ? "valid" as const : "invalid" as const,
      validationErrors: valid ? [] : reviewErrors.length ? reviewErrors : ["일괄 문구 검수 기준을 통과하지 못했습니다."],
    };
  });
}

export async function prewarmReferenceCopyProfiles(references: NativeAdReference[]) {
  const hashes = await Promise.all(references.map(referenceHash));
  const cached = await readProfileCache();
  const existing = references.map((reference, index) => cached.find((profile) => profile.referenceId === reference.id && profile.referenceHash === hashes[index] && profile.profileVersion === REFERENCE_COPY_PROFILE_VERSION));
  const missingReferences = references.filter((_, index) => !existing[index]);
  if (!missingReferences.length) return { profiles: existing.filter((profile): profile is ReferenceCopyProfile => Boolean(profile)), analyzedCount: 0, fallbackCount: 0 };
  let analyzed: ProfilePayload["profiles"] = [];
  let analysisError = "";
  try {
    analyzed = (await runCodexJson<ProfilePayload>(profilePrompt(missingReferences), profileSchema)).profiles;
  } catch (error) {
    analysisError = error instanceof Error ? error.message : "레퍼런스 문구 구조 분석에 실패했습니다.";
  }
  const created = missingReferences.map((reference) => {
    const index = references.findIndex((candidate) => candidate.id === reference.id);
    const base = fallbackProfile(reference, hashes[index]);
    const raw = analyzed.find((profile) => profile.referenceId === reference.id);
    return raw ? { ...base, ...raw, analysisSource: "codex-local" as const, analysisError: undefined, createdAt: new Date().toISOString() } : { ...base, analysisError };
  });
  await writeProfileCache(created);
  const resolved = references.map((reference, index) => existing[index] || created.find((profile) => profile.referenceId === reference.id) || fallbackProfile(reference, hashes[index]));
  return { profiles: resolved, analyzedCount: created.filter((profile) => profile.analysisSource === "codex-local").length, fallbackCount: created.filter((profile) => profile.analysisSource === "safe-minimal").length };
}

export async function planReferenceAdaptedCopies(input: { truth: ProductTruth; references: NativeAdReference[] }) {
  const copyGuide = await loadCopyGuideForProduct({
    brandName: input.truth.product.brandName,
    advertiserName: input.truth.product.advertiserName,
    productUrl: input.truth.product.landingUrl,
    category: input.truth.product.category,
    productName: input.truth.product.productName,
    copyGuideId: input.truth.product.copyGuideId,
  });
  const profiles = await Promise.all(input.references.map(async (reference) => {
    const profile = fallbackProfile(reference, await referenceHash(reference));
    const raw = reference.nativeCopy?.useForCopyAdaptation === false ? "" : reference.nativeCopy?.rawText || "";
    return {
      ...profile,
      tone: /ㅋㅋ|;;|\.\.|\?\!|\!\?/.test(raw) ? "레퍼런스 원문 구어체" : "레퍼런스 원문 말투",
      headlineLineBudget: Math.max(1, Math.min(4, reference.nativeCopy?.textRegions.find((region) => region.role === "headline")?.lines.length || 2)),
      supportLineBudget: Math.max(0, Math.min(5, reference.nativeCopy?.rawLines.length || 2)),
      prohibitedLiteralPhrases: [],
      analysisSource: reference.nativeCopy?.extractionSource === "codex-local" ? "codex-local" as const : "safe-minimal" as const,
    };
  }));
  const readyEntries = input.references
    .map((reference, index) => ({ reference, profile: profiles[index], index }))
    .filter(({ reference }) => isApprovedReferenceNativeCopy(reference.nativeCopy));
  const fallbackPlans = input.references.map((reference, index) => fallbackPlan(input.truth, reference, profiles[index], index));
  if (!readyEntries.length) {
    return {
      profiles,
      plans: ensureRenderableReferencePlans({ truth: input.truth, references: input.references, profiles, plans: fallbackPlans }),
      provider: "fallback" as const,
      warnings: ["저장·자동 검증된 레퍼런스 OCR 원문이 없어 레퍼런스 구성 태그와 상품 사실로 최선 문구를 만들고 제작을 계속합니다. 제작 중 즉석 OCR은 실행하지 않았습니다."],
    };
  }
  const readyReferences = readyEntries.map(({ reference }) => reference);
  const readyProfiles = readyEntries.map(({ profile }) => profile);
  try {
    const planningWarnings: string[] = [];
    const response = await runPlanner(planningPrompt({ truth: input.truth, references: readyReferences, profiles: readyProfiles, missingProfileIds: [], copyGuide }));
    let readyPlans = readyEntries.map(({ reference, profile, index }) => normalizePlan(response.plans.find((plan) => plan.referenceId === reference.id), input.truth, reference, profile, index, "codex-local"));
    try {
      readyPlans = await reviewPlans({ truth: input.truth, profiles: readyProfiles, plans: readyPlans, copyGuide });
    } catch (error) {
      const message = error instanceof Error ? error.message : "일괄 문구 자연스러움 검수에 실패했습니다.";
      // 7점 품질을 확인하지 못한 AI 자체 점수만 신뢰하지 않는다. 제작은 멈추지
      // 않되 아래 1회 보정 또는 레퍼런스 구조 기반 fallback으로 반드시 교체한다.
      planningWarnings.push(`문구 품질 검수 호출 실패(미검수 AI 문구 미사용): ${message}`);
      readyPlans = readyPlans.map((plan) => ({
        ...plan,
        validationStatus: "invalid" as const,
        validationErrors: [...new Set([...plan.validationErrors, "독립 문구 품질 검수를 완료하지 못했습니다."])],
      }));
    }
    // 묶음 중복·가격 반복 오류도 1회 보정 배치에 포함한다. 과거에는 보정이
    // 끝난 뒤 처음 발견되어 고칠 기회 없이 규칙 문구로 교체되던 문제를 막는다.
    readyPlans = applyReferenceCopyGroupRules(readyPlans, input.truth);
    const failed = readyPlans.filter((plan) => plan.validationStatus === "invalid");
    if (failed.length) {
      try {
        const repaired = await runPlanner(planningPrompt({ truth: input.truth, references: readyReferences, profiles: readyProfiles, missingProfileIds: [], copyGuide, repairPlans: failed }));
        readyPlans = readyPlans.map((plan, readyIndex) => {
          const entry = readyEntries[readyIndex];
          return plan.validationStatus === "invalid" ? normalizePlan(repaired.plans.find((candidate) => candidate.referenceId === plan.referenceId), input.truth, entry.reference, entry.profile, entry.index, "repaired-codex-local") : plan;
        });
        const repairedReferenceIds = new Set(failed.map((plan) => plan.referenceId));
        const repairedPlans = readyPlans.filter((plan) => repairedReferenceIds.has(plan.referenceId));
        try {
          const reviewedRepairs = await reviewPlans({ truth: input.truth, profiles: readyProfiles.filter((profile) => repairedReferenceIds.has(profile.referenceId)), plans: repairedPlans, copyGuide });
          const reviewedByReference = new Map(reviewedRepairs.map((plan) => [plan.referenceId, plan]));
          readyPlans = readyPlans.map((plan) => reviewedByReference.get(plan.referenceId) || plan);
        } catch (error) {
          const message = error instanceof Error ? error.message : "보정 문구 재검수에 실패했습니다.";
          planningWarnings.push(`보정 문구 품질 재검수 실패(미검수 보정본 미사용): ${message}`);
          readyPlans = readyPlans.map((plan) => repairedReferenceIds.has(plan.referenceId)
            ? {
                ...plan,
                validationStatus: "invalid" as const,
                validationErrors: [...new Set([...plan.validationErrors, "보정 문구의 독립 품질 재검수를 완료하지 못했습니다."])],
              }
            : plan);
        }
        readyPlans = applyReferenceCopyGroupRules(readyPlans, input.truth);
      } catch (error) {
        const message = error instanceof Error ? error.message : "문구 1회 보정에 실패했습니다.";
        readyPlans = readyPlans.map((plan) => plan.validationStatus === "invalid" ? { ...plan, validationErrors: [...plan.validationErrors, message], repairCount: 1 } : plan);
      }
    }
    const plannedByReference = new Map(readyPlans.map((plan) => [plan.referenceId, plan]));
    let plans = input.references.map((reference, index) => plannedByReference.get(reference.id) || fallbackPlans[index]);
    plans = applyReferenceCopyGroupRules(plans, input.truth);
    plans = ensureRenderableReferencePlans({ truth: input.truth, references: input.references, profiles, plans });
    // AI 보정 실패 항목을 fallback으로 바꾼 뒤에도 6장 가격·핵심 문구 반복을
    // 다시 검사한다. 제작은 계속하지만 최종 계획과 경고에 품질 상태를 남긴다.
    plans = applyReferenceCopyGroupRules(plans, input.truth);
    return { profiles, plans, provider: "codex-local" as const, warnings: [...planningWarnings, ...plans.flatMap((plan) => plan.validationErrors)] };
  } catch (error) {
    const plans = ensureRenderableReferencePlans({
      truth: input.truth,
      references: input.references,
      profiles,
      plans: fallbackPlans,
    });
    return { profiles, plans, provider: "fallback" as const, warnings: [error instanceof Error ? error.message : "레퍼런스 문구 계획 응답이 없어 원문 구조 기반 최선 문구로 제작을 계속합니다."] };
  }
}

export function buildReferenceAdaptedCreativePlan(input: { truth: ProductTruth; references: NativeAdReference[]; copyPlans: ReferenceAdaptedCopyPlan[]; logoPath?: string; adBrief?: AdBrief; testCode?: `T${string}`; provider: "codex-local" | "fallback"; warnings?: string[] }): CreativePlan {
  const brandProfile = withRequestedLogo(matchBrandProfile(input.truth.product), input.logoPath);
  const categoryProfile = matchCategoryProfile(input.truth.product);
  const hookPlans: HookPlan[] = input.copyPlans.map((plan, index) => {
    const reference = input.references[index];
    const blueprintId = blueprintForReference(reference);
    return {
      id: `material-${plan.resultCode}-${reference.id}`,
      blueprintId,
      hookType: "reference-adapted-material",
      title: `소재 ${String(index + 1).padStart(2, "0")}`,
      headline: plan.headline,
      body: plan.subCopy,
      proof: plan.proof,
      offer: plan.offer,
      cta: plan.cta,
      audience: input.truth.product.targetCustomer || "상품 고객",
      sceneIntent: `선택된 레퍼런스 ${reference.id}의 구도와 문구 구조를 유지한 상품 교체 소재`,
      factIds: plan.factIds,
      numericTokens: extractNumericTokens([plan.headline, plan.subCopy, plan.proof, plan.offer, plan.cta].join(" ")),
      hookCode: plan.resultCode,
      hypothesis: `레퍼런스 ${reference.id} 적응 소재`,
      confidence: plan.validationStatus === "valid" ? "high" : "medium",
      mainMessage: plan.headline,
      evidenceSummary: plan.sourceFactValues.join(" · "),
      naturalnessScore: plan.naturalnessScore,
      validationStatus: plan.validationStatus === "invalid" ? "invalid" : plan.validationStatus === "needs-review" ? "fallback" : "valid",
      validationErrors: plan.validationErrors,
      generationSource: plan.generationSource === "reference-best-effort" || plan.generationSource === "safe-minimal" ? "fallback" : plan.generationSource === "repaired-codex-local" ? "repaired-ai" : "ai",
      repairCount: plan.repairCount,
      sentenceStyle: plan.sentenceStyle,
      selectionReason: reference.selectionReason,
      visualDirection: reference.layoutFamily,
    };
  });
  const masterDesign = selectMasterCreativeDirection({ truth: input.truth, brand: brandProfile, category: categoryProfile, preserveMasterDesignId: `reference-first-${hookPlans[0]?.blueprintId || "product-hero-lifestyle"}` });
  return {
    id: `reference-plan-${Date.now().toString(36)}`,
    productTruth: input.truth,
    brandProfile,
    categoryProfile,
    hookPlans,
    blueprintIds: hookPlans.map((plan) => plan.blueprintId),
    masterDesign,
    mode: "reference-adapted-materials",
    testCode: input.testCode || "T01",
    copyGeneration: { provider: input.provider, repairAttempts: input.copyPlans.some((plan) => plan.repairCount > 0) ? 1 : 0, warnings: input.warnings || [] },
    adBrief: input.adBrief,
    createdAt: new Date().toISOString(),
    plannerVersion: REFERENCE_ADAPTED_PLANNER_VERSION,
  };
}

export function buildReferenceScenes(references: NativeAdReference[], copyPlans: ReferenceAdaptedCopyPlan[]): ScenePlan[] {
  return references.map((reference, index) => ({
    id: `scene-${copyPlans[index].resultCode}-${reference.id}`,
    blueprintId: blueprintForReference(reference),
    sceneAsset: { id: reference.id, file: reference.path, sourceType: "library", assetType: "curated-ad-reference", scene: reference.layoutFamily, category: reference.categoryGroup, includesPerson: reference.photographyType === "human-model", textSafeArea: "reference-defined", productPosition: "reference-defined" },
    promptVersion: "reference-first-scene-v1",
    provider: "library",
    generated: false,
    paidGenerationAllowed: false,
    generationMode: "reference-guided-full-scene",
    reason: reference.selectionReason,
  }));
}
