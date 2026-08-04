import type {
  AdBrief,
  AdImageLabel,
  AutoReferenceContext,
  ProductInfoForPrompt,
  ReferenceMatchResult,
} from "./types";

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function tokens(value: string) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  );
}

function numberFromPrice(value: string) {
  const match = value.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function labelContext(label: AdImageLabel): AutoReferenceContext {
  const final = label.finalLabel;
  return {
    referenceId: label.imageId,
    category: final?.category || label.category || undefined,
    hookTypes: Array.from(
      new Set(
        [...(label.structuredLabels?.hookTypes || []), clean(final?.hookType)].filter(Boolean)
      )
    ),
    appealPoints: Array.from(
      new Set(
        [...(label.structuredLabels?.appealPoints || []), clean(final?.appealPoint)].filter(Boolean)
      )
    ),
    copyNuance: final?.copyNuance || final?.toneOfVoice || undefined,
    consumerInsight: final?.consumerInsight || undefined,
    purchaseTrigger: final?.purchaseTrigger || undefined,
    reusablePattern: final?.reusableCopyPattern || undefined,
    visualTone: final?.visualTone || undefined,
    layoutPattern: final?.layoutPattern || final?.visualCopyRelation || undefined,
    ocrText: final?.ocrText || undefined,
  };
}

function analysisCompleteness(context: AutoReferenceContext) {
  const fields = [
    context.category,
    context.copyNuance,
    context.consumerInsight,
    context.purchaseTrigger,
    context.reusablePattern,
    context.visualTone,
    context.layoutPattern,
    context.ocrText,
  ];
  return (
    fields.filter(Boolean).length +
    (context.hookTypes?.length || 0) +
    (context.appealPoints?.length || 0)
  );
}

function intensityScore(intensity: AdBrief["creativeIntensity"], text: string) {
  if (
    intensity === "performance" &&
    /가격|할인|특가|긴급|한정|UGC|문제|후기|리뷰|구성/.test(text)
  ) {
    return 12;
  }
  if (intensity === "brand" && /프리미엄|고급|신뢰|브랜드|감성|선물/.test(text)) {
    return 12;
  }
  if (intensity === "balanced" && /혜택|가성비|품질|신뢰|상황|공감/.test(text)) {
    return 8;
  }
  return 0;
}

export function matchReferences(params: {
  product: ProductInfoForPrompt;
  brief: AdBrief;
  labels: AdImageLabel[];
  limit?: number;
}): ReferenceMatchResult[] {
  const productText = [
    params.product.productName,
    params.product.category,
    params.product.mainBenefit,
    params.product.extractedDescription,
    params.product.discountInfo,
    params.product.targetCustomer,
    params.brief.additionalEmphasis,
  ]
    .filter(Boolean)
    .join(" ");
  const productTokens = tokens(productText);
  const productPrice = numberFromPrice(params.product.price);
  const hasDiscount = Boolean(params.product.discountInfo || params.product.originalPrice);
  const hasBundle = /\d+\s*(?:개|팩|세트|입|장|병|포)|묶음|구성|세트/.test(productText);

  return params.labels
    .filter((label) => label.finalLabel && Object.values(label.finalLabel).some(Boolean))
    .map((label) => {
      const context = labelContext(label);
      const referenceText = [
        context.category,
        ...(context.hookTypes || []),
        ...(context.appealPoints || []),
        context.copyNuance,
        context.consumerInsight,
        context.purchaseTrigger,
        context.reusablePattern,
        context.visualTone,
        context.layoutPattern,
        context.ocrText,
      ]
        .filter(Boolean)
        .join(" ");
      const referenceTokens = tokens(referenceText);
      const reasons: string[] = [];
      let score = 0;
      let productRelationScore = 0;

      const productCategory = clean(params.product.category).toLowerCase();
      const referenceCategory = clean(context.category).toLowerCase();
      const hasUsefulCategory = Boolean(
        productCategory && !["기타", "default", "etc"].includes(productCategory)
      );
      if (hasUsefulCategory && referenceCategory && productCategory === referenceCategory) {
        score += 40;
        productRelationScore += 40;
        reasons.push("동일 카테고리");
      } else if (
        hasUsefulCategory &&
        referenceCategory &&
        (productCategory.includes(referenceCategory) || referenceCategory.includes(productCategory))
      ) {
        score += 24;
        productRelationScore += 24;
        reasons.push("유사 카테고리");
      }

      let keywordMatches = 0;
      productTokens.forEach((token) => {
        if (referenceTokens.has(token)) keywordMatches += 1;
      });
      if (keywordMatches) {
        const keywordScore = Math.min(24, keywordMatches * 4);
        score += keywordScore;
        productRelationScore += keywordScore;
        reasons.push(`상품·라벨 키워드 ${keywordMatches}개 일치`);
      }

      const referencePrice = numberFromPrice(context.ocrText || "");
      if (productPrice && referencePrice) {
        const ratio =
          Math.max(productPrice, referencePrice) / Math.min(productPrice, referencePrice);
        if (ratio <= 1.35) {
          score += 12;
          productRelationScore += 12;
          reasons.push("유사 가격대");
        } else if (ratio <= 2) {
          score += 6;
          productRelationScore += 6;
          reasons.push("인접 가격대");
        }
      }

      if (hasDiscount && /할인|특가|가격|혜택|파격/.test(referenceText)) {
        score += 10;
        productRelationScore += 10;
        reasons.push("할인·가격 소구 일치");
      }
      if (hasBundle && /묶음|구성|세트|용량|수량/.test(referenceText)) {
        score += 8;
        productRelationScore += 8;
        reasons.push("구성 소구 일치");
      }

      const intensity = intensityScore(params.brief.creativeIntensity, referenceText);
      if (intensity) {
        score += intensity;
        reasons.push("광고 강도와 카피 뉘앙스 일치");
      }
      if (
        params.brief.adObjective === "purchase" &&
        /구매|가격|혜택|CTA|전환|트리거/.test(referenceText)
      ) {
        score += 6;
        reasons.push("구매 목표 적합");
      }
      if (
        params.brief.adObjective === "signup" &&
        /회원|가입|체험|참여|시작|문제|해결/.test(referenceText)
      ) {
        score += 6;
        reasons.push("가입 목표 적합");
      }
      if (
        params.brief.adObjective === "awareness" &&
        /브랜드|감성|신뢰|발견|반전|비주얼/.test(referenceText)
      ) {
        score += 6;
        reasons.push("인지 목표 적합");
      }

      const completeness = analysisCompleteness(context);
      score += Math.min(18, completeness * 2);
      if (completeness >= 7) reasons.push("분석 데이터가 풍부함");

      return {
        referenceId: label.imageId,
        score,
        productRelationScore,
        matchedReasons: reasons.length ? reasons : ["분석 데이터 품질 기준"],
        context,
      };
    })
    .filter((result) => result.productRelationScore > 0 && result.score >= 20)
    .sort((a, b) => b.score - a.score || a.referenceId.localeCompare(b.referenceId))
    .slice(0, Math.max(1, Math.min(5, params.limit || 5)))
    .map((result) => ({
      referenceId: result.referenceId,
      score: result.score,
      matchedReasons: result.matchedReasons,
      context: result.context,
    }));
}

export function labelsForReferenceMatches(labels: AdImageLabel[], matches: ReferenceMatchResult[]) {
  const byId = new Map(labels.map((label) => [label.imageId, label]));
  return matches
    .map((match) => byId.get(match.referenceId))
    .filter((label): label is AdImageLabel => Boolean(label));
}
