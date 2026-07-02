import { NextResponse } from "next/server";
import {
  buildSafeHeadlineFallback,
  cleanGeneratedText,
  isBadHeadline,
  normalizeBodyCopyPolite,
  normalizeCopyVariant,
  normalizeKoreanPricePhrase,
  repairHeadline,
  removeForbiddenCopy,
  trimCopyToLimit,
  visibleCopyLength,
} from "../../../lib/mvp/copyQuality";
import { buildGenerateCopyPrompt } from "../../../lib/mvp/copyPromptBuilder";
import { readAdImageLabels } from "../../../lib/mvp/labelStore";
import {
  copyLimitCharSummary,
  DEFAULT_TEMPLATE_COPY_LIMIT_CHARS,
  fitCopyToTemplate,
} from "../../../lib/mvp/templateCopyFitter";
import type {
  AdImageLabel,
  GeneratedAdCopy,
  GeneratedAdCopyVariant,
  ProductInfoForPrompt,
  ReferencePatternUsage,
  TemplateCopyLimits,
} from "../../../lib/mvp/types";

type Body = {
  productInfo?: Partial<ProductInfoForPrompt>;
  referenceLabels?: AdImageLabel[];
  templateId?: string;
  templateName?: string;
  copyLimits?: TemplateCopyLimits;
};

type TemplateInfo = {
  templateId?: string;
  templateName?: string;
  copyLimits?: TemplateCopyLimits;
};

type OpenAIResponseContent = {
  text?: string;
};

type OpenAIResponseItem = {
  content?: OpenAIResponseContent[];
};

function normalizeProduct(productInfo: Partial<ProductInfoForPrompt> = {}): ProductInfoForPrompt {
  return {
    productName: productInfo.productName || "",
    category: productInfo.category || "",
    price: productInfo.price || "",
    discountInfo: productInfo.discountInfo || "",
    mainBenefit: productInfo.mainBenefit || "",
    targetCustomer: productInfo.targetCustomer || "",
    landingUrl: productInfo.landingUrl || "",
    productImagePath: productInfo.productImagePath || "",
    secondaryProductImagePath: productInfo.secondaryProductImagePath || "",
    productImagePaths: productInfo.productImagePaths || [],
    backgroundImagePath: productInfo.backgroundImagePath || "",
    extractedDescription: productInfo.extractedDescription || "",
    extractedMainImage: productInfo.extractedMainImage || "",
    extractedGalleryImages: productInfo.extractedGalleryImages || [],
    selectedBackgroundSource: productInfo.selectedBackgroundSource || "",
    backgroundMode: productInfo.backgroundMode || "none",
    sourceImageCandidates: productInfo.sourceImageCandidates || [],
    selectedSourceImageId: productInfo.selectedSourceImageId || "",
    selectedSourceImagePath: productInfo.selectedSourceImagePath || "",
  };
}

function labelHasFinalData(label: AdImageLabel): boolean {
  return Boolean(label.finalLabel && Object.values(label.finalLabel).some(Boolean));
}

function labelText(label: AdImageLabel): string {
  const finalLabel = label.finalLabel;

  return [
    label.category,
    finalLabel?.category,
    finalLabel?.ocrText,
    finalLabel?.hookType,
    finalLabel?.appealPoint,
    finalLabel?.targetEmotion,
    finalLabel?.copyNuance,
    finalLabel?.visualTone,
    finalLabel?.layoutPattern,
    finalLabel?.whyItWorks,
    finalLabel?.recommendedUse,
    finalLabel?.firstLineHook,
    finalLabel?.copyStructure,
    finalLabel?.toneOfVoice,
    finalLabel?.trendElements,
    finalLabel?.consumerInsight,
    finalLabel?.purchaseTrigger,
    finalLabel?.reusableCopyPattern,
    finalLabel?.visualCopyRelation,
  ]
    .filter(Boolean)
    .join(" ");
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^0-9a-z가-힣\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 2),
  );
}

function scoreLabel(product: ProductInfoForPrompt, label: AdImageLabel): number {
  const productText = [
    product.productName,
    product.category,
    product.mainBenefit,
    product.extractedDescription,
    product.targetCustomer,
    product.discountInfo,
  ].join(" ");
  const productTokens = tokenize(productText);
  const referenceTokens = tokenize(labelText(label));
  let score = 0;

  productTokens.forEach((token) => {
    if (referenceTokens.has(token)) score += 3;
  });

  if (product.category && labelText(label).includes(product.category)) score += 10;
  if (label.finalLabel?.ocrText) score += 5;
  if (label.finalLabel?.reusableCopyPattern) score += 5;
  if (label.finalLabel?.consumerInsight) score += 3;
  if (label.finalLabel?.purchaseTrigger) score += 3;
  if (label.finalLabel?.copyNuance) score += 2;

  return score;
}

function selectSingleReferenceLabel(
  product: ProductInfoForPrompt,
  allLabels: AdImageLabel[],
  requestedLabels: AdImageLabel[] = [],
): AdImageLabel[] {
  const requestedValid = requestedLabels.filter(labelHasFinalData);

  if (requestedValid.length > 0) {
    return [requestedValid[0]];
  }

  const autoSelected = [...allLabels]
    .filter(labelHasFinalData)
    .sort((a, b) => scoreLabel(product, b) - scoreLabel(product, a));

  return autoSelected[0] ? [autoSelected[0]] : [];
}

function parseJsonObject(text: string): Partial<GeneratedAdCopy> {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "");
  const match = cleaned.match(/\{[\s\S]*\}/);

  return JSON.parse(match ? match[0] : cleaned) as Partial<GeneratedAdCopy>;
}

function getResponseText(data: { output_text?: string; output?: OpenAIResponseItem[] }): string {
  if (data.output_text) return data.output_text;

  return (
    data.output
      ?.flatMap((item) => item.content ?? [])
      .map((item) => item.text || "")
      .join("") || ""
  );
}

function inferHookType(reference?: AdImageLabel): string {
  const text = reference ? labelText(reference) : "";
  const existing = reference?.finalLabel?.hookType || "";

  if (/나와버|코어|야호|POV|저장각|장바구니각|SNS|밈|유행어|짤|구어체/.test(text)) return "UGC형";
  if (/후기|리뷰|평점|써보고|먹어보|반응/.test(text)) return "후기/리뷰형";
  if (/불편|문제|아직도|왜 매번|놓치|없이/.test(text)) return "문제제기형";
  if (/나만|공감|귀찮|이런 날|속으로/.test(text)) return "공감형";
  if (/선물|부모님|명절|체면|고급|프리미엄/.test(text)) return "선물명분형";
  if (/오늘|한정|이번 구성|마감|오래 안 갈/.test(text)) return "긴급/한정형";
  if (/출근|주말|캠핑|집들이|상황|용으로/.test(text)) return "상황제안형";
  if (/가격|할인|무료배송|쿠폰|만원대|구성|가성비|반칙/.test(text)) return "가격정당화형";

  return existing || "상황제안형";
}

function inferAppealPoint(reference?: AdImageLabel): string {
  const text = reference ? labelText(reference) : "";
  const existing = reference?.finalLabel?.appealPoint || "";

  if (/선물|부모님|명절|체면|고급|프리미엄/.test(text)) return "선물 명분";
  if (/무료배송|쿠폰|할인|특가|구성|만원대|가성비|가격/.test(text)) return "가격/구성 명분";
  if (/후기|리뷰|평점|반응|인증/.test(text)) return "후기 신뢰";
  if (/나와버|코어|야호|POV|저장각|장바구니각|SNS|밈/.test(text)) return "SNS식 관심 유도";
  if (/불편|문제|결핍|귀찮|놓치/.test(text)) return "불편 해소";
  if (/대용량|세트|박스|팩|구성/.test(text)) return "실속 구성";

  return existing || "";
}

function bodyFallback(product: ProductInfoForPrompt, reference?: AdImageLabel): string {
  const text = [
    product.productName,
    product.category,
    product.mainBenefit,
    reference ? labelText(reference) : "",
  ].join(" ");

  if (/선물|부모님|명절|고급|프리미엄/.test(text)) return "부담 없이 준비하기 좋아요";
  if (/고기|소고기|한우|등심|갈비|스테이크|식품/.test(text)) return "집에서도 든든하게 즐겨보세요";
  if (/후기|리뷰|평점/.test(text)) return "후기로 확인해보세요";
  if (/무료배송|할인|쿠폰|구성/.test(text)) return "구성까지 확인해보세요";

  return "부담 없이 확인해보세요";
}

function normalizePrice(product: ProductInfoForPrompt, generatedPrice?: string): string {
  const generated = cleanGeneratedText(generatedPrice || "");
  if (generated) return generated;
  return cleanGeneratedText(product.price || product.discountInfo || "");
}

function baseVariant(copy: GeneratedAdCopy): GeneratedAdCopyVariant {
  return {
    headline: copy.headline,
    bodyCopy: copy.bodyCopy,
    highlightCopy: copy.highlightCopy,
    bottomBarCopy: copy.bottomBarCopy,
    cta: copy.cta,
    price: copy.price,
  };
}

function buildCopyVariants(
  copy: GeneratedAdCopy,
  product: ProductInfoForPrompt,
  reference?: AdImageLabel,
  copyLimits?: TemplateCopyLimits,
): GeneratedAdCopy["copyVariants"] {
  const fallback = baseVariant(copy);
  const body = bodyFallback(product, reference);

  return {
    short: normalizeCopyVariant(copy.copyVariants?.short, {
      ...fallback,
      headline: repairHeadline({
        headline: copy.copyVariants?.short?.headline || copy.headline,
        product,
        reference,
        maxChars: Math.min(copyLimits?.headline?.maxChars || 14, 14),
      }).headline,
      bodyCopy: body,
    }, {
      headline: { ...copyLimits?.headline, maxChars: Math.min(copyLimits?.headline?.maxChars || 14, 14) },
      bodyCopy: { ...copyLimits?.bodyCopy, maxChars: Math.min(copyLimits?.bodyCopy?.maxChars || 20, 20) },
      highlightCopy: { ...copyLimits?.highlightCopy, maxChars: Math.min(copyLimits?.highlightCopy?.maxChars || 20, 20) },
      bottomBarCopy: { ...copyLimits?.bottomBarCopy, maxChars: Math.min(copyLimits?.bottomBarCopy?.maxChars || 24, 24) },
      cta: { ...copyLimits?.cta, maxChars: Math.min(copyLimits?.cta?.maxChars || 8, 8) },
      price: copyLimits?.price,
    }),
    medium: normalizeCopyVariant(copy.copyVariants?.medium, fallback, {
      headline: { ...copyLimits?.headline, maxChars: Math.min(copyLimits?.headline?.maxChars || 18, 18) },
      bodyCopy: { ...copyLimits?.bodyCopy, maxChars: Math.min(copyLimits?.bodyCopy?.maxChars || 28, 28) },
      highlightCopy: { ...copyLimits?.highlightCopy, maxChars: Math.min(copyLimits?.highlightCopy?.maxChars || 26, 26) },
      bottomBarCopy: { ...copyLimits?.bottomBarCopy, maxChars: Math.min(copyLimits?.bottomBarCopy?.maxChars || 30, 30) },
      cta: { ...copyLimits?.cta, maxChars: Math.min(copyLimits?.cta?.maxChars || 10, 10) },
      price: copyLimits?.price,
    }),
    long: normalizeCopyVariant(copy.copyVariants?.long, fallback, {
      headline: { ...copyLimits?.headline, maxChars: Math.min(copyLimits?.headline?.maxChars || 22, 22) },
      bodyCopy: { ...copyLimits?.bodyCopy, maxChars: Math.min(copyLimits?.bodyCopy?.maxChars || 36, 36) },
      highlightCopy: { ...copyLimits?.highlightCopy, maxChars: Math.min(copyLimits?.highlightCopy?.maxChars || 34, 34) },
      bottomBarCopy: { ...copyLimits?.bottomBarCopy, maxChars: Math.min(copyLimits?.bottomBarCopy?.maxChars || 38, 38) },
      cta: { ...copyLimits?.cta, maxChars: Math.min(copyLimits?.cta?.maxChars || 10, 10) },
      price: copyLimits?.price,
    }),
  };
}

function preferredVariantForTemplate(copyLimits?: TemplateCopyLimits): "short" | "medium" | "long" {
  const headlineMax = copyLimits?.headline?.maxChars || DEFAULT_TEMPLATE_COPY_LIMIT_CHARS.headline;
  const bodyMax = copyLimits?.bodyCopy?.maxChars || DEFAULT_TEMPLATE_COPY_LIMIT_CHARS.bodyCopy;
  const highlightMax = copyLimits?.highlightCopy?.maxChars || DEFAULT_TEMPLATE_COPY_LIMIT_CHARS.highlightCopy;

  if (headlineMax <= 14 || bodyMax <= 28 || highlightMax <= 22) return "short";
  if (headlineMax <= 18 || bodyMax <= 40 || highlightMax <= 26) return "medium";
  return "long";
}

function applyPreferredVariant(copy: GeneratedAdCopy, copyLimits?: TemplateCopyLimits): GeneratedAdCopy {
  const variantKey = preferredVariantForTemplate(copyLimits);
  const variant = copy.copyVariants?.[variantKey];
  if (!variant) return copy;

  return {
    ...copy,
    headline: variant.headline || copy.headline,
    bodyCopy: variant.bodyCopy || copy.bodyCopy,
    highlightCopy: variant.highlightCopy || copy.highlightCopy,
    bottomBarCopy: variant.bottomBarCopy || copy.bottomBarCopy,
    cta: variant.cta || copy.cta,
    price: variant.price || copy.price,
  };
}

function referencePatternUsage(reference?: AdImageLabel): ReferencePatternUsage {
  const finalLabel = reference?.finalLabel;

  return {
    usedHookPattern: finalLabel?.firstLineHook || finalLabel?.hookType || "",
    usedCopyStructure: finalLabel?.copyStructure || "",
    usedToneOfVoice: finalLabel?.toneOfVoice || finalLabel?.copyNuance || "",
    usedConsumerInsight: finalLabel?.consumerInsight || "",
    usedPurchaseTrigger: finalLabel?.purchaseTrigger || "",
    usedReusablePattern: finalLabel?.reusableCopyPattern || "",
    usedVisualCopyRelation: finalLabel?.visualCopyRelation || "",
  };
}

function normalizeCopy(
  value: Partial<GeneratedAdCopy>,
  product: ProductInfoForPrompt,
  labels: AdImageLabel[],
  template?: TemplateInfo,
): GeneratedAdCopy {
  const reference = labels[0];
  const headlineRepair = repairHeadline({
    headline: value.headline || "",
    product,
    reference,
    maxChars: template?.copyLimits?.headline?.maxChars || 22,
  });
  const bodyMax = Math.min(template?.copyLimits?.bodyCopy?.maxChars || 36, 36);
  const bodyCopy = normalizeBodyCopyPolite(
    value.bodyCopy || "",
    bodyFallback(product, reference),
    bodyMax,
  );
  const highlightFallback =
    cleanGeneratedText(product.discountInfo || product.mainBenefit || reference?.finalLabel?.purchaseTrigger || "") ||
    buildSafeHeadlineFallback({ product, reference });
  const bottomFallback =
    cleanGeneratedText(reference?.finalLabel?.purchaseTrigger || reference?.finalLabel?.whyItWorks || "") ||
    "구성 확인해보세요";
  const price = normalizePrice(product, value.price);
  const hookType = cleanGeneratedText(value.hookType || inferHookType(reference));
  const appealPoint = cleanGeneratedText(value.appealPoint || inferAppealPoint(reference));

  const copy: GeneratedAdCopy = {
    headline: headlineRepair.headline,
    bodyCopy,
    highlightCopy: trimCopyToLimit(
      value.highlightCopy || highlightFallback,
      template?.copyLimits?.highlightCopy?.maxChars || 34,
    ),
    bottomBarCopy: trimCopyToLimit(
      value.bottomBarCopy || bottomFallback,
      template?.copyLimits?.bottomBarCopy?.maxChars || 38,
    ),
    cta: trimCopyToLimit(value.cta || "구성 보러가기", template?.copyLimits?.cta?.maxChars || 10),
    price,
    hookType,
    appealPoint,
    whyThisWorks: cleanGeneratedText(
      value.whyThisWorks ||
        `reference의 ${reference?.finalLabel?.reusableCopyPattern || reference?.finalLabel?.firstLineHook || "카피 패턴"}을 현재 상품에 맞게 변형했습니다.`,
    ),
    reasoning: {
      ...(value.reasoning || {}),
      headlineReason: value.reasoning?.headlineReason || "reference pattern based headline",
      referencePatternUsed:
        value.reasoning?.referencePatternUsed ||
        reference?.finalLabel?.reusableCopyPattern ||
        reference?.finalLabel?.firstLineHook ||
        "",
      consumerInsightUsed: value.reasoning?.consumerInsightUsed || reference?.finalLabel?.consumerInsight || "",
      purchaseTriggerUsed: value.reasoning?.purchaseTriggerUsed || reference?.finalLabel?.purchaseTrigger || "",
      headlineQualityCheck: headlineRepair.repaired ? headlineRepair.reason : "passed",
    },
    templateFit: {
      templateId: template?.templateId,
      templateName: template?.templateName,
      usedCopyLimits: copyLimitCharSummary(template?.copyLimits),
      fitNotes: "선택 템플릿의 copyLimits를 기준으로 생성했습니다.",
    },
    referencePatternUsage: {
      ...referencePatternUsage(reference),
      ...(value.referencePatternUsage || {}),
    },
    copyValidation: {
      bodyCopy: {
        ok: true,
        reasons: [],
        original: value.bodyCopy || "",
        normalized: bodyCopy,
        finalLength: visibleCopyLength(bodyCopy),
      },
    },
    copyVariants: undefined,
  };

  const cleaned = removeForbiddenCopy(copy);
  cleaned.copyVariants = buildCopyVariants(
    {
      ...cleaned,
      copyVariants: value.copyVariants,
    },
    product,
    reference,
    template?.copyLimits,
  );

  return cleaned;
}

function repairAfterTemplateFit(
  copy: GeneratedAdCopy,
  product: ProductInfoForPrompt,
  reference?: AdImageLabel,
  copyLimits?: TemplateCopyLimits,
): GeneratedAdCopy {
  const repair = repairHeadline({
    headline: copy.headline,
    product,
    reference,
    maxChars: copyLimits?.headline?.maxChars || 22,
  });
  const bodyCopy = normalizeBodyCopyPolite(
    copy.bodyCopy,
    bodyFallback(product, reference),
    Math.min(copyLimits?.bodyCopy?.maxChars || 36, 36),
  );

  return {
    ...copy,
    headline: repair.headline,
    bodyCopy,
    reasoning: {
      ...copy.reasoning,
      headlineQualityCheck: repair.repaired ? repair.reason : copy.reasoning?.headlineQualityCheck || "passed",
    },
  };
}

function mockCopy(product: ProductInfoForPrompt, labels: AdImageLabel[], template?: TemplateInfo): GeneratedAdCopy {
  const reference = labels[0];
  const headline = buildSafeHeadlineFallback({ product, reference });
  const hookType = inferHookType(reference);
  const appealPoint = inferAppealPoint(reference);
  const price = normalizePrice(product);
  const bodyCopy = bodyFallback(product, reference);

  return normalizeCopy(
    {
      headline,
      bodyCopy,
      highlightCopy:
        cleanGeneratedText(product.discountInfo || reference?.finalLabel?.purchaseTrigger || product.mainBenefit) ||
        "구성까지 확인해보세요",
      bottomBarCopy:
        cleanGeneratedText(reference?.finalLabel?.whyItWorks || reference?.finalLabel?.purchaseTrigger) ||
        "놓치면 아쉬운 구성입니다",
      cta: "구성 보러가기",
      price,
      hookType,
      appealPoint,
      whyThisWorks: `reference의 ${reference?.finalLabel?.reusableCopyPattern || "카피 패턴"}을 상품 정보에 맞게 보수적으로 변형했습니다.`,
      referencePatternUsage: referencePatternUsage(reference),
    },
    product,
    labels,
    template,
  );
}

async function generateWithOpenAI(
  product: ProductInfoForPrompt,
  labels: AdImageLabel[],
  template?: TemplateInfo,
): Promise<GeneratedAdCopy> {
  const prompt = buildGenerateCopyPrompt({
    product: {
      ...product,
      price: product.price || normalizeKoreanPricePhrase(product.discountInfo),
    },
    reference: labels[0],
    template,
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

  const data = await response.json();
  const text = getResponseText(data);
  const parsed = parseJsonObject(text);

  return normalizeCopy(parsed, product, labels, template);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const product = normalizeProduct(body.productInfo);
    const template: TemplateInfo = {
      templateId: body.templateId,
      templateName: body.templateName,
      copyLimits: body.copyLimits,
    };
    const allLabels = await readAdImageLabels();
    const selectedLabels = selectSingleReferenceLabel(product, allLabels, body.referenceLabels ?? []);

    if (!selectedLabels.length) {
      return NextResponse.json(
        { ok: false, error: "참고할 레퍼런스 라벨이 없습니다. 먼저 이미지 라벨을 저장해 주세요." },
        { status: 400 },
      );
    }

    const rawCopy = process.env.OPENAI_API_KEY
      ? await generateWithOpenAI(product, selectedLabels, template)
      : mockCopy(product, selectedLabels, template);
    const variantCopy = applyPreferredVariant(rawCopy, body.copyLimits);
    const fitted = body.templateId
      ? fitCopyToTemplate({
          copy: variantCopy,
          templateId: body.templateId,
          copyLimits: body.copyLimits,
        })
      : null;
    const copyBeforeRepair = {
      ...variantCopy,
      ...(fitted
        ? {
            headline: fitted.headline,
            bodyCopy: fitted.bodyCopy,
            highlightCopy: fitted.highlightCopy,
            bottomBarCopy: fitted.bottomBarCopy,
            cta: fitted.cta,
            price: fitted.price || variantCopy.price,
          }
        : {}),
      templateFit: {
        ...variantCopy.templateFit,
        templateId: body.templateId || variantCopy.templateFit?.templateId,
        templateName: body.templateName || variantCopy.templateFit?.templateName,
        usedCopyLimits: copyLimitCharSummary(body.copyLimits),
        fitNotes: fitted?.slotFits.some((slot) => slot.status === "trimmed")
          ? `${variantCopy.templateFit?.fitNotes || ""} 선택 템플릿의 문구 영역에 맞춰 일부 문구를 줄였습니다.`.trim()
          : `${variantCopy.templateFit?.fitNotes || ""} 선택 템플릿의 문구 영역에 맞춰 작성했습니다.`.trim(),
      },
      copyVariants: variantCopy.copyVariants || buildCopyVariants(variantCopy, product, selectedLabels[0], body.copyLimits),
    } satisfies GeneratedAdCopy;
    const copy = repairAfterTemplateFit(
      copyBeforeRepair,
      product,
      selectedLabels[0],
      body.copyLimits,
    );

    if (isBadHeadline(copy.headline)) {
      copy.headline = trimCopyToLimit(
        buildSafeHeadlineFallback({ product, reference: selectedLabels[0] }),
        body.copyLimits?.headline?.maxChars || 22,
      );
    }

    return NextResponse.json({
      ok: true,
      copy,
      referenceLabels: selectedLabels,
      isMock: !process.env.OPENAI_API_KEY,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "광고문구 생성 중 오류가 발생했습니다.",
      },
      { status: 500 },
    );
  }
}
