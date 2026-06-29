import { NextResponse } from "next/server";
import { readAdImageLabels } from "../../../lib/mvp/labelStore";
import { AdImageLabel, GeneratedAdCopy, GeneratedAdCopyVariant, ProductInfoForPrompt } from "../../../lib/mvp/types";

type Body = {
  productInfo?: Partial<ProductInfoForPrompt>;
  referenceLabels?: AdImageLabel[];
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
    .slice(0, requestedLabels.length ? 3 : 5);
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

function compactCta(value: string) {
  const text = replaceForbiddenPhrases(value || "");
  if (copyLength(text) <= 10) return text || "구성보기";
  if (/혜택|할인|특가/.test(text)) return "혜택보기";
  if (/장바구니|담/.test(text)) return "담아보기";
  if (/구성|세트|상품/.test(text)) return "구성보기";
  return "보러가기";
}

function buildCopyVariants(copy: GeneratedAdCopy): GeneratedAdCopy["copyVariants"] {
  const existing = copy.copyVariants;
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
      bodyCopy: shortenCopy(existing?.short?.bodyCopy || base.bodyCopy, 24, base.bodyCopy),
      highlightCopy: shortenCopy(existing?.short?.highlightCopy || base.highlightCopy, 18, base.highlightCopy),
      bottomBarCopy: shortenCopy(existing?.short?.bottomBarCopy || base.bottomBarCopy, 22, base.bottomBarCopy),
      cta: compactCta(existing?.short?.cta || base.cta),
      price: existing?.short?.price || base.price,
    },
    medium: {
      headline: shortenCopy(existing?.medium?.headline || base.headline, 16, base.headline),
      bodyCopy: shortenCopy(existing?.medium?.bodyCopy || base.bodyCopy, 40, base.bodyCopy),
      highlightCopy: shortenCopy(existing?.medium?.highlightCopy || base.highlightCopy, 26, base.highlightCopy),
      bottomBarCopy: shortenCopy(existing?.medium?.bottomBarCopy || base.bottomBarCopy, 30, base.bottomBarCopy),
      cta: compactCta(existing?.medium?.cta || base.cta),
      price: existing?.medium?.price || base.price,
    },
    long: {
      headline: shortenCopy(existing?.long?.headline || base.headline, 22, base.headline),
      bodyCopy: shortenCopy(existing?.long?.bodyCopy || base.bodyCopy, 56, base.bodyCopy),
      highlightCopy: shortenCopy(existing?.long?.highlightCopy || base.highlightCopy, 34, base.highlightCopy),
      bottomBarCopy: shortenCopy(existing?.long?.bottomBarCopy || base.bottomBarCopy, 38, base.bottomBarCopy),
      cta: compactCta(existing?.long?.cta || base.cta),
      price: existing?.long?.price || base.price,
    },
  };
}

function inferPrimaryHookType(labels: AdImageLabel[]) {
  const text = labels.map(labelText).join(" ");
  const hook = labels.find((label) => label.finalLabel.hookType)?.finalLabel.hookType || "";

  if (/가격|구성|가성비|할인|만원|원|반칙|납득/.test(text + hook)) return "가격정당화형";
  if (/문제|불편|아직도|없이|왜 매번|놓쳤|버텼/.test(text + hook)) return "문제제기형";
  if (/공감|나만|귀찮|이런 날|속으로|됨/.test(text + hook)) return "공감형";
  if (/후기|리뷰|써보고|알았음|저장각|찐/.test(text + hook)) return "후기/리뷰형";
  if (/UGC|나와버림|코어|야호|미쳤|장바구니각|SNS|구어체|짤/.test(text + hook)) return "UGC형";
  if (/선물|부모님|명절|체면|고급|프리미엄/.test(text + hook)) return "선물명분형";
  if (/긴급|한정|오늘|이번 구성|오래 안|마감/.test(text + hook)) return "긴급/한정형";
  if (/상황|출근|주말|냉장고|여행|집들이|데일리/.test(text + hook)) return "상황제안형";

  return hook || "상황제안형";
}

function hasMemeTone(labels: AdImageLabel[]) {
  return /코어|나와버림|저장각|장바구니각|야호|미쳤|반칙|아직도 없음|왜 이제 알았지|구어체|SNS|짤/.test(
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

  if (/나와버림|나와 버림/.test(referenceText)) {
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

  if (referenceExpression) return referenceExpression;
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

function referenceAwareBody(product: ProductInfoForPrompt, labels: AdImageLabel[]) {
  const fields = referenceFieldBundle(labels);
  const subject = productSubject(product, labels);
  const keyword = shortProductKeyword(product, labels);
  const tone = fields.toneOfVoice;
  const insight = fields.consumerInsight;

  if (/야호|POV|pov|코어|나와버림|저장각|장바구니각|SNS|구어체|반말|짤/.test(referenceExpressionText(labels))) {
    return `${keyword} 얘기 나오면 일단 멈칫. ${conciseAdSignal(insight || tone || `${subject}가 눈에 들어오는 이유`)}`;
  }
  if (insight) return `${conciseAdSignal(insight)} 그래서 ${subject}가 먼저 눈에 들어옵니다.`;
  if (fields.copyStructure) return `${conciseAdSignal(fields.copyStructure)} 흐름으로 ${subject}를 살 이유를 만듭니다.`;
  return `${subject}를 고를 이유를 레퍼런스 말투에 맞춰 먼저 보여줍니다.`;
}

function referenceAwareHighlight(product: ProductInfoForPrompt, labels: AdImageLabel[]) {
  const fields = referenceFieldBundle(labels);
  const expression = referenceExpressionHeadline(product, labels);
  if (expression) return expression;
  if (fields.purchaseTrigger) return conciseAdSignal(fields.purchaseTrigger, 42);
  if (fields.reusableCopyPattern) return conciseAdSignal(fields.reusableCopyPattern, 42);
  return product.mainBenefit || product.discountInfo || labels[0]?.finalLabel.appealPoint || "지금 볼 이유 있음";
}

function referenceAwareBottom(product: ProductInfoForPrompt, labels: AdImageLabel[]) {
  const fields = referenceFieldBundle(labels);
  const hookType = inferPrimaryHookType(labels);
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

  if (isGenericHeadline(normalized)) return true;
  if (/만나보세요|기다립니다|필수 아이템|특별한 선택|새로워진|여러분/.test(normalized)) return true;
  if (expressionHeadline && !/(야호|POV|pov|코어|나와버림|저장각|장바구니각|미쳤|반칙|1위)/.test(normalized)) return true;
  if (/(습니다|하세요|드립니다|제공합니다)$/.test(normalized) && /구어체|SNS|반말|UGC|짤|나와버림|코어|저장각/.test(referenceText)) return true;
  if (hookType.includes("가격") && !/(가격|구성|원|만원|납득|반칙|특가|할인)/.test(normalized)) return true;
  if (hookType.includes("문제") && !/(아직|왜|없이|버텼|놓쳤|귀찮|불편|\?)/.test(normalized)) return true;
  if (hookType.includes("공감") && !/(나만|이런 날|귀찮|됨|아니지|\?)/.test(normalized)) return true;
  if (hookType.includes("후기") && !/(써보고|알았|저장각|찐|후기|반응)/.test(normalized)) return true;
  if (hookType.includes("UGC") && !/(나와버림|코어|각|야호|미쳤|반칙|요즘|결국)/.test(normalized)) return true;
  if (hookType.includes("선물") && !/(선물|부담|체면|부모님|명분|고급)/.test(normalized)) return true;
  if (hookType.includes("긴급") && !/(오늘|이번|지금|오래 안|마감|고민 짧게)/.test(normalized)) return true;

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

  const headline = shouldRewriteHeadlineWithReference(copy.headline, labels)
    ? fallbackHeadline(product, labels)
    : copy.headline;

  const bodyCopy = copy.bodyCopy && !/새 상품|즐거움|기다립니다|만나보세요|여러분|만족/.test(copy.bodyCopy)
    ? copy.bodyCopy
    : firstFilled(
        referenceAwareBody(product, labels),
        purchaseTrigger && `${purchaseTrigger} ${productSubject(product, labels)}로 바로 이어지게 잡았습니다.`,
        consumerInsight && `${consumerInsight}를 먼저 건드리고, ${productSubject(product, labels)}로 살 이유를 붙였습니다.`,
        toneOfVoice && `${toneOfVoice} 톤을 살려 광고보다 레퍼런스 같은 말맛을 먼저 냅니다.`,
        copy.bodyCopy,
      );

  const highlightCopy = copy.highlightCopy && !/특별한|필수|즐거움|만족|기다립니다/.test(copy.highlightCopy)
    ? copy.highlightCopy
    : firstFilled(referenceAwareHighlight(product, labels), purchaseTrigger, reusableCopyPattern, finalLabel.appealPoint, copy.highlightCopy);

  const bottomBarCopy = copy.bottomBarCopy && !/자세한|클릭|확인|특별한|필수/.test(copy.bottomBarCopy)
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

function normalizeCopy(value: Partial<GeneratedAdCopy>, product: ProductInfoForPrompt, labels: AdImageLabel[]): GeneratedAdCopy {
  const hookType = String(value.hookType || inferPrimaryHookType(labels));
  const headline = replaceForbiddenPhrases(String(value.headline || ""));
  const bodyCopy = replaceForbiddenPhrases(String(value.bodyCopy || ""));
  const highlightCopy = replaceForbiddenPhrases(String(value.highlightCopy || ""));
  const bottomBarCopy = replaceForbiddenPhrases(String(value.bottomBarCopy || ""));
  const cta = replaceForbiddenPhrases(String(value.cta || ""));

  const normalized: GeneratedAdCopy = {
    headline: isGenericHeadline(headline) ? fallbackHeadline(product, labels) : headline,
    bodyCopy: bodyCopy || mockCopy(product, labels).bodyCopy,
    highlightCopy: highlightCopy || mockCopy(product, labels).highlightCopy,
    bottomBarCopy: bottomBarCopy || mockCopy(product, labels).bottomBarCopy,
    cta: cta || "구성 보러가기",
    price: String(value.price || product.price || product.discountInfo || ""),
    hookType,
    appealPoint: String(value.appealPoint || labels[0]?.finalLabel.appealPoint || product.mainBenefit || ""),
    whyThisWorks: String(
      value.whyThisWorks ||
        "선택한 레퍼런스의 OCR, hookType, copyNuance에서 후킹 구조를 뽑아 상품 정보에 맞게 변형했습니다.",
    ),
  };

  const referenceApplied = applyReferenceNuance(normalized, product, labels);
  return {
    ...referenceApplied,
    copyVariants: buildCopyVariants(referenceApplied),
  };
}

function mockCopy(product: ProductInfoForPrompt, labels: AdImageLabel[]): GeneratedAdCopy {
  const first = labels[0]?.finalLabel;
  const hookType = inferPrimaryHookType(labels);
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
    bodyCopy: `${tone}를 살려 ${insight}를 먼저 건드리고, ${subject}를 고를 이유를 붙입니다.`,
    highlightCopy: trigger || benefit,
    bottomBarCopy: pattern || `${first?.hookType || hookType} 구조로 클릭 전 이유를 먼저 만듭니다.`,
    cta: "구성 보러가기",
    price,
    hookType,
    appealPoint: first?.appealPoint || benefit,
    whyThisWorks: `레퍼런스 반영: ${firstFilled(first?.firstLineHook, first?.hookType)} / ${tone} / ${pattern}을 새 상품 정보에 맞춰 변형했습니다.`,
  };

  if (hookType.includes("가격")) {
    return {
      ...base,
      bodyCopy: `싸다는 말보다 ${price || "이 조건"}에 ${benefit}까지 챙길 명분을 앞세웁니다.`,
      highlightCopy: `${price || "이 가격"}이면 사도 되는 이유`,
    };
  }
  if (hookType.includes("문제")) {
    return {
      ...base,
      bodyCopy: `${product.targetCustomer || "고민 중인 사람"}이 느끼는 불편을 먼저 찌르고 ${subject}로 해결감을 줍니다.`,
      highlightCopy: `${benefit} 놓치기 전에`,
    };
  }
  if (hookType.includes("공감")) {
    return {
      ...base,
      bodyCopy: `속으로 한 번쯤 했을 말을 꺼내고, ${subject}가 왜 편한 선택인지 바로 붙입니다.`,
      highlightCopy: `이런 날엔 ${subject} 하나면 됨`,
    };
  }
  if (hookType.includes("후기")) {
    return {
      ...base,
      bodyCopy: `광고 설명보다 실제 반응처럼 ${benefit}를 말하게 만들어 저장하고 싶게 합니다.`,
      highlightCopy: meme ? "이건 저장각" : "써보면 납득되는 구성",
    };
  }
  if (hookType.includes("UGC")) {
    return {
      ...base,
      bodyCopy: meme
        ? `너무 광고처럼 설명하지 않고, ${subject}가 피드에 올라온 말투처럼 보이게 만듭니다.`
        : `${subject}를 SNS 게시글처럼 가볍게 꺼내되 과한 밈으로 고정하지 않습니다.`,
      highlightCopy: meme ? "지금 장바구니각" : benefit,
    };
  }
  if (hookType.includes("선물")) {
    return {
      ...base,
      bodyCopy: `가격보다 체면과 명분을 먼저 세워 ${subject}가 선물로 어색하지 않게 보이게 합니다.`,
      highlightCopy: `${price || "이 조건"}에 선물 느낌은 제대로`,
    };
  }
  if (hookType.includes("긴급")) {
    return {
      ...base,
      bodyCopy: `지금 지나치면 아쉬운 이유를 구성, 혜택, 타이밍 중 하나로 분명하게 만듭니다.`,
      highlightCopy: "오늘 조건이면 고민 짧게",
    };
  }

  return base;
}

async function generateWithOpenAI(product: ProductInfoForPrompt, labels: AdImageLabel[]) {
  const prompt = `
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

대체 방향:
- "만나보세요" 대신 "이건 좀 확인각" 또는 톤에 맞는 행동형 문구
- "기다립니다" 대신 "지금 장바구니각"
- "필수 아이템" 대신 "없으면 괜히 아쉬운템"
- "자세한 정보는 여기를 클릭하세요" 대신 "구성 바로 보기"
- "지금 바로 확인하기" 대신 "구성 보러가기"

상품 정보:
${JSON.stringify(product, null, 2)}

선택 레퍼런스 카피 패턴 요약:
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
- bodyCopy는 consumerInsight와 toneOfVoice를 반영해 소비자가 왜 반응하는지 광고 문장으로 바꾼다. 분석문을 그대로 쓰지 말고 소비자-facing 문장으로 쓴다.
- highlightCopy는 purchaseTrigger, whyItWorks, appealPoint 중 가장 강한 소구 하나를 짧게 쓴다.
- bottomBarCopy는 whyItWorks에서 나온 구매 명분 또는 긴급성을 CTA 직전 문구로 바꾼다.
- cta는 "구성 보러가기", "혜택 보기", "장바구니 담기"처럼 구체적인 행동으로 쓴다.
- price는 상품 정보의 price 또는 discountInfo를 활용한다.
- whyThisWorks는 반드시 어떤 레퍼런스의 어떤 분석 항목(왜 먹히는지, 말투, 구매 트리거, 재사용 패턴)을 응용했는지 설명한다.

반환 JSON:
{
  "headline": "",
  "bodyCopy": "",
  "highlightCopy": "",
  "bottomBarCopy": "",
  "cta": "",
  "price": "",
  "hookType": "",
  "appealPoint": "",
  "whyThisWorks": "",
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

  return normalizeCopy(parseJsonObject(text), product, labels);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const product = normalizeProduct(body.productInfo);
    const allLabels = await readAdImageLabels();
    const selectedLabels = selectReferenceLabels(product, allLabels, body.referenceLabels ?? []);

    if (!selectedLabels.length) {
      return NextResponse.json(
        { ok: false, error: "참고할 라벨 데이터가 없습니다. 먼저 이미지 라벨을 저장해주세요." },
        { status: 400 },
      );
    }

    const rawCopy = process.env.OPENAI_API_KEY ? await generateWithOpenAI(product, selectedLabels) : mockCopy(product, selectedLabels);
    const copy = {
      ...rawCopy,
      copyVariants: rawCopy.copyVariants || buildCopyVariants(rawCopy),
    };

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
