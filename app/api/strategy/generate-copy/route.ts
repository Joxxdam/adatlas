import { NextResponse } from "next/server";

import { defaultAdBrief, productInfoToAdBrief } from "../../../lib/mvp/adBrief";
import { buildGenerateCopyPrompt } from "../../../lib/mvp/copyPromptBuilder";
import { loadCopyGuideForProduct } from "../../../lib/mvp/copyGuideLoader";
import {
  kookdaeGenericForbiddenPhrases,
  normalizeKookdaePunctuation,
} from "../../../lib/mvp/kookdaeCopyPatterns";
import {
  analyzeProductUsp,
  buildTargetedCopyVariants,
  buildUspFirstFallbackCopy,
  isCopyGroundedInProductUsp,
} from "../../../lib/mvp/productUsp";
import { readAdImageLabels } from "../../../lib/mvp/labelStore";
import { labelsForReferenceMatches, matchReferences } from "../../../lib/mvp/referenceMatcher";
import { normalizeReferenceUsages } from "../../../lib/mvp/referenceUsage";
import { copyLimitCharSummary } from "../../../lib/mvp/templateCopyFitter";
import { isObjectiveCtaAligned, objectiveCta } from "../../../lib/mvp/adObjective";
import type {
  AdBrief,
  AdImageLabel,
  CopyGuideContext,
  CreativeStrategy,
  GeneratedAdCopy,
  GeneratedAdCopyVariant,
  ProductInfoForPrompt,
  ReferenceUsageSelection,
} from "../../../lib/mvp/types";

type Body = {
  productInfo?: Partial<ProductInfoForPrompt>;
  referenceLabels?: AdImageLabel[];
  templateId?: string;
  templateName?: string;
  advertiserName?: string;
  brandName?: string;
  copyGuideId?: string;
  productUrl?: string;
  category?: string;
  adBrief?: AdBrief;
  creativeStrategy?: CreativeStrategy | null;
  creativeStrategies?: CreativeStrategy[];
  referenceUsages?: ReferenceUsageSelection[];
};

type TemplateInfo = {
  templateId?: string;
  templateName?: string;
};

const forbiddenPhrases = [
  "만나보세요",
  "기다립니다",
  "필수 아이템",
  "특별한 선택",
  "자세한 정보",
  "여기를 클릭",
  "새로워진 즐거움",
  "만족을 줄 수 있음",
  "여러분을 기다립니다",
  "지금 바로 확인하기",
  "meet",
  "waiting",
  "must-have",
  "special choice",
  "click here",
  "learn more",
  "undefined",
  "null",
  "nan",
];

const copySlots = [
  "headline",
  "bodyCopy",
  "highlightCopy",
  "bottomBarCopy",
  "cta",
  "price",
] as const;

const kookdaeGuideExamplePattern =
  /(사장님|정육점|직원인 저|담당자 컨펌|경리팀|본사에서 뒤집|마진(?:도)? 안 남|손해 보고|오타 아닙니다|두 번 (?:놀랐|확인)|반신반의|인생 고기|진심 미쳤|가격 실화냐|사장님만 모릅니다|캠핑용 고기로|입에서 살살 녹|배터지게|잡내 없이 부드러운|가족 선물각|오늘의 특가 구성)/i;

function cleanText(value?: string) {
  return String(value || "")
    .replace(/[\u{1f000}-\u{1ffff}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function visibleLength(value: string) {
  return [...cleanText(value).replace(/\s+/g, "")].length;
}

function trimToLimit(value: string, maxChars: number) {
  const text = cleanText(value);
  if (!text || visibleLength(text) <= maxChars) return text;

  const phrase = text
    .split(/[,.!?\n]/)
    .map((part) => part.trim())
    .find((part) => part && visibleLength(part) <= maxChars);
  if (phrase) return phrase;

  let output = "";
  for (const char of text) {
    if (visibleLength(output + char) > maxChars) break;
    output += char;
  }
  return output.trim();
}

function normalizeProduct(productInfo?: Partial<ProductInfoForPrompt>): ProductInfoForPrompt {
  return {
    productName: cleanText(productInfo?.productName),
    category: cleanText(productInfo?.category || "default"),
    price: cleanText(productInfo?.price),
    originalPrice: cleanText(productInfo?.originalPrice),
    oldPrice: cleanText(productInfo?.oldPrice),
    advertiserName: cleanText(productInfo?.advertiserName),
    brandName: cleanText(productInfo?.brandName),
    copyGuideId: cleanText(productInfo?.copyGuideId),
    copyGuideContext: productInfo?.copyGuideContext,
    discountInfo: cleanText(productInfo?.discountInfo),
    mainBenefit: cleanText(productInfo?.mainBenefit || productInfo?.extractedDescription),
    targetCustomer: cleanText(productInfo?.targetCustomer),
    landingUrl: cleanText(productInfo?.landingUrl),
    productImagePath: cleanText(productInfo?.productImagePath),
    secondaryProductImagePath: cleanText(productInfo?.secondaryProductImagePath),
    productImagePaths: productInfo?.productImagePaths || [],
    backgroundImagePath: cleanText(productInfo?.backgroundImagePath),
    extractedDescription: cleanText(productInfo?.extractedDescription),
    extractedMainImage: cleanText(productInfo?.extractedMainImage),
    extractedGalleryImages: productInfo?.extractedGalleryImages || [],
    selectedBackgroundSource: cleanText(productInfo?.selectedBackgroundSource),
    backgroundMode: productInfo?.backgroundMode || "none",
    sourceImageCandidates: productInfo?.sourceImageCandidates || [],
    selectedSourceImageId: cleanText(productInfo?.selectedSourceImageId),
    selectedSourceImagePath: cleanText(productInfo?.selectedSourceImagePath),
    productSubCategory: cleanText(productInfo?.productSubCategory),
    detectedProductType: cleanText(productInfo?.detectedProductType),
    targetAgeGroups: productInfo?.targetAgeGroups || [],
    productColors: productInfo?.productColors || [],
    brandColors: productInfo?.brandColors || [],
    ingredients: productInfo?.ingredients || [],
    verifiedBenefits: productInfo?.verifiedBenefits || [],
    packageType: cleanText(productInfo?.packageType),
    imageType: cleanText(productInfo?.imageType),
    modelIncluded: Boolean(productInfo?.modelIncluded),
    productCutoutAvailable: Boolean(productInfo?.productCutoutAvailable),
    productRepresentation: productInfo?.productRepresentation,
    reviewSources: productInfo?.reviewSources || [],
  };
}

function normalizePrice(product: ProductInfoForPrompt, value?: string) {
  const sources = [value, product.price, product.discountInfo, product.mainBenefit].filter(Boolean);
  for (const source of sources) {
    const match = cleanText(source).match(/[\d,]+\s*(?:[^\s\d,]+)?/);
    if (match) return match[0].replace(/\s+/g, "");
  }
  return "";
}

function hasForbidden(value: string) {
  const text = cleanText(value).toLowerCase();
  return forbiddenPhrases.some((phrase) => text.includes(phrase));
}

function hasUnsupportedFact(value: string, product: ProductInfoForPrompt) {
  const text = cleanText(value);
  const facts = cleanText(
    [
      product.productName,
      product.price,
      product.originalPrice,
      product.oldPrice,
      product.discountInfo,
      product.mainBenefit,
      product.extractedDescription,
      ...(product.verifiedBenefits || []),
      ...(product.ingredients || []),
      ...(product.reviewSources || []).map((review) => review.keySentence),
    ].join(" ")
  );
  const allowedNumbers = new Set(
    (facts.match(/\d[\d,.]*/g) || []).map((number) => number.replace(/[,.]/g, ""))
  );
  const generatedNumbers = (text.match(/\d[\d,.]*/g) || []).map((number) =>
    number.replace(/[,.]/g, "")
  );
  if (generatedNumbers.some((number) => !allowedNumbers.has(number))) return true;
  const guardedClaims: Array<[RegExp, RegExp]> = [
    [/무료\s*배송/i, /무료\s*배송/i],
    [
      /오늘만|오늘까지|기간\s*한정|마감\s*임박|품절\s*임박|한정\s*수량/i,
      /오늘만|오늘까지|기간\s*한정|마감\s*임박|품절\s*임박|한정\s*수량/i,
    ],
    [/리뷰\s*\d|후기\s*\d|평점\s*\d/i, /리뷰\s*\d|후기\s*\d|평점\s*\d/i],
  ];
  return guardedClaims.some(([claim, evidence]) => claim.test(text) && !evidence.test(facts));
}

function isKookdaeGuide(copyGuide?: CopyGuideContext | null) {
  return copyGuide?.guideId === "kookdae-hanwoo";
}

function rejectedKookdaeGenericExpressions(copy: Partial<GeneratedAdCopy>) {
  const source = copySlots
    .filter((key) => key !== "price")
    .map((key) => String(copy[key] || ""))
    .join(" ");
  return kookdaeGenericForbiddenPhrases.filter((phrase) => source.includes(phrase));
}

function applyKookdaeGenericReplacements(value: string) {
  return normalizeKookdaePunctuation(cleanText(value));
}

function hasKookdaeForbidden(value: string) {
  const text = cleanText(value);
  return (
    kookdaeGuideExamplePattern.test(text) ||
    kookdaeGenericForbiddenPhrases.some((phrase) => text.includes(phrase))
  );
}

function isBadHeadline(
  value: string,
  copyGuide?: CopyGuideContext | null,
  product?: ProductInfoForPrompt
) {
  const text = cleanText(value);
  if (!text || text.length < 4) return true;
  if (/^[\d,]+[^\s\d,]*$/.test(text)) return true;
  if (hasForbidden(text)) return true;
  if (isKookdaeGuide(copyGuide) && hasKookdaeForbidden(text)) return true;
  if (
    product &&
    (hasUnsupportedFact(text, product) || !isCopyGroundedInProductUsp(text, product))
  ) {
    return true;
  }
  return false;
}

function isObjectiveHeadlineAligned(
  value: string,
  brief: AdBrief | undefined,
  product: ProductInfoForPrompt
) {
  if (!brief) return true;
  const text = cleanText(value);
  if (brief.adObjective === "signup") {
    return /(처음|차이|왜|기준|필요|알아|무엇|어떤|비교)/.test(text);
  }
  if (brief.adObjective === "awareness") {
    const brand = cleanText(product.brandName || product.advertiserName);
    return Boolean((brand && text.includes(brand)) || /(브랜드|기억|대표|이름|감각)/.test(text));
  }
  if (brief.adObjective === "retargeting") {
    return /(다시|망설|봤|보던|재구매|혜택|놓친|비교)/.test(text);
  }
  return /(구매|조건|혜택|구성|선택|결정|고를|이유|차이|가격|지금|근거|필요|순간|왜)/.test(text);
}

function inferHookType(reference?: AdImageLabel) {
  return cleanText(reference?.finalLabel?.hookType || "performance-hook");
}

function inferAppealPoint(reference?: AdImageLabel) {
  return cleanText(reference?.finalLabel?.appealPoint || "price-value");
}

function safeHeadlineFallback(product: ProductInfoForPrompt, reference?: AdImageLabel) {
  const uspFallback = buildUspFirstFallbackCopy(product);
  const price = normalizePrice(product);
  const source = cleanText(
    reference?.finalLabel?.firstLineHook ||
      reference?.finalLabel?.reusableCopyPattern ||
      product.mainBenefit ||
      product.productName ||
      product.category
  );
  if (price && uspFallback.headline) return trimToLimit(`${uspFallback.headline}, ${price}`, 34);
  return trimToLimit(
    uspFallback.headline || source || product.productName || "상품의 핵심 차이",
    34
  );
}

function bodyFallback(
  product: ProductInfoForPrompt,
  reference?: AdImageLabel,
  copyGuide?: CopyGuideContext | null
) {
  if (isKookdaeGuide(copyGuide)) {
    return buildUspFirstFallbackCopy(product).bodyCopy;
  }

  const source = cleanText(
    analyzeProductUsp(product).uspSignals[1] ||
      product.mainBenefit ||
      reference?.finalLabel?.consumerInsight ||
      product.productName ||
      product.category
  );
  return trimToLimit(source ? `${source}을 확인해보세요.` : "상품의 차이를 확인해보세요.", 36);
}

function normalizeBody(value: string, fallback: string, copyGuide?: CopyGuideContext | null) {
  const source = isKookdaeGuide(copyGuide) ? applyKookdaeGenericReplacements(value) : value;
  const normalized = trimToLimit(cleanText(source || fallback), 42);
  if (isKookdaeGuide(copyGuide) && hasKookdaeForbidden(normalized))
    return trimToLimit(fallback, 42);
  return trimToLimit(normalized, 36);
}

function normalizeCta(
  value?: string,
  copyGuide?: CopyGuideContext | null,
  brief?: AdBrief,
  hasConfirmedOffer = false
) {
  const text = isKookdaeGuide(copyGuide)
    ? applyKookdaeGenericReplacements(value || "")
    : cleanText(value);
  if (
    text &&
    !hasForbidden(text) &&
    !hasKookdaeForbidden(text) &&
    (!brief || isObjectiveCtaAligned(text, brief.adObjective))
  ) {
    return trimToLimit(text, 10);
  }
  if (brief) return trimToLimit(objectiveCta(brief.adObjective, hasConfirmedOffer), 10);
  if (isKookdaeGuide(copyGuide)) return "상품 정보 보기";
  return "상품 보기";
}

function referencePatternUsage(reference?: AdImageLabel): GeneratedAdCopy["referencePatternUsage"] {
  const finalLabel = reference?.finalLabel;
  return {
    usedReferenceIds: reference?.imageId ? [reference.imageId] : [],
    appliedPatterns: [
      finalLabel?.reusableCopyPattern,
      finalLabel?.firstLineHook,
      finalLabel?.copyStructure,
      finalLabel?.toneOfVoice || finalLabel?.copyNuance,
      finalLabel?.purchaseTrigger,
    ].filter(Boolean) as string[],
    avoidedDirectCopy: true,
    usedHookPattern: finalLabel?.firstLineHook || finalLabel?.hookType || "",
    usedCopyStructure: finalLabel?.copyStructure || "",
    usedToneOfVoice: finalLabel?.toneOfVoice || finalLabel?.copyNuance || "",
    usedConsumerInsight: finalLabel?.consumerInsight || "",
    usedPurchaseTrigger: finalLabel?.purchaseTrigger || "",
    usedReusablePattern: finalLabel?.reusableCopyPattern || "",
    usedVisualCopyRelation: finalLabel?.visualCopyRelation || "",
  };
}

function guideHeadings(guide: CopyGuideContext) {
  return Array.from(guide.content.matchAll(/^#{2,3}\s+(.+)$/gm)).map((match) =>
    cleanText(match[1])
  );
}

function firstHeadingMatching(headings: string[], pattern: RegExp) {
  return headings.find((heading) => pattern.test(heading));
}

function guideSectionsForUsage(guide: CopyGuideContext) {
  const headings = guideHeadings(guide);

  if (guide.guideId !== "kookdae-hanwoo") {
    return headings.slice(0, 5);
  }

  const picked = [
    firstHeadingMatching(headings, /^1\./),
    firstHeadingMatching(headings, /^1-A\./),
    firstHeadingMatching(headings, /^1-B\./),
    firstHeadingMatching(headings, /^1-C\./),
    firstHeadingMatching(headings, /^1-D\./),
    firstHeadingMatching(headings, /^2\./),
    firstHeadingMatching(headings, /^3\./),
    firstHeadingMatching(headings, /^6\./),
  ].filter(Boolean) as string[];

  return Array.from(new Set(picked)).slice(0, 8);
}

function toneFromSection(section: string) {
  return cleanText(section.replace(/^\d+(?:-[A-Z])?\.\s*/, ""));
}

function copyGuideUsage(guide?: CopyGuideContext | null): GeneratedAdCopy["copyGuideUsage"] {
  if (!guide) return undefined;

  const sections = guideSectionsForUsage(guide);
  const tones = sections.map(toneFromSection).filter(Boolean).slice(0, 6);

  return {
    guideId: guide.guideId,
    brandName: guide.brandName,
    usedSections: sections.length ? sections : ["Brand Copy Guide"],
    toneApplied: tones.length ? tones : ["brand tone", "price appeal", "purchase reason"],
  };
}
function variantFrom(
  copy: Partial<GeneratedAdCopyVariant> | undefined,
  fallback: GeneratedAdCopyVariant,
  limits: Record<keyof GeneratedAdCopyVariant, number>,
  copyGuide?: CopyGuideContext | null,
  product?: ProductInfoForPrompt
): GeneratedAdCopyVariant {
  const sanitize = (value: string) =>
    isKookdaeGuide(copyGuide) ? applyKookdaeGenericReplacements(value) : value;
  const safe = (incoming: string | undefined, fallback: string) => {
    const value = sanitize(incoming || fallback);
    return product && (hasForbidden(value) || hasUnsupportedFact(value, product))
      ? sanitize(fallback)
      : value;
  };

  return {
    headline: trimToLimit(safe(copy?.headline, fallback.headline), limits.headline),
    bodyCopy: trimToLimit(safe(copy?.bodyCopy, fallback.bodyCopy), limits.bodyCopy),
    highlightCopy: trimToLimit(
      safe(copy?.highlightCopy, fallback.highlightCopy),
      limits.highlightCopy
    ),
    bottomBarCopy: trimToLimit(
      safe(copy?.bottomBarCopy, fallback.bottomBarCopy),
      limits.bottomBarCopy
    ),
    cta: trimToLimit(safe(copy?.cta, fallback.cta), limits.cta),
    price: trimToLimit(
      product && hasUnsupportedFact(copy?.price || "", product)
        ? fallback.price || ""
        : copy?.price || fallback.price || "",
      limits.price
    ),
  };
}

function alignVariantToObjective(
  incoming: Partial<GeneratedAdCopyVariant> | undefined,
  fallback: GeneratedAdCopyVariant,
  brief: AdBrief | undefined,
  product: ProductInfoForPrompt
) {
  if (!incoming || !brief) return incoming;
  const headline = incoming.headline || "";
  return {
    ...incoming,
    headline:
      isObjectiveHeadlineAligned(headline, brief, product) &&
      isCopyGroundedInProductUsp(headline, product)
        ? incoming.headline
        : fallback.headline,
    cta: isObjectiveCtaAligned(incoming.cta || "", brief.adObjective) ? incoming.cta : fallback.cta,
  };
}

function kookdaeVariantSlotValue(
  slot: keyof GeneratedAdCopyVariant,
  value: string | undefined,
  fallback: string,
  product: ProductInfoForPrompt
) {
  const raw = cleanText(value);
  if (
    !raw ||
    hasForbidden(raw) ||
    hasKookdaeForbidden(raw) ||
    (slot === "headline" && !isCopyGroundedInProductUsp(raw, product))
  ) {
    return fallback;
  }

  return normalizeKookdaePunctuation(applyKookdaeGenericReplacements(raw), {
    cta: slot === "cta",
  });
}

function mergeKookdaeVariant(
  incoming: Partial<GeneratedAdCopyVariant> | undefined,
  fallback: GeneratedAdCopyVariant,
  product: ProductInfoForPrompt
): GeneratedAdCopyVariant {
  return {
    headline: kookdaeVariantSlotValue("headline", incoming?.headline, fallback.headline, product),
    bodyCopy: kookdaeVariantSlotValue("bodyCopy", incoming?.bodyCopy, fallback.bodyCopy, product),
    highlightCopy: kookdaeVariantSlotValue(
      "highlightCopy",
      incoming?.highlightCopy,
      fallback.highlightCopy,
      product
    ),
    bottomBarCopy: kookdaeVariantSlotValue(
      "bottomBarCopy",
      incoming?.bottomBarCopy,
      fallback.bottomBarCopy,
      product
    ),
    cta: kookdaeVariantSlotValue("cta", incoming?.cta, fallback.cta, product),
    price: cleanText(incoming?.price || fallback.price || ""),
  };
}

function buildCopyVariants(
  copy: Partial<GeneratedAdCopy>,
  product: ProductInfoForPrompt,
  reference?: AdImageLabel,
  copyGuide?: CopyGuideContext | null,
  adBrief?: AdBrief,
  creativeStrategy?: CreativeStrategy | null
): GeneratedAdCopy["copyVariants"] {
  if (isKookdaeGuide(copyGuide)) {
    const fallbackVariants = adBrief
      ? buildTargetedCopyVariants({ product, brief: adBrief, strategy: creativeStrategy })
      : buildUspFirstFallbackCopy(product).variants;
    const preferred = {
      short: mergeKookdaeVariant(
        alignVariantToObjective(copy.copyVariants?.short, fallbackVariants.short, adBrief, product),
        fallbackVariants.short,
        product
      ),
      medium: mergeKookdaeVariant(
        alignVariantToObjective(
          copy.copyVariants?.medium,
          fallbackVariants.medium,
          adBrief,
          product
        ),
        fallbackVariants.medium,
        product
      ),
      long: mergeKookdaeVariant(
        alignVariantToObjective(copy.copyVariants?.long, fallbackVariants.long, adBrief, product),
        fallbackVariants.long,
        product
      ),
    };

    return {
      short: variantFrom(
        preferred.short,
        fallbackVariants.short,
        {
          headline: 14,
          bodyCopy: 18,
          highlightCopy: 12,
          bottomBarCopy: 18,
          cta: 6,
          price: 12,
        },
        copyGuide,
        product
      ),
      medium: variantFrom(
        preferred.medium,
        fallbackVariants.medium,
        {
          headline: 22,
          bodyCopy: 28,
          highlightCopy: 18,
          bottomBarCopy: 24,
          cta: 8,
          price: 12,
        },
        copyGuide,
        product
      ),
      long: variantFrom(
        preferred.long,
        fallbackVariants.long,
        {
          headline: 34,
          bodyCopy: 42,
          highlightCopy: 28,
          bottomBarCopy: 36,
          cta: 10,
          price: 12,
        },
        copyGuide,
        product
      ),
    };
  }

  const fallback: GeneratedAdCopyVariant = {
    headline: copy.headline || safeHeadlineFallback(product, reference),
    bodyCopy: copy.bodyCopy || bodyFallback(product, reference, copyGuide),
    highlightCopy: copy.highlightCopy || product.discountInfo || product.mainBenefit || "deal",
    bottomBarCopy:
      copy.bottomBarCopy ||
      reference?.finalLabel?.purchaseTrigger ||
      reference?.finalLabel?.whyItWorks ||
      "check bundle",
    cta: copy.cta || "상품 보기",
    price: normalizePrice(product, copy.price),
  };
  const targetedFallbacks = adBrief
    ? buildTargetedCopyVariants({ product, brief: adBrief, strategy: creativeStrategy })
    : { short: fallback, medium: fallback, long: fallback };

  return {
    short: variantFrom(
      alignVariantToObjective(copy.copyVariants?.short, targetedFallbacks.short, adBrief, product),
      targetedFallbacks.short,
      {
        headline: 14,
        bodyCopy: 18,
        highlightCopy: 12,
        bottomBarCopy: 18,
        cta: 6,
        price: 12,
      },
      copyGuide,
      product
    ),
    medium: variantFrom(
      alignVariantToObjective(
        copy.copyVariants?.medium,
        targetedFallbacks.medium,
        adBrief,
        product
      ),
      targetedFallbacks.medium,
      {
        headline: 22,
        bodyCopy: 28,
        highlightCopy: 18,
        bottomBarCopy: 24,
        cta: 8,
        price: 12,
      },
      copyGuide,
      product
    ),
    long: variantFrom(
      alignVariantToObjective(copy.copyVariants?.long, targetedFallbacks.long, adBrief, product),
      targetedFallbacks.long,
      {
        headline: 34,
        bodyCopy: 42,
        highlightCopy: 28,
        bottomBarCopy: 36,
        cta: 10,
        price: 12,
      },
      copyGuide,
      product
    ),
  };
}

function removeForbidden(
  copy: GeneratedAdCopy,
  product: ProductInfoForPrompt,
  reference?: AdImageLabel,
  copyGuide?: CopyGuideContext | null
): GeneratedAdCopy {
  const kookdaeFallback = buildUspFirstFallbackCopy(product);
  const replacements: Partial<Record<keyof GeneratedAdCopyVariant, string>> = isKookdaeGuide(
    copyGuide
  )
    ? kookdaeFallback
    : {
        headline: kookdaeFallback.headline,
        bodyCopy: kookdaeFallback.bodyCopy,
        highlightCopy: kookdaeFallback.highlightCopy,
        bottomBarCopy: kookdaeFallback.bottomBarCopy,
        cta: kookdaeFallback.cta,
      };

  const next = { ...copy };
  copySlots.forEach((key) => {
    if (
      key !== "price" &&
      (hasForbidden(String(next[key] || "")) ||
        hasUnsupportedFact(String(next[key] || ""), product) ||
        (isKookdaeGuide(copyGuide) && hasKookdaeForbidden(String(next[key] || ""))))
    ) {
      next[key] = replacements[key] || "";
    } else if (key !== "price" && isKookdaeGuide(copyGuide)) {
      next[key] = applyKookdaeGenericReplacements(String(next[key] || ""));
    }
  });
  return next;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripUserProhibitedClaims(value: string, prohibitedClaims: string[]) {
  let result = value;
  for (const claim of prohibitedClaims.map(cleanText).filter(Boolean)) {
    result = result.replace(new RegExp(escapeRegExp(claim), "gi"), "");
  }
  return cleanText(result.replace(/\s+([,.!?])/g, "$1").replace(/([,.!?]){2,}/g, "$1"));
}

function applyBriefConstraints(
  copy: GeneratedAdCopy,
  brief: AdBrief,
  product: ProductInfoForPrompt,
  labels: AdImageLabel[],
  copyGuide?: CopyGuideContext | null
) {
  const prohibitedClaims = brief.prohibitedClaims || [];
  const normalizedProhibited = new Set(
    prohibitedClaims.map((claim) => cleanText(claim).toLowerCase())
  );
  const mandatoryInfo = (brief.mandatoryInfo || [])
    .map(cleanText)
    .filter((item) => item && !normalizedProhibited.has(item.toLowerCase()));
  const mandatoryText = Array.from(new Set(mandatoryInfo)).join(" · ");
  const reference = labels[0];

  const constrainVariant = <Variant extends GeneratedAdCopyVariant>(variant: Variant): Variant => {
    const next = { ...variant };
    copySlots.forEach((key) => {
      if (key !== "price") {
        next[key] = stripUserProhibitedClaims(String(next[key] || ""), prohibitedClaims);
      }
    });
    if (!next.headline) next.headline = safeHeadlineFallback(product, reference);
    if (!next.bodyCopy) next.bodyCopy = bodyFallback(product, reference, copyGuide);
    if (!next.cta) {
      next.cta = normalizeCta(
        undefined,
        copyGuide,
        brief,
        Boolean(product.discountInfo || product.price)
      );
    }

    const currentText = copySlots.map((key) => String(next[key] || "")).join(" ");
    const hasAllMandatory = mandatoryInfo.every((item) => currentText.includes(item));
    if (mandatoryText && !hasAllMandatory) {
      next.highlightCopy = mandatoryText;
    }
    return next;
  };

  const constrained = constrainVariant(copy);
  constrained.copyVariants = copy.copyVariants
    ? {
        short: copy.copyVariants.short ? constrainVariant(copy.copyVariants.short) : undefined,
        medium: copy.copyVariants.medium ? constrainVariant(copy.copyVariants.medium) : undefined,
        long: copy.copyVariants.long ? constrainVariant(copy.copyVariants.long) : undefined,
      }
    : undefined;
  constrained.messageHierarchy = {
    primaryMessage: constrained.headline,
    secondaryMessage: constrained.bodyCopy,
    proofMessage: constrained.highlightCopy,
    offerMessage: constrained.bottomBarCopy,
    actionMessage: constrained.cta,
  };
  return constrained;
}

function normalizeGeneratedCopy(
  value: Partial<GeneratedAdCopy>,
  product: ProductInfoForPrompt,
  labels: AdImageLabel[],
  copyGuide?: CopyGuideContext | null,
  context?: { adBrief?: AdBrief; creativeStrategy?: CreativeStrategy | null }
): GeneratedAdCopy {
  const reference = labels[0];
  const price = normalizePrice(product, value.price);
  const kookdaeFallback = buildUspFirstFallbackCopy(product);
  const productUsp = analyzeProductUsp(product);
  const objectiveFallback = context?.adBrief
    ? buildTargetedCopyVariants({
        product,
        brief: context.adBrief,
        strategy: context.creativeStrategy,
      }).medium
    : undefined;
  const rejectedGenericExpressions = isKookdaeGuide(copyGuide)
    ? rejectedKookdaeGenericExpressions(value)
    : [];
  const headlineSource = isKookdaeGuide(copyGuide)
    ? applyKookdaeGenericReplacements(value.headline || "")
    : value.headline || "";
  const headlineNeedsRepair =
    isBadHeadline(headlineSource, copyGuide, product) ||
    !isObjectiveHeadlineAligned(headlineSource, context?.adBrief, product);
  const headline = headlineNeedsRepair
    ? objectiveFallback?.headline || safeHeadlineFallback(product, reference)
    : cleanText(headlineSource);
  const selectedKookdaePattern = isKookdaeGuide(copyGuide)
    ? `USP 우선: ${productUsp.primaryUsp}`
    : "";
  const kookdaeVariantPatternPlan = isKookdaeGuide(copyGuide)
    ? (["short", "medium", "long"] as const).map((variant, index) => ({
        variant,
        patternGroup: "product-usp",
        sourcePattern: productUsp.uspSignals[index] || productUsp.primaryUsp || product.productName,
        tone: "상세페이지 USP 기반 후킹",
      }))
    : undefined;
  const baseCopyGuideUsage = copyGuideUsage(copyGuide);
  const usedReferenceIds = Array.from(
    new Set([
      ...labels.map((label) => label.imageId),
      ...(value.referencePatternUsage?.usedReferenceIds || []),
    ])
  );
  const normalizedBodyCopy = normalizeBody(
    value.bodyCopy || "",
    bodyFallback(product, reference, copyGuide),
    copyGuide
  );
  const normalizedHighlightCopy = trimToLimit(
    cleanText(
      isKookdaeGuide(copyGuide)
        ? applyKookdaeGenericReplacements(
            value.highlightCopy ||
              product.discountInfo ||
              product.mainBenefit ||
              kookdaeFallback.highlightCopy
          )
        : value.highlightCopy ||
            product.discountInfo ||
            productUsp.proofSignals[0] ||
            product.mainBenefit ||
            kookdaeFallback.highlightCopy
    ),
    28
  );
  const normalizedBottomBarCopy = trimToLimit(
    cleanText(
      isKookdaeGuide(copyGuide)
        ? applyKookdaeGenericReplacements(value.bottomBarCopy || kookdaeFallback.bottomBarCopy)
        : value.bottomBarCopy ||
            reference?.finalLabel?.purchaseTrigger ||
            reference?.finalLabel?.whyItWorks ||
            productUsp.situationSignals[0] ||
            productUsp.featureSignals[1] ||
            kookdaeFallback.bottomBarCopy
    ),
    36
  );
  const normalizedCta = normalizeCta(
    value.cta,
    copyGuide,
    context?.adBrief,
    Boolean(product.discountInfo || product.price)
  );

  const normalized: GeneratedAdCopy = {
    headline,
    bodyCopy: normalizedBodyCopy,
    highlightCopy: normalizedHighlightCopy,
    bottomBarCopy: normalizedBottomBarCopy,
    cta: normalizedCta,
    price,
    hookType: cleanText(value.hookType || inferHookType(reference)),
    appealPoint: cleanText(value.appealPoint || inferAppealPoint(reference)),
    whyThisWorks: cleanText(
      value.whyThisWorks ||
        (isKookdaeGuide(copyGuide)
          ? "상세페이지에서 확인한 USP를 중심으로 후킹을 만들고 국대한우 가이드는 말투에만 반영했습니다."
          : "Combined reference copy pattern with product value proof.")
    ),
    messageHierarchy: {
      primaryMessage: headline,
      secondaryMessage: normalizedBodyCopy,
      proofMessage: normalizedHighlightCopy,
      offerMessage: normalizedBottomBarCopy,
      actionMessage: normalizedCta,
    },
    reasoning: {
      ...(value.reasoning || {}),
      headlineQualityCheck: headlineNeedsRepair ? "repaired" : "passed",
      selectedKookdaePattern:
        value.reasoning?.selectedKookdaePattern || selectedKookdaePattern || undefined,
      rejectedGenericExpressions:
        value.reasoning?.rejectedGenericExpressions || rejectedGenericExpressions,
      productFactsUsed:
        value.reasoning?.productFactsUsed ||
        (isKookdaeGuide(copyGuide)
          ? [product.productName, ...productUsp.uspSignals, ...productUsp.offerSignals].filter(
              Boolean
            )
          : undefined),
    },
    templateFit: {
      templateId: undefined,
      templateName: undefined,
      usedCopyLimits: copyLimitCharSummary(undefined),
      fitNotes: "Generated as masterCopy. Template fitting is handled by templateCopyPlanner.",
    },
    referencePatternUsage: {
      ...referencePatternUsage(reference),
      ...(value.referencePatternUsage || {}),
      usedReferenceIds,
      avoidedDirectCopy: true,
    },
    copyGuideUsage: value.copyGuideUsage
      ? {
          ...value.copyGuideUsage,
          selectedPatterns:
            kookdaeVariantPatternPlan ||
            value.copyGuideUsage.selectedPatterns ||
            baseCopyGuideUsage?.selectedPatterns,
        }
      : baseCopyGuideUsage
        ? {
            ...baseCopyGuideUsage,
            selectedPatterns: kookdaeVariantPatternPlan || baseCopyGuideUsage.selectedPatterns,
          }
        : undefined,
    copyValidation: {
      bodyCopy: {
        ok: true,
        reasons: [],
        original: value.bodyCopy || "",
        normalized: normalizeBody(
          value.bodyCopy || "",
          bodyFallback(product, reference, copyGuide),
          copyGuide
        ),
        finalLength: visibleLength(
          normalizeBody(
            value.bodyCopy || "",
            bodyFallback(product, reference, copyGuide),
            copyGuide
          )
        ),
      },
    },
    copyVariants: undefined,
  };

  const cleaned = removeForbidden(normalized, product, reference, copyGuide);
  cleaned.copyVariants = buildCopyVariants(
    { ...cleaned, copyVariants: value.copyVariants },
    product,
    reference,
    copyGuide,
    context?.adBrief,
    context?.creativeStrategy
  );
  return cleaned;
}

function parseJsonObject(text: string): Partial<GeneratedAdCopy> {
  try {
    return JSON.parse(text) as Partial<GeneratedAdCopy>;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("OpenAI copy response did not include JSON");
    return JSON.parse(match[0]) as Partial<GeneratedAdCopy>;
  }
}

function getResponseText(data: unknown) {
  const response = data as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
  };
  if (response.output_text) return response.output_text;
  return (
    response.output?.flatMap((item) => item.content || []).find((item) => item.text)?.text || ""
  );
}

function mockCopy(
  product: ProductInfoForPrompt,
  labels: AdImageLabel[],
  copyGuide?: CopyGuideContext | null,
  adBrief?: AdBrief,
  creativeStrategy?: CreativeStrategy | null
) {
  const reference = labels[0];
  const resolvedBrief = adBrief || productInfoToAdBrief(product, defaultAdBrief);
  const objectiveFallback = buildTargetedCopyVariants({
    product,
    brief: resolvedBrief,
    strategy: creativeStrategy,
  }).medium;
  const mockHeadline = cleanText(creativeStrategy?.mainCopy || objectiveFallback.headline);
  const strategyEvidence = cleanText(
    creativeStrategy?.keyAppeal || creativeStrategy?.appeal || objectiveFallback.bodyCopy
  ).replace(/^[^:]{1,18}:\s*/, "");
  const mockBody = creativeStrategy
    ? {
        "problem-solution": `고민의 답이 되는 ${strategyEvidence}`,
        "feature-usp": `${strategyEvidence}, 핵심 차이를 확인하세요`,
        "price-benefit": `${strategyEvidence}, 구매 조건을 확인하세요`,
        "social-proof": `${strategyEvidence}, 선택 근거로 확인하세요`,
        curiosity: `${strategyEvidence}, 왜 다른지 비교해보세요`,
        lifestyle: `${strategyEvidence}, 필요한 순간에 선택하세요`,
        "season-event": `${strategyEvidence}, 지금 필요한 이유를 확인하세요`,
        sensory: `${strategyEvidence}, 사용하는 순간의 차이`,
        gift: `${strategyEvidence}, 선물할 이유를 확인하세요`,
        "brand-story": `${strategyEvidence}, 브랜드의 기준을 확인하세요`,
      }[creativeStrategy.hookType]
    : objectiveFallback.bodyCopy;
  const mockHighlight = creativeStrategy
    ? {
        "problem-solution": (creativeStrategy.expectedCustomerProblem || strategyEvidence)
          .replace(/어려움$/, "어려운 순간")
          .replace(/필요함$/, "필요한 순간"),
        "feature-usp": strategyEvidence,
        "price-benefit": product.discountInfo || product.price || strategyEvidence,
        "social-proof": creativeStrategy.inferredEvidence[0] || strategyEvidence,
        curiosity: `직접 비교할 차이: ${strategyEvidence}`,
        lifestyle: `필요한 순간의 선택: ${strategyEvidence}`,
        "season-event": strategyEvidence,
        sensory: strategyEvidence,
        gift: strategyEvidence,
        "brand-story": strategyEvidence,
      }[creativeStrategy.hookType]
    : objectiveFallback.highlightCopy;
  return normalizeGeneratedCopy(
    {
      headline: mockHeadline,
      bodyCopy: mockBody,
      highlightCopy: mockHighlight,
      bottomBarCopy: creativeStrategy?.audience || objectiveFallback.bottomBarCopy,
      cta: objectiveFallback.cta,
      price: normalizePrice(product),
      hookType: inferHookType(reference),
      appealPoint: inferAppealPoint(reference),
      whyThisWorks: "선택한 광고 목표·강도·전략과 상품 사실을 반영한 규칙 기반 masterCopy입니다.",
      referencePatternUsage: referencePatternUsage(reference),
      copyGuideUsage: copyGuideUsage(copyGuide),
    },
    product,
    labels,
    copyGuide,
    { adBrief: resolvedBrief, creativeStrategy }
  );
}

async function generateWithOpenAI(
  product: ProductInfoForPrompt,
  labels: AdImageLabel[],
  template: TemplateInfo,
  copyGuide?: CopyGuideContext | null,
  context?: Pick<Body, "adBrief" | "creativeStrategy" | "referenceUsages" | "referenceLabels">
) {
  const prompt = buildGenerateCopyPrompt({
    product,
    reference: labels[0],
    referenceContext: context?.referenceLabels,
    referenceUsages: context?.referenceUsages,
    template,
    copyGuide,
    adBrief: context?.adBrief,
    creativeStrategy: context?.creativeStrategy,
  });

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_TEXT_MODEL || "gpt-4o-mini",
      input: prompt,
      text: { format: { type: "json_object" } },
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI copy generation failed: HTTP ${response.status}`);
  }

  const parsed = parseJsonObject(getResponseText(await response.json()));
  return normalizeGeneratedCopy(parsed, product, labels, copyGuide, {
    adBrief: context?.adBrief,
    creativeStrategy: context?.creativeStrategy,
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const product = normalizeProduct(body.productInfo);
    const advertiserName =
      body.advertiserName || body.brandName || product.advertiserName || product.brandName || "";
    const brandName = body.brandName || product.brandName || advertiserName;
    const copyGuide = await loadCopyGuideForProduct({
      advertiserName,
      brandName,
      copyGuideId: body.copyGuideId || product.copyGuideId,
      productUrl: body.productUrl || product.landingUrl,
      category: body.category || product.category,
      productName: product.productName,
    });

    product.advertiserName = advertiserName;
    product.brandName = brandName || copyGuide?.brandName || "";
    product.copyGuideId = copyGuide?.guideId || body.copyGuideId || product.copyGuideId || "";
    product.copyGuideContext = copyGuide || undefined;

    const storedLabels = await readAdImageLabels();
    const labelsById = new Map(storedLabels.map((label) => [label.imageId, label]));
    for (const legacyLabel of body.referenceLabels || []) {
      if (!labelsById.has(legacyLabel.imageId)) labelsById.set(legacyLabel.imageId, legacyLabel);
    }
    const allLabels = Array.from(labelsById.values());
    const adBrief = productInfoToAdBrief(product, body.adBrief || defaultAdBrief);
    const referenceMatches = matchReferences({
      product,
      brief: adBrief,
      labels: allLabels,
      limit: 5,
    });
    const selectedLabels = labelsForReferenceMatches(allLabels, referenceMatches);
    const referenceUsages = normalizeReferenceUsages(selectedLabels, []);
    const template: TemplateInfo = {
      templateId: body.templateId,
      templateName: body.templateName,
    };
    const requestedStrategies = (body.creativeStrategies || [])
      .filter((strategy): strategy is CreativeStrategy => Boolean(strategy?.id))
      .slice(0, 6);
    const copyStrategies = requestedStrategies.length
      ? requestedStrategies
      : body.creativeStrategy
        ? [body.creativeStrategy]
        : [];
    const primaryStrategy = copyStrategies[0] || body.creativeStrategy;
    const primaryGeneratedCopy = process.env.OPENAI_API_KEY
      ? await generateWithOpenAI(product, selectedLabels, template, copyGuide, {
          ...body,
          creativeStrategy: primaryStrategy,
          adBrief,
          referenceLabels: selectedLabels,
          referenceUsages,
        })
      : mockCopy(product, selectedLabels, copyGuide, adBrief, primaryStrategy);
    const generatedCopies = copyStrategies.length
      ? copyStrategies.map((strategy, index) =>
          index === 0
            ? primaryGeneratedCopy
            : mockCopy(product, selectedLabels, copyGuide, adBrief, strategy)
        )
      : [primaryGeneratedCopy];
    const copies = generatedCopies.map((generatedCopy) =>
      applyBriefConstraints(generatedCopy, adBrief, product, selectedLabels, copyGuide)
    );
    const copy = copies[0];

    return NextResponse.json({
      ok: true,
      copy,
      copies,
      referenceLabels: selectedLabels,
      referenceMatches,
      copyGuide,
      isMock: !process.env.OPENAI_API_KEY,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Copy generation failed.",
      },
      { status: 500 }
    );
  }
}
