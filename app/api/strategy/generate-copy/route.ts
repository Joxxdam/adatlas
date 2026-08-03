import { NextResponse } from "next/server";

import { buildGenerateCopyPrompt } from "../../../lib/mvp/copyPromptBuilder";
import { loadCopyGuideForProduct } from "../../../lib/mvp/copyGuideLoader";
import {
  buildKookdaeCopyVariantsFromPatterns,
  chooseKookdaePatternNames,
  kookdaeFallbackCopy,
  kookdaeGenericForbiddenPhrases,
  kookdaeGenericReplacements,
  normalizeKookdaePunctuation,
  kookdaeProductFacts,
} from "../../../lib/mvp/kookdaeCopyPatterns";
import { readAdImageLabels } from "../../../lib/mvp/labelStore";
import { copyLimitCharSummary } from "../../../lib/mvp/templateCopyFitter";
import type {
  AdImageLabel,
  CopyGuideContext,
  GeneratedAdCopy,
  GeneratedAdCopyVariant,
  ProductInfoForPrompt,
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
    if (/\s/.test(char)) continue;
    if (visibleLength(output + char) > maxChars) break;
    output += char;
  }
  return output;
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
    mainBenefit: cleanText(productInfo?.mainBenefit),
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
  };
}

function tokenize(value: string) {
  return new Set(
    cleanText(value)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 2)
  );
}

function labelHasFinalData(label?: AdImageLabel) {
  return Boolean(label?.finalLabel && Object.values(label.finalLabel).some(Boolean));
}

function scoreLabel(product: ProductInfoForPrompt, label: AdImageLabel) {
  const productTokens = tokenize(
    [
      product.productName,
      product.category,
      product.mainBenefit,
      product.discountInfo,
      product.targetCustomer,
    ].join(" ")
  );
  const labelTokens = tokenize(
    [
      label.category,
      label.brandName,
      label.finalLabel?.category,
      label.finalLabel?.hookType,
      label.finalLabel?.appealPoint,
      label.finalLabel?.copyNuance,
      label.finalLabel?.consumerInsight,
      label.finalLabel?.purchaseTrigger,
    ].join(" ")
  );

  let score = 0;
  productTokens.forEach((token) => {
    if (labelTokens.has(token)) score += 2;
  });
  if (
    product.category &&
    cleanText(label.finalLabel?.category || label.category) === product.category
  ) {
    score += 10;
  }
  return score;
}

function selectSingleReferenceLabel(
  product: ProductInfoForPrompt,
  allLabels: AdImageLabel[],
  requestedLabels: AdImageLabel[] = []
) {
  const requestedValid = requestedLabels.filter(labelHasFinalData);
  if (requestedValid.length) return [requestedValid[0]];

  const autoSelected = [...allLabels]
    .filter(labelHasFinalData)
    .sort((a, b) => scoreLabel(product, b) - scoreLabel(product, a));

  return autoSelected[0] ? [autoSelected[0]] : [];
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
  let text = normalizeKookdaePunctuation(cleanText(value));
  for (const [pattern, replacement] of kookdaeGenericReplacements) {
    text = text.replace(pattern, replacement);
  }
  return normalizeKookdaePunctuation(text);
}

function hasKookdaeForbidden(value: string) {
  return kookdaeGenericForbiddenPhrases.some((phrase) => cleanText(value).includes(phrase));
}

function isBadHeadline(value: string, copyGuide?: CopyGuideContext | null) {
  const text = cleanText(value);
  if (!text || text.length < 4) return true;
  if (/^[\d,]+[^\s\d,]*$/.test(text)) return true;
  if (hasForbidden(text)) return true;
  if (isKookdaeGuide(copyGuide) && hasKookdaeForbidden(text)) return true;
  return false;
}

function inferHookType(reference?: AdImageLabel) {
  return cleanText(reference?.finalLabel?.hookType || "performance-hook");
}

function inferAppealPoint(reference?: AdImageLabel) {
  return cleanText(reference?.finalLabel?.appealPoint || "price-value");
}

function safeHeadlineFallback(
  product: ProductInfoForPrompt,
  reference?: AdImageLabel,
  copyGuide?: CopyGuideContext | null
) {
  if (isKookdaeGuide(copyGuide)) {
    return kookdaeFallbackCopy(product, reference).headline;
  }

  const price = normalizePrice(product);
  const source = cleanText(
    reference?.finalLabel?.firstLineHook ||
      reference?.finalLabel?.reusableCopyPattern ||
      product.mainBenefit ||
      product.productName ||
      product.category
  );
  if (price) return trimToLimit(`${price} value proof`, 34);
  return trimToLimit(source ? `${source} proof` : "value proof deal", 34);
}

function bodyFallback(
  product: ProductInfoForPrompt,
  reference?: AdImageLabel,
  copyGuide?: CopyGuideContext | null
) {
  if (isKookdaeGuide(copyGuide)) {
    return kookdaeFallbackCopy(product, reference).bodyCopy;
  }

  const source = cleanText(
    product.mainBenefit ||
      reference?.finalLabel?.consumerInsight ||
      product.productName ||
      product.category
  );
  return trimToLimit(source ? `${source} ready.` : "Prepared for easier choice.", 36);
}

function normalizeBody(value: string, fallback: string, copyGuide?: CopyGuideContext | null) {
  const source = isKookdaeGuide(copyGuide) ? applyKookdaeGenericReplacements(value) : value;
  const normalized = trimToLimit(cleanText(source || fallback), 42);
  if (isKookdaeGuide(copyGuide) && hasKookdaeForbidden(normalized)) return trimToLimit(fallback, 42);
  return trimToLimit(normalized, 36);
}

function normalizeCta(value?: string, copyGuide?: CopyGuideContext | null) {
  const text = isKookdaeGuide(copyGuide)
    ? applyKookdaeGenericReplacements(value || "")
    : cleanText(value);
  if (text && !hasForbidden(text) && !hasKookdaeForbidden(text)) return trimToLimit(text, 10);
  if (isKookdaeGuide(copyGuide)) return "특가 확인하기";
  return "view deal";
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
  copyGuide?: CopyGuideContext | null
): GeneratedAdCopyVariant {
  const sanitize = (value: string) =>
    isKookdaeGuide(copyGuide) ? applyKookdaeGenericReplacements(value) : value;

  return {
    headline: trimToLimit(sanitize(copy?.headline || fallback.headline), limits.headline),
    bodyCopy: trimToLimit(sanitize(copy?.bodyCopy || fallback.bodyCopy), limits.bodyCopy),
    highlightCopy: trimToLimit(sanitize(copy?.highlightCopy || fallback.highlightCopy), limits.highlightCopy),
    bottomBarCopy: trimToLimit(sanitize(copy?.bottomBarCopy || fallback.bottomBarCopy), limits.bottomBarCopy),
    cta: trimToLimit(sanitize(copy?.cta || fallback.cta), limits.cta),
    price: trimToLimit(copy?.price || fallback.price || "", limits.price),
  };
}

function kookdaeVariantSlotValue(
  slot: keyof GeneratedAdCopyVariant,
  value: string | undefined,
  fallback: string
) {
  const raw = cleanText(value);
  if (!raw || hasForbidden(raw) || hasKookdaeForbidden(raw)) {
    return fallback;
  }

  return normalizeKookdaePunctuation(applyKookdaeGenericReplacements(raw), {
    cta: slot === "cta",
  });
}

function mergeKookdaeVariant(
  incoming: Partial<GeneratedAdCopyVariant> | undefined,
  fallback: GeneratedAdCopyVariant
): GeneratedAdCopyVariant {
  return {
    headline: kookdaeVariantSlotValue("headline", incoming?.headline, fallback.headline),
    bodyCopy: kookdaeVariantSlotValue("bodyCopy", incoming?.bodyCopy, fallback.bodyCopy),
    highlightCopy: kookdaeVariantSlotValue(
      "highlightCopy",
      incoming?.highlightCopy,
      fallback.highlightCopy
    ),
    bottomBarCopy: kookdaeVariantSlotValue(
      "bottomBarCopy",
      incoming?.bottomBarCopy,
      fallback.bottomBarCopy
    ),
    cta: kookdaeVariantSlotValue("cta", incoming?.cta, fallback.cta),
    price: cleanText(incoming?.price || fallback.price || ""),
  };
}

function buildCopyVariants(
  copy: Partial<GeneratedAdCopy>,
  product: ProductInfoForPrompt,
  reference?: AdImageLabel,
  copyGuide?: CopyGuideContext | null
): GeneratedAdCopy["copyVariants"] {
  if (isKookdaeGuide(copyGuide)) {
    const fallbackVariants = buildKookdaeCopyVariantsFromPatterns(product, reference).variants;
    const preferred = {
      short: mergeKookdaeVariant(copy.copyVariants?.short, fallbackVariants.short),
      medium: mergeKookdaeVariant(copy.copyVariants?.medium, fallbackVariants.medium),
      long: mergeKookdaeVariant(copy.copyVariants?.long, fallbackVariants.long),
    };

    return {
      short: variantFrom(preferred.short, fallbackVariants.short, {
        headline: 14,
        bodyCopy: 18,
        highlightCopy: 12,
        bottomBarCopy: 18,
        cta: 6,
        price: 12,
      }, copyGuide),
      medium: variantFrom(preferred.medium, fallbackVariants.medium, {
        headline: 22,
        bodyCopy: 28,
        highlightCopy: 18,
        bottomBarCopy: 24,
        cta: 8,
        price: 12,
      }, copyGuide),
      long: variantFrom(preferred.long, fallbackVariants.long, {
        headline: 34,
        bodyCopy: 42,
        highlightCopy: 28,
        bottomBarCopy: 36,
        cta: 10,
        price: 12,
      }, copyGuide),
    };
  }

  const fallback: GeneratedAdCopyVariant = {
    headline: copy.headline || safeHeadlineFallback(product, reference, copyGuide),
    bodyCopy: copy.bodyCopy || bodyFallback(product, reference, copyGuide),
    highlightCopy: copy.highlightCopy || product.discountInfo || product.mainBenefit || "deal",
    bottomBarCopy:
      copy.bottomBarCopy ||
      reference?.finalLabel?.purchaseTrigger ||
      reference?.finalLabel?.whyItWorks ||
      "check bundle",
    cta: copy.cta || "view deal",
    price: normalizePrice(product, copy.price),
  };

  return {
    short: variantFrom(copy.copyVariants?.short, fallback, {
      headline: 14,
      bodyCopy: 18,
      highlightCopy: 12,
      bottomBarCopy: 18,
      cta: 6,
      price: 12,
    }, copyGuide),
    medium: variantFrom(copy.copyVariants?.medium, fallback, {
      headline: 22,
      bodyCopy: 28,
      highlightCopy: 18,
      bottomBarCopy: 24,
      cta: 8,
      price: 12,
    }, copyGuide),
    long: variantFrom(copy.copyVariants?.long, fallback, {
      headline: 34,
      bodyCopy: 42,
      highlightCopy: 28,
      bottomBarCopy: 36,
      cta: 10,
      price: 12,
    }, copyGuide),
  };
}

function removeForbidden(
  copy: GeneratedAdCopy,
  product: ProductInfoForPrompt,
  reference?: AdImageLabel,
  copyGuide?: CopyGuideContext | null
): GeneratedAdCopy {
  const kookdaeFallback = kookdaeFallbackCopy(product, reference);
  const replacements: Partial<Record<keyof GeneratedAdCopyVariant, string>> = isKookdaeGuide(copyGuide)
    ? kookdaeFallback
    : {
        headline: "value proof deal",
        bodyCopy: "Prepared for easier choice.",
        highlightCopy: "deal check",
        bottomBarCopy: "check bundle",
        cta: "view deal",
      };

  const next = { ...copy };
  copySlots.forEach((key) => {
    if (
      key !== "price" &&
      (hasForbidden(String(next[key] || "")) ||
        (isKookdaeGuide(copyGuide) && hasKookdaeForbidden(String(next[key] || ""))))
    ) {
      next[key] = replacements[key] || "";
    } else if (key !== "price" && isKookdaeGuide(copyGuide)) {
      next[key] = applyKookdaeGenericReplacements(String(next[key] || ""));
    }
  });
  return next;
}

function normalizeGeneratedCopy(
  value: Partial<GeneratedAdCopy>,
  product: ProductInfoForPrompt,
  labels: AdImageLabel[],
  copyGuide?: CopyGuideContext | null
): GeneratedAdCopy {
  const reference = labels[0];
  const price = normalizePrice(product, value.price);
  const kookdaeFallback = kookdaeFallbackCopy(product, reference);
  const rejectedGenericExpressions = isKookdaeGuide(copyGuide)
    ? rejectedKookdaeGenericExpressions(value)
    : [];
  const headlineSource = isKookdaeGuide(copyGuide)
    ? applyKookdaeGenericReplacements(value.headline || "")
    : value.headline || "";
  const headline = isBadHeadline(headlineSource, copyGuide)
    ? safeHeadlineFallback(product, reference, copyGuide)
    : cleanText(headlineSource);
  const productFacts = kookdaeProductFacts(product, reference);
  const selectedKookdaePattern = isKookdaeGuide(copyGuide)
    ? chooseKookdaePatternNames(product, reference).join(", ")
    : "";
  const kookdaeVariantPatternPlan = isKookdaeGuide(copyGuide)
    ? buildKookdaeCopyVariantsFromPatterns(product, reference).selectedPatterns
    : undefined;
  const baseCopyGuideUsage = copyGuideUsage(copyGuide);

  const normalized: GeneratedAdCopy = {
    headline,
    bodyCopy: normalizeBody(
      value.bodyCopy || "",
      bodyFallback(product, reference, copyGuide),
      copyGuide
    ),
    highlightCopy: trimToLimit(
      cleanText(
        isKookdaeGuide(copyGuide)
          ? applyKookdaeGenericReplacements(
              value.highlightCopy ||
                product.discountInfo ||
                product.mainBenefit ||
                kookdaeFallback.highlightCopy
            )
          : value.highlightCopy || product.discountInfo || product.mainBenefit || "deal"
      ),
      28
    ),
    bottomBarCopy: trimToLimit(
      cleanText(
        isKookdaeGuide(copyGuide)
          ? applyKookdaeGenericReplacements(value.bottomBarCopy || kookdaeFallback.bottomBarCopy)
          : value.bottomBarCopy ||
              reference?.finalLabel?.purchaseTrigger ||
              reference?.finalLabel?.whyItWorks ||
              "check bundle"
      ),
      36
    ),
    cta: normalizeCta(value.cta, copyGuide),
    price,
    hookType: cleanText(value.hookType || inferHookType(reference)),
    appealPoint: cleanText(value.appealPoint || inferAppealPoint(reference)),
    whyThisWorks: cleanText(
      value.whyThisWorks ||
        (isKookdaeGuide(copyGuide)
          ? "국대한우 카피 가이드의 가격 충격/구어체 패턴을 상품 사실에 맞게 변형했습니다."
          : "Combined reference copy pattern with product value proof.")
    ),
    reasoning: {
      ...(value.reasoning || {}),
      headlineQualityCheck: isBadHeadline(headlineSource, copyGuide) ? "repaired" : "passed",
      selectedKookdaePattern:
        value.reasoning?.selectedKookdaePattern || selectedKookdaePattern || undefined,
      rejectedGenericExpressions:
        value.reasoning?.rejectedGenericExpressions || rejectedGenericExpressions,
      productFactsUsed:
        value.reasoning?.productFactsUsed ||
        (isKookdaeGuide(copyGuide)
          ? [
              productFacts.productName,
              productFacts.cut,
              productFacts.price,
              productFacts.originalPrice,
              productFacts.discountInfo,
              productFacts.useCase,
              productFacts.benefit,
            ].filter(Boolean)
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
          normalizeBody(value.bodyCopy || "", bodyFallback(product, reference, copyGuide), copyGuide)
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
    copyGuide
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
  copyGuide?: CopyGuideContext | null
) {
  const reference = labels[0];
  return normalizeGeneratedCopy(
    {
      headline: safeHeadlineFallback(product, reference),
      bodyCopy: bodyFallback(product, reference, copyGuide),
      highlightCopy: isKookdaeGuide(copyGuide)
        ? kookdaeFallbackCopy(product, reference).highlightCopy
        : product.discountInfo || product.mainBenefit || "deal",
      bottomBarCopy:
        (isKookdaeGuide(copyGuide)
          ? kookdaeFallbackCopy(product, reference).bottomBarCopy
          : reference?.finalLabel?.purchaseTrigger ||
            reference?.finalLabel?.whyItWorks ||
            "check bundle"),
      cta: isKookdaeGuide(copyGuide) ? "특가 확인하기" : "view deal",
      price: normalizePrice(product),
      hookType: inferHookType(reference),
      appealPoint: inferAppealPoint(reference),
      whyThisWorks: "Mock masterCopy generated from product and reference inputs.",
      referencePatternUsage: referencePatternUsage(reference),
      copyGuideUsage: copyGuideUsage(copyGuide),
    },
    product,
    labels,
    copyGuide
  );
}

async function generateWithOpenAI(
  product: ProductInfoForPrompt,
  labels: AdImageLabel[],
  template: TemplateInfo,
  copyGuide?: CopyGuideContext | null
) {
  const prompt = buildGenerateCopyPrompt({
    product,
    reference: labels[0],
    template,
    copyGuide,
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
  return normalizeGeneratedCopy(parsed, product, labels, copyGuide);
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

    const allLabels = await readAdImageLabels();
    const selectedLabels = selectSingleReferenceLabel(
      product,
      allLabels,
      body.referenceLabels ?? []
    );
    const template: TemplateInfo = {
      templateId: body.templateId,
      templateName: body.templateName,
    };
    const copy = process.env.OPENAI_API_KEY
      ? await generateWithOpenAI(product, selectedLabels, template, copyGuide)
      : mockCopy(product, selectedLabels, copyGuide);

    return NextResponse.json({
      ok: true,
      copy,
      referenceLabels: selectedLabels,
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
