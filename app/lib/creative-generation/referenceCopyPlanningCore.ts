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

import {
  NATURALNESS_PASS_SCORE,
  REFERENCE_FIT_PASS_SCORE,
  fallbackProfile,
  referenceHash,
  resolvedVendorCopyExamples,
  sentenceStyles,
  type PlannerPayload,
} from "./referenceCopyProfiles.server";

function productFactPlanningPriority(fact: ProductFact) {
  if (fact.evidenceType === "merchant-proof") return 5;
  if (fact.source === "vendor-research") {
    if (fact.evidenceType === "quantity" || fact.evidenceType === "numeric") return 155;
    if (fact.evidenceType === "ingredient" || fact.evidenceType === "composition") return 148;
    if (fact.evidenceType === "usage" || fact.evidenceType === "review") return 140;
    if (fact.evidenceType === "usp") return 136;
    if (/향(?:이|만|으로|의)?\s*(?:좋|상쾌|달콤|산뜻|포근)|향의\s*(?:특징|흐름|인상)/u.test(`${fact.label} ${fact.value}`)) return 106;
    return 130;
  }
  if (fact.key === "main-benefit" || fact.key === "verified-descriptor") return 120;
  if (fact.key.startsWith("title-benefit") || fact.key.startsWith("verified-benefit")) return 112;
  if (fact.evidenceType === "usp") return 108;
  if (fact.evidenceType === "ingredient" || fact.evidenceType === "composition") return 98;
  if (fact.evidenceType === "usage" || fact.evidenceType === "review") return 92;
  if (fact.evidenceType === "quantity" || fact.evidenceType === "numeric") return 82;
  if (fact.evidenceType === "offer" || fact.evidenceType === "price") return 72;
  if (fact.evidenceType === "identity") return 20;
  return 55;
}

function prioritizedPlanningFacts(truth: ProductTruth) {
  return truth.facts
    .filter((fact) => fact.usableInCopy && fact.verification !== "unverified" && fact.copyEligibility !== "blocked")
    .filter((fact) => !isMalformedProductSignal(fact.value) && !isIncompleteOcrCopyFragment(fact.value))
    .sort((left, right) => productFactPlanningPriority(right) - productFactPlanningPriority(left));
}

function factsForPlanning(truth: ProductTruth) {
  const seen = new Set<string>();
  return prioritizedPlanningFacts(truth)
    .filter((fact) => fact.key !== "brand-name" && fact.evidenceType !== "merchant-proof")
    .filter((fact) => !isProhibitedAdCopySignal(fact.value) && fact.evidenceType !== "shipping" && !isShippingCreativeSignal(fact.value) && !isNonDomesticOriginCreativeSignal(fact.value))
    .filter((fact) => {
      const signature = comparableCopy(fact.value);
      if (!signature || seen.has(signature)) return false;
      seen.add(signature);
      return true;
    })
    .map((fact) => ({
      id: fact.id,
      label: fact.label,
      value: fact.value,
      copyHint: consumerFacingFactHint(fact.value),
      role: fact.copyEligibility || "headlineEligible",
      scope: fact.copyEligibility === "offerOnly" ? "offer" : "product",
      priority: productFactPlanningPriority(fact),
    }));
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
  return errors.filter((error) => /ProductTruth|근거(?:가| 없이| 없는)|확인되지|허위|수치|가격|할인|혜택|효능|함량|원산지|후기|배송|상품 카테고리 의미 충돌/u.test(error));
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
  const usage = clean.match(/^(?:사용감|향)(?:(?:은|는|이|가)\s*|\s+)(.+?)(?:\s*(?:합니다|입니다))?$/u)?.[1]?.trim();
  if (usage && !/^(?:으?로|기(?:로)?)(?:\s|,|$)/u.test(usage)) return `${usage}, 직접 느껴보세요`;
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
  const domain = resolveProductCopyDomain(truth.product);
  const productContext = [truth.product.productName, truth.product.category, truth.product.productSubCategory, truth.product.detectedProductType].filter(Boolean).join(" ");
  const meat = /고기|갈비|한우|소고기|돼지|육류|정육|meat|beef|pork/iu.test(productContext);
  const candidates = domain === "snack"
    ? [
        "오늘 간식은 또 뭘 먹을까요?",
        `간식 생각날 때 ${identity} 어때요?`,
        "간식만 꺼내면 같이 모이는 우리 가족",
        "주말 간식 시간의 주인공",
        "출출한 오후에 한입",
        "간식 고를 때 이 식감부터",
      ]
    : domain === "food"
      ? meat
        ? [
            "고기 없으면 서운한 울 아버지",
            "고기 사러 멀리 가세요?",
            "오늘은 집에서 편하게 골라요",
            "오늘 밥상의 진짜 주인공",
            `오늘 저녁 ${identity} 어때요?`,
            "좋은 날엔 좋은 고기",
          ]
        : [
            "오늘 저녁은 또 뭘 먹을까요?",
            `오늘 식탁에 ${identity} 어때요?`,
            "우리 가족 메뉴 고민은 여기까지",
            "오늘 식탁의 진짜 주인공",
            "퇴근한 저녁, 간단하게 골라요",
            "식탁 위에 바로 더해보세요",
          ]
      : domain === "personal-care" || domain === "beauty"
        ? [
            `매일 손이 가는 ${identity}`,
            "오늘 샤워 루틴에 어때요?",
            "바쁜 하루에 더하는 리셋",
            "나를 위한 개운한 루틴",
            "매일 쓰는 만큼 사용감부터",
            "필요한 순간 바로 꺼내세요",
          ]
        : [
            `오늘 필요한 ${identity}`,
            "일상에 자연스럽게 더해보세요",
            "고민될 때 이 특징부터",
            "매일 함께하기 좋은 선택",
            "지금 핵심부터 살펴보세요",
            "필요한 순간 바로 꺼내세요",
          ];
  return [...candidates.slice(index % candidates.length), ...candidates.slice(0, index % candidates.length)];
}

function premiseFallbackCandidates(premise: ImageCreativePremise, identity: string) {
  if (premise.kind === "everyday-question-answer") return [premise.situation, premise.tension, premise.productBridge, identity];
  if (premise.kind === "everyday-relationship") return [premise.character, `${identity}, 오늘 자연스럽게 챙겨요`, premise.productBridge, identity];
  if (premise.kind === "obvious-ad-metaphor") return [premise.situation, premise.productBridge, identity];
  if (premise.kind === "comparison-benefit") {
    return [`일반 상품과 비교해 ${premise.productBridge}`, premise.productBridge, `비슷해 보여도 ${identity}는 달라요`, identity];
  }
  if (premise.kind === "usp-focus") return [premise.productBridge, `${identity}, 이 장점부터 보세요`, identity];
  return [premise.character, premise.situation, premise.tension, premise.productBridge];
}

function fallbackTextCandidates(truth: ProductTruth, facts: ProductFact[], identity: string, offerText: string, index: number) {
  const singles = uniqueFacts(facts)
    .filter((fact) => !["category", "target", "season-event", "package-option", "quantity"].includes(fact.key))
    .filter((fact) => fact.copyEligibility !== "blocked" && fact.copyEligibility !== "offerOnly")
    .filter((fact) => fact.evidenceType !== "merchant-proof")
    .filter((fact) => fact.evidenceType !== "price" && fact.evidenceType !== "offer" && fact.evidenceType !== "numeric")
    .map((fact) => reasonTextForFact(fact, identity, truth))
    .filter((value) => value && factCharacterCount(value) <= 32);
  const contexts = contextualFallbackCandidates(truth, identity, index);
  const values = [...contexts, ...singles, identity, offerText]
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
    .filter((fact) => fact.evidenceType !== "merchant-proof")
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

function fallbackPlan(truth: ProductTruth, reference: NativeAdReference, profile: ReferenceCopyProfile, index: number, assignedPremise?: ImageCreativePremise): ReferenceAdaptedCopyPlan {
  const creativePremise = assignedPremise || buildImageCreativePremiseSeed(truth, reference, index);
  const facts = prioritizedPlanningFacts(truth).filter((fact) => fact.evidenceType !== "shipping" && !isShippingCreativeSignal(fact.value) && !isNonDomesticOriginCreativeSignal(fact.value) && !isProhibitedAdCopySignal(fact.value));
  const headlineCandidates = uniqueFacts(facts.filter((fact) => isCleanFallbackHeadlineFact(fact, truth, profile.headlineCharacterBudget)));
  const prioritizedHeadlineCandidates = uniqueFacts([
    ...headlineCandidates.filter((fact) => fact.source === "vendor-research" && !/향(?:이|만|으로|의)?\s*(?:좋|상쾌|달콤|산뜻|포근)|향의\s*(?:특징|흐름|인상)/u.test(`${fact.label} ${fact.value}`)),
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
    fact.evidenceType !== "merchant-proof" &&
    !["base-product-name", "category", "target"].includes(fact.key) &&
    factCharacterCount(fact.value) <= 38
  ));
  const proofFact = proofFacts[index % Math.max(1, proofFacts.length)] || supportFact;
  // fallback에서도 여섯 장 모두 가격으로 수렴하지 않게 가격·할인형은 앞의
  // 두 소재에만 배정한다. 나머지 offer 슬롯은 검증된 다른 구매 이유로 채운다.
  const offer = index % 6 < 2 ? automaticOfferLine(facts) : { text: "", facts: [] as ProductFact[] };
  const offerFact = offer.facts[0];
  const identity = shortProductIdentity(truth);
  // 사전 조사 예문은 첫 세 소재에만 한 번씩 배정합니다. 나머지는 다른 검증
  // 사실과 사용 맥락을 사용해 6장이 같은 문구 세 개를 반복하지 않게 합니다.
  const vendorExample = resolvedVendorCopyExamples(truth)[index];
  const vendorExampleFacts = (vendorExample?.factIds || [])
    .map((id) => facts.find((fact) => fact.id === id))
    .filter((fact): fact is ProductFact => Boolean(fact));
  const contextualCandidates = [...premiseFallbackCandidates(creativePremise, identity), ...contextualFallbackCandidates(truth, identity, index)];
  const sourceLines = reference.nativeCopy?.useForCopyAdaptation === false ? [] : reference.nativeCopy?.rawLines || [];
  const contentFacts = uniqueFacts([headlineFact, supportFact, proofFact, ...prioritizedHeadlineCandidates, ...proofFacts]
    .filter((fact): fact is ProductFact => Boolean(fact))
    .filter((fact) => !["category", "target", "season-event", "package-option", "quantity"].includes(fact.key))
    .filter((fact) => factCharacterCount(consumerFacingFactHint(fact.value)) <= 32));
  const usedFacts = new Map<string, ProductFact>();
  vendorExampleFacts.forEach((fact) => usedFacts.set(fact.id, fact));
  const numberedFallback = sourceLines.length ? buildNumberedReasonFallback(truth, reference, sourceLines, facts) : null;
  numberedFallback?.selectedFacts.forEach((fact) => usedFacts.set(fact.id, fact));
  let contentIndex = 0;
  let offerIndex = 0;
  const roleUseCounts = new Map<NonNullable<ReferenceAdaptedCopyPlan["copySlots"]>[number]["role"], number>();
  const fallbackOfferFacts = uniqueFacts(facts.filter((fact) => fact.copyEligibility === "offerOnly"));
  const contentFallbackCandidates = [vendorExample?.headline, vendorExample?.support, ...fallbackTextCandidates(truth, facts, identity, "", index)]
    .filter((candidate): candidate is string => Boolean(candidate))
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
  const headlineFallbackText = vendorExample?.headline || (headlineFact ? reasonTextForFact(headlineFact, identity, truth) || contextualCandidates[0] : contextualCandidates[0]);
  const supportFallbackText = vendorExample?.support || (supportFact ? reasonTextForFact(supportFact, identity, truth) || contextualCandidates[1] : contextualCandidates[1]);
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
        const roleUseCount = roleUseCounts.get(role) || 0;
        roleUseCounts.set(role, roleUseCount + 1);
        const fact = role === "offer" && offerFact ? offerFact : contentFacts[contentIndex++ % Math.max(1, contentFacts.length)];
        if (fact) usedFacts.set(fact.id, fact);
        // AI 문구가 검수에서 탈락해도 사전 조사에서 사람이 정리한 광고용
        // 후보를 범용 상황문보다 먼저 사용한다. 같은 역할의 두 번째 줄부터는
        // 다른 ProductTruth 사실·상황 후보로 회전해 한 이미지 안의 반복을 막는다.
        const researchedPreferred = roleUseCount === 0
          ? role === "headline"
            ? headlineFallbackText
            : role === "support"
              ? supportFallbackText
              : role === "proof" || role === "badge"
                ? proofFallbackText
                : ""
          : "";
        const contextualPreferred = role === "headline" ? contextualCandidates[0] : role === "support" ? contextualCandidates[1] : "";
        const preferred = researchedPreferred || (fact ? reasonTextForFact(fact, identity, truth) : contextualPreferred || contextualCandidates[2]);
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
    creativePremise,
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
    naturalnessScore: 0,
    referenceFitScore: 0,
    factualSafetyScore: 0,
    validationStatus: "needs-review",
    validationErrors: [],
    repairCount: 0,
    generationSource: "reference-best-effort",
  };
  const validationErrors = [...new Set(validatePlan(candidate, truth, profile))];
  const naturalnessErrors = findReferenceCopyNaturalnessErrors(candidate);
  const copyText = [candidate.headline, candidate.subCopy, candidate.proof, candidate.offer, candidate.cta, ...adaptedLines].filter(Boolean).join("\n");
  const incompleteFragments = adaptedLines.filter((line) => isIncompleteOcrCopyFragment(line)).length;
  const naturalnessScore = Math.max(0, Math.min(100,
    96 - naturalnessErrors.length * 12 - incompleteFragments * 24 - (candidate.headline.trim() ? 0 : 35) - (copySlots.some((slot) => slot.targetText.trim()) ? 0 : 35)
  ));
  const sourceNonBlank = sourceLines.filter((line) => line.trim()).length;
  const targetNonBlank = adaptedLines.filter((line) => line.trim()).length;
  const lineCoverage = sourceNonBlank ? Math.min(1, targetNonBlank / sourceNonBlank) : Math.min(1, targetNonBlank / Math.max(1, fallbackSlotRoles(reference, profile, Boolean(offer.text)).length));
  const sourceCharacters = Math.max(1, sourceLines.join("").replace(/\s/g, "").length);
  const targetCharacters = adaptedLines.join("").replace(/\s/g, "").length;
  const densityRatio = sourceLines.length ? Math.min(1, targetCharacters / sourceCharacters) : Math.min(1, targetCharacters / Math.max(12, profile.headlineCharacterBudget + profile.supportCharacterBudget));
  const roleCoverage = Math.min(1, new Set(copySlots.filter((slot) => slot.targetText.trim()).map((slot) => slot.role)).size / Math.max(1, new Set(fallbackSlotRoles(reference, profile, Boolean(offer.text))).size));
  const referenceFitScore = Math.max(0, Math.min(100, Math.round(45 + lineCoverage * 25 + densityRatio * 20 + roleCoverage * 10 - validationErrors.filter((error) => /레퍼런스|슬롯|문구 정보 밀도|헤드라인 길이|축약/u.test(error)).length * 10)));
  const factualValidation = validateCopyAgainstTruth(copyText, truth);
  const factualErrors = validationErrors.filter((error) => /ProductTruth|근거|확인되지|허위|수치|차단|배송|원산지|판매주체|상품 카테고리 의미 충돌/u.test(error)).length;
  const factualSafetyScore = Math.max(0, 100 - (factualValidation.valid ? 0 : 45) - factualErrors * 20);
  const scoredErrors = [...validationErrors];
  if (naturalnessScore < NATURALNESS_PASS_SCORE) scoredErrors.push(`결정적 문장 완결성 검수 ${NATURALNESS_PASS_SCORE}점 기준을 통과하지 못했습니다.`);
  if (referenceFitScore < REFERENCE_FIT_PASS_SCORE) scoredErrors.push(`결정적 레퍼런스 구조 적합도 ${REFERENCE_FIT_PASS_SCORE}점 기준을 통과하지 못했습니다.`);
  if (factualSafetyScore < 90) scoredErrors.push("결정적 상품 사실 안전성 기준을 통과하지 못했습니다.");
  return {
    ...candidate,
    naturalnessScore,
    referenceFitScore,
    factualSafetyScore,
    validationStatus: scoredErrors.length ? "invalid" : "valid",
    validationErrors: [...new Set(scoredErrors)],
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
    /ProductTruth|근거(?:가| 없이| 없는)|확인되지|허위|원산지|산지(?:\s*특가)?\s*근거|배송|브랜드|업체명|판매자명|상품 카테고리 의미 충돌/u.test(error)
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
  const renderedCopy = [...(plan.adaptedLines || []), plan.headline, plan.subCopy, plan.proof, plan.offer, plan.cta].filter(Boolean).join(" ");
  return plan.validationStatus === "valid" &&
    plan.generationSource !== "reference-best-effort" &&
    plan.generationSource !== "safe-minimal" &&
    plan.naturalnessScore >= NATURALNESS_PASS_SCORE &&
    plan.referenceFitScore >= REFERENCE_FIT_PASS_SCORE &&
    plan.factualSafetyScore >= 90 &&
    !(plan.validationErrors || []).length &&
    findImageCreativePremiseCopyErrors(plan.creativePremise, renderedCopy).length === 0;
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
  const assignedPremise = input.previous?.creativePremise || buildImageCreativePremiseSeed(input.truth, input.reference, input.index);
  const candidates = Array.from({ length: 6 }, (_, offset) => fallbackPlan(input.truth, input.reference, profile, input.index + offset, assignedPremise));
  const fallbackPenalty = (candidate: ReferenceAdaptedCopyPlan) => {
    const errors = candidate.validationErrors || [];
    const critical = errors.filter((error) => /ProductTruth|근거|확인되지|허위|원산지|배송|상품 카테고리 의미 충돌|빈 문구/u.test(error)).length;
    const repetition = errors.filter((error) => /반복|같은 핵심 문구|같은 상품명/u.test(error)).length;
    const generic = errors.filter((error) => /범용 광고 문구|단순 상품명|단순화/u.test(error)).length;
    return critical * 10_000 + repetition * 1_000 + generic * 500 + errors.length * 25 - candidate.naturalnessScore - candidate.referenceFitScore;
  };
  // 여섯 회전안이 모두 엄격 검수에 미달하더라도 첫 번째 안을 무조건 쓰지
  // 않는다. 치명적 사실 오류·반복·범용화가 가장 적은 안을 고르면 이미지
  // 제작을 계속하면서도 검수용 문구의 품질 하한을 지킬 수 있다.
  const rankedCandidates = [...candidates].sort((left, right) => fallbackPenalty(left) - fallbackPenalty(right));
  const fallback = candidates.find((candidate) => hasPublishableReferenceCopyContract(candidate)) || rankedCandidates.find((candidate) => hasExecutableReferenceCopyContract(candidate)) || rankedCandidates[0];
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
  premiseSeeds?: ImageCreativePremise[];
}) {
  return input.references.map((reference, index) => {
    const plan = input.plans[index];
    if (hasPublishableReferenceCopyContract(plan)) return plan;
    const fallback = fallbackPlan(input.truth, reference, input.profiles[index], index, input.premiseSeeds?.[index] || plan?.creativePremise);
    return {
      ...fallback,
      repairCount: Math.max(plan?.repairCount || 0, fallback.repairCount),
    };
  });
}

function validatePlan(plan: ReferenceAdaptedCopyPlan, truth: ProductTruth, profile: ReferenceCopyProfile) {
  const errors: string[] = [];
  errors.push(...findImageCreativePremiseErrors(plan.creativePremise, truth));
  errors.push(...findImageCreativePremiseCopyErrors(
    plan.creativePremise,
    [...(plan.adaptedLines || []), plan.headline, plan.subCopy, plan.proof, plan.offer, plan.cta].filter(Boolean).join(" ")
  ));
  errors.push(...findReferenceCopyNaturalnessErrors(plan));
  errors.push(...findProductCopySemanticErrors(
    [...(plan.adaptedLines || []), plan.headline, plan.subCopy, plan.proof, plan.offer, plan.cta].join(" "),
    truth.product
  ));
  const facts = new Map(truth.facts.map((fact) => [fact.id, fact]));
  const selectedFacts = plan.factIds.map((id) => facts.get(id)).filter((fact): fact is ProductFact => Boolean(fact));
  if (!plan.headline.trim()) errors.push("헤드라인이 비어 있습니다.");
  if (!plan.factIds.length) errors.push("문구의 근거가 되는 ProductTruth fact id가 없습니다.");
  if (Array.from(plan.headline.replace(/\s/g, "")).length > profile.headlineCharacterBudget + 8) errors.push("레퍼런스 헤드라인 길이 예산을 초과했습니다.");
  if (plan.factIds.some((id) => !facts.has(id))) errors.push("존재하지 않는 ProductTruth fact id가 포함됐습니다.");
  if (selectedFacts.some((fact) => fact.copyEligibility === "blocked" || !fact.usableInCopy)) errors.push("문구 사용이 차단된 사실이 포함됐습니다.");
  if (selectedFacts.some((fact) => fact.evidenceType === "shipping" || isShippingCreativeSignal(fact.value))) errors.push("배송 관련 정보는 광고 문구로 사용할 수 없습니다.");
  if (selectedFacts.some((fact) => isMalformedProductSignal(fact.value))) errors.push("OCR로 훼손된 상품 문구는 광고 사실로 사용할 수 없습니다.");
  if (selectedFacts.some((fact) => fact.copyEligibility === "offerOnly" && `${plan.headline} ${plan.subCopy} ${plan.proof}`.includes(fact.value))) errors.push("가격·혜택 사실이 offer 이외 영역에 사용됐습니다.");
  if (plan.offer && !selectedFacts.some((fact) => fact.copyEligibility === "offerOnly")) errors.push("offer 문구에 연결된 가격·혜택 사실이 없습니다.");
  if (plan.proof && !selectedFacts.some((fact) => ["headlineEligible", "proofOnly"].includes(fact.copyEligibility || "headlineEligible"))) errors.push("proof 문구에 연결된 근거 사실이 없습니다.");
  const renderedPlanCopy = [...(plan.adaptedLines || []), plan.headline, plan.subCopy, plan.proof, plan.offer, plan.cta].filter(Boolean).join(" ");
  const renderedPlanSignature = comparableCopy(renderedPlanCopy);
  const usedPackageOptions = selectedFacts.filter((fact) =>
    fact.key === "package-option" && comparableCopy(fact.value).length >= 3 && renderedPlanSignature.includes(comparableCopy(fact.value))
  );
  const usedPriceFacts = selectedFacts.filter((fact) =>
    ["price", "original-price"].includes(fact.key) && extractNumericTokens(fact.value).some((token) => renderedPlanCopy.includes(token))
  );
  if (usedPackageOptions.length && usedPriceFacts.length) {
    const optionAndPriceBoundInOneFact = truth.facts.some((fact) => {
      const signature = comparableCopy(fact.value);
      return usedPackageOptions.some((option) => signature.includes(comparableCopy(option.value))) &&
        usedPriceFacts.some((price) => extractNumericTokens(price.value).some((token) => fact.value.includes(token)));
    });
    if (!optionAndPriceBoundInOneFact) errors.push("선택 옵션과 가격의 직접 연결 근거가 없어 같은 소재에 함께 표시할 수 없습니다.");
  }
  const merchantNames = [truth.product.advertiserName, truth.product.brandName, truth.normalized.brandName]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const merchantSignatures = merchantNames.map(comparableCopy).filter((value) => value.length >= 2);
  if (merchantSignatures.some((merchant) => renderedPlanSignature.includes(merchant))) {
    errors.push("브랜드·업체명은 광고 문구에서 제외해야 합니다.");
  }
  const merchantSlots = (plan.copySlots?.length
    ? plan.copySlots.map((slot) => ({ role: slot.role, text: slot.targetText }))
    : [
        { role: "headline", text: plan.headline },
        { role: "support", text: plan.subCopy },
        { role: "proof", text: plan.proof },
        { role: "offer", text: plan.offer },
        { role: "cta", text: plan.cta },
      ])
    .filter(({ text }) => isMerchantCredentialCreativeSignal(text));
  for (const slot of merchantSlots) {
    void slot;
    errors.push("업체 순위·수상·업력 문구는 브랜드 없는 상품 광고 문구에 사용할 수 없습니다.");
  }
  if ([...(plan.adaptedLines || []), plan.headline, plan.subCopy, plan.proof, plan.offer, plan.cta].some((text) => isAmbiguousMerchantCredentialCreativeSignal(text))) {
    errors.push("주체·평가 범위가 없는 업체 실적 OCR 조각은 광고 문구로 사용할 수 없습니다.");
  }
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
  if ([...targetLines, plan.headline, plan.subCopy, plan.proof, plan.offer, plan.cta].some((text) => isIncompleteOcrCopyFragment(text))) errors.push("조사·관형형에서 끊긴 불완전한 문구 조각이 포함됐습니다.");
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

function applyMerchantCredentialGroupRule(plans: ReferenceAdaptedCopyPlan[]) {
  let used = false;
  return plans.map((plan) => {
    const copy = (plan.copySlots?.length ? plan.copySlots.map((slot) => slot.targetText) : [plan.headline, plan.subCopy, plan.proof, plan.offer, plan.cta]).join(" ");
    if (!isMerchantCredentialCreativeSignal(copy)) return plan;
    if (!used) {
      used = true;
      return plan;
    }
    const validationErrors = [...new Set([...plan.validationErrors, "업체 순위·수상·업력 보조 문구는 6장 중 최대 1장만 사용할 수 있습니다."])];
    return { ...plan, validationStatus: "invalid" as const, validationErrors };
  });
}

function normalizePlan(raw: PlannerPayload["plans"][number] | undefined, truth: ProductTruth, reference: NativeAdReference, profile: ReferenceCopyProfile, index: number, assignedPremise: ImageCreativePremise, source: "codex-local" | "repaired-codex-local"): ReferenceAdaptedCopyPlan {
  if (!raw || raw.referenceId !== reference.id) return fallbackPlan(truth, reference, profile, index, assignedPremise);
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
    creativePremise: normalizeImageCreativePremise(raw.creativePremise, assignedPremise, truth),
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


export {
  factsForPlanning,
  plannerDeclaredSafetyErrors,
  buildCopySlots,
  canonicalCopyFields,
  fallbackPlan,
  ensureRenderableReferencePlans,
  applyMerchantCredentialGroupRule,
  normalizePlan,
  shortProductIdentity,
};

