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
import { normalizeReferenceRawLines } from "./referenceLibraryManagement";
import type { AdBrief } from "../mvp/types";
import type { CreativeBlueprintId, CreativePlan, HookPlan, ProductFact, ProductTruth, ReferenceAdaptedCopyPlan, ReferenceCopyProfile, ScenePlan } from "./types";

export const REFERENCE_COPY_PROFILE_VERSION = "reference-copy-profile-v1";
export const REFERENCE_ADAPTED_PLANNER_VERSION = "reference-native-copy-adapter-v2";

const cachePath = path.resolve(process.cwd(), ".data", "creative-generation", "reference-copy-profiles.json");
const sentenceStyles = ["question", "declaration", "dialogue", "contrast", "sensory", "urgency", "proof"] as const;
let profileCacheWriteQueue: Promise<void> = Promise.resolve();

type PlannerPayload = {
  profiles: Array<Omit<ReferenceCopyProfile, "id" | "referenceHash" | "profileVersion" | "createdAt" | "analysisSource">>;
  plans: Array<Pick<ReferenceAdaptedCopyPlan, "resultCode" | "referenceId" | "adaptedLines" | "headline" | "subCopy" | "proof" | "offer" | "cta" | "factIds" | "tone" | "sentenceStyle" | "naturalnessScore" | "referenceFitScore" | "factualSafetyScore" | "validationErrors">>;
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
        required: ["resultCode", "referenceId", "adaptedLines", "headline", "subCopy", "proof", "offer", "cta", "factIds", "tone", "sentenceStyle", "naturalnessScore", "referenceFitScore", "factualSafetyScore", "validationErrors"],
        properties: {
          resultCode: { type: "string" }, referenceId: { type: "string" }, adaptedLines: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20 }, headline: { type: "string" }, subCopy: { type: "string" }, proof: { type: "string" }, offer: { type: "string" }, cta: { type: "string" }, factIds: { type: "array", items: { type: "string" } }, tone: { type: "string" }, sentenceStyle: { type: "string", enum: sentenceStyles },
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
  return truth.facts
    .filter((fact) => fact.usableInCopy && fact.verification !== "unverified" && fact.copyEligibility !== "blocked")
    .map((fact) => ({ id: fact.id, label: fact.label, value: fact.value, role: fact.copyEligibility || "headlineEligible" }));
}

function fallbackPlan(truth: ProductTruth, reference: NativeAdReference, profile: ReferenceCopyProfile, index: number): ReferenceAdaptedCopyPlan {
  const facts = truth.facts.filter((fact) => fact.usableInCopy && fact.verification !== "unverified");
  const headlineFact = facts.find((fact) => fact.copyEligibility === "headlineEligible") || facts.find((fact) => fact.evidenceType === "usp");
  const proofFact = facts.find((fact) => fact.copyEligibility === "proofOnly");
  const offerFact = facts.find((fact) => fact.copyEligibility === "offerOnly");
  const headline = (headlineFact?.value || truth.normalized.cleanProductName || truth.product.productName).slice(0, profile.headlineCharacterBudget);
  const selected = [headlineFact, proofFact, offerFact].filter((fact): fact is ProductFact => Boolean(fact));
  return {
    id: `reference-copy-${truth.productId}-${index + 1}`,
    resultCode: `H${String(index + 1).padStart(2, "0")}`,
    referenceId: reference.id,
    referenceCopyProfileId: profile.id,
    referenceRawCopy: reference.nativeCopy?.useForCopyAdaptation === false ? "" : reference.nativeCopy?.rawText || "",
    referenceRawLines: reference.nativeCopy?.useForCopyAdaptation === false ? [] : reference.nativeCopy?.rawLines || [],
    adaptedLines: [headline, proofFact && proofFact.id !== headlineFact?.id ? proofFact.value.slice(0, 48) : "", offerFact?.value || "", /없음|미사용|none/i.test(profile.ctaRole) ? "" : "상품 보기"].filter(Boolean),
    headline,
    subCopy: proofFact && proofFact.id !== headlineFact?.id ? proofFact.value.slice(0, 48) : "",
    proof: "",
    offer: offerFact?.value || "",
    cta: /없음|미사용|none/i.test(profile.ctaRole) ? "" : "상품 보기",
    factIds: selected.map((fact) => fact.id),
    sourceFactValues: selected.map((fact) => fact.value),
    tone: profile.tone,
    sentenceStyle: profile.sentenceStyle,
    naturalnessScore: 72,
    referenceFitScore: 70,
    factualSafetyScore: 100,
    validationStatus: "valid",
    validationErrors: ["로컬 문구 생성기를 사용할 수 없어 검증된 사실로 최소 문구를 구성했습니다."],
    repairCount: 0,
    generationSource: "safe-minimal",
  };
}

function validatePlan(plan: ReferenceAdaptedCopyPlan, truth: ProductTruth, profile: ReferenceCopyProfile) {
  const errors: string[] = [];
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
  const factual = validateCopyAgainstTruth([plan.headline, plan.subCopy, plan.proof, plan.offer, plan.cta].join(" "), truth);
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
  if (sourceLines.length && targetLines.length !== sourceLines.length) errors.push("레퍼런스 원문과 적응 문구의 줄 수가 다릅니다.");
  const copy = [plan.headline, plan.subCopy, plan.proof, plan.offer, plan.cta].join(" ");
  const bannedGenericPhrases = ["구매 조건 보기", "이 선택", "핵심 이유", "고를 이유", "한눈에", "새로운 사용 이유", "지금 확인하세요"];
  if (bannedGenericPhrases.some((phrase) => copy.includes(phrase))) errors.push("상품과 무관한 범용 광고 문구가 포함됐습니다.");
  if (plan.subCopy && Array.from(plan.subCopy.replace(/\s/g, "")).length > profile.supportCharacterBudget + 12) errors.push("레퍼런스 보조 문구 길이 예산을 초과했습니다.");
  return errors;
}

function normalizePlan(raw: PlannerPayload["plans"][number] | undefined, truth: ProductTruth, reference: NativeAdReference, profile: ReferenceCopyProfile, index: number, source: "codex-local" | "repaired-codex-local"): ReferenceAdaptedCopyPlan {
  if (!raw || raw.referenceId !== reference.id) return fallbackPlan(truth, reference, profile, index);
  const known = new Map(truth.facts.map((fact) => [fact.id, fact]));
  const factIds = [...new Set(raw.factIds)].filter((id) => known.has(id));
  const plan: ReferenceAdaptedCopyPlan = {
    id: `reference-copy-${truth.productId}-${index + 1}`,
    resultCode: `H${String(index + 1).padStart(2, "0")}`,
    referenceId: reference.id,
    referenceCopyProfileId: profile.id,
    referenceRawCopy: reference.nativeCopy?.useForCopyAdaptation === false ? "" : reference.nativeCopy?.rawText || "",
    referenceRawLines: reference.nativeCopy?.useForCopyAdaptation === false ? [] : reference.nativeCopy?.rawLines || [],
    adaptedLines: normalizeReferenceRawLines(raw.adaptedLines),
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
  if (plan.naturalnessScore < 70) errors.push("한국어 문구 자연스러움 기준을 통과하지 못했습니다.");
  if (plan.referenceFitScore < 70) errors.push("레퍼런스 문구 구조 적합도 기준을 통과하지 못했습니다.");
  if (plan.factualSafetyScore < 90) errors.push("상품 사실 안전성 기준을 통과하지 못했습니다.");
  return { ...plan, validationStatus: errors.length ? "invalid" : "valid", validationErrors: [...new Set(errors)] };
}

function planningPrompt(input: { truth: ProductTruth; references: NativeAdReference[]; profiles: ReferenceCopyProfile[]; missingProfileIds: string[]; repairPlans?: ReferenceAdaptedCopyPlan[] }) {
  return `한국 광고 제작용 레퍼런스 원문 적응 문구를 한 번의 배치로 작성한다. 후킹 후보, 고객 긴장, 성과 가설, 장면 콘셉트를 새로 기획하지 않는다.

작업 원칙:
- 각 레퍼런스의 rawText/rawLines가 유일한 문구 출발점이다. 일반화된 청사진이나 새 후킹을 만들지 않는다.
- adaptedLines는 rawLines와 같은 개수·순서·빈 줄을 유지하고, 각 줄에서 상품에 맞지 않는 사실만 교체한다.
- 원문의 단어 순서, 줄 수, 문장부호, 이모지, ㅋㅋ, ㅎㅎ, ㅠㅠ, ;;, .., ㄷㄷ, 헐, 뭐임, 겨 같은 구어체를 최대한 그대로 둔다.
- 기존 상품·가격·혜택·업체·상품별 근거만 ProductTruth의 현재 상품 사실로 치환한다. 상품과 무관한 연결어와 말투는 함부로 고치지 않는다.
- 원문에 채팅/댓글/밈 문법이 있을 때만 그 형식을 유지하고, 없으면 새로 추가하지 않는다.
- ProductTruth는 사실 상한선이다. 제공된 fact 이외의 가격, 할인, 구성, 후기, 효능, 원산지, 수치를 만들지 않는다.
- headlineEligible은 헤드라인/보조 문구에, proofOnly는 근거에, offerOnly는 offer에만 쓴다. identityOnly는 상품 식별에만 쓴다.
- 애매한 상투어보다 ProductTruth의 구체 사실을 우선하고, 확인된 사실 안에서는 판매형 말투를 충분히 강하게 유지한다.
- CTA는 레퍼런스에 실제 CTA 역할이 있을 때만 짧게 작성한다.
- 여섯 결과가 같은 의미가 되지 않게 서로 다른 원문 의미 구조를 유지한다.
- 가격은 최대 2장, 할인율은 최대 2장, 배송/쿠폰/증정 등 혜택은 최대 3장, 수량·중량은 최대 2장에서만 메인 강조한다.
- 각 plan은 스스로 점검한 naturalnessScore, referenceFitScore, factualSafetyScore와 validationErrors를 반드시 포함한다.
- 결과 코드는 내부 순번 H01~H06일 뿐 후킹 유형이 아니다.

상품 사실:
${JSON.stringify({ productName: input.truth.normalized.cleanProductName, facts: factsForPlanning(input.truth) }, null, 2)}

레퍼런스:
${JSON.stringify(input.references.map((reference, index) => ({ resultCode: `H${String(index + 1).padStart(2, "0")}`, referenceId: reference.id, imagePath: reference.path, layoutFamily: reference.layoutFamily, textDensity: reference.textDensity, compositionType: reference.compositionType, productSlotCount: reference.productSlotCount, rawText: reference.nativeCopy?.useForCopyAdaptation === false ? "" : reference.nativeCopy?.rawText || "", rawLines: reference.nativeCopy?.useForCopyAdaptation === false ? [] : reference.nativeCopy?.rawLines || [], textRegions: reference.nativeCopy?.useForCopyAdaptation === false ? [] : reference.nativeCopy?.textRegions || [] })), null, 2)}

이미 분석된 프로필:
${JSON.stringify(input.profiles.filter((profile) => !input.missingProfileIds.includes(profile.referenceId)), null, 2)}

profiles는 과거 저장 구조 호환용이므로 빈 배열로 반환한다.
${input.repairPlans?.length ? `다음 검증 실패 문구만 한 번 수정한다. 나머지 resultCode는 plans에 포함하지 않는다: ${JSON.stringify(input.repairPlans, null, 2)}` : "여섯 레퍼런스 각각의 plans를 작성한다."}
JSON 스키마만 반환한다.`;
}

function profilePrompt(references: NativeAdReference[]) {
  return `광고 레퍼런스 이미지의 문구 구조만 분석한다. 상품 전략이나 새 문구는 생성하지 않는다. 각 imagePath를 확인해 headline/support/proof/offer/CTA 역할, 줄 수와 글자 수 예산, 말투, 문장형, 수치 강조, 문장부호 리듬을 기록한다. 원문의 핵심 리터럴 문구는 prohibitedLiteralPhrases에 기록한다. JSON 스키마만 반환한다.\n${JSON.stringify(references.map((reference) => ({ referenceId: reference.id, imagePath: reference.path, layoutFamily: reference.layoutFamily, textDensity: reference.textDensity })), null, 2)}`;
}

function criticPrompt(input: { truth: ProductTruth; profiles: ReferenceCopyProfile[]; plans: ReferenceAdaptedCopyPlan[] }) {
  return `아래 6개 한국 광고 문구를 한 번에 독립 검수한다. 새 문구를 만들지 말고 점수와 오류만 반환한다.\n검수 기준: 자연스러운 한국어, referenceRawCopy/referenceRawLines의 어순·줄 수·기호·구어체 보존, 상품 관련 표현만 ProductTruth로 교체했는지, ProductTruth 밖 수치·혜택·효능 금지, 장면과 문구의 일치, 여섯 결과의 의미 중복 억제. 원문을 보존한 사실 자체를 오류로 판정하지 않는다. valid는 세 점수가 각각 naturalness 70, referenceFit 70, factualSafety 90 이상이고 치명 오류가 없을 때만 true다.\nProductTruth: ${JSON.stringify(factsForPlanning(input.truth))}\nPlans: ${JSON.stringify(input.plans)}\nJSON 스키마만 반환한다.`;
}

async function runCodexJson<T>(prompt: string, outputSchema: object) {
  if (!(await codexLocalAuthenticated())) throw new Error("로컬 Codex 로그인이 없습니다.");
  const codex = new Codex({ env: codexLocalEnvironment(), codexPathOverride: resolveCodexLocalExecutable() });
  const thread = codex.startThread({ workingDirectory: process.cwd(), sandboxMode: "read-only", approvalPolicy: "never", networkAccessEnabled: false, model: process.env.ADATLAS_CODEX_MODEL?.trim() || "gpt-5.6-sol", modelReasoningEffort: "low" });
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
    const errors = [...new Set([...plan.validationErrors, ...review.errors])];
    const valid = plan.validationStatus === "valid" && review.valid && review.naturalnessScore >= 70 && review.referenceFitScore >= 70 && review.factualSafetyScore >= 90;
    return {
      ...plan,
      naturalnessScore: review.naturalnessScore,
      referenceFitScore: review.referenceFitScore,
      factualSafetyScore: review.factualSafetyScore,
      validationStatus: valid ? "valid" as const : "invalid" as const,
      validationErrors: valid ? [] : errors.length ? errors : ["일괄 문구 검수 기준을 통과하지 못했습니다."],
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
  try {
    const response = await runPlanner(planningPrompt({ ...input, profiles, missingProfileIds: [] }));
    let plans = input.references.map((reference, index) => normalizePlan(response.plans.find((plan) => plan.referenceId === reference.id), input.truth, reference, profiles[index], index, "codex-local"));
    try {
      plans = applyReferenceCopyGroupRules(await reviewPlans({ truth: input.truth, profiles, plans }), input.truth);
    } catch (error) {
      const message = error instanceof Error ? error.message : "일괄 문구 자연스러움 검수에 실패했습니다.";
      plans = plans.map((plan) => ({ ...plan, validationStatus: "invalid" as const, validationErrors: [...plan.validationErrors, message] }));
    }
    const failed = plans.filter((plan) => plan.validationStatus === "invalid");
    if (failed.length) {
      try {
        const repaired = await runPlanner(planningPrompt({ ...input, profiles, missingProfileIds: [], repairPlans: failed }));
        plans = plans.map((plan, index) => plan.validationStatus === "invalid" ? normalizePlan(repaired.plans.find((candidate) => candidate.referenceId === plan.referenceId), input.truth, input.references[index], profiles[index], index, "repaired-codex-local") : plan);
        const repairedReferenceIds = new Set(failed.map((plan) => plan.referenceId));
        const repairedPlans = plans.filter((plan) => repairedReferenceIds.has(plan.referenceId));
        try {
          const reviewedRepairs = await reviewPlans({ truth: input.truth, profiles: profiles.filter((profile) => repairedReferenceIds.has(profile.referenceId)), plans: repairedPlans });
          const reviewedByReference = new Map(reviewedRepairs.map((plan) => [plan.referenceId, plan]));
          plans = applyReferenceCopyGroupRules(plans.map((plan) => reviewedByReference.get(plan.referenceId) || plan), input.truth);
        } catch (error) {
          const message = error instanceof Error ? error.message : "보정 문구 재검수에 실패했습니다.";
          plans = plans.map((plan) => repairedReferenceIds.has(plan.referenceId) ? { ...plan, validationStatus: "invalid" as const, validationErrors: [...plan.validationErrors, message] } : plan);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "문구 1회 보정에 실패했습니다.";
        plans = plans.map((plan) => plan.validationStatus === "invalid" ? { ...plan, validationErrors: [...plan.validationErrors, message], repairCount: 1 } : plan);
      }
    }
    return { profiles, plans, provider: "codex-local" as const, warnings: plans.flatMap((plan) => plan.validationErrors) };
  } catch (error) {
    const plans = input.references.map((reference, index) => fallbackPlan(input.truth, reference, profiles[index], index));
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
