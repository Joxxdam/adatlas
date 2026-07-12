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
    return "식품/특가 히어로형: headline은 강하고 짧게, bodyCopy는 존댓말 1문장, highlightCopy는 가격/구성 혜택, bottomBarCopy는 마지막 구매 명분으로 쓴다.";
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
- 국대한우 가이드는 고정 브랜드 톤입니다. reference label은 현재 소재의 후킹 방향과 소구점입니다.
- 1-A/1-B/1-C/1-D는 모두 headline 후보군입니다. 반드시 headline과 headlineVariants에 우선 반영합니다.
- 1-B 내부 고백/사장님 결단형, 1-C 전문가/권위 인용형, 1-D 반전/반신반의형은 bodyCopy, bottomBarCopy, cta에 긴 문장으로 넣지 않습니다.
- bodyCopy는 상품 설명, 맛, 부위, 구성, 사용 상황을 존댓말 1문장으로 씁니다.
- highlightCopy는 "도매가", "무료배송", "특별가", "선물용 구성"처럼 짧은 스티커/배지 문구로 씁니다.
- bottomBarCopy는 가격 명분, 한정성, 구성 혜택을 짧게 보조합니다.
- cta는 "구성 보러가기", "오늘 특가 보기"처럼 짧은 행동형 문구만 씁니다.
- copyGuideUsage.usedSections에는 실제로 쓴 섹션명을 넣습니다. 예: ["1-A 기본 가격/선물 후킹형", "1-B 내부 고백/사장님 결단형", "2 서브카피"].
- copyGuideUsage.toneApplied에는 적용한 톤을 구체적으로 씁니다. 예: ["가격 충격", "선물 명분", "내부 고백 톤", "존댓말 bodyCopy"].
- headlineVariants.short/medium/long은 단순 축약이 아니라 1-A~1-D 중 서로 다른 후보 스타일을 자연스럽게 변형합니다.
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
단, 모든 문구를 밈처럼 만들지 말고 reference label과 브랜드 가이드의 실제 톤에 맞춰야 한다.

[중요 원칙]
- reference label은 최대 1개만 참고한다.
- reference OCR을 그대로 복사하지 않는다.
- reference의 문장 구조, 말투, 후킹 방식, 감정 유도 방식, 밈성, 가격 소구, CTA 구조만 추출해 현재 상품에 맞게 변형한다.
- 가격/혜택/상품명을 코드처럼 붙인 비문을 만들지 않는다.
- headline에는 숫자만 넣지 않는다.
- headline 후보 5개를 내부적으로 만든 뒤, 비문/generic/상품 정보 결여 후보를 제거하고 가장 좋은 1개만 JSON에 출력한다.
- 이모지와 그림문자는 절대 출력하지 않는다.
- bodyCopy는 headline을 반복하지 말고 존댓말 1문장으로 쓴다.

[상품 정보]
${JSON.stringify(product, null, 2)}

${copyGuideBlock}

[Brand Guide + Reference Integration Rules]
- Brand Copy Guide is the advertiser's fixed tone, preferred expression style, and repeatable persuasion grammar.
- The selected reference label is the current creative's hook pattern, appeal point, copy nuance, and visual-copy relation.
- If the two conflict, preserve the brand guide's tone and use the reference label as an angle/structure.
- If no Brand Copy Guide matched, use only product information and reference label.
- If no reference label exists, use product information and matched Brand Copy Guide only.
- If neither guide nor reference exists, generate a conservative default performance ad copy from product information.
- Do not copy guide examples or OCR text verbatim.
- Generate copyVariants.short, copyVariants.medium, copyVariants.long with the same appeal but different natural lengths.
- Fill copyGuideUsage with guideId, brandName, usedSections, and toneApplied when a guide exists.
- Fill referencePatternUsage.usedReferenceIds, appliedPatterns, and avoidedDirectCopy when a reference exists.

${guideSpecificRules(copyGuide)}

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
- 문제제기형: 소비자의 불편이나 결핍을 먼저 찌르고 해결 구조로 간다.
- 공감형: 소비자가 속으로 생각할 법한 말을 쓴다.
- 후기/리뷰형: 실제 사용자 반응처럼 짧고 믿을 만하게 쓴다.
- UGC형: reference에 근거가 있을 때만 SNS 게시글 같은 말투로 쓴다.
- 선물명분형: 가격보다 체면, 명분, 고급감을 같이 살린다.
- 긴급/한정형: 지금 사야 할 이유를 분명하게 만든다.
- 상황제안형: 특정 상황에서 왜 필요한지 보여준다.

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
- short/medium/long은 같은 소구를 기계적으로 자른 문구가 아니라, 자연스러운 길이별 대안이어야 한다.
- 국대한우 가이드가 적용되면 1-A/1-B/1-C/1-D 스타일 중 최소 2개 이상을 headlineVariants에 반영한다.

[출력 JSON]
JSON만 반환한다. 모든 문자열에는 이모지를 넣지 않는다.
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
