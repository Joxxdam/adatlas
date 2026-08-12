import { copyLimitCharSummary } from "./templateCopyFitter";
import { analyzeProductUsp } from "./productUsp";
import { adObjectivePrompt } from "./adObjective";
import type {
  AdBrief,
  AdImageLabel,
  CopyGuideContext,
  CreativeStrategy,
  ProductInfoForPrompt,
  ReferenceUsageSelection,
  TemplateCopyLimits,
} from "./types";

type TemplateInfo = {
  templateId?: string;
  templateName?: string;
  copyLimits?: TemplateCopyLimits;
};

const referenceFieldPriority = [
  "reusableCopyPattern",
  "firstLineHook",
  "copyStructure",
  "consumerInsight",
  "purchaseTrigger",
  "toneOfVoice",
  "trendElements",
  "visualCopyRelation",
  "hookType",
  "appealPoint",
  "copyNuance",
  "whyItWorks",
] as const;

function referencePayload(reference?: AdImageLabel) {
  if (!reference?.finalLabel) return null;

  const label = reference.finalLabel;

  return {
    imageId: reference.imageId,
    category: reference.category,
    brandName: reference.brandName,
    sourcePlatform: reference.sourcePlatform,
    finalLabel: {
      ocrText: label.ocrText,
      hookType: label.hookType,
      appealPoint: label.appealPoint,
      copyNuance: label.copyNuance,
      whyItWorks: label.whyItWorks,
      firstLineHook: label.firstLineHook,
      copyStructure: label.copyStructure,
      toneOfVoice: label.toneOfVoice,
      trendElements: label.trendElements,
      consumerInsight: label.consumerInsight,
      purchaseTrigger: label.purchaseTrigger,
      reusableCopyPattern: label.reusableCopyPattern,
      visualCopyRelation: label.visualCopyRelation,
      targetEmotion: label.targetEmotion,
      visualTone: label.visualTone,
      layoutPattern: label.layoutPattern,
      recommendedUse: label.recommendedUse,
    },
  };
}

function templateSpecificRules(templateId?: string) {
  if (templateId === "food-template-001") {
    return `
[food-template-001 전용 슬롯 규칙]
- 이 템플릿은 "분할고기특가형"입니다. 일반 배너 문장이 아니라 좌우 이미지 분할과 하단 가격 블록에 맞춥니다.
- headline: 상단 1~2줄 후킹 문구입니다. 가격/선물/가성비/구성 충격을 강하게 씁니다.
- bodyCopy: 상품명 또는 부위명만 짧게 씁니다. 긴 설명문은 금지합니다.
- highlightCopy: 빨간 배지 문구입니다. 예: "파격특가", "실속가", "특별가".
- bottomBarCopy: 기존가 숫자만 씁니다. 기존가 정보가 없으면 빈 문자열로 둡니다.
- price: 최종 판매가 숫자만 씁니다. 예: "49,800원".
- cta: 이 템플릿에서는 빈 문자열을 권장합니다.
`;
  }

  return "";
}

function templateStrategy(templateId?: string) {
  if (!templateId) {
    return "템플릿 미선택: headline은 짧은 후킹, bodyCopy는 존댓말 보조 설명, highlightCopy는 핵심 혜택, bottomBarCopy는 구매 명분으로 분리한다.";
  }

  if (/food-template-001/.test(templateId)) {
    return "분할고기특가형: headline은 가격/선물/가성비 후킹, bodyCopy는 상품명, highlightCopy는 가격 배지, bottomBarCopy는 기존가, price는 판매가로 분리한다.";
  }

  if (/food-template-002/.test(templateId)) {
    return "가격폭발특가형: 배경 이미지를 강하게 쓰고, headline은 짧고 강한 가격 충격, bodyCopy는 1문장, price는 크게 보이는 판매가로 쓴다.";
  }

  if (/food-template-003/.test(templateId)) {
    return "비교 설명형: 비교 축을 명확히 하고, bodyCopy는 차분한 설명형 존댓말로 쓴다.";
  }

  if (/food-template-004/.test(templateId)) {
    return "리뷰/말풍선형: headline은 소비자 질문이나 반응처럼 쓰고, 말풍선에는 짧은 후기성 문장을 배치한다.";
  }

  if (/food-template-005/.test(templateId)) {
    return "다크 임팩트형: headline은 강한 질문/감탄형, bodyCopy는 짧은 신뢰 보강, highlightCopy는 품질/가격 명분으로 쓴다.";
  }

  if (
    /food-impact-hero-001|bold-commerce-001|price-proof-002|home-shopping-max-010/.test(templateId)
  ) {
    return "식품/특가 히어로형: headline은 강하고 짧게, bodyCopy는 존댓말 1문장, highlightCopy는 가격/구성 혜택, bottomBarCopy는 빨간 정보 바용 짧은 소구, price는 판매가만 쓴다.";
  }

  if (/premium-gift-006/.test(templateId)) {
    return "고급 선물형: 밈 표현을 줄이고 체면, 선물 명분, 고급감, 부담 낮은 가격을 차분하게 드러낸다.";
  }

  if (/ugc-meme-005/.test(templateId)) {
    return "UGC 밈형: reference OCR과 trendElements에 근거가 있을 때만 SNS 말투, 말 끊기, ~코어 같은 패턴을 상품에 맞게 변형한다.";
  }

  return "선택 템플릿의 각 슬롯 역할에 맞춰 headline/bodyCopy/highlightCopy/bottomBarCopy/cta를 분리하고, 배너 안에 들어갈 수 있게 짧게 쓴다.";
}

function guideSpecificRules(copyGuide?: CopyGuideContext | null) {
  if (!copyGuide) return "";

  if (copyGuide.guideId === "kookdae-hanwoo") {
    return `
[국대한우 가이드 적용 규칙]
- 생성 내용의 1차 기준은 반드시 현재 상세페이지의 PRODUCT_USP_ANALYSIS입니다.
- 국대한우 가이드는 속도감 있는 구어체, 짧은 호흡, 질문·반전 같은 표현 방식에만 사용합니다.
- 가이드의 예시 문장, 상품 주장, 사장님·직원·정육점 서사, 도매가·손해·마진·품절 표현을 재사용하거나 유사하게 바꾸지 않습니다.
- 가격 후킹은 현재 상품 정보에 실제 가격이나 할인 정보가 있을 때만 사용합니다.
- 내부자 고백, 전문가 권위, 후기 표현은 상세페이지에 같은 근거가 명시된 경우에만 사용합니다.
- headline은 선택한 전략과 핵심 USP를 한 문장 안에서 연결합니다. 말투만 강하고 상품 차이가 없는 문장은 실패입니다.
- bodyCopy는 headline과 다른 확인된 USP, 구성, 맛, 부위, 사용 상황을 존댓말 1문장으로 씁니다.
- highlightCopy와 bottomBarCopy도 상세페이지에서 확인된 가격·구성·혜택·USP만 사용합니다.
- cta는 "상품 정보 보기", "구매 조건 보기", "구성 보기"처럼 사실을 과장하지 않는 짧은 행동형 문구로 씁니다.
- copyGuideUsage에는 예문 이름이 아니라 실제 적용한 표현 원칙과 사용한 USP를 기록합니다.
- copyVariants.short / medium / long은 서로 독립적으로 생성합니다. short는 long을 줄인 문장이 아니고, medium도 long의 요약본이 아닙니다.
- short/medium/long은 각각 서로 다른 확인된 USP 또는 구매 이유에 근거합니다.
- short / medium에는 필요 시 ",, / .. / ;; / ?!" 같은 말끝 처리를 제한적으로 사용할 수 있습니다.
- 단, 모든 문구에 기호를 붙이지 말고 CTA에는 과한 기호를 붙이지 않습니다.
- copyGuideUsage.selectedPatterns에는 예시 문장이 아니라 각 variant가 사용한 USP와 후킹 방식을 기록합니다.
`;
  }

  if (copyGuide.guideId === "daehan-hanwoo") {
    return `
[대한한우 가이드 적용 규칙]
- 대한한우는 왕도매가, 노마진, 물량/숫자 임팩트와 궁중 프리미엄의 결합이 핵심이다.
- headline은 가격 충격 또는 왕도매가 명분을 짧고 강하게 쓴다. 상품 정보에 없는 수량, 등급, 기간, 할인율은 만들지 않는다.
- bodyCopy는 품질, 마블링, 선별, 구성, 선물 용도를 존댓말 한 문장으로 설명한다.
- 내부 고백과 반전은 headline에만 짧게 사용하며, 확인되지 않은 결재/납품/회의 상황을 사실처럼 말하지 않는다.
- 국대한우의 사장님 개인 서사, 힘내라농가의 산지 농민 서사와 단가 착시를 섞지 않는다.
- 이모지와 그림문자는 절대 쓰지 않는다.
- copyGuideUsage.usedSections와 toneApplied에는 실제 선택한 대한한우 가이드 섹션과 왕도매가/물량/프리미엄 등 적용 톤을 구체적으로 기록한다.
`;
  }

  if (copyGuide.guideId === "fighting-farm") {
    return `
[힘내라농가 가이드 적용 규칙]
- 힘내라농가는 산지직송, 산지 물량, 유통 단계 축소와 단가 착시로 가격을 납득시키는 브랜드다.
- headline은 가격 반전 또는 산지 특가를 짧고 강하게 쓴다. 단가 표현은 실제 가격과 수량/중량으로 계산 가능한 경우에만 사용한다.
- bodyCopy는 산지, 품질, 제철, 구성, 활용도를 존댓말 한 문장으로 설명한다.
- 힘농/힘농 식구님, 단골 추천, 후기 표현은 실제 상품 정보나 확인된 근거가 있을 때만 사용한다.
- 대한한우의 왕도매가/궁중 세계관과 국대한우의 사장님 개인 서사를 섞지 않는다.
- 이모지와 그림문자는 절대 쓰지 않는다.
- copyGuideUsage.usedSections와 toneApplied에는 실제 선택한 힘내라농가 가이드 섹션과 산지/농민 서사/단가 프레이밍 등 적용 톤을 구체적으로 기록한다.
`;
  }

  return `
[브랜드 가이드 적용 규칙]
- Brand Copy Guide는 광고주의 고정 톤과 반복 가능한 설득 구조입니다.
- reference label은 이번 소재의 후킹 방향과 소구점입니다.
- 예문은 그대로 복사하지 않고 현재 상품 정보로 재조합합니다.
- copyGuideUsage.usedSections와 toneApplied를 구체적으로 채웁니다.
`;
}

function intensityInstruction(intensity: AdBrief["creativeIntensity"] | undefined) {
  if (intensity === "brand") {
    return "부드럽게: 감성적이고 자연스러운 문장을 사용하고 과도한 판매 표현과 압박형 CTA를 최소화한다.";
  }
  if (intensity === "performance") {
    return "강하게: 상세페이지에서 확인된 가격·할인·한정 수량·기간과 즉시 행동 요소를 우선한다. 확인되지 않은 수치나 한정성은 절대 만들지 않는다.";
  }
  return "균형 있게: 상품의 USP와 상세페이지에서 확인된 구매 혜택을 균형 있게 전달한다.";
}

export function buildGenerateCopyPrompt(params: {
  product: ProductInfoForPrompt;
  reference?: AdImageLabel;
  referenceContext?: AdImageLabel[];
  referenceUsages?: ReferenceUsageSelection[];
  template?: TemplateInfo;
  copyGuide?: CopyGuideContext | null;
  adBrief?: AdBrief;
  creativeStrategy?: CreativeStrategy | null;
}) {
  const {
    product,
    reference,
    referenceContext = reference ? [reference] : [],
    referenceUsages = [],
    template,
    copyGuide,
    adBrief,
    creativeStrategy,
  } = params;
  const copyLimitSummary = copyLimitCharSummary(template?.copyLimits);
  const referenceJson = referencePayload(reference);
  const isKookdae = copyGuide?.guideId === "kookdae-hanwoo";
  const referenceJsonForPrompt =
    isKookdae && referenceJson
      ? {
          imageId: referenceJson.imageId,
          category: referenceJson.category,
          brandName: referenceJson.brandName,
          sourcePlatform: referenceJson.sourcePlatform,
          finalLabel: {
            hookType: referenceJson.finalLabel.hookType,
            appealPoint: referenceJson.finalLabel.appealPoint,
            copyNuance: referenceJson.finalLabel.copyNuance,
            whyItWorks: referenceJson.finalLabel.whyItWorks,
            targetEmotion: referenceJson.finalLabel.targetEmotion,
            visualTone: referenceJson.finalLabel.visualTone,
            layoutPattern: referenceJson.finalLabel.layoutPattern,
            recommendedUse: referenceJson.finalLabel.recommendedUse,
          },
        }
      : referenceJson;
  const productUspAnalysis = analyzeProductUsp(product);
  const copyGuideBlock = copyGuide
    ? `
[Brand Copy Guide]
guideId: ${copyGuide.guideId}
brandName: ${copyGuide.brandName}
matchedBy: ${copyGuide.matchedBy.join(", ")}

This guide is a tone and sentence-structure reference. It is not a source of product claims.
${
  copyGuide.guideId === "kookdae-hanwoo"
    ? `For 국대한우, use only a fast Korean conversational rhythm and concise hook structure.
Never copy or closely paraphrase any guide example. Never use a guide example as a fallback.
Product claims and hook content must come from PRODUCT_USP_ANALYSIS and current productInfo only.`
    : "Do not copy guide examples verbatim. Recompose the style for the current product and automatically matched reference patterns."
}

${
  copyGuide.guideId === "kookdae-hanwoo"
    ? `Allowed tone summary: 빠른 호흡, 짧은 구어체, 질문·반전 구조, 확인된 가격이나 구성의 명확한 강조.
Forbidden unless the current product page explicitly confirms it: 사장님·직원·정육점 내부자 서사, 손해·마진 포기, 도매가, 오타, 품절 임박, 오늘만, 전문가·후기·판매량 주장.`
    : copyGuide.content
}
`
    : `
[Brand Copy Guide]
No advertiser-specific copy guide matched. Use the product information and automatically matched reference patterns.
`;

  return `
너는 일반 브랜드 카피라이터가 아니라 한국 이커머스 퍼포먼스 광고의 후킹 문구를 만드는 마케터다.
예쁜 문장보다 클릭을 유도하는 첫 문장, 소비자 공감, 가격정당화, 선물명분, 후기형 말투, SNS식 표현을 우선한다.
단, 모든 문구를 밈처럼 만들지 말고 reference label과 브랜드 가이드의 실제 톤에 맞춰야 한다.

[중요 원칙]
- 첫 번째 자동 매칭 레퍼런스를 주 패턴으로 삼고, 나머지 레퍼런스는 보조 패턴으로만 사용한다.
- reference OCR과 고유 문구를 그대로 복사하지 않는다.
- reference의 상품명, 브랜드명, 가격, 할인율, 인증, 후기 수, 판매량은 현재 상품의 사실로 사용하지 않는다.
- reference의 문장 구조, 말투, 후킹 방식, 감정 유도 방식, 소구 순서, 레이아웃 패턴만 추출해 현재 상품에 맞게 변형한다.
- 최종 문구의 제품 사실은 오직 [현재 광고 대상 상품의 사실 정보]에서만 가져온다.
- 가격/혜택/상품명을 코드처럼 붙인 비문을 만들지 않는다.
- headline에는 숫자만 넣지 않는다.
- headline 후보 5개를 내부적으로 만든 뒤, 비문/generic/상품 정보 결여 후보를 제거하고 가장 좋은 1개만 JSON에 출력한다.
- PRODUCT_USP_ANALYSIS.targetSegments에서 선택 전략의 audience와 가장 가까운 타겟을 고르고, 그 고객이 실제로 신경 쓰는 tension을 첫 문장에 반영한다.
- PRODUCT_USP_ANALYSIS.hookAngles 중 선택 전략의 hookType과 맞는 angle을 사용한다. 문제형·근거형·감각형·가치형·상황형을 섞어 같은 말투만 반복하지 않는다.
- 자극성은 과장된 수치가 아니라 현실적인 불편을 찌르는 질문, 기존 선택과의 대비, 놓치기 아쉬운 구체적 이점, 감각 묘사, 짧은 반전에서 만든다.
- headline에는 반드시 target tension 또는 evidence signal 중 하나가 보여야 하며, 상품명이 없어도 해당 상품만의 차이가 드러나야 한다.
- 이모지와 그림문자는 절대 출력하지 않는다.
- bodyCopy는 headline을 반복하지 말고 존댓말 1문장으로 쓴다.

[현재 광고 대상 상품의 사실 정보]
${JSON.stringify(product, null, 2)}

[PRODUCT_USP_ANALYSIS]
${JSON.stringify(productUspAnalysis, null, 2)}
- primaryUsp와 uspSignals는 현재 상세페이지에서 추출한 상품 차별점 후보입니다.
- headline은 반드시 이 USP 중 하나 또는 확인된 offerSignals를 중심으로 작성합니다.
- 브랜드 가이드 예문보다 이 분석을 우선합니다.

[광고 브리프]
${JSON.stringify(adBrief || {}, null, 2)}

[광고 콘텐츠 참고사항]
${JSON.stringify(product.creativeContext?.appliedContentNotes || [], null, 2)}
- required 또는 MUST_INCLUDE는 상품 사실과 충돌하지 않는 범위에서 반드시 포함한다.
- prohibited 또는 PROHIBITED_EXPRESSION은 어떤 변형에도 사용하지 않는다.
- PRODUCT_USP, PREFERRED_HOOK, TONE_OF_VOICE는 각각 소구점·후킹·말투에 실제 반영한다.
- PRICE_POLICY와 PROMOTION은 현재 상품 사실에 같은 가격·기간·구성이 확인된 경우에만 사용한다.
- IMAGE_RULE, BACKGROUND_STYLE, LAYOUT_RULE은 카피 사실의 출처가 아니라 시각 제작 제약이다.

[광고 목표 적용]
${adObjectivePrompt(adBrief?.adObjective)}
- 광고 목표는 단순한 말투 태그가 아닙니다. headline, bodyCopy, highlightCopy, bottomBarCopy, CTA의 역할과 정보 순서를 모두 목표에 맞게 바꾸세요.
- 구매 전환은 구매 장벽을 줄이고, 신규 고객 확보는 필요성과 차이를 설명하고, 브랜드 인지도는 브랜드명과 대표 기억점을 남기고, 재구매·리타겟팅은 이미 본 고객의 망설임에 답해야 합니다.
- copyVariants의 short/medium/long도 같은 광고 목표를 유지하되 서로 독립적인 문장 구조로 작성하세요.

[광고 강도 적용]
${intensityInstruction(adBrief?.creativeIntensity)}
- 광고 강도와 무관하게 가격, 기존가, 할인율, 수량, 중량, 한정 수량, 종료일, 후기 수, 평점은 [현재 광고 대상 상품의 사실 정보]에 있는 값만 사용한다.
- "강하게"에서도 확인되지 않은 할인, 기간, 수량, 품절 임박, 판매 실적을 임의로 만들지 않는다.

[사용자가 선택한 광고 전략]
${JSON.stringify(creativeStrategy || {}, null, 2)}

[자동 매칭된 광고 레퍼런스 패턴]
${JSON.stringify(
  referenceContext.map((item) => ({
    referenceId: item.imageId,
    category: item.finalLabel?.category || item.category,
    hookTypes: item.structuredLabels?.hookTypes || [item.finalLabel?.hookType].filter(Boolean),
    appealPoints:
      item.structuredLabels?.appealPoints || [item.finalLabel?.appealPoint].filter(Boolean),
    ocrText: isKookdae ? undefined : item.finalLabel?.ocrText,
    firstLineHook: isKookdae ? undefined : item.finalLabel?.firstLineHook,
    copyStructure: item.finalLabel?.copyStructure,
    copyNuance: item.finalLabel?.copyNuance || item.finalLabel?.toneOfVoice,
    consumerInsight: item.finalLabel?.consumerInsight,
    purchaseTrigger: item.finalLabel?.purchaseTrigger,
    reusableCopyPattern: isKookdae ? undefined : item.finalLabel?.reusableCopyPattern,
    visualTone: item.finalLabel?.visualTone,
    layoutPattern: item.finalLabel?.layoutPattern || item.finalLabel?.visualCopyRelation,
    whyItWorks: item.finalLabel?.whyItWorks,
  })),
  null,
  2
)}

[자동 적용된 레퍼런스 사용 범위]
${JSON.stringify(
  referenceUsages.map((usage) => ({
    ...usage,
    reference: (() => {
      const label = referenceContext.find((item) => item.imageId === usage.imageId)?.finalLabel;
      if (!label) return null;
      if (!isKookdae) return label;
      return {
        hookType: label.hookType,
        appealPoint: label.appealPoint,
        copyNuance: label.copyNuance,
        whyItWorks: label.whyItWorks,
        targetEmotion: label.targetEmotion,
        visualTone: label.visualTone,
        layoutPattern: label.layoutPattern,
        recommendedUse: label.recommendedUse,
      };
    })(),
  })),
  null,
  2
)}

[메시지 계층 생성 규칙]
- 먼저 primaryMessage, secondaryMessage, proofMessage, offerMessage, actionMessage의 역할을 분리한다.
- primaryMessage는 첫 시선을 잡는 핵심 후킹, secondaryMessage는 상품 설명, proofMessage는 확인된 근거, offerMessage는 혜택과 구매 명분, actionMessage는 다음 행동이다.
- 같은 의미를 여러 계층에서 반복하지 않는다.
- 이 메시지 계층을 현재 renderer 호환 필드 headline, bodyCopy, highlightCopy, bottomBarCopy, cta에 각각 매핑한다.
- 광고 브리프의 mandatoryInfo는 누락하지 않고 prohibitedClaims는 절대 사용하지 않는다.
- additionalEmphasis가 있으면 상세페이지 사실과 충돌하지 않는 범위에서 우선 반영한다.
- 선택한 광고 전략의 후킹과 소구 방향을 우선하되 상품 정보에 없는 사실은 만들지 않는다.
- 선택한 광고 전략이 PRODUCT_USP_ANALYSIS와 충돌하거나 상품 차이가 없는 generic 문구라면, 전략의 hookType만 유지하고 USP 중심으로 다시 작성한다.

${copyGuideBlock}

[Brand Guide + Reference Integration Rules]
- Brand Copy Guide is the advertiser's fixed tone, preferred expression style, and repeatable persuasion grammar.
- Automatically matched reference labels provide hook patterns, appeal points, copy nuance, consumer insight, and visual-copy relations.
- If they conflict, preserve the brand guide's tone and use the highest-ranked reference as the primary angle.
- If no Brand Copy Guide matched, use only product information and the automatically matched patterns.
- If no reference label exists, use product information and matched Brand Copy Guide only.
- If neither guide nor reference exists, generate a conservative default performance ad copy from product information.
- Do not copy guide examples or OCR text verbatim.
- Generate copyVariants.short, copyVariants.medium, copyVariants.long as independent executions of the selected target tension and hook angle, not as paraphrases with only different lengths.
- For 국대한우, copyVariants.short/medium/long must be independently grounded in confirmed USP signals. Never make short/medium by trimming long.
- Fill copyGuideUsage with guideId, brandName, usedSections, and toneApplied when a guide exists.
- Fill referencePatternUsage.usedReferenceIds, appliedPatterns, and avoidedDirectCopy when a reference exists.

${guideSpecificRules(copyGuide)}

[선택 템플릿]
templateId: ${template?.templateId || ""}
templateName: ${template?.templateName || ""}
copyLimits: ${JSON.stringify(copyLimitSummary, null, 2)}
templateStrategy: ${templateStrategy(template?.templateId)}
${templateSpecificRules(template?.templateId)}

[Primary Reference Copy Pattern 추출]
아래 자동 매칭 1순위 reference에서 다음 항목을 먼저 분석한 뒤, 보조 레퍼런스의 공통 패턴으로 검증한다.
우선순위는 ${referenceFieldPriority.join(" > ")} 순서다.

referenceLabel:
${JSON.stringify(referenceJsonForPrompt, null, 2)}

분석해야 할 항목:
- 원문 OCR
- 첫 문장의 후킹 방식
- 문장 톤
- 소구점
- 소비자 감정
- 밈/유행어/구어체 여부
- 가격/혜택/문제제기/후기/선물명분 구조 여부
- 새 상품에 적용 가능한 변형 방향

[hookType별 문구 전략]
- 가격정당화형: 싸다는 말보다 "이 가격이면 사도 되는 이유"를 만든다.
- 문제제기형: 소비자의 불편이나 결핍을 먼저 찌르고 해결 구조로 간다.
- 공감형: 소비자가 속으로 생각할 법한 말을 쓴다.
- 후기/리뷰형: 실제 사용자 반응처럼 짧고 믿을 만하게 쓴다.
- UGC형: reference에 근거가 있을 때만 SNS 게시글 같은 말투로 쓴다.
- 선물명분형: 가격보다 체면, 명분, 고급감을 같이 살린다.
- 긴급/한정형: 지금 사야 할 이유를 분명하게 만든다.
- 상황제안형: 특정 상황에서 왜 필요한지 보여준다.

[타겟 맞춤 후킹 구조]
- problem-solution: "타겟이 겪는 구체적 불편 → 짧은 반전 → 확인된 해결 근거"
- feature-usp / proof: "비슷한 상품과 비교할 기준 → 상세페이지 근거 → 선택 이유"
- sensory: "사용 직전의 불편한 감각 → 사용 순간의 확인된 감각 차이"
- price-benefit: "가격 숫자 → 구성 또는 효용 → 이 조건을 봐야 하는 이유"
- lifestyle / gift: "정확한 사용 순간 → 실패하고 싶지 않은 심리 → 상품 근거"
- curiosity: "구체적 차이 하나 → 왜 중요한지 궁금증 → bodyCopy에서 근거 회수"
- social-proof는 실제 후기 근거가 PRODUCT_USP_ANALYSIS 또는 reviewSources에 있을 때만 사용한다.
- 같은 단어로 시작하는 headline을 short/medium/long에 반복하지 않는다.

[밈/트렌드 표현 제한]
~코어, 나와버림, 저장각, 장바구니각, 야호, 미쳤다, 반칙, 아직도 없음?, 이거 왜 이제 알았지 같은 표현은 reference OCR/copyNuance/trendElements에 그런 톤이 있을 때만 사용한다.
reference가 고급형이면 고급스럽게, 가격형이면 가격정당화형으로, 밈형이면 밈형으로 생성한다.

[금지 표현]
- 만나보세요
- 기다립니다
- 필수 아이템
- 특별한 선택
- 자세한 정보
- 여기를 클릭
- 새로워진 즐거움
- 만족을 줄 수 있음
- 여러분을 기다립니다
- 지금 바로 확인하기
- 숫자만 있는 headline
- undefined, null, NaN이 포함된 문구

[bodyCopy 규칙]
- bodyCopy는 반드시 존댓말이다.
- 가능한 28자 이내, 최대 36자를 넘기지 않는다.
- 반말 종결 금지: ~임, ~함, ~됨, ~각, ~듯, ~없음.
- headline 후보군의 긴 후킹 문장을 그대로 넣지 않는다.

[copyVariants 길이 규칙]
- short.headline: 8~14자
- medium.headline: 12~22자
- long.headline: 18~34자
- short/medium/long은 같은 소구를 기계적으로 자른 문구가 아니라, 길이별 전용 패턴에서 고른 자연스러운 대안이어야 한다.
- short는 짧은 말맛과 강한 후킹을 우선한다.
- medium은 자연스러운 후기/가격충격 문장으로 쓴다.
- long은 확인된 USP와 구매 이유를 가장 풍부하게 전달한다.
- 국대한우 가이드가 적용되어도 가이드 예시 문장이나 가이드가 제공한 상품 주장을 사용하지 않는다.

[출력 JSON]
JSON만 반환한다. 모든 문자열에는 이모지를 넣지 않는다.
{
  "messageHierarchy": {
    "primaryMessage": "",
    "secondaryMessage": "",
    "proofMessage": "",
    "offerMessage": "",
    "actionMessage": ""
  },
  "headline": "",
  "bodyCopy": "",
  "highlightCopy": "",
  "bottomBarCopy": "",
  "cta": "",
  "price": "",
  "hookType": "",
  "appealPoint": "",
  "whyThisWorks": "",
  "reasoning": {
    "headlineReason": "",
    "bodyReason": "",
    "highlightReason": "",
    "referencePatternUsed": "",
    "consumerInsightUsed": "",
    "purchaseTriggerUsed": "",
    "headlineQualityCheck": "",
    "selectedKookdaePattern": "",
    "rejectedGenericExpressions": [],
    "productFactsUsed": []
  },
  "referencePatternUsage": {
    "usedReferenceIds": [],
    "appliedPatterns": [],
    "avoidedDirectCopy": true,
    "usedHookPattern": "",
    "usedCopyStructure": "",
    "usedToneOfVoice": "",
    "usedConsumerInsight": "",
    "usedPurchaseTrigger": "",
    "usedReusablePattern": "",
    "usedVisualCopyRelation": ""
  },
  "copyGuideUsage": {
    "guideId": "",
    "brandName": "",
    "usedSections": [],
    "toneApplied": [],
    "selectedPatterns": [
      {
        "variant": "short",
        "patternGroup": "",
        "sourcePattern": "",
        "tone": ""
      },
      {
        "variant": "medium",
        "patternGroup": "",
        "sourcePattern": "",
        "tone": ""
      },
      {
        "variant": "long",
        "patternGroup": "",
        "sourcePattern": "",
        "tone": ""
      }
    ]
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
}
