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
import { findReferenceCopyNaturalnessErrors } from "./referenceCopyNaturalness";
import { isUnsafeProductCreativeSignal } from "./productSignalHygiene";
import { isApprovedReferenceNativeCopy, normalizeReferenceRawLines, type ReferenceTextRegion } from "./referenceLibraryManagement";
import type { AdBrief } from "../mvp/types";
import type { CreativeBlueprintId, CreativePlan, HookPlan, ProductFact, ProductTruth, ReferenceAdaptedCopyPlan, ReferenceCopyProfile, ScenePlan } from "./types";

export const REFERENCE_COPY_PROFILE_VERSION = "reference-copy-profile-v1";
export const REFERENCE_ADAPTED_PLANNER_VERSION = "reference-native-copy-adapter-v11-reference-flow-no-review-metadata";

const NATURALNESS_PASS_SCORE = 85;
const REFERENCE_FIT_PASS_SCORE = 75;

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
    .filter((fact) => fact.usableInCopy && fact.verification !== "unverified" && fact.copyEligibility !== "blocked")
    .filter((fact) => !isUnsafeProductCreativeSignal(fact.value))
    .filter((fact) => {
      const signature = comparableCopy(fact.value);
      if (!signature || seen.has(signature)) return false;
      seen.add(signature);
      return true;
    })
    .map((fact) => ({ id: fact.id, label: fact.label, value: fact.value, role: fact.copyEligibility || "headlineEligible" }));
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

function isSourceBrandRemovalRegion(region: ReferenceTextRegion | undefined) {
  return region?.sourceType === "source-brand" || region?.replacePolicy === "remove";
}

function buildCopySlots(reference: NativeAdReference, sourceLines: string[], targetLines: string[]): NonNullable<ReferenceAdaptedCopyPlan["copySlots"]> {
  return sourceLines.map((sourceText, index) => {
    const role = sourceLineRole(reference, sourceText, index);
    const region = reference.nativeCopy?.textRegions.find((candidate) =>
      candidate.lines.some((line) => comparableCopy(line) === comparableCopy(sourceText)) || comparableCopy(candidate.text).includes(comparableCopy(sourceText))
    );
    return {
      index,
      regionId: region?.id,
      readingOrder: region?.readingOrder,
      role,
      sourceType: region?.sourceType,
      replacePolicy: region?.replacePolicy,
      sourceText,
      // 기존 광고주의 로고·워드마크는 현재 상품명으로 치환하지 않는다.
      // 빈 target은 생성 단계에서 이 작은 영역의 주변 배경 복원을 뜻하며,
      // 실제 업체 로고는 사용자가 선택한 투명 원본만 후처리로 적용한다.
      targetText: isSourceBrandRemovalRegion(region) ? "" : targetLines[index] || "",
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
  if (/[*★]|[ㄱ-ㅎㅏ-ㅣ]|\([^)]*[!?]{2,}[^)]*\)/u.test(fact.value)) return false;
  if (comparableCopy(fact.value) === comparableCopy(truth.normalized.cleanProductName || truth.product.productName)) return false;
  const length = factCharacterCount(fact.value);
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
  let value = String(truth.normalized.cleanProductName || truth.product.productName || "상품")
    .replace(/\([^)]*(?:g|kg|ml|l|개|팩|세트)[^)]*\)/giu, " ")
    .replace(/\d[\d,.]*\s*(?:g|kg|ml|l|개|팩|세트)\b/giu, " ")
    .replace(/(?:오늘만|지금만|추석맞이특가|초특가|한정특가|특별구성|지방\s*손질|로스\s*제거|대한\s*선별|특급\s*선별|프리미엄)/giu, " ")
    .replace(/[★☆*✅⚡💥&＆·/+]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = value.split(" ").filter(Boolean);
  while (tokens.length > 1 && Array.from(tokens.join(" ").replace(/\s/g, "")).length > 18) tokens.shift();
  value = tokens.join(" ").trim();
  return value || truth.normalized.baseProductName || truth.normalized.cleanProductName || truth.product.productName || "상품";
}

function reasonTextForFact(fact: ProductFact, identity: string) {
  const clean = fact.value
    .replace(/[★☆*✅⚡💥]+/gu, " ")
    .replace(/\s*[&＆]\s*/g, " · ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  if (fact.key === "title-composition") {
    const pack = clean.match(/(\d[\d,.]*\s*(?:g|kg|ml|l))\s*[×x]\s*(\d+)\s*팩/iu);
    return pack ? `${pack[1].replace(/\s+/g, "")}씩 ${pack[2]}팩 구성` : clean;
  }
  if (fact.key === "quantity") return `총 ${clean} 구성`;
  if (fact.key === "verified-descriptor") return comparableCopy(identity).includes(comparableCopy(clean)) ? identity : `${clean} ${identity}`;
  if (fact.key === "origin") return clean;
  if (factCharacterCount(clean) > 38) return "";
  return clean;
}

function fallbackTextCandidates(truth: ProductTruth, facts: ProductFact[], identity: string, offerText: string) {
  const brand = String(truth.normalized.brandName || truth.product.brandName || truth.product.advertiserName || "").trim();
  const singles = uniqueFacts(facts)
    .filter((fact) => !["category", "target", "season-event", "package-option"].includes(fact.key))
    .filter((fact) => fact.copyEligibility !== "blocked")
    .map((fact) => reasonTextForFact(fact, identity))
    .filter((value) => value && factCharacterCount(value) <= 32);
  const values = [identity, brand && !comparableCopy(identity).includes(comparableCopy(brand)) ? `${brand} ${identity}` : "", ...singles, offerText]
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
  const brand = String(truth.normalized.brandName || truth.product.brandName || truth.product.advertiserName || "").trim();
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
    .map((fact) => ({ fact, text: reasonTextForFact(fact, identity) }))
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
  const brandFact = facts.find((fact) => fact.key === "brand-name");
  const selectedFacts = [identityFact, brandFact, ...reasonCandidates.map((candidate) => candidate.fact)].filter((fact): fact is ProductFact => Boolean(fact));
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
    if (headlineOrder === 1) return brand ? `${brand}에서 고르는 이유` : "고를 때 보는 이유";
    return preserveRhetoricalEnding(sourceLine, reasonCandidates[reasonIndex++ % Math.max(1, reasonCandidates.length)]?.text || identity);
  });
  return { lines, selectedFacts };
}

function fallbackPlan(truth: ProductTruth, reference: NativeAdReference, profile: ReferenceCopyProfile, index: number): ReferenceAdaptedCopyPlan {
  const facts = truth.facts.filter((fact) => fact.usableInCopy && fact.verification !== "unverified" && fact.copyEligibility !== "blocked" && !isUnsafeProductCreativeSignal(fact.value));
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
  const offer = automaticOfferLine(facts);
  const offerFact = offer.facts[0];
  const identity = shortProductIdentity(truth);
  const sourceLines = reference.nativeCopy?.useForCopyAdaptation === false ? [] : reference.nativeCopy?.rawLines || [];
  const contentFacts = uniqueFacts([headlineFact, supportFact, proofFact, ...prioritizedHeadlineCandidates, ...proofFacts]
    .filter((fact): fact is ProductFact => Boolean(fact))
    .filter((fact) => !["category", "target", "season-event", "package-option"].includes(fact.key))
    .filter((fact) => factCharacterCount(fact.value) <= 32));
  const usedFacts = new Map<string, ProductFact>();
  const numberedFallback = sourceLines.length ? buildNumberedReasonFallback(truth, reference, sourceLines, facts) : null;
  numberedFallback?.selectedFacts.forEach((fact) => usedFacts.set(fact.id, fact));
  let contentIndex = 0;
  let offerIndex = 0;
  const fallbackOfferFacts = uniqueFacts(facts.filter((fact) => fact.copyEligibility === "offerOnly"));
  const fallbackCandidates = fallbackTextCandidates(truth, facts, identity, offer.text);
  const usedTargetSignatures = new Set<string>();
  const nextUniqueTarget = (preferred: string) => {
    const ordered = [preferred, ...fallbackCandidates];
    const selected = ordered.find((candidate) => {
      const signature = comparableCopy(candidate);
      return signature && !usedTargetSignatures.has(signature);
    }) || preferred || identity;
    usedTargetSignatures.add(comparableCopy(selected));
    return selected;
  };
  let adaptedLines = numberedFallback?.lines || (sourceLines.length
    ? sourceLines.map((sourceLine, lineIndex) => {
        const role = sourceLineRole(reference, sourceLine, lineIndex);
        if (role === "cta") return nextUniqueTarget("상품 자세히 보기");
        if (role === "offer" && offer.text) {
          const offerReplacement = fallbackOfferFacts[offerIndex++] || offer.facts[0];
          if (offerReplacement) usedFacts.set(offerReplacement.id, offerReplacement);
          return preserveRhetoricalEnding(sourceLine, nextUniqueTarget(offerReplacement?.value || offer.text));
        }
        const fact = role === "offer" && offerFact ? offerFact : contentFacts[contentIndex++ % Math.max(1, contentFacts.length)];
        if (fact) usedFacts.set(fact.id, fact);
        const preferred = fact ? reasonTextForFact(fact, identity) : identity;
        return preserveRhetoricalEnding(sourceLine, nextUniqueTarget(preferred || identity));
      })
    : [headlineFact?.value || identity, supportFact?.value || "", proofFact?.value || "", offer.text, /없음|미사용|none/i.test(profile.ctaRole) ? "" : "상품 자세히 보기"].filter(Boolean));
  let copySlots = buildCopySlots(reference, sourceLines, adaptedLines);
  // OCR가 비어도 이미지 생성을 빈 문구 계약으로 시작하지 않는다. 레퍼런스의
  // 밀도·구성 태그로 예상 슬롯을 만들고, 실제 편집 단계에서는 원본 이미지의
  // 대응 문구 영역을 직접 읽어 이 검증된 ProductTruth 문구로 교체한다.
  if (!copySlots.length) {
    const slotRoles = fallbackSlotRoles(reference, profile, Boolean(offer.text));
    const fallbackByRole = {
      headline: headlineFact?.value || identity,
      support: supportFact?.value || proofFact?.value || headlineFact?.value || identity,
      proof: proofFact?.value || supportFact?.value || headlineFact?.value || identity,
      offer: offer.text || supportFact?.value || proofFact?.value || headlineFact?.value || identity,
      cta: "상품 자세히 보기",
      badge: proofFact?.value || headlineFact?.value || identity,
      other: proofFact?.value || headlineFact?.value || identity,
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
  const headline = headlineLines.join(" ") || headlineFact?.value || identity;
  const selected = [...usedFacts.values()];
  if (!selected.length) [headlineFact, supportFact, proofFact, ...offer.facts].filter((fact): fact is ProductFact => Boolean(fact)).forEach((fact) => selected.push(fact));
  return {
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
    naturalnessScore: numberedFallback ? 90 : 72,
    referenceFitScore: numberedFallback ? 88 : 70,
    factualSafetyScore: 100,
    validationStatus: "valid",
    validationErrors: [],
    repairCount: 0,
    generationSource: "safe-minimal",
  };
}

export function hasExecutableReferenceCopyContract(plan: ReferenceAdaptedCopyPlan | undefined, truth?: ProductTruth) {
  if (!plan) return false;
  // 길이·문맥·사실 검증에서 invalid가 된 AI 계획을 실행 가능한 것으로
  // 되살리지 않는다. 자동 제작에서 긴 SEO 상품명이 그대로 반복되던 핵심 경계다.
  if (plan.validationStatus === "invalid") return false;
  const targetLines = (plan.adaptedLines || []).filter((line) => line.trim());
  const targetSlots = (plan.copySlots || []).filter((slot) => slot.targetText.trim());
  if (!plan.headline.trim() || !targetLines.length || !targetSlots.length) return false;
  const signatures = targetLines.map(comparableCopy).filter(Boolean);
  if (signatures.length !== new Set(signatures).size) return false;
  if (/[*★]|\([^)]*[!?]{2,}[^)]*\)/u.test(plan.headline)) return false;
  if (findReferenceCopyNaturalnessErrors(plan).length) return false;
  if (!truth) return true;
  const renderedCopy = [plan.headline, plan.subCopy, plan.proof, plan.offer, plan.cta, ...targetLines]
    .filter(Boolean)
    .join("\n");
  if (isUnsafeProductCreativeSignal(renderedCopy)) return false;
  return validateCopyAgainstTruth(renderedCopy, truth).valid;
}

export async function createTruthFallbackReferenceCopyPlan(input: {
  truth: ProductTruth;
  reference: NativeAdReference;
  index: number;
  previous?: ReferenceAdaptedCopyPlan;
}) {
  const profile = fallbackProfile(input.reference, await referenceHash(input.reference));
  const fallback = fallbackPlan(input.truth, input.reference, profile, input.index);
  return {
    ...fallback,
    id: input.previous?.id || fallback.id,
    resultCode: input.previous?.resultCode || fallback.resultCode,
    validationErrors: [...new Set([...(input.previous?.validationErrors || []), ...fallback.validationErrors])],
    repairCount: Math.max(input.previous?.repairCount || 0, fallback.repairCount),
  };
}

function replaceUnusablePlansWithTruthFallback(input: {
  truth: ProductTruth;
  references: NativeAdReference[];
  profiles: ReferenceCopyProfile[];
  plans: ReferenceAdaptedCopyPlan[];
}) {
  return input.references.map((reference, index) => {
    const plan = input.plans[index];
    if (hasExecutableReferenceCopyContract(plan, input.truth)) return plan;
    const fallback = fallbackPlan(input.truth, reference, input.profiles[index], index);
    const priorErrors = plan?.validationErrors || [];
    return {
      ...fallback,
      validationErrors: [...new Set([...priorErrors, ...fallback.validationErrors])],
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
  if (sourceCharacterCount >= 20 && targetCharacterCount < Math.floor(sourceCharacterCount * 0.42)) errors.push("레퍼런스 문구의 시각적 분량이 과도하게 축약됐습니다.");
  const sourceHeadline = slots.filter((slot) => slot.role === "headline").map((slot) => slot.sourceText).join(" ") || sourceLines.slice(0, profile.headlineLineBudget).join(" ");
  const sourceHasStrongHook = /[?!]|\b1\s*\+\s*1\b|전후|탈출|찾았다|왜|어떻게|없다|아니|만에|한정|특가|증정|무료|%/i.test(sourceHeadline);
  const normalizedHeadline = comparableCopy(plan.headline);
  const normalizedProductName = comparableCopy(truth.normalized.cleanProductName || truth.product.productName);
  if (sourceHasStrongHook && normalizedHeadline && (normalizedHeadline === normalizedProductName || normalizedProductName.includes(normalizedHeadline))) {
    errors.push("강한 레퍼런스 헤드라인이 단순 상품명으로 축약됐습니다.");
  }
  const flattenedTarget = comparableCopy(targetLines.join(" "));
  if (targetLines.length && normalizedHeadline && !flattenedTarget.includes(normalizedHeadline)) errors.push("최종 헤드라인이 줄별 편집 계약에 포함되지 않았습니다.");
  const copy = [...targetLines, plan.headline, plan.subCopy, plan.proof, plan.offer, plan.cta].join(" ");
  if (isUnsafeProductCreativeSignal(copy)) errors.push("후기 작성 시각·작성자 또는 상세페이지 UI 메타데이터가 광고 문구에 포함됐습니다.");
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
  return errors;
}

function normalizePlan(raw: PlannerPayload["plans"][number] | undefined, truth: ProductTruth, reference: NativeAdReference, profile: ReferenceCopyProfile, index: number, source: "codex-local" | "repaired-codex-local"): ReferenceAdaptedCopyPlan {
  if (!raw || raw.referenceId !== reference.id) return fallbackPlan(truth, reference, profile, index);
  const known = new Map(truth.facts.map((fact) => [fact.id, fact]));
  const factIds = [...new Set(raw.factIds)].filter((id) => known.has(id));
  const storedSourceLines = reference.nativeCopy?.useForCopyAdaptation === false ? [] : normalizeReferenceRawLines(reference.nativeCopy?.rawLines || []);
  const referenceRawLines = storedSourceLines;
  const proposedAdaptedLines = normalizeReferenceRawLines(raw.adaptedLines);
  const copySlots = buildCopySlots(reference, referenceRawLines, proposedAdaptedLines);
  const adaptedLines = copySlots.map((slot) => slot.targetText);
  const plan: ReferenceAdaptedCopyPlan = {
    id: `reference-copy-${truth.productId}-${index + 1}`,
    resultCode: `H${String(index + 1).padStart(2, "0")}`,
    referenceId: reference.id,
    referenceCopyProfileId: profile.id,
    referenceRawCopy: reference.nativeCopy?.useForCopyAdaptation === false ? "" : reference.nativeCopy?.rawText || "",
    referenceRawLines,
    adaptedLines,
    copySlots,
    headline: raw.headline.trim(), subCopy: raw.subCopy.trim(), proof: raw.proof.trim(), offer: raw.offer.trim(), cta: raw.cta.trim(),
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
  const errors = [...new Set([...validatePlan(plan, truth, profile), ...(raw.validationErrors || [])])];
  if (plan.naturalnessScore < NATURALNESS_PASS_SCORE) errors.push(`한국어 문구 자연스러움 ${NATURALNESS_PASS_SCORE}점 기준을 통과하지 못했습니다.`);
  if (plan.referenceFitScore < REFERENCE_FIT_PASS_SCORE) errors.push(`레퍼런스 문구 구조 적합도 ${REFERENCE_FIT_PASS_SCORE}점 기준을 통과하지 못했습니다.`);
  if (plan.factualSafetyScore < 90) errors.push("상품 사실 안전성 기준을 통과하지 못했습니다.");
  return { ...plan, validationStatus: errors.length ? "invalid" : "valid", validationErrors: [...new Set(errors)] };
}

function planningPrompt(input: { truth: ProductTruth; references: NativeAdReference[]; profiles: ReferenceCopyProfile[]; missingProfileIds: string[]; repairPlans?: ReferenceAdaptedCopyPlan[] }) {
  return `한국 광고 제작용 레퍼런스 원문 적응 문구를 한 번의 배치로 작성한다. 후킹 후보, 고객 긴장, 성과 가설, 장면 콘셉트를 새로 기획하지 않는다.

작업 원칙:
- 각 레퍼런스의 rawText/rawLines가 유일한 문구 출발점이다. 일반화된 청사진이나 새 후킹을 만들지 않는다.
- observedSourceLines에는 저장된 rawLines를 글자와 빈 줄까지 그대로 복사한다. 이 단계에서는 이미지 파일을 열거나 OCR하지 않는다.
- adaptedLines는 rawLines와 같은 개수·순서·빈 줄을 유지하고, 각 줄에서 상품에 맞지 않는 사실만 교체한다.
- textRegions의 sourceType이 source-brand이거나 replacePolicy가 remove인 줄은 예외적으로 adaptedLines를 빈 문자열로 둔다. 이 영역에는 현재 상품명·브랜드명·축약어를 넣지 않으며 새 로고나 워드마크를 만들지 않는다.
- 저장 rawLines가 비어 있는 레퍼런스는 이 배치에 전달되지 않으며 별도의 ProductTruth 안전 최소 문구를 사용한다.
- source-brand/remove 영역을 제외한 원본의 모든 비어 있지 않은 문구 블록은 최종 문구에서도 비어 있지 않아야 한다. 가격·할인·증정처럼 현재 상품에 근거가 없는 슬롯은 삭제하거나 수치를 만들지 말고, 비슷한 길이의 검증된 USP·사용 사실·상품 식별 문구로 역할을 바꿔 시각적 밀도를 유지한다.
- 원문의 단어 순서, 줄 수, 문장부호, 이모지, ㅋㅋ, ㅎㅎ, ㅠㅠ, ;;, .., ㄷㄷ, 헐, 뭐임, 겨 같은 구어체를 최대한 그대로 둔다.
- 기존 상품·가격·혜택·업체·상품별 근거만 ProductTruth의 현재 상품 사실로 치환한다. 다만 레퍼런스의 수사 의도와 말투를 보존하는 것이 목적이지, 명사를 슬롯처럼 바꾸는 것이 목적이 아니다.
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
- 같은 상품명·구성·중량 설명을 여러 블록에 반복하지 않는다. 원문에서 역할이 다른 블록은 현재 상품의 서로 다른 검증 사실이나 CTA로 그 역할을 유지한다.
- headlineEligible은 헤드라인/보조 문구에, proofOnly는 근거에, offerOnly는 offer에만 쓴다. identityOnly는 상품 식별에만 쓴다.
- 애매한 상투어보다 ProductTruth의 구체 사실을 우선하고, 확인된 사실 안에서는 판매형 말투를 충분히 강하게 유지한다.
- CTA는 레퍼런스에 실제 CTA 역할이 있을 때만 짧게 작성한다.
- 여섯 결과가 같은 의미가 되지 않게 서로 다른 원문 의미 구조를 유지한다.
- 가격은 최대 2장, 할인율은 최대 2장, 배송/쿠폰/증정 등 혜택은 최대 3장, 수량·중량은 최대 2장에서만 메인 강조한다.
- 각 plan은 스스로 점검한 naturalnessScore, referenceFitScore, factualSafetyScore와 validationErrors를 반드시 포함한다. naturalnessScore는 주어·서술어·조사·문장 완결성과 소비자가 한 번에 이해하는지를 기준으로 엄격하게 채점하며 ${NATURALNESS_PASS_SCORE}점 미만이면 스스로 invalid 사유를 적는다.
- 결과 코드는 내부 순번 H01~H06일 뿐 후킹 유형이 아니다.

상품 사실:
${JSON.stringify({ productName: shortProductIdentity(input.truth), facts: factsForPlanning(input.truth) }, null, 2)}

레퍼런스:
${JSON.stringify(input.references.map((reference, index) => ({ resultCode: `H${String(index + 1).padStart(2, "0")}`, referenceId: reference.id, layoutFamily: reference.layoutFamily, textDensity: reference.textDensity, compositionType: reference.compositionType, productSlotCount: reference.productSlotCount, rawText: reference.nativeCopy?.useForCopyAdaptation === false ? "" : reference.nativeCopy?.rawText || "", rawLines: reference.nativeCopy?.useForCopyAdaptation === false ? [] : reference.nativeCopy?.rawLines || [], textRegions: reference.nativeCopy?.useForCopyAdaptation === false ? [] : reference.nativeCopy?.textRegions || [] })), null, 2)}

이미 분석된 프로필:
${JSON.stringify(input.profiles.filter((profile) => !input.missingProfileIds.includes(profile.referenceId)), null, 2)}

profiles는 과거 저장 구조 호환용이므로 빈 배열로 반환한다. 각 plan의 headline/subCopy/proof/offer/cta는 adaptedLines의 같은 역할 문구와 반드시 일치해야 한다.
${input.repairPlans?.length ? `다음 검증 실패 문구만 한 번 수정한다. 나머지 resultCode는 plans에 포함하지 않는다: ${JSON.stringify(input.repairPlans, null, 2)}` : "여섯 레퍼런스 각각의 plans를 작성한다."}
JSON 스키마만 반환한다.`;
}

function profilePrompt(references: NativeAdReference[]) {
  return `광고 레퍼런스 이미지의 문구 구조만 분석한다. 상품 전략이나 새 문구는 생성하지 않는다. 각 imagePath를 확인해 headline/support/proof/offer/CTA 역할, 줄 수와 글자 수 예산, 말투, 문장형, 수치 강조, 문장부호 리듬을 기록한다. 원문의 핵심 리터럴 문구는 prohibitedLiteralPhrases에 기록한다. JSON 스키마만 반환한다.\n${JSON.stringify(references.map((reference) => ({ referenceId: reference.id, imagePath: reference.path, layoutFamily: reference.layoutFamily, textDensity: reference.textDensity })), null, 2)}`;
}

function criticPrompt(input: { truth: ProductTruth; profiles: ReferenceCopyProfile[]; plans: ReferenceAdaptedCopyPlan[] }) {
  return `아래 6개 한국 광고 문구를 한 번에 독립 검수한다. 새 문구를 만들지 말고 점수와 오류만 반환한다.\n검수 기준: 자연스러운 한국어, referenceRawCopy/referenceRawLines의 줄 수·기호·구어체와 수사 의도 보존, source-brand/remove를 제외한 원본 문구 블록과 정보 밀도 보존, 질문→대답·문제→해결·비교→결론·경험→추천 같은 줄 사이 관계 보존, 질문·반전·비교·문제 제기·긴급성 같은 헤드라인 판매 강도 보존, 상품 관련 표현만 ProductTruth로 교체했는지, ProductTruth 밖 수치·혜택·효능 금지, 후기 작성 날짜·시각·작성자·닉네임 같은 UI 메타데이터 금지, 장면과 문구의 일치, 여섯 결과의 의미 중복 억제. source-brand/remove 슬롯은 빈 targetText가 정답이며 현재 상품명·브랜드명으로 채우거나 새 로고 문구로 바꾸면 치명 오류다. 원문 어순을 기계적으로 유지하는 것보다 현재 상품 문장의 주어·서술어·조사·수식 관계·완결성이 우선이다. adaptedLines를 줄바꿈 없이 이어 읽어도 하나의 자연스러운 소비자 문장이 되어야 한다. 사람 주어를 추석·명절·가격·상품 같은 무생물 명사로 단순 치환하거나, 연결 조사·쉼표에서 문장이 끊기거나, 소비자가 의미를 추측해야 하면 naturalness 치명 오류다. ‘명절 메뉴 없더니...’처럼 상황과 주체가 빠진 문구, 계절 단어와 범용 판매어를 이어 붙인 문구도 naturalness 실패다. 처음 보는 소비자가 1초 안에 누가 어떤 상황에서 무엇을 말하는지 이해할 수 있어야 한다. ‘명절 갈비, 언제 손질해요...’, ‘명절 음식 언제 만들어요...’처럼 실제 질문·고민 장면으로 재구성한 문장은 좋은 방향이다. ‘먹어본 사람은 계속 달라고 졸라요’ 같은 반응·후기 문구는 ProductTruth에 후기 근거가 있을 때만 factualSafety를 통과시킨다. 강한 원문 헤드라인을 단순 상품명으로 바꾸거나, 레퍼런스 문장 관계를 버리고 상품 스펙 목록으로 바꾸거나, 동일 상품명·중량을 여러 블록에 반복하거나, 근거 없는 가격·혜택 슬롯을 빈칸으로 지우거나, 전체 문구량을 과도하게 줄이면 referenceFit 실패다. 원문의 말투와 수사 의도를 자연스럽게 보존한 사실 자체는 오류가 아니다. valid는 naturalness ${NATURALNESS_PASS_SCORE}, referenceFit ${REFERENCE_FIT_PASS_SCORE}, factualSafety 90 이상이고 치명 오류가 없을 때만 true다.\nProductTruth: ${JSON.stringify(factsForPlanning(input.truth))}\nPlans: ${JSON.stringify(input.plans)}\nJSON 스키마만 반환한다.`;
}

async function runCodexJson<T>(prompt: string, outputSchema: object) {
  if (!(await codexLocalAuthenticated())) throw new Error("로컬 Codex 로그인이 없습니다.");
  const codex = new Codex({ env: codexLocalEnvironment(), codexPathOverride: resolveCodexLocalExecutable() });
  const thread = codex.startThread({ workingDirectory: process.cwd(), sandboxMode: "read-only", approvalPolicy: "never", networkAccessEnabled: false, model: process.env.ADATLAS_CODEX_MODEL?.trim() || "gpt-5.6-sol", modelReasoningEffort: "medium" });
  const response = await thread.run(prompt, { outputSchema, signal: AbortSignal.timeout(resolveRuntimeTimeout(process.env.ADATLAS_CODEX_REFERENCE_COPY_TIMEOUT_MS, 180_000, 30_000)) });
  return JSON.parse(response.finalResponse) as T;
}

async function runPlanner(prompt: string) {
  return runCodexJson<PlannerPayload>(prompt, plannerSchema);
}

async function reviewPlans(input: { truth: ProductTruth; profiles: ReferenceCopyProfile[]; plans: ReferenceAdaptedCopyPlan[] }) {
  const critic = await runCodexJson<CriticPayload>(criticPrompt(input), criticSchema);
  return input.plans.map((plan) => {
    const review = critic.reviews.find((candidate) => candidate.referenceId === plan.referenceId);
    if (!review) return { ...plan, validationStatus: "invalid" as const, validationErrors: [...plan.validationErrors, "일괄 자연스러움 검수 결과가 누락됐습니다."] };
    const deterministicErrors = findReferenceCopyNaturalnessErrors(plan);
    const reviewErrors = [...new Set([...plan.validationErrors, ...review.errors, ...deterministicErrors])];
    const valid = plan.validationStatus === "valid" && review.valid && review.naturalnessScore >= NATURALNESS_PASS_SCORE && review.referenceFitScore >= REFERENCE_FIT_PASS_SCORE && review.factualSafetyScore >= 90 && deterministicErrors.length === 0;
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
      plans: replaceUnusablePlansWithTruthFallback({ truth: input.truth, references: input.references, profiles, plans: fallbackPlans }),
      provider: "fallback" as const,
      warnings: ["저장·자동 검증된 레퍼런스 OCR 원문이 없어 ProductTruth 안전 최소 문구를 사용했습니다. 제작 중 즉석 OCR은 실행하지 않았습니다."],
    };
  }
  const readyReferences = readyEntries.map(({ reference }) => reference);
  const readyProfiles = readyEntries.map(({ profile }) => profile);
  try {
    const planningWarnings: string[] = [];
    const response = await runPlanner(planningPrompt({ truth: input.truth, references: readyReferences, profiles: readyProfiles, missingProfileIds: [] }));
    let readyPlans = readyEntries.map(({ reference, profile, index }) => normalizePlan(response.plans.find((plan) => plan.referenceId === reference.id), input.truth, reference, profile, index, "codex-local"));
    try {
      readyPlans = await reviewPlans({ truth: input.truth, profiles: readyProfiles, plans: readyPlans });
    } catch (error) {
      const message = error instanceof Error ? error.message : "일괄 문구 자연스러움 검수에 실패했습니다.";
      // normalizePlan의 사실·길이·원문 구조 검증은 이미 통과했다. 보조 critic
      // 호출 장애만으로 정상 레퍼런스 문구를 일반 fallback으로 덮어쓰지 않는다.
      planningWarnings.push(`보조 문구 검수 호출 실패(결정적 검증 결과 유지): ${message}`);
    }
    const failed = readyPlans.filter((plan) => plan.validationStatus === "invalid");
    if (failed.length) {
      try {
        const repaired = await runPlanner(planningPrompt({ truth: input.truth, references: readyReferences, profiles: readyProfiles, missingProfileIds: [], repairPlans: failed }));
        readyPlans = readyPlans.map((plan, readyIndex) => {
          const entry = readyEntries[readyIndex];
          return plan.validationStatus === "invalid" ? normalizePlan(repaired.plans.find((candidate) => candidate.referenceId === plan.referenceId), input.truth, entry.reference, entry.profile, entry.index, "repaired-codex-local") : plan;
        });
        const repairedReferenceIds = new Set(failed.map((plan) => plan.referenceId));
        const repairedPlans = readyPlans.filter((plan) => repairedReferenceIds.has(plan.referenceId));
        try {
          const reviewedRepairs = await reviewPlans({ truth: input.truth, profiles: readyProfiles.filter((profile) => repairedReferenceIds.has(profile.referenceId)), plans: repairedPlans });
          const reviewedByReference = new Map(reviewedRepairs.map((plan) => [plan.referenceId, plan]));
          readyPlans = readyPlans.map((plan) => reviewedByReference.get(plan.referenceId) || plan);
        } catch (error) {
          const message = error instanceof Error ? error.message : "보정 문구 재검수에 실패했습니다.";
          // 보정본도 normalizePlan의 결정적 검증을 통과했다면 그대로 유지한다.
          // critic의 일시 실패는 품질 경고이지 안전한 계획을 폐기할 근거가 아니다.
          planningWarnings.push(`보정 문구 보조 재검수 호출 실패(결정적 검증 결과 유지): ${message}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "문구 1회 보정에 실패했습니다.";
        readyPlans = readyPlans.map((plan) => plan.validationStatus === "invalid" ? { ...plan, validationErrors: [...plan.validationErrors, message], repairCount: 1 } : plan);
      }
    }
    const plannedByReference = new Map(readyPlans.map((plan) => [plan.referenceId, plan]));
    let plans = input.references.map((reference, index) => plannedByReference.get(reference.id) || fallbackPlans[index]);
    plans = applyReferenceCopyGroupRules(plans, input.truth);
    plans = replaceUnusablePlansWithTruthFallback({ truth: input.truth, references: input.references, profiles, plans });
    return { profiles, plans, provider: "codex-local" as const, warnings: [...planningWarnings, ...plans.flatMap((plan) => plan.validationErrors)] };
  } catch (error) {
    const plans = replaceUnusablePlansWithTruthFallback({
      truth: input.truth,
      references: input.references,
      profiles,
      plans: fallbackPlans,
    });
    return { profiles, plans, provider: "fallback" as const, warnings: [error instanceof Error ? error.message : "레퍼런스 문구 계획을 만들지 못해 안전 최소 문구를 사용했습니다."] };
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
      generationSource: plan.generationSource === "safe-minimal" ? "fallback" : plan.generationSource === "repaired-codex-local" ? "repaired-ai" : "ai",
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
