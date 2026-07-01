import { NextResponse } from "next/server";
import { formatReferenceLabelsForCopyGeneration } from "../../../lib/mvp/copyReferenceFormatter";
import {
  bodyCopyLength,
  normalizeBodyCopy,
  normalizeCasualCopyToPolite,
  validateBodyCopy,
} from "../../../lib/mvp/copyLengthPolicy";
import { readAdImageLabels } from "../../../lib/mvp/labelStore";
import { copyLimitCharSummary, DEFAULT_TEMPLATE_COPY_LIMIT_CHARS, fitCopyToTemplate } from "../../../lib/mvp/templateCopyFitter";
import { AdImageLabel, GeneratedAdCopy, GeneratedCopyReasoning, GeneratedAdCopyVariant, ProductInfoForPrompt, ReferencePatternUsage, TemplateCopyLimits } from "../../../lib/mvp/types";

type Body = {
  productInfo?: Partial<ProductInfoForPrompt>;
  referenceLabels?: AdImageLabel[];
  templateId?: string;
  templateName?: string;
  copyLimits?: TemplateCopyLimits;
};

const forbiddenReplacements: Record<string, string> = {
  "만나보세요": "확인해보세요",
  "기다립니다": "장바구니에 담기 좋은 타이밍입니다",
  "필수 아이템": "없으면 괜히 아쉬운템",
  "특별한 선택": "이유 있는 선택",
  "자세한 정보": "구성",
  "여기를 클릭": "구성 보러가기",
  "새로워진 즐거움": "지금 필요한 이유",
  "만족을 줄 수 있음": "납득되는 이유가 있음",
  "여러분을 기다립니다": "지금 장바구니각",
  "지금 바로 확인하기": "구성 보러가기",
};

const genericHeadlinePatterns = [
  /새\s*상품/,
  /즐거움/,
  /특별한/,
  /만나보/,
  /기다립/,
  /필수\s*아이템/,
  /여러분/,
  /최고의\s*선택/,
];

const emojiRegex = /[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu;

function stripEmoji(value: string) {
  return value.replace(emojiRegex, "").replace(/\s{2,}/g, " ").trim();
}

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
    backgroundImagePath: productInfo.backgroundImagePath || "",
    extractedDescription: productInfo.extractedDescription || "",
    extractedMainImage: productInfo.extractedMainImage || "",
    extractedGalleryImages: productInfo.extractedGalleryImages || [],
    selectedBackgroundSource: productInfo.selectedBackgroundSource || "",
    backgroundMode: productInfo.backgroundMode || "none",
  };
}

function labelText(label: AdImageLabel) {
  return [
    label.category,
    label.finalLabel.category,
    label.finalLabel.ocrText,
    label.finalLabel.hookType,
    label.finalLabel.appealPoint,
    label.finalLabel.targetEmotion,
    label.finalLabel.copyNuance,
    label.finalLabel.visualTone,
    label.finalLabel.layoutPattern,
    label.finalLabel.whyItWorks,
    label.finalLabel.recommendedUse,
    label.finalLabel.firstLineHook,
    label.finalLabel.copyStructure,
    label.finalLabel.toneOfVoice,
    label.finalLabel.trendElements,
    label.finalLabel.consumerInsight,
    label.finalLabel.purchaseTrigger,
    label.finalLabel.reusableCopyPattern,
    label.finalLabel.visualCopyRelation,
  ].join(" ");
}

function tokenize(value: string) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^0-9a-z가-힣\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 2),
  );
}

function scoreLabel(product: ProductInfoForPrompt, label: AdImageLabel) {
  const productText = [
    product.productName,
    product.category,
    product.mainBenefit,
    product.extractedDescription,
    product.targetCustomer,
    product.discountInfo,
  ].join(" ");
  const productTokens = tokenize(productText);
  const labelTokens = tokenize(labelText(label));
  let score = 0;

  productTokens.forEach((token) => {
    if (labelTokens.has(token)) score += 3;
  });
  if (product.category && labelText(label).includes(product.category)) score += 10;
  if (label.finalLabel.ocrText) score += 5;
  if (label.finalLabel.hookType) score += 3;
  if (label.finalLabel.copyNuance) score += 3;
  if (label.finalLabel.whyItWorks) score += 2;

  return score;
}

function selectReferenceLabels(product: ProductInfoForPrompt, allLabels: AdImageLabel[], requestedLabels: AdImageLabel[] = []) {
  const source = requestedLabels.length ? requestedLabels : allLabels;
  return [...source]
    .filter((label) => label.finalLabel && Object.values(label.finalLabel).some(Boolean))
    .sort((a, b) => scoreLabel(product, b) - scoreLabel(product, a))
    .slice(0, 1);
}

function parseJsonObject(text: string) {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "");
  const match = cleaned.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : cleaned) as Partial<GeneratedAdCopy>;
}

function replaceForbiddenPhrases(value: string) {
  const withoutEmoji = stripEmoji(value);
  return Object.entries(forbiddenReplacements).reduce(
    (text, [forbidden, replacement]) => text.replaceAll(forbidden, replacement),
    withoutEmoji,
  );
}

function copyLength(value: string) {
  return String(value || "").replace(/\s+/g, "").length;
}

function shortenCopy(value: string, maxChars: number, fallback: string) {
  const normalized = replaceForbiddenPhrases(String(value || fallback || "").replace(/\s+/g, " ").trim());
  if (copyLength(normalized) <= maxChars) return normalized;

  const firstPhrase = normalized
    .split(/[,.!?\n]/)
    .map((part) => part.trim())
    .find((part) => part && copyLength(part) <= maxChars);
  if (firstPhrase) return firstPhrase;

  const words = normalized.split(/\s+/).filter(Boolean);
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (copyLength(candidate) > maxChars) break;
    current = candidate;
  }
  if (current) return current;

  let output = "";
  for (const char of normalized) {
    if (/\s/.test(char)) continue;
    if (copyLength(output + char) > Math.max(1, maxChars - 2)) break;
    output += char;
  }
  return output ? `${output}...` : fallback;
}

function buildFallbackBodyCopy(product: ProductInfoForPrompt) {
  const categoryText = `${product.category} ${product.productName} ${product.mainBenefit} ${product.extractedDescription}`;

  if (/식품|고기|한우|소고기|스테이크|갈비|등심|정육|한돈|육류/.test(categoryText)) {
    return "특별한 날에도 좋아요";
  }
  if (/선물|부모님|명절|답례|프리미엄/.test(categoryText)) {
    return "선물용으로도 좋아요";
  }
  if (/뷰티|화장품|스킨|크림|세럼/.test(categoryText)) {
    return "부담 없이 써보세요";
  }
  if (/패션|의류|룩|가방|신발/.test(categoryText)) {
    return "오늘 코디에 잘 어울려요";
  }

  return "부담 없이 즐겨보세요";
}

function trimBodyCopyToLength(input: string, maxLength: number, fallback: string) {
  const normalized = normalizeBodyCopy(input);
  if (bodyCopyLength(normalized) <= maxLength) return normalized;

  const firstSentence = normalized
    .split(/[.!?。！？]/)
    .map((part) => part.trim())
    .find((part) => part && bodyCopyLength(part) <= maxLength);
  if (firstSentence) return firstSentence;

  const words = normalized.split(/\s+/).filter(Boolean);
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (bodyCopyLength(candidate) > maxLength) break;
    current = candidate;
  }

  return current || fallback;
}

function normalizeBodyCopyForBanner(input: string, product: ProductInfoForPrompt, maxLength = 36) {
  const original = normalizeBodyCopy(input);
  const fallback = buildFallbackBodyCopy(product);
  const polite = normalizeCasualCopyToPolite(replaceForbiddenPhrases(original));
  const trimmed = trimBodyCopyToLength(polite, maxLength, fallback);
  const normalized = normalizeCasualCopyToPolite(trimmed);
  const validation = validateBodyCopy(normalized);
  const finalBodyCopy = validation.ok ? normalized : fallback;

  return {
    bodyCopy: finalBodyCopy,
    validation: {
      ok: validation.ok && finalBodyCopy === normalized,
      reasons: validation.reasons,
      original,
      normalized,
      finalLength: bodyCopyLength(finalBodyCopy),
    },
  };
}

function compactCta(value: string) {
  const text = replaceForbiddenPhrases(value || "");
  if (copyLength(text) <= 10) return text || "구성보기";
  if (/혜택|할인|특가/.test(text)) return "혜택보기";
  if (/장바구니|담/.test(text)) return "담아보기";
  if (/구성|세트|상품/.test(text)) return "구성보기";
  return "보러가기";
}

function normalizeNonHeadlineCopy(input: string, fallback: string, maxLength: number) {
  const source = isMetaAnalysisCopy(input || "") ? fallback : input;
  const polite = normalizeCasualCopyToPolite(replaceForbiddenPhrases(source || ""));
  const normalized = polite
    .replace(/듯$/g, "듯해요")
    .replace(/각$/g, "각이에요")
    .replace(/반칙$/g, "반칙이에요")
    .replace(/끝$/g, "끝내세요")
    .replace(/됨$/g, "돼요")
    .replace(/좋다$/g, "좋아요")
    .replace(/필요함$/g, "필요해요")
    .replace(/가능함$/g, "가능해요")
    .trim();
  return shortenCopy(normalized || fallback, maxLength, fallback);
}

function bodyCopyMaxChars(copyLimits?: TemplateCopyLimits) {
  return copyLimits?.bodyCopy?.maxChars || 36;
}

function buildCopyVariants(copy: GeneratedAdCopy, product: ProductInfoForPrompt, copyLimits?: TemplateCopyLimits): GeneratedAdCopy["copyVariants"] {
  const existing = copy.copyVariants;
  const longBodyMax = Math.min(36, bodyCopyMaxChars(copyLimits));
  const mediumBodyMax = Math.min(28, longBodyMax);
  const shortBodyMax = Math.min(20, mediumBodyMax);
  const base: GeneratedAdCopyVariant = {
    headline: copy.headline,
    bodyCopy: copy.bodyCopy,
    highlightCopy: copy.highlightCopy,
    bottomBarCopy: copy.bottomBarCopy,
    cta: copy.cta,
    price: copy.price,
  };

  return {
    short: {
      headline: shortenCopy(existing?.short?.headline || base.headline, 12, base.headline),
      bodyCopy: normalizeBodyCopyForBanner(shortenCopy(existing?.short?.bodyCopy || base.bodyCopy, shortBodyMax, base.bodyCopy), product, shortBodyMax).bodyCopy,
      highlightCopy: normalizeNonHeadlineCopy(existing?.short?.highlightCopy || base.highlightCopy, base.highlightCopy, 18),
      bottomBarCopy: normalizeNonHeadlineCopy(existing?.short?.bottomBarCopy || base.bottomBarCopy, base.bottomBarCopy, 22),
      cta: compactCta(existing?.short?.cta || base.cta),
      price: existing?.short?.price || base.price,
    },
    medium: {
      headline: shortenCopy(existing?.medium?.headline || base.headline, 16, base.headline),
      bodyCopy: normalizeBodyCopyForBanner(shortenCopy(existing?.medium?.bodyCopy || base.bodyCopy, mediumBodyMax, base.bodyCopy), product, mediumBodyMax).bodyCopy,
      highlightCopy: normalizeNonHeadlineCopy(existing?.medium?.highlightCopy || base.highlightCopy, base.highlightCopy, 26),
      bottomBarCopy: normalizeNonHeadlineCopy(existing?.medium?.bottomBarCopy || base.bottomBarCopy, base.bottomBarCopy, 30),
      cta: compactCta(existing?.medium?.cta || base.cta),
      price: existing?.medium?.price || base.price,
    },
    long: {
      headline: shortenCopy(existing?.long?.headline || base.headline, 22, base.headline),
      bodyCopy: normalizeBodyCopyForBanner(shortenCopy(existing?.long?.bodyCopy || base.bodyCopy, longBodyMax, base.bodyCopy), product, longBodyMax).bodyCopy,
      highlightCopy: normalizeNonHeadlineCopy(existing?.long?.highlightCopy || base.highlightCopy, base.highlightCopy, 34),
      bottomBarCopy: normalizeNonHeadlineCopy(existing?.long?.bottomBarCopy || base.bottomBarCopy, base.bottomBarCopy, 38),
      cta: compactCta(existing?.long?.cta || base.cta),
      price: existing?.long?.price || base.price,
    },
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
    templateFit: {
      ...copy.templateFit,
      fitNotes: `${copy.templateFit?.fitNotes || "선택한 템플릿 기준으로 문구를 조정했습니다."} ${variantKey} 문구 변형을 우선 적용했습니다.`,
    },
  };
}

function templateCopyStrategy(templateId?: string) {
  if (!templateId) return "템플릿 미선택: headline은 후킹, highlightCopy는 핵심 소구, bottomBarCopy는 구매 명분으로 분리한다.";
  if (/food-template-001|food-impact-hero-001/.test(templateId)) {
    return "초강한 식품 특가형: headline에는 firstLineHook/reusableCopyPattern을 압축하고, bodyCopy는 한 문장 구매 명분, highlightCopy는 가격/구성/핵심소구, bottomBarCopy는 즉시 구매 이유를 넣는다.";
  }
  if (/food-template-002/.test(templateId)) {
    return "가격 폭발형: headline과 price는 가격 충격, highlightCopy는 할인/구성, bottomBarCopy는 한정/혜택 명분을 짧게 넣는다.";
  }
  if (/food-template-003/.test(templateId)) {
    return "프리미엄 선물형: headline은 고급감/선물명분, bodyCopy는 체면/대접감, highlightCopy는 부담 낮춤 또는 구성 명분을 차분하게 넣는다.";
  }
  if (/food-template-004/.test(templateId)) {
    return "후기/UGC형: headline은 실제 반응처럼, bodyCopy는 짧은 후기 말투, highlightCopy는 저장각/후기신뢰/사회적 인정 소구를 넣는다.";
  }
  if (/food-template-005/.test(templateId)) {
    return "SNS 밈형: headline에는 trendElements와 reusableCopyPattern을 상품 키워드로 치환하고, highlightCopy는 밈 표현 또는 장바구니각 같은 행동 신호로 압축한다.";
  }
  return "선택 템플릿: headline은 후킹, bodyCopy는 보조 명분, highlightCopy는 핵심 소구, bottomBarCopy는 CTA 직전 구매 이유로 분리한다.";
}

function inferPrimaryHookType(labels: AdImageLabel[]) {
  const text = labels.map(labelText).join(" ");
  const hook = labels.find((label) => label.finalLabel.hookType)?.finalLabel.hookType || "";
  const source = text + hook;

  if (/UGC|나와버(?:ㄹ|르|림|린|렸|렸네)?|버ㄹ|ㄹ\.\.|[가-힣A-Za-z0-9]+코어|야호|POV|pov|저장각|장바구니각|SNS|구어체|짤|밈|유행어|결국|미쳤/.test(source)) return "UGC형";
  if (/후기|리뷰|써보고|알았음|찐|평점|인증/.test(source)) return "후기/리뷰형";
  if (/문제|불편|아직도|없이|왜 매번|놓쳤|버텼/.test(source)) return "문제제기형";
  if (/공감|나만|귀찮|이런 날|속으로|됨/.test(source)) return "공감형";
  if (/선물|부모님|명절|체면|고급|프리미엄/.test(source)) return "선물명분형";
  if (/긴급|한정|오늘|이번 구성|오래 안|마감/.test(source)) return "긴급/한정형";
  if (/상황|출근|주말|냉장고|여행|집들이|데일리/.test(source)) return "상황제안형";
  if (/(?:\d[\d,]*\s*(?:원|만원|천원|%|퍼센트)|가격|구성|가성비|할인|만원대|원대|특가|무료배송|쿠폰|반칙|납득)/.test(source)) return "가격정당화형";

  return hook || "상황제안형";
}

function inferPrimaryAppealPoint(labels: AdImageLabel[]) {
  const text = labels.map(labelText).join(" ");
  const existing = labels.find((label) => label.finalLabel.appealPoint)?.finalLabel.appealPoint || "";

  if (/선물|부모님|명절|추석|설날|답례|체면|생색|부담.*낮|부담.*덜/.test(text)) return "선물명분";
  if (/후기|리뷰|평점|별점|인증|써보|먹어보|사용자|찐후기|반응/.test(text)) return "후기신뢰";
  if (/무료배송|쿠폰|할인|특가|오늘만|즉시|바로|혜택|덤|사은품|증정/.test(text)) return "즉시혜택";
  if (/(?:\d[\d,]*\s*(?:원|만원|천원|%|퍼센트)|가격|가성비|가격 대비|가격대비|반값|만원대|원대|실속가)/.test(text)) return "가성비";
  if (/고급|프리미엄|품격|근사|대접|퀄리티|품질|럭셔리|상급|최고급/.test(text)) return "고급감";
  if (/한정|희소|품절|마감|마지막|구하기|드디어|찾았|레어|소량/.test(text)) return "희소성";
  if (/불편|해결|문제|고민|귀찮|번거|없이|아직도|왜\s*매번/.test(text)) return "불편해소";
  if (/성분|효능|효과|비타민|홍삼|유산균|단백질|저당|영양|원료|함량/.test(text)) return "성분/효능";
  if (/시간|빠르게|간편|간단|한번에|1분|즉석|바쁜|출근|퇴근/.test(text)) return "시간절약";
  if (/핏|체형|커버|보정|슬림|라인|키높이|몸매/.test(text)) return "체형보완";
  if (/자기관리|관리|루틴|운동|다이어트|건강|피부|뷰티|홈케어/.test(text)) return "자기관리";
  if (/나와버(?:ㄹ|르|림|린|렸|렸네)?|[가-힣A-Za-z0-9]+코어|야호|POV|pov|저장각|장바구니각|트렌드|유행|요즘|SNS|공유|인싸|취향|감성|소장/.test(text)) return "사회적 인정";
  if (/실속|구성|대용량|세트|쟁여|가족|온가족|가득|넉넉/.test(text)) return "실속";

  return existing || "";
}

function hasMemeTone(labels: AdImageLabel[]) {
  return /코어|나와버(?:ㄹ|르|림|린|렸|렸네)?|버ㄹ|ㄹ\.\.|저장각|장바구니각|야호|POV|pov|미쳤|반칙|아직도 없음|왜 이제 알았지|구어체|SNS|짤|밈|유행어|결국/.test(
    labels.map(labelText).join(" "),
  );
}

function productSubject(product: ProductInfoForPrompt, labels: AdImageLabel[]) {
  return (
    product.productName ||
    product.mainBenefit ||
    product.extractedDescription ||
    product.category ||
    labels[0]?.finalLabel.category ||
    labels[0]?.category ||
    "이 구성"
  );
}

function pricePhrase(product: ProductInfoForPrompt) {
  const source = [product.price, product.discountInfo, product.extractedDescription, product.mainBenefit].filter(Boolean).join(" ");
  const priceMatch = source.match(/[\d,]+\s*(?:원|만원|천원)/);
  if (priceMatch) return priceMatch[0].replace(/\s+/g, "");
  const percentMatch = source.match(/\d+\s*%/);
  if (percentMatch) return percentMatch[0].replace(/\s+/g, "");
  return product.price || product.discountInfo || "이 조건";
}

function shortProductKeyword(product: ProductInfoForPrompt, labels: AdImageLabel[]) {
  const text = [
    product.productName,
    product.mainBenefit,
    product.category,
    product.extractedDescription,
    labels[0]?.finalLabel.category,
  ].join(" ");

  if (/한우|소고기|쇠고기|등심|스테이크|갈비|불고기|육류|고기/.test(text)) return /한우/.test(text) ? "한우" : "소고기";
  if (/토마토/.test(text)) return "토마토";
  if (/강아지|반려견|댕댕|펫|간식/.test(text)) return "강아지";
  if (/케이크|디저트|빵|쿠키/.test(text)) return "디저트";
  if (/화장품|뷰티|크림|세럼|앰플|립/.test(text)) return "뷰티";
  if (/옷|패션|룩|가방|신발/.test(text)) return "룩";
  if (/건강|영양|비타민|유산균|홍삼/.test(text)) return "건강";
  if (/앱|서비스|메모|사진|정리/.test(text)) return "앱";

  const compact = (product.productName || product.category || labels[0]?.finalLabel.category || "이거")
    .replace(/[^\w가-힣\s]/g, " ")
    .split(/\s+/)
    .find((word) => word.length >= 2);
  return compact || "이거";
}

function referenceExpressionText(labels: AdImageLabel[]) {
  return labels.map((label) => [
    label.finalLabel.ocrText,
    label.finalLabel.trendElements,
    label.finalLabel.toneOfVoice,
    label.finalLabel.reusableCopyPattern,
    label.finalLabel.copyStructure,
    label.finalLabel.copyNuance,
  ].join(" ")).join(" ");
}

function referenceExpressionHeadline(product: ProductInfoForPrompt, labels: AdImageLabel[]) {
  const referenceText = referenceExpressionText(labels);
  const keyword = shortProductKeyword(product, labels);
  const price = pricePhrase(product);
  const parts: string[] = [];

  if (/POV|pov|피오브이/.test(referenceText)) {
    parts.push(`POV. ${price !== "이 조건" ? `${price} ${keyword}` : `${keyword}`} 발견한 나`);
  }

  const coreMatch = referenceText.match(/([가-힣A-Za-z0-9]+)코어/);
  if (coreMatch) {
    parts.push(`${keyword}코어`);
  }

  if (/야호/.test(referenceText)) {
    parts.push(`${keyword} 야호`);
  }

  if (/나와버(?:ㄹ|르|림|린|렸|렸네)?|나와\s*버림|버ㄹ|ㄹ\.\./.test(referenceText)) {
    parts.push(`${keyword} 나와버림`);
  }

  if (/저장각/.test(referenceText)) {
    parts.push(`${keyword} 저장각`);
  }

  if (/장바구니각/.test(referenceText)) {
    parts.push(`${keyword} 장바구니각`);
  }

  if (/미쳤/.test(referenceText)) {
    parts.push(`${keyword} 미쳤다`);
  }

  if (/반칙/.test(referenceText)) {
    parts.push(`${price}에 ${keyword}, 반칙`);
  }

  if (/국내\s*1위|국내1위|선정\s*1위|1위/.test(referenceText)) {
    parts.push(`국내 1위급 ${keyword}`);
  }

  return parts.slice(0, 3).join(" · ");
}

function fallbackHeadline(product: ProductInfoForPrompt, labels: AdImageLabel[]) {
  const subject = productSubject(product, labels);
  const benefit = product.mainBenefit || product.extractedDescription || labels[0]?.finalLabel.appealPoint || "살 이유";
  const hookType = inferPrimaryHookType(labels);
  const meme = hasMemeTone(labels);
  const referenceExpression = referenceExpressionHeadline(product, labels);
  const reusablePattern = adaptedReferencePattern(product, labels);

  if (referenceExpression) return referenceExpression;
  if (reusablePattern) return reusablePattern;
  if (hookType.includes("가격")) return `${pricePhrase(product)}이면 ${subject}, 납득됨`;
  if (hookType.includes("문제")) return `아직도 ${benefit} 없이 버텼다고?`;
  if (hookType.includes("공감")) return `나만 ${benefit} 귀찮았던 거 아니지?`;
  if (hookType.includes("후기")) return `써보고 왜 ${subject} 얘기 나오는지 알았음`;
  if (hookType.includes("UGC")) return meme ? `결국 ${subject} 나와버림` : `${subject}, 요즘 장바구니각`;
  if (hookType.includes("선물")) return `${pricePhrase(product)}에 선물 느낌은 제대로`;
  if (hookType.includes("긴급")) return `이번 ${subject} 구성은 오래 안 갈 듯`;
  if (hookType.includes("상황")) return `${product.targetCustomer || product.category || "오늘"}에 ${subject} 하나면 됨`;

  return `${subject}, ${benefit}로 이유가 생김`;
}

function primaryFinalLabel(labels: AdImageLabel[]) {
  return labels[0]?.finalLabel;
}

function firstFilled(...values: Array<string | undefined>) {
  return values.map((value) => value?.trim()).find(Boolean) || "";
}

function conciseAdSignal(value: string, maxLength = 54) {
  const normalized = value
    .replace(/\s+/g, " ")
    .replace(/^(레퍼런스|분석|소비자|구매자|광고)\s*[:：-]\s*/i, "")
    .trim();
  const firstSentence = normalized.split(/(?<=[.!?。])\s+/)[0] || normalized;
  return firstSentence.length > maxLength ? `${firstSentence.slice(0, maxLength).trim()}...` : firstSentence;
}

function isMetaAnalysisCopy(value: string) {
  return /소비자|심리|반영|제시|자극|유도|레퍼런스|패턴|분석|구조|구매\s*욕구|클릭\s*욕구|강조하여|집중시|상품\s*이미지|고급스러운\s*상품|가격이\s*대폭|대폭\s*인하|인하된\s*점|욕구를\s*자극|부각시켜|강조합니다/.test(value);
}

function isInvalidHeadlineCopy(value: string) {
  const normalized = value.replace(/\s+/g, "").trim();
  if (!normalized) return true;
  if (/^\d+$/.test(normalized)) return true;
  if (/^[\d,]+(?:원|만원|천원)?$/.test(normalized)) return true;
  if (normalized.length < 4) return true;
  if (isMetaAnalysisCopy(value)) return true;
  return false;
}

function adaptedReferencePattern(product: ProductInfoForPrompt, labels: AdImageLabel[]) {
  const fields = referenceFieldBundle(labels);
  const referenceText = referenceExpressionText(labels);
  const pattern = [
    fields.reusableCopyPattern,
    fields.firstLineHook,
    fields.copyStructure,
    referenceText,
  ].join(" ");
  const keyword = shortProductKeyword(product, labels);
  const subject = productSubject(product, labels);
  const price = pricePhrase(product);

  if (/찾았|찾았습니다|찾음/.test(pattern)) {
    if (price && price !== "이 조건") return `${price}에 ${keyword} 찾았습니다`;
    return `${keyword}, 드디어 찾았습니다`;
  }
  if (/가격\s*충격|가격충격|충격/.test(pattern) && price && price !== "이 조건") {
    return `${price}이라니, ${keyword} 이건 좀`;
  }
  if (/OO|XX|YY|ZZ/.test(pattern)) {
    return pattern
      .replace(/OO\s*만원대/g, price && price !== "이 조건" ? price : "이 가격")
      .replace(/OO/g, price && price !== "이 조건" ? price : "이 가격")
      .replace(/XX/g, keyword)
      .replace(/YY/g, subject)
      .replace(/ZZ/g, product.mainBenefit || labels[0]?.finalLabel.appealPoint || "혜택")
      .split(/[.!?。]/)[0]
      .slice(0, 28)
      .trim();
  }
  return "";
}

function referencePatternSummary(labels: AdImageLabel[]) {
  return labels.map((label, index) => {
    const finalLabel = label.finalLabel;
    return {
      index: index + 1,
      ocrText: finalLabel.ocrText || "",
      hookType: finalLabel.hookType || "",
      firstLineHook: finalLabel.firstLineHook || "",
      copyStructure: finalLabel.copyStructure || "",
      toneOfVoice: finalLabel.toneOfVoice || finalLabel.copyNuance || "",
      trendElements: finalLabel.trendElements || "",
      consumerInsight: finalLabel.consumerInsight || "",
      purchaseTrigger: finalLabel.purchaseTrigger || "",
      reusableCopyPattern: finalLabel.reusableCopyPattern || "",
      visualCopyRelation: finalLabel.visualCopyRelation || "",
      whyItWorks: finalLabel.whyItWorks || "",
    };
  });
}

function referenceFieldBundle(labels: AdImageLabel[]) {
  const finalLabel = primaryFinalLabel(labels);
  return {
    firstLineHook: firstFilled(finalLabel?.firstLineHook, finalLabel?.hookType),
    copyStructure: firstFilled(finalLabel?.copyStructure, finalLabel?.reusableCopyPattern),
    toneOfVoice: firstFilled(finalLabel?.toneOfVoice, finalLabel?.copyNuance),
    trendElements: firstFilled(finalLabel?.trendElements),
    consumerInsight: firstFilled(finalLabel?.consumerInsight, finalLabel?.targetEmotion),
    purchaseTrigger: firstFilled(finalLabel?.purchaseTrigger, finalLabel?.whyItWorks),
    reusableCopyPattern: firstFilled(finalLabel?.reusableCopyPattern, finalLabel?.copyStructure),
    visualCopyRelation: firstFilled(finalLabel?.visualCopyRelation, finalLabel?.layoutPattern),
    whyItWorks: firstFilled(finalLabel?.whyItWorks),
  };
}

function buildReferencePatternUsage(labels: AdImageLabel[], fallback?: Partial<ReferencePatternUsage>): ReferencePatternUsage {
  const fields = referenceFieldBundle(labels);
  const finalLabel = primaryFinalLabel(labels);

  return {
    usedHookPattern: firstFilled(fallback?.usedHookPattern, fields.firstLineHook, finalLabel?.hookType),
    usedCopyStructure: firstFilled(fallback?.usedCopyStructure, fields.copyStructure, "상단 후킹 → 혜택 강조 → 구매 명분 → CTA 구조"),
    usedToneOfVoice: firstFilled(fallback?.usedToneOfVoice, fields.toneOfVoice, finalLabel?.copyNuance),
    usedConsumerInsight: firstFilled(fallback?.usedConsumerInsight, fields.consumerInsight, finalLabel?.targetEmotion),
    usedPurchaseTrigger: firstFilled(fallback?.usedPurchaseTrigger, fields.purchaseTrigger, finalLabel?.whyItWorks),
    usedReusablePattern: firstFilled(fallback?.usedReusablePattern, fields.reusableCopyPattern, fields.copyStructure),
    usedVisualCopyRelation: firstFilled(fallback?.usedVisualCopyRelation, fields.visualCopyRelation, finalLabel?.layoutPattern),
  };
}

function buildCopyReasoning(labels: AdImageLabel[], fallback?: Partial<GeneratedCopyReasoning>): GeneratedCopyReasoning {
  const fields = referenceFieldBundle(labels);
  const finalLabel = primaryFinalLabel(labels);

  return {
    headlineReason: firstFilled(
      fallback?.headlineReason,
      `headline uses firstLineHook/reusableCopyPattern: ${firstFilled(fields.firstLineHook, fields.reusableCopyPattern, finalLabel?.hookType)}`,
    ),
    bodyReason: firstFilled(
      fallback?.bodyReason,
      `bodyCopy uses consumerInsight in polite banner tone: ${firstFilled(fields.consumerInsight, finalLabel?.targetEmotion)}`,
    ),
    highlightReason: firstFilled(
      fallback?.highlightReason,
      `highlightCopy uses purchaseTrigger/appealPoint: ${firstFilled(fields.purchaseTrigger, finalLabel?.appealPoint)}`,
    ),
    referencePatternUsed: firstFilled(fallback?.referencePatternUsed, fields.reusableCopyPattern, fields.copyStructure, fields.firstLineHook),
    consumerInsightUsed: firstFilled(fallback?.consumerInsightUsed, fields.consumerInsight, finalLabel?.targetEmotion),
    purchaseTriggerUsed: firstFilled(fallback?.purchaseTriggerUsed, fields.purchaseTrigger, fields.whyItWorks),
  };
}

function referenceAwareBody(product: ProductInfoForPrompt, labels: AdImageLabel[]) {
  const fields = referenceFieldBundle(labels);
  const subject = productSubject(product, labels);
  const keyword = shortProductKeyword(product, labels);
  const tone = fields.toneOfVoice;
  const insight = fields.consumerInsight;

  if (/야호|POV|pov|코어|나와버(?:ㄹ|르|림|린|렸|렸네)?|버ㄹ|ㄹ\.\.|저장각|장바구니각|SNS|구어체|반말|짤|밈|유행어/.test(referenceExpressionText(labels))) {
    return `${keyword} 얘기 나오면 일단 멈칫해요`;
  }
  const hookType = inferPrimaryHookType(labels);
  if (hookType.includes("가격")) return "선물용으로도 부담 덜해요";
  if (hookType.includes("선물")) return "선물용으로도 좋아요";
  if (hookType.includes("후기")) return "먹어보면 바로 아실 거예요";
  if (insight) return `${conciseAdSignal(insight)} 그래서 ${subject}가 먼저 눈에 들어옵니다.`;
  if (fields.copyStructure) return `${conciseAdSignal(fields.copyStructure)} 흐름으로 ${subject}를 살 이유를 만듭니다.`;
  return `${subject}를 고를 이유를 레퍼런스 말투에 맞춰 먼저 보여줍니다.`;
}

function referenceAwareHighlight(product: ProductInfoForPrompt, labels: AdImageLabel[]) {
  const fields = referenceFieldBundle(labels);
  const expression = referenceExpressionHeadline(product, labels);
  const adaptedPattern = adaptedReferencePattern(product, labels);
  const hookType = inferPrimaryHookType(labels);
  const appealPoint = inferPrimaryAppealPoint(labels);
  if (expression) return expression;
  if (adaptedPattern) return adaptedPattern;
  if (hookType.includes("가격")) return `${pricePhrase(product)}에 이 구성이면 반칙`;
  if (appealPoint === "선물명분") return "부담은 낮추고 선물 느낌은 제대로";
  if (appealPoint === "고급감") return "고급스러움은 살리고 부담은 낮게";
  if (appealPoint === "후기신뢰") return "후기로 먼저 증명된 선택";
  if (appealPoint === "희소성") return "이번 구성은 오래 안 갈 듯";
  if (appealPoint === "사회적 인정") return referenceExpressionHeadline(product, labels) || `${shortProductKeyword(product, labels)} 저장각`;
  if (fields.purchaseTrigger) return conciseAdSignal(fields.purchaseTrigger, 42);
  if (fields.reusableCopyPattern) return conciseAdSignal(fields.reusableCopyPattern, 42);
  return product.mainBenefit || product.discountInfo || labels[0]?.finalLabel.appealPoint || "지금 볼 이유 있음";
}

function referenceAwareBottom(product: ProductInfoForPrompt, labels: AdImageLabel[]) {
  const fields = referenceFieldBundle(labels);
  const hookType = inferPrimaryHookType(labels);
  const adaptedPattern = adaptedReferencePattern(product, labels);
  if (adaptedPattern && hookType.includes("가격")) return adaptedPattern;
  if (fields.purchaseTrigger) return conciseAdSignal(fields.purchaseTrigger, 46);
  if (hookType.includes("가격")) return `${pricePhrase(product)}이면 고민 짧게`;
  if (hookType.includes("선물")) return "부담은 낮추고 선물 느낌은 제대로";
  if (hookType.includes("UGC")) return "지금 장바구니각";
  if (hookType.includes("문제")) return "이 불편, 오늘 끝내기";
  return "구성 보고 판단하기";
}

function shouldRewriteHeadlineWithReference(headline: string, labels: AdImageLabel[]) {
  const referenceText = labels.map(labelText).join(" ");
  const hookType = inferPrimaryHookType(labels);
  const normalized = headline.trim();
  const expressionHeadline = referenceExpressionHeadline({} as ProductInfoForPrompt, labels);

  if (isGenericHeadline(normalized) || isInvalidHeadlineCopy(normalized)) return true;
  if (/만나보세요|기다립니다|필수 아이템|특별한 선택|새로워진|여러분/.test(normalized)) return true;
  if (expressionHeadline && !/(야호|POV|pov|코어|나와버(?:ㄹ|르|림|린|렸|렸네)?|저장각|장바구니각|미쳤|반칙|1위|결국)/.test(normalized)) return true;
  if (/(습니다|하세요|드립니다|제공합니다)$/.test(normalized) && /구어체|SNS|반말|UGC|짤|나와버(?:ㄹ|르|림|린|렸|렸네)?|코어|저장각/.test(referenceText)) return true;
  if (hookType.includes("가격") && !/(가격|구성|원|만원|납득|반칙|특가|할인)/.test(normalized)) return true;
  if (hookType.includes("문제") && !/(아직|왜|없이|버텼|놓쳤|귀찮|불편|\?)/.test(normalized)) return true;
  if (hookType.includes("공감") && !/(나만|이런 날|귀찮|됨|아니지|\?)/.test(normalized)) return true;
  if (hookType.includes("후기") && !/(써보고|알았|저장각|찐|후기|반응)/.test(normalized)) return true;
  if (hookType.includes("UGC") && !/(나와버(?:ㄹ|르|림|린|렸|렸네)?|코어|각|야호|미쳤|반칙|요즘|결국|POV|pov)/.test(normalized)) return true;
  if (hookType.includes("선물") && !/(선물|부담|체면|부모님|명분|고급)/.test(normalized)) return true;
  if (hookType.includes("긴급") && !/(오늘|이번|지금|오래 안|마감|고민 짧게)/.test(normalized)) return true;

  return false;
}

function shouldRewriteBodyWithReference(bodyCopy: string, labels: AdImageLabel[]) {
  const normalized = bodyCopy.trim();
  if (!normalized) return true;
  if (isMetaAnalysisCopy(normalized)) return true;
  if (/새 상품|즐거움|기다립니다|만나보세요|여러분|만족/.test(normalized)) return true;
  if (normalized.length > 42) return true;
  const hookType = inferPrimaryHookType(labels);
  const referenceText = referenceExpressionText(labels);
  if (/구어체|SNS|반말|UGC|짤|밈|유행어|나와버|코어|야호/.test(referenceText) && /(습니다|제공|강조|자극|유도)/.test(normalized)) return true;
  if (hookType.includes("가격") && /소비자|고급스러움|구매 욕구|심리/.test(normalized)) return true;
  return false;
}

function shouldRewriteHighlightWithReference(highlightCopy: string, labels: AdImageLabel[]) {
  const normalized = highlightCopy.trim();
  if (!normalized) return true;
  if (isMetaAnalysisCopy(normalized)) return true;
  if (/특별한|필수|즐거움|만족|기다립니다/.test(normalized)) return true;
  const hookType = inferPrimaryHookType(labels);
  if (hookType.includes("가격") && !/(가격|구성|원|만원|특가|할인|반칙|납득|찾았|무료|혜택)/.test(normalized)) return true;
  if (hookType.includes("UGC") && !/(나와버|코어|각|야호|미쳤|반칙|요즘|결국|POV|pov)/.test(normalized)) return true;
  return false;
}

function shouldRewriteBottomWithReference(bottomBarCopy: string, labels: AdImageLabel[]) {
  const normalized = bottomBarCopy.trim();
  if (!normalized) return true;
  if (isMetaAnalysisCopy(normalized)) return true;
  if (/자세한|클릭|확인|특별한|필수/.test(normalized)) return true;
  const hookType = inferPrimaryHookType(labels);
  if (hookType.includes("가격") && !/(가격|구성|원|만원|특가|할인|반칙|납득|찾았|무료|혜택)/.test(normalized)) return true;
  return false;
}

function hasStrongReferenceCopyPattern(labels: AdImageLabel[]) {
  const fields = referenceFieldBundle(labels);
  return Boolean(fields.reusableCopyPattern || fields.firstLineHook || fields.copyStructure || fields.trendElements);
}

function headlineMissesReferencePattern(headline: string, labels: AdImageLabel[]) {
  if (!hasStrongReferenceCopyPattern(labels)) return false;
  const fields = referenceFieldBundle(labels);
  const referenceText = [
    fields.reusableCopyPattern,
    fields.firstLineHook,
    fields.copyStructure,
    fields.trendElements,
    fields.purchaseTrigger,
  ].join(" ");
  const normalizedHeadline = headline.replace(/\s+/g, "");

  if (/OO|XX|YY|ZZ|찾|found|만원대|price range/i.test(referenceText) && !/(찾|만원|원|가격|구성|price|found)/i.test(normalizedHeadline)) return true;
  if (/POV|pov|core|코어|야호|나와|버림|저장|장바구니|SNS|UGC/i.test(referenceText) && !/(POV|pov|코어|야호|나와|버림|저장|장바구니|각|결국)/i.test(normalizedHeadline)) return true;
  if (/선물|부모|명절|체면|고급|premium|gift/i.test(referenceText) && !/(선물|부모|명절|체면|고급|격|부담)/i.test(normalizedHeadline)) return true;
  if (/후기|리뷰|평점|써보|먹어보|review/i.test(referenceText) && !/(후기|리뷰|평점|써보|먹어보|알았|유명)/i.test(normalizedHeadline)) return true;

  return false;
}

function applyReferenceNuance(copy: GeneratedAdCopy, product: ProductInfoForPrompt, labels: AdImageLabel[]): GeneratedAdCopy {
  const finalLabel = primaryFinalLabel(labels);
  if (!finalLabel) return copy;

  const fields = referenceFieldBundle(labels);
  const consumerInsight = fields.consumerInsight;
  const purchaseTrigger = fields.purchaseTrigger;
  const reusableCopyPattern = fields.reusableCopyPattern;
  const toneOfVoice = fields.toneOfVoice;

  const headline = shouldRewriteHeadlineWithReference(copy.headline, labels) || headlineMissesReferencePattern(copy.headline, labels)
    ? fallbackHeadline(product, labels)
    : copy.headline;

  const bodyCopy = !shouldRewriteBodyWithReference(copy.bodyCopy, labels)
    ? copy.bodyCopy
    : firstFilled(
        referenceAwareBody(product, labels),
        purchaseTrigger && `${purchaseTrigger} ${productSubject(product, labels)}로 바로 이어지게 잡았습니다.`,
        consumerInsight && `${consumerInsight}를 먼저 건드리고, ${productSubject(product, labels)}로 살 이유를 붙였습니다.`,
        toneOfVoice && `${toneOfVoice} 톤을 살려 광고보다 레퍼런스 같은 말맛을 먼저 냅니다.`,
        copy.bodyCopy,
      );

  const highlightCopy = !shouldRewriteHighlightWithReference(copy.highlightCopy, labels)
    ? copy.highlightCopy
    : firstFilled(referenceAwareHighlight(product, labels), purchaseTrigger, reusableCopyPattern, finalLabel.appealPoint, copy.highlightCopy);

  const bottomBarCopy = !shouldRewriteBottomWithReference(copy.bottomBarCopy, labels)
    ? copy.bottomBarCopy
    : firstFilled(referenceAwareBottom(product, labels), copy.bottomBarCopy);

  const whyThisWorks = [
    copy.whyThisWorks,
    `레퍼런스 반영: 왜 먹히는지(${firstFilled(fields.whyItWorks, "분석 없음")}), 첫 후킹(${firstFilled(fields.firstLineHook, finalLabel.hookType)}), 말투(${firstFilled(toneOfVoice, "톤 정보 없음")}), 구매 트리거(${firstFilled(purchaseTrigger, "트리거 정보 없음")}), 재사용 패턴(${firstFilled(reusableCopyPattern, "패턴 정보 없음")})을 새 상품 정보에 맞게 변형했습니다.`,
  ].filter(Boolean).join(" ");

  return {
    ...copy,
    headline,
    bodyCopy,
    highlightCopy,
    bottomBarCopy,
    whyThisWorks,
  };
}

function isGenericHeadline(value: string) {
  const normalized = value.trim();
  return !normalized || genericHeadlinePatterns.some((pattern) => pattern.test(normalized)) || normalized.length < 8;
}

function normalizeCopy(
  value: Partial<GeneratedAdCopy>,
  product: ProductInfoForPrompt,
  labels: AdImageLabel[],
  template?: { templateId?: string; templateName?: string; copyLimits?: TemplateCopyLimits },
): GeneratedAdCopy {
  const hookType = String(value.hookType || inferPrimaryHookType(labels));
  const appealPoint = String(value.appealPoint || inferPrimaryAppealPoint(labels) || labels[0]?.finalLabel.appealPoint || product.mainBenefit || "");
  const headline = replaceForbiddenPhrases(String(value.headline || ""));
  const bodyCopy = replaceForbiddenPhrases(String(value.bodyCopy || ""));
  const highlightCopy = replaceForbiddenPhrases(String(value.highlightCopy || ""));
  const bottomBarCopy = replaceForbiddenPhrases(String(value.bottomBarCopy || ""));
  const cta = replaceForbiddenPhrases(String(value.cta || ""));
  const incomingReasoning = (value as Partial<GeneratedAdCopy> & { reasoning?: Partial<GeneratedCopyReasoning> }).reasoning;

  const normalized: GeneratedAdCopy = {
    headline: isGenericHeadline(headline) || isInvalidHeadlineCopy(headline) ? fallbackHeadline(product, labels) : headline,
    bodyCopy: bodyCopy || mockCopy(product, labels, template).bodyCopy,
    highlightCopy: highlightCopy || mockCopy(product, labels, template).highlightCopy,
    bottomBarCopy: bottomBarCopy || mockCopy(product, labels, template).bottomBarCopy,
    cta: cta || "구성 보러가기",
    price: String(value.price || product.price || product.discountInfo || ""),
    hookType,
    appealPoint,
    whyThisWorks: String(
      value.whyThisWorks ||
        "선택한 레퍼런스의 OCR, hookType, copyNuance에서 후킹 구조를 뽑아 상품 정보에 맞게 변형했습니다.",
    ),
    templateFit: {
      templateId: template?.templateId || value.templateFit?.templateId,
      templateName: template?.templateName || value.templateFit?.templateName,
      usedCopyLimits: copyLimitCharSummary(template?.copyLimits),
      fitNotes: value.templateFit?.fitNotes || "선택한 템플릿의 문구 영역 길이 제한에 맞춰 작성했습니다.",
    },
    referencePatternUsage: buildReferencePatternUsage(labels, value.referencePatternUsage),
    reasoning: buildCopyReasoning(labels, incomingReasoning),
  };

  const referenceApplied = applyReferenceNuance(normalized, product, labels);
  const bodyCopyPolicy = normalizeBodyCopyForBanner(referenceApplied.bodyCopy, product, Math.min(36, bodyCopyMaxChars(template?.copyLimits)));
  const policyApplied: GeneratedAdCopy = {
    ...referenceApplied,
    bodyCopy: bodyCopyPolicy.bodyCopy,
    highlightCopy: normalizeNonHeadlineCopy(referenceApplied.highlightCopy, referenceAwareHighlight(product, labels), 34),
    bottomBarCopy: normalizeNonHeadlineCopy(referenceApplied.bottomBarCopy, referenceAwareBottom(product, labels), 38),
    copyValidation: {
      ...referenceApplied.copyValidation,
      bodyCopy: bodyCopyPolicy.validation,
    },
  };

  return {
    ...policyApplied,
    copyVariants: buildCopyVariants(policyApplied, product, template?.copyLimits),
  };
}

function finalizeCopyBody(copy: GeneratedAdCopy, product: ProductInfoForPrompt, copyLimits?: TemplateCopyLimits): GeneratedAdCopy {
  const bodyCopyPolicy = normalizeBodyCopyForBanner(copy.bodyCopy, product, Math.min(36, bodyCopyMaxChars(copyLimits)));
  const nextCopy = {
    ...copy,
    bodyCopy: bodyCopyPolicy.bodyCopy,
    copyValidation: {
      ...copy.copyValidation,
      bodyCopy: bodyCopyPolicy.validation,
    },
  };

  return {
    ...nextCopy,
    copyVariants: buildCopyVariants(nextCopy, product, copyLimits),
  };
}

function mockCopy(product: ProductInfoForPrompt, labels: AdImageLabel[], template?: { templateId?: string; templateName?: string; copyLimits?: TemplateCopyLimits }): GeneratedAdCopy {
  const first = labels[0]?.finalLabel;
  const hookType = inferPrimaryHookType(labels);
  const appealPoint = inferPrimaryAppealPoint(labels);
  const subject = productSubject(product, labels);
  const benefit = product.mainBenefit || product.extractedDescription || first?.appealPoint || "살 이유";
  const price = product.price || product.discountInfo || "";
  const meme = hasMemeTone(labels);
  const tone = firstFilled(first?.toneOfVoice, first?.copyNuance, "레퍼런스 말투");
  const insight = firstFilled(first?.consumerInsight, first?.targetEmotion, "고객이 느끼는 고민");
  const trigger = firstFilled(first?.purchaseTrigger, first?.whyItWorks, "지금 확인할 이유");
  const pattern = firstFilled(first?.reusableCopyPattern, first?.copyStructure, first?.firstLineHook, "레퍼런스 카피 패턴");

  const base: GeneratedAdCopy = {
    headline: fallbackHeadline(product, labels),
    bodyCopy: buildFallbackBodyCopy(product),
    highlightCopy: trigger || benefit,
    bottomBarCopy: pattern || `${first?.hookType || hookType} 구조로 클릭 전 이유를 먼저 만듭니다.`,
    cta: "구성 보러가기",
    price,
    hookType,
    appealPoint: appealPoint || first?.appealPoint || benefit,
    whyThisWorks: `레퍼런스 반영: ${firstFilled(first?.firstLineHook, first?.hookType)} / ${tone} / ${pattern}을 새 상품 정보에 맞춰 변형했습니다.`,
    templateFit: {
      templateId: template?.templateId,
      templateName: template?.templateName,
      usedCopyLimits: copyLimitCharSummary(template?.copyLimits),
      fitNotes: "선택한 템플릿의 문구 영역 길이 제한에 맞춰 작성했습니다.",
    },
    referencePatternUsage: buildReferencePatternUsage(labels, {
      usedHookPattern: "선택된 레퍼런스의 hookType과 firstLineHook을 참고한 강한 후킹형 문구",
      usedCopyStructure: "상단 후킹 → 혜택 강조 → 구매 명분 구조",
      usedToneOfVoice: tone,
      usedConsumerInsight: insight,
      usedPurchaseTrigger: trigger,
      usedReusablePattern: pattern,
      usedVisualCopyRelation: "상단 헤드라인과 하단 CTA에 적합한 구조",
    }),
  };

  if (hookType.includes("가격")) {
    return finalizeCopyBody({
      ...base,
      bodyCopy: price ? `${price}라면 이유가 충분해요` : "이 구성이라면 납득돼요",
      highlightCopy: `${price || "이 가격"}이면 사도 되는 이유`,
    }, product, template?.copyLimits);
  }
  if (hookType.includes("문제")) {
    return finalizeCopyBody({
      ...base,
      bodyCopy: "그 불편, 오늘 줄여보세요",
      highlightCopy: `${benefit} 놓치기 전에`,
    }, product, template?.copyLimits);
  }
  if (hookType.includes("공감")) {
    return finalizeCopyBody({
      ...base,
      bodyCopy: "이런 날엔 하나면 충분해요",
      highlightCopy: `이런 날엔 ${subject} 하나면 됨`,
    }, product, template?.copyLimits);
  }
  if (hookType.includes("후기")) {
    return finalizeCopyBody({
      ...base,
      bodyCopy: "써보면 바로 아실 거예요",
      highlightCopy: meme ? "이건 저장각" : "써보면 납득되는 구성",
    }, product, template?.copyLimits);
  }
  if (hookType.includes("UGC")) {
    return finalizeCopyBody({
      ...base,
      bodyCopy: meme ? "가볍게 담아보세요" : "부담 없이 살펴보세요",
      highlightCopy: meme ? "지금 장바구니각" : benefit,
    }, product, template?.copyLimits);
  }
  if (hookType.includes("선물")) {
    return finalizeCopyBody({
      ...base,
      bodyCopy: "선물용으로도 좋아요",
      highlightCopy: `${price || "이 조건"}에 선물 느낌은 제대로`,
    }, product, template?.copyLimits);
  }
  if (hookType.includes("긴급")) {
    return finalizeCopyBody({
      ...base,
      bodyCopy: "오늘 조건이면 챙겨두세요",
      highlightCopy: "오늘 조건이면 고민 짧게",
    }, product, template?.copyLimits);
  }

  return finalizeCopyBody(base, product, template?.copyLimits);
}

async function generateWithOpenAI(
  product: ProductInfoForPrompt,
  labels: AdImageLabel[],
  template?: { templateId?: string; templateName?: string; copyLimits?: TemplateCopyLimits },
) {
  const formattedReferenceLabels = formatReferenceLabelsForCopyGeneration(labels);
  const copyLimitSummary = copyLimitCharSummary(template?.copyLimits);
  const templateLimitLines = (Object.keys(DEFAULT_TEMPLATE_COPY_LIMIT_CHARS) as Array<keyof typeof DEFAULT_TEMPLATE_COPY_LIMIT_CHARS>)
    .map((slot) => `- ${slot}: ${copyLimitSummary[slot] || DEFAULT_TEMPLATE_COPY_LIMIT_CHARS[slot]}자 이내`)
    .join("\n");
  const copyPromptHardening = `
[STRICT COPY GENERATION RULES]
You are generating Korean SNS/ecommerce performance ad copy, not generic brand copy.
Use exactly ONE selected reference label as the primary pattern source. Do not average multiple references.

Reference field priority:
1. reusableCopyPattern
2. firstLineHook
3. copyStructure
4. consumerInsight
5. purchaseTrigger
6. toneOfVoice
7. trendElements
8. visualCopyRelation
9. hookType
10. appealPoint
11. copyNuance
12. whyItWorks

Headline rules:
- Headline is the most important slot.
- It must visibly adapt firstLineHook or reusableCopyPattern when either exists.
- It must not be a vague brand line.
- Never output only a number or a bare price as headline.
- If a reference pattern says "OO price range found XX", transform it into a natural product-specific Korean headline.
- If the reference has meme/UGC syntax such as POV, ~core, yaw-ho, saved-it, came-out, or intentionally broken sentence endings, adapt that syntax only when the reference actually has that tone.
- If the reference is price/gift/premium, do not force meme syntax.

Body/highlight/bottom/CTA rules:
- bodyCopy must be polite Korean, one short sentence, banner-ready, and not a calm generic brand sentence.
- bodyCopy must reflect consumerInsight or purchaseTrigger.
- highlightCopy must reflect reusableCopyPattern, purchaseTrigger, price/configuration/benefit, or the strongest USP.
- bottomBarCopy must be a short purchase reason or urgency line.
- CTA must be a concrete action.

Forbidden output:
- Generic abstract copy such as "meet the new joy", "waiting for you", "special choice", "must-have item".
- Meta-analysis text such as "this reflects consumer psychology" inside copy slots.
- Awkward Korean like a bare number plus unclear predicate.
- Any emoji or emoticon.

Return JSON only. Include reasoning with:
headlineReason, bodyReason, highlightReason, referencePatternUsed, consumerInsightUsed, purchaseTriggerUsed.
`;
  const prompt = `
${copyPromptHardening}
너는 일반 브랜드 카피라이터가 아니라, 한국 이커머스 퍼포먼스 광고의 후킹 문구를 만드는 마케터다.
예쁜 문장보다 클릭을 유도하는 첫 문장, 소비자 공감, 가격정당화, 선물명분, 후기형 말투, SNS식 표현을 우선한다.
단, 모든 문구를 밈처럼 만들지 말고 referenceLabels의 실제 카피 톤에 맞춰야 한다.

목표:
선택된 referenceLabels의 finalLabel.ocrText, hookType, appealPoint, copyNuance, targetEmotion, whyItWorks,
firstLineHook, copyStructure, toneOfVoice, trendElements, consumerInsight, purchaseTrigger, reusableCopyPattern, visualCopyRelation을 분석해서
특정 문구를 복사하지 않고 "카피 패턴"만 추출한 뒤 새 상품에 맞게 변형한다.
상품 상세페이지 정보에서는 실제 USP, 가격, 구성, 혜택, 구매 명분을 뽑고,
레퍼런스 라벨에서는 후킹 방식, 말투, 소구 구조, 카피 문법을 뽑아 두 정보를 분리해서 결합한다.
landingUrl 자체를 카피에 쓰지 말고, 추출된 productName, category, price, discountInfo, mainBenefit, extractedDescription만 근거로 쓴다.

가장 중요한 규칙:
- 생성 결과는 선택한 referenceLabels의 뉘앙스가 눈에 보여야 한다.
- 최소 2개 이상을 반드시 반영한다: firstLineHook, copyStructure, toneOfVoice, consumerInsight, purchaseTrigger, reusableCopyPattern, trendElements.
- 선택한 레퍼런스의 finalLabel은 단순 설명 데이터가 아니라, 광고 문구 생성의 패턴 DB다.
- firstLineHook은 첫 줄에서 시선을 끄는 방식, copyStructure는 설득 순서, toneOfVoice는 말투/리듬, copyNuance는 미묘한 문법, consumerInsight는 소비자 심리, purchaseTrigger는 구매 트리거, reusableCopyPattern은 가장 중요한 재사용 가능한 광고 문법, visualCopyRelation은 문구가 이미지/레이아웃에서 맡는 역할로 사용한다.
- 기존 문구를 그대로 복사하지 말고 광고 문법/소구 구조/소비자 심리만 현재 상품에 맞게 변형한다.
- whyThisWorks에는 어떤 레퍼런스 분석 필드를 반영했는지 구체적으로 적는다.
- 레퍼런스가 구어체/SNS/UGC 톤이면 정중한 브랜드 문장으로 만들지 않는다.
- 레퍼런스가 가격정당화형이면 가격이 싼 문구보다 "이 가격이면 사도 되는 이유"를 만든다.
- 레퍼런스가 선물/고급형이면 밈을 억지로 넣지 않는다.
- 레퍼런스 OCR에 "야호", "POV", "~코어", "나와버림", "저장각", "장바구니각" 같은 실제 표현 장치가 있으면, 단어를 그대로 복사하기보다 새 상품 키워드에 치환해 재조합한다.
- 예: 레퍼런스가 "토마토코어", "야호", "POV" 톤이고 새 상품이 소고기/한우라면 "소고기코어", "한우 야호", "POV. 오늘 한우 고른 나"처럼 표현 장치를 상품에 맞게 변형한다.
- 단, 레퍼런스에 그런 밈/UGC 표현이 없으면 억지로 넣지 않는다.

작업 순서:
1. 상품 상세페이지 정보에서 상품 특장을 요약한다.
   - 무엇을 파는가
   - 왜 이 가격/구성이 납득되는가
   - 구매자가 지금 살 명분은 무엇인가
   - 광고에 쓸 수 있는 구체 USP는 무엇인가
2. 각 referenceLabel에서 아래 Reference Copy Pattern을 먼저 추출한다.
   - 원문 OCR
   - 첫 문장의 후킹 방식
   - 문장 톤
   - 소구점
   - 소비자 감정
   - 밈/유행어/구어체 여부
   - 가격/혜택/문제제기/후기/선물명분 구조 여부
   - 소비자 인사이트와 구매 트리거
   - 재사용 가능한 카피 골격
   - 비주얼과 문구가 연결되는 방식
   - 새 상품에 적용 가능한 변형 방향
3. 여러 레퍼런스 중 새 상품 카테고리와 가장 맞는 패턴을 고른다.
4. 상품 특장과 카피 패턴을 결합한다.
5. OCR 문구는 그대로 복사하지 말고 문장 구조, 말투, 감정, CTA 구조만 변형한다.
6. 상품 정보가 부족해도 "새 상품", "즐거움", "필수 아이템" 같은 일반 문구로 도망가지 말고 referenceLabels의 패턴을 우선한다.

hookType별 생성 규칙:
- 가격정당화형: 가격이 싸다는 말보다 "이 가격이면 납득된다"는 명분을 만든다. 예: "4만원대로 생색 제대로", "이 구성에 이 가격이면 반칙"
- 문제제기형: 소비자가 가진 불편함이나 결핍을 먼저 찌른다. 예: "아직도 이거 없이 버텼다고?", "왜 매번 이걸 놓쳤지?"
- 공감형: 소비자가 속으로 생각할 법한 말을 쓴다. 예: "나만 이거 귀찮았던 거 아니지?", "이런 날엔 이거 하나면 됨"
- 후기/리뷰형: 실제 사용자의 반응처럼 보이게 쓴다. 예: "써보고 왜 유명한지 알았음", "이건 저장각"
- UGC형: 너무 광고 같지 않고 SNS 게시글/짤 같은 말투로 쓴다. 예: "결국 나와버림", "요즘 이거 없는 사람?"
- 선물명분형: 가격보다 체면, 명분, 고급감을 함께 살린다. 예: "부담은 낮추고 선물 느낌은 제대로", "이 가격에 이 정도면 부모님 선물각"
- 긴급/한정형: 지금 사야 할 이유를 분명하게 만든다. 예: "이번 구성은 오래 안 갈 듯", "오늘 가격이면 고민 짧게"
- 상황제안형: 특정 상황에서 왜 필요한지 보여준다. 예: "출근룩에 이거 하나면 끝", "주말 냉장고 채우기용으로 딱"

밈/트렌드 표현 사용 규칙:
"~코어", "나와버림", "저장각", "장바구니각", "야호", "미쳤다", "반칙", "아직도 없음?", "이거 왜 이제 알았지"는
ocrText와 copyNuance에 그런 톤이 있을 때만 사용한다.
감성형/고급형 레퍼런스면 고급스럽게, 가격형이면 가격정당화형으로, 밈형이면 밈형으로 생성한다.

금지 표현:
만나보세요, 기다립니다, 필수 아이템, 특별한 선택, 자세한 정보, 여기를 클릭, 새로워진 즐거움,
만족을 줄 수 있음, 여러분을 기다립니다, 지금 바로 확인하기

[bodyCopy 작성 규칙]
- bodyCopy는 반드시 존댓말 형식으로 작성하세요.
- 단, 문구의 에너지와 광고 톤을 갑자기 차분하게 바꾸지 마세요.
- 홈쇼핑형, SNS형, 구어체형, 강한 후킹형 톤은 유지할 수 있습니다.
- 핵심은 반말/비격식 종결을 존댓말 종결로 바꾸는 것입니다.

예:
- "쟁여둬" → "쟁여두세요"
- "덤이야" → "덤입니다"
- "놓치지 마" → "놓치지 마세요"
- "먹어봐야 알지" → "먹어보면 바로 아실 거예요"
- "즐기기 좋음" → "즐기기 좋아요"
- "사야 함" → "사야 해요"
- "추천함" → "추천드려요"

잘못된 방향:
- 캐주얼한 문구를 갑자기 너무 차분하고 딱딱한 브랜드 문구로 바꾸는 것
- 홈쇼핑형 톤을 전부 프리미엄/정중한 톤으로 바꾸는 것
- 원래 문구의 후킹감과 구매 유도감을 없애는 것

좋은 방향:
- 원래 문구의 가벼움과 구매 유도감은 유지
- 종결만 존댓말로 정리
- 배너에 들어갈 수 있게 짧게 압축

bodyCopy 길이 규칙:
- bodyCopy는 배너 안에 들어가는 짧은 보조 문구입니다.
- 28자 이내를 권장합니다.
- 최대 36자를 넘지 마세요.
- 한 문장으로 작성하세요.
- 쉼표가 많은 긴 문장을 만들지 마세요.
- 두 개 이상의 메시지를 억지로 한 문장에 넣지 마세요.
- headline이나 highlightCopy에서 이미 말한 내용을 반복하지 마세요.
- 가격/할인/구성 정보는 highlightCopy 또는 bottomBarCopy에 우선 배치하고, bodyCopy에는 구매 명분이나 사용 상황을 짧게 넣으세요.

좋은 bodyCopy 예시:
- 지금 쟁여두세요
- 이것까지 덤입니다
- 특별한 날에도 좋아요
- 집에서도 근사하게 즐겨보세요
- 부담 없이 즐겨보세요
- 먹어보면 바로 아실 거예요
- 오늘 식탁에 딱이에요
- 선물용으로도 좋아요

나쁜 bodyCopy 예시:
- 지금 바로 쟁여둬
- 이것까지 덤이야
- 특별한 날엔 물론, 일상에서도 즐기기 좋음
- 이 가격에 이런 품질? 먹어봐야 알지! 고급스러움과 가성비, 모두 갖춘 스테이크는 덤이야.

copyVariants의 bodyCopy 규칙:
- short.bodyCopy: 20자 이내, 존댓말
- medium.bodyCopy: 28자 이내, 존댓말
- long.bodyCopy: 36자 이내, 존댓말
- 모든 bodyCopy는 한 문장
- 반말 종결 금지
- 캐주얼한 광고 톤은 유지 가능
- 반말 표현은 같은 의미의 존댓말 표현으로 최소 수정

대체 방향:
- "만나보세요" 대신 "이건 좀 확인각" 또는 톤에 맞는 행동형 문구
- "기다립니다" 대신 "지금 장바구니각"
- "필수 아이템" 대신 "없으면 괜히 아쉬운템"
- "자세한 정보는 여기를 클릭하세요" 대신 "구성 바로 보기"
- "지금 바로 확인하기" 대신 "구성 보러가기"

상품 정보:
${JSON.stringify(product, null, 2)}

[선택된 배너 템플릿 정보]
templateId: ${template?.templateId || "none"}
templateName: ${template?.templateName || "템플릿 미선택"}

[템플릿 문구 영역 제한]
아래 제한은 실제 배너 템플릿에 들어가는 문구 영역 기준입니다.
반드시 각 슬롯의 maxChars를 지켜서 문구를 작성하세요.
${templateLimitLines}

[선택 템플릿별 문구 배치 전략]
${templateCopyStrategy(template?.templateId)}

각 문구는 배너에 바로 들어갈 수 있어야 합니다.
문구가 길어져서 잘릴 가능성이 있으면 더 짧게 작성하세요.

[슬롯별 문구 역할]
headline:
- 가장 강한 첫 줄 후킹
- 짧고 직관적
- 1초 안에 읽히는 문구

bodyCopy:
- 짧은 보조 설명
- 반드시 존댓말 형식
- 캐주얼한 톤은 가능하지만 반말 종결은 금지
- 한 문장
- 너무 많은 정보를 넣지 말 것

highlightCopy:
- 핵심 혜택, 구성, 할인, USP 강조
- 숫자/구성/특가 정보가 있다면 이 슬롯에 우선 배치

bottomBarCopy:
- 하단 띠배너에 들어갈 구매 명분 또는 혜택 요약
- 가격/특가/한정성/구성 정보를 짧게 정리

cta:
- 클릭/구매 유도 문구
- 매우 짧게 작성
- 예: 구성보기, 지금확인, 바로보기, 혜택보기

price:
- 가격 또는 할인 정보
- 상품 정보에 가격이 없으면 빈 문자열 가능

[선택한 레퍼런스 광고 패턴]
${formattedReferenceLabels}

[레퍼런스 활용 규칙]
- referenceLabels는 원문 복사 대상이 아닙니다.
- referenceLabels는 광고 문법/소구 구조/소비자 심리를 참고하기 위한 패턴 DB입니다.
- 현재 상품과 맞지 않는 소구점은 억지로 사용하지 마세요.
- 여러 레퍼런스가 선택된 경우 공통 패턴을 우선 반영하고, 충돌하는 톤은 현재 상품 카테고리에 더 적합한 쪽을 선택하세요.
- reusableCopyPattern, consumerInsight, purchaseTrigger를 가장 중요하게 반영하세요.
- appealPoint는 "표현 방식"이 아니라 소비자가 사야 하는 핵심 이유입니다.
- 가격/할인/원/만원대/무료배송/쿠폰/특가가 핵심이면 가성비 또는 즉시혜택을 고르세요.
- 선물/부모님/명절/체면/생색/부담 낮춤이 핵심이면 선물명분을 고르세요.
- 고급/품질/프리미엄/대접감이 핵심이면 고급감을 고르세요.
- 후기/평점/인증/사용자 반응이 핵심이면 후기신뢰를 고르세요.
- 밈/트렌드/SNS/"~코어"/"야호"/"POV"가 핵심이면 사회적 인정을 우선 고려하세요. 가격 정보가 명시되지 않으면 가성비로 도망가지 마세요.

여러 레퍼런스가 선택된 경우:
- 공통적으로 반복되는 hookType, appealPoint, consumerInsight, purchaseTrigger를 우선 반영하세요.
- 톤이 충돌하면 현재 상품 카테고리와 가장 잘 맞는 toneOfVoice를 선택하세요.
- 세 레퍼런스를 억지로 모두 섞지 마세요.
- 가장 강한 reusableCopyPattern 하나를 중심으로 문구를 설계하세요.
- 필요한 경우 두 번째 레퍼런스의 purchaseTrigger만 보조적으로 반영하세요.

[선택 레퍼런스 카피 패턴 요약 JSON]
${JSON.stringify(referencePatternSummary(labels), null, 2)}

referenceLabels:
${JSON.stringify(labels.map((label) => ({
  imageId: label.imageId,
  category: label.category,
  brandName: label.brandName,
  sourcePlatform: label.sourcePlatform,
  finalLabel: {
    ocrText: label.finalLabel.ocrText,
    category: label.finalLabel.category,
    hookType: label.finalLabel.hookType,
    appealPoint: label.finalLabel.appealPoint,
    targetEmotion: label.finalLabel.targetEmotion,
    copyNuance: label.finalLabel.copyNuance,
    visualTone: label.finalLabel.visualTone,
    layoutPattern: label.finalLabel.layoutPattern,
    whyItWorks: label.finalLabel.whyItWorks,
    recommendedUse: label.finalLabel.recommendedUse,
    firstLineHook: label.finalLabel.firstLineHook,
    copyStructure: label.finalLabel.copyStructure,
    toneOfVoice: label.finalLabel.toneOfVoice,
    trendElements: label.finalLabel.trendElements,
    consumerInsight: label.finalLabel.consumerInsight,
    purchaseTrigger: label.finalLabel.purchaseTrigger,
    reusableCopyPattern: label.finalLabel.reusableCopyPattern,
    visualCopyRelation: label.finalLabel.visualCopyRelation,
  },
})), null, 2)}

반환 규칙:
- JSON만 반환한다.
- headline, bodyCopy, highlightCopy, bottomBarCopy, cta, whyThisWorks에는 이모지/이모티콘/그림문자/장식 기호를 절대 쓰지 않는다.
- "야호", "POV", "~코어" 같은 텍스트 밈 표현은 가능하지만 😂🔥✨✅⭐ 같은 이모지는 금지한다.
- headline은 firstLineHook, reusableCopyPattern, trendElements를 우선 반영해 첫 1초에 레퍼런스 말맛이 보여야 한다.
- bodyCopy는 존댓말 형식의 짧은 배너용 보조 문구다. 캐주얼한 광고 톤은 유지 가능하지만 28자 이내 권장, 최대 36자, 한 문장으로 쓴다.
- bodyCopy는 선택한 템플릿의 bodyCopy maxChars를 반드시 지켜야 한다.
- highlightCopy는 purchaseTrigger, whyItWorks, appealPoint 중 가장 강한 소구 하나를 짧게 쓴다.
- bottomBarCopy는 whyItWorks에서 나온 구매 명분 또는 긴급성을 CTA 직전 문구로 바꾼다.
- cta는 "구성 보러가기", "혜택 보기", "장바구니 담기"처럼 구체적인 행동으로 쓴다.
- price는 상품 정보의 price 또는 discountInfo를 활용한다.
- whyThisWorks는 반드시 어떤 레퍼런스의 어떤 분석 항목(왜 먹히는지, 말투, 구매 트리거, 재사용 패턴)을 응용했는지 설명한다.
- referencePatternUsage는 어떤 레퍼런스 패턴을 실제 생성에 사용했는지 사람이 읽을 수 있게 설명한다.

응답하기 전에 bodyCopy를 자체 검수하세요.
- 반말 종결이면 존댓말 종결로 바꿔서 다시 작성
- 단, 문구 톤 자체를 과하게 차분하게 바꾸지 말 것
- 36자를 넘으면 다시 작성
- 한 문장 이상이면 다시 작성
- 배너에서 잘릴 것 같으면 더 짧게 작성

반환 JSON:
{
  "headline": "",
  "bodyCopy": "존댓말 형식의 짧은 배너용 보조 문구. 캐주얼한 광고 톤은 유지 가능. 28자 이내 권장, 최대 36자. 한 문장.",
  "highlightCopy": "",
  "bottomBarCopy": "",
  "cta": "",
  "price": "",
  "hookType": "",
  "appealPoint": "",
  "whyThisWorks": "",
  "templateFit": {
    "templateId": "${template?.templateId || ""}",
    "templateName": "${template?.templateName || ""}",
    "usedCopyLimits": ${JSON.stringify(copyLimitSummary)},
    "fitNotes": "선택한 템플릿의 headline/bodyCopy/highlightCopy/bottomBarCopy/cta 길이 제한에 맞춰 작성했습니다."
  },
  "referencePatternUsage": {
    "usedHookPattern": "",
    "usedCopyStructure": "",
    "usedToneOfVoice": "",
    "usedConsumerInsight": "",
    "usedPurchaseTrigger": "",
    "usedReusablePattern": "",
    "usedVisualCopyRelation": ""
  },
  "copyVariants": {
    "short": {
      "headline": "",
      "bodyCopy": "",
      "highlightCopy": "",
      "bottomBarCopy": "",
      "cta": "",
      "price": ""
    },
    "medium": {
      "headline": "",
      "bodyCopy": "",
      "highlightCopy": "",
      "bottomBarCopy": "",
      "cta": "",
      "price": ""
    },
    "long": {
      "headline": "",
      "bodyCopy": "",
      "highlightCopy": "",
      "bottomBarCopy": "",
      "cta": "",
      "price": ""
    }
  }
}
`;

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
    throw new Error(`OpenAI 광고문구 생성 실패: HTTP ${response.status}`);
  }

  const data = await response.json();
  const text =
    data.output_text ||
    data.output?.flatMap((item: { content?: { text?: string }[] }) => item.content ?? []).map((item: { text?: string }) => item.text).join("") ||
    "";

  return normalizeCopy(parseJsonObject(text), product, labels, template);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const product = normalizeProduct(body.productInfo);
    const template = {
      templateId: body.templateId,
      templateName: body.templateName,
      copyLimits: body.copyLimits,
    };
    const allLabels = await readAdImageLabels();
    const selectedLabels = selectReferenceLabels(product, allLabels, body.referenceLabels ?? []);

    if (!selectedLabels.length) {
      return NextResponse.json(
        { ok: false, error: "참고할 라벨 데이터가 없습니다. 먼저 이미지 라벨을 저장해주세요." },
        { status: 400 },
      );
    }

    const rawCopy = process.env.OPENAI_API_KEY ? await generateWithOpenAI(product, selectedLabels, template) : mockCopy(product, selectedLabels, template);
    const variantCopy = applyPreferredVariant(rawCopy, body.copyLimits);
    const fitted = body.templateId
      ? fitCopyToTemplate({ copy: variantCopy, templateId: body.templateId, copyLimits: body.copyLimits })
      : null;
    const copy = {
      ...variantCopy,
      ...(fitted ? {
        headline: fitted.headline,
        bodyCopy: fitted.bodyCopy,
        highlightCopy: fitted.highlightCopy,
        bottomBarCopy: fitted.bottomBarCopy,
        cta: fitted.cta,
        price: fitted.price || rawCopy.price,
      } : {}),
      templateFit: {
        ...variantCopy.templateFit,
        templateId: body.templateId || variantCopy.templateFit?.templateId,
        templateName: body.templateName || variantCopy.templateFit?.templateName,
        usedCopyLimits: copyLimitCharSummary(body.copyLimits),
        fitNotes: fitted?.slotFits.some((slot) => slot.status === "trimmed")
          ? `${variantCopy.templateFit?.fitNotes || ""} 선택한 템플릿의 문구 영역 길이 제한에 맞춰 일부 문구를 압축했습니다.`.trim()
          : `${variantCopy.templateFit?.fitNotes || ""} 선택한 템플릿의 문구 영역 길이 제한에 맞춰 작성했습니다.`.trim(),
      },
      copyVariants: variantCopy.copyVariants || buildCopyVariants(variantCopy, product, body.copyLimits),
    } satisfies GeneratedAdCopy;

    return NextResponse.json({
      ok: true,
      copy,
      referenceLabels: selectedLabels,
      isMock: !process.env.OPENAI_API_KEY,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "광고문구 생성 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
