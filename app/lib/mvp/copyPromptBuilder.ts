import { copyLimitCharSummary } from "./templateCopyFitter";
import type {
  AdImageLabel,
  CopyGuideContext,
  ProductInfoForPrompt,
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
- 이 템플릿은 "분할고기특가형 템플릿"이다. 일반 배너 문장이 아니라 레퍼런스처럼 상단 후킹 + 하단 가격 블록에 맞춰 쓴다.
- headline: 상단 1~2줄 후킹 문구. 가격/선물/가성비/구성 충격을 강하게 쓴다. 예: "4만원대로 생색 제대로 내는 선물 찾았습니다"
- bodyCopy: 상품명 또는 상품 특징명만 짧게 쓴다. 설명문 금지. 예: "국내산 설록우 찰진 등심"
- highlightCopy: 빨간 배지 라벨만 쓴다. 예: "파격특가", "한정특가", "실속특가"
- bottomBarCopy: 기존가 숫자만 쓴다. 기존가 정보가 없으면 빈 문자열로 둔다. 문장 금지.
- price: 최종 판매가 숫자만 쓴다. 예: "49,800원"
- cta: 이 템플릿에서는 빈 문자열로 둔다.
- 금지: bodyCopy에 긴 설명문, bottomBarCopy에 혜택 문장, highlightCopy에 긴 문장을 넣지 않는다.
`;
    return `
[food-template-001 전용 슬롯 규칙]
- 이 템플릿은 "분할고기특가형 템플릿"이다.
- headline: 상단 2줄 가격/구성 충격 후킹. 예: "4만원대로 생색 제대로 내는 선물 찾았습니다"
- bodyCopy: 상품명 또는 핵심 상품명만 짧게. 예: "국내산 설록우 찰진 등심"
- highlightCopy: 빨간 배지 문구. 예: "파격특가", "한정특가", "실속특가"
- bottomBarCopy: 기존가 숫자. 예: "148,000원"
- price: 최종 판매가 숫자. 예: "49,800원"
- cta는 비워도 된다. 설명문, 긴 혜택 문장, 리뷰 문장을 bodyCopy에 넣지 않는다.
`;
  }

  return "";
}

function templateStrategy(templateId?: string) {
  if (!templateId) {
    return "템플릿 미선택: headline은 짧은 후킹, bodyCopy는 존댓말 보조 설명, highlightCopy는 핵심 혜택, bottomBarCopy는 구매 명분으로 분리한다.";
  }

  if (/food-template-001/.test(templateId)) {
    return "분할고기특가형: headline은 가격/선물/가성비 후킹 1~2줄, bodyCopy는 상품명만, highlightCopy는 파격특가 같은 배지 라벨, bottomBarCopy는 기존가 숫자, price는 판매가 숫자로 분리한다.";
    return "좌우 이미지 분할형: headline은 2줄 이내 강한 후킹, highlightCopy는 가격/구성 명분, bottomBarCopy는 추가 혜택이나 구매 이유를 짧게 둔다.";
  }

  if (/food-template-002/.test(templateId)) {
    return "리뷰/평점형: headline은 소비자 반응처럼 쓰고, bodyCopy는 존댓말 후기 느낌, highlightCopy는 판매량/리뷰/혜택을 압축한다.";
  }

  if (/food-template-003/.test(templateId)) {
    return "비교 설명형: headline은 비교 축을 명확히 하고, bodyCopy는 차분한 존댓말 설명으로 쓴다.";
  }

  if (/food-template-004/.test(templateId)) {
    return "프리미엄 임팩트형: headline은 큼직한 선언형, highlightCopy는 가격 또는 품질 명분, price는 독립적으로 읽히게 둔다.";
  }

  if (/food-template-005/.test(templateId)) {
    return "SNS/밈형: reference에 실제 밈 톤이 있을 때만 끊긴 말투, ~코어, 야호, POV 같은 패턴을 상품명에 맞게 변형한다.";
  }

  if (/food-impact-hero-001|bold-commerce-001|price-proof-002|home-shopping-max-010/.test(templateId)) {
    return "식품/특가 히어로형: headline은 강하고 짧게, bodyCopy는 존댓말 1문장, highlightCopy는 가격/구성 혜택, bottomBarCopy는 마지막 구매 명분으로 쓴다.";
  }

  if (/premium-gift-006/.test(templateId)) {
    return "고급 선물형: 밈 표현을 피하고 체면, 선물 명분, 고급감, 부담 낮은 가격을 차분하게 설득한다.";
  }

  if (/ugc-meme-005/.test(templateId)) {
    return "UGC형: reference의 OCR과 trendElements에 근거가 있을 때만 SNS 말투를 쓰고, 과한 브랜드 문구는 피한다.";
  }

  return "선택 템플릿에 맞춰 각 슬롯의 역할을 분리하고, 모든 문구는 배너에 들어갈 수 있게 짧게 쓴다.";
}

export function buildGenerateCopyPrompt(params: {
  product: ProductInfoForPrompt;
  reference?: AdImageLabel;
  template?: TemplateInfo;
  copyGuide?: CopyGuideContext | null;
}) {
  const { product, reference, template, copyGuide } = params;
  const copyLimitSummary = copyLimitCharSummary(template?.copyLimits);
  const referenceJson = referencePayload(reference);
  const copyGuideBlock = copyGuide
    ? `
[Brand Copy Guide]
guideId: ${copyGuide.guideId}
brandName: ${copyGuide.brandName}
matchedBy: ${copyGuide.matchedBy.join(", ")}

This guide contains the advertiser's preferred tone, repeatable copy structures, price framing, gift framing, proof cues, and CTA style.
Do not copy example lines verbatim. Recompose the style for the current product and selected reference label.

${copyGuide.content}
`
    : `
[Brand Copy Guide]
No advertiser-specific copy guide matched. Use the product information and the selected reference label.
`;

  return `
너는 일반 브랜드 카피라이터가 아니라 한국 이커머스 퍼포먼스 광고의 후킹 문구를 만드는 마케터다.
예쁜 문장보다 클릭을 유도하는 첫 문장, 소비자 공감, 가격정당화, 선물명분, 후기형 말투, SNS식 표현을 우선한다.
단, 모든 문구를 밈처럼 만들지 말고 아래 reference label의 실제 OCR 문구, 말투, copyNuance, hookType, whyItWorks에 맞춘다.

[중요 원칙]
- reference label은 단 1개만 참고한다.
- reference OCR을 그대로 복사하지 않는다.
- reference의 문장 구조, 말투, 후킹 방식, 감정 유도 방식, 밈성, 가격 소구, CTA 구조만 추출해 현재 상품에 맞게 변형한다.
- 가격/혜택/상품명을 코드처럼 붙인 비문을 만들지 않는다.
- headline에는 숫자만 넣지 않는다.
- headline 후보 5개를 내부적으로 만든 뒤 비문, generic, 상품 정보 왜곡 후보를 제거하고 가장 좋은 1개만 JSON에 출력한다.
- 내부 후보 목록이나 사고 과정은 출력하지 않는다.
- 이모티콘과 그림문자는 절대 출력하지 않는다.

[상품 정보]
${JSON.stringify(product, null, 2)}

${copyGuideBlock}

[Brand Guide + Reference Integration Rules]
- Brand Copy Guide is the advertiser's fixed tone, preferred expression style, and repeatable persuasion grammar.
- The selected reference label is the current creative's hook pattern, appeal point, copy nuance, and visual-copy relation.
- If the two conflict, preserve the brand guide's tone and use the reference label as an angle/structure.
- Do not copy guide examples or OCR text verbatim.
- Generate copyVariants.short, copyVariants.medium, copyVariants.long with the same appeal but different lengths.
- Fill copyGuideUsage with guideId, brandName, usedSections, and toneApplied.
- Fill referencePatternUsage.usedReferenceIds, appliedPatterns, and avoidedDirectCopy.

[선택 템플릿]
templateId: ${template?.templateId || ""}
templateName: ${template?.templateName || ""}
copyLimits: ${JSON.stringify(copyLimitSummary, null, 2)}
templateStrategy: ${templateStrategy(template?.templateId)}
${templateSpecificRules(template?.templateId)}

[Reference Copy Pattern 추출]
아래 reference 1개에서 다음 항목을 먼저 분석한 뒤 문구에 반영한다.
우선순위는 ${referenceFieldPriority.join(" > ")} 순서다.

referenceLabel:
${JSON.stringify(referenceJson, null, 2)}

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
- 문제제기형: 소비자의 불편이나 결핍을 먼저 찌르고 해결 구조로 쓴다.
- 공감형: 소비자가 속으로 할 법한 말을 쓴다.
- 후기/리뷰형: 실제 사용자의 짧은 반응처럼 쓴다.
- UGC형: 광고 같지 않은 SNS 게시글/짤 말투로 쓴다.
- 선물명분형: 가격보다 체면, 명분, 고급감, 선물 이유를 함께 살린다.
- 긴급/한정형: 지금 사야 할 이유를 분명하게 만든다.
- 상황제안형: 특정 상황에서 왜 필요한지 보여준다.

[밈/트렌드 표현 제한]
~코어, 나와버림, 저장각, 장바구니각, 야호, 미쳤다, 반칙, 아직도 없음?, 이거 왜 이제 알았지는 reference OCR/copyNuance/trendElements에 그런 톤이 있을 때만 사용한다.
reference가 고급형/감성형이면 차분하게, 가격형이면 가격정당화형으로, 밈형이면 밈형으로 쓴다.

[금지 headline 및 금지 표현]
- 이젠 새로워진 즐거움을 만나보세요
- 설레는 새 상품이 여러분을 기다립니다
- 특별한 선택
- 필수 아이템
- 자세한 정보
- 여기를 클릭
- 지금 바로 확인하기
- 64이면 분만함
- 64800이면 든든함
- 숫자만 있는 headline
- undefined, null, NaN이 포함된 문구

[bodyCopy 규칙]
- bodyCopy는 반드시 존댓말이다.
- headline/highlightCopy는 퍼포먼스 광고 톤이 가능하지만 bodyCopy는 존댓말로 정리한다.
- bodyCopy는 1문장, 가능하면 28자 이내, 최대 36자를 넘기지 않는다.
- 반말 종결 금지: ~다, ~듯, ~각, ~임, ~함, ~됨, ~템, ~없음.

[출력 JSON]
JSON만 반환한다. 모든 문자열에는 이모티콘을 넣지 않는다.
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
  "reasoning": {
    "headlineReason": "",
    "bodyReason": "",
    "highlightReason": "",
    "referencePatternUsed": "",
    "consumerInsightUsed": "",
    "purchaseTriggerUsed": "",
    "headlineQualityCheck": ""
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
    "toneApplied": []
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
