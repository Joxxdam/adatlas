import type { TemplateCopyLimits } from "../app/lib/mvp/types";

export type HeadlineFontPresetId =
  "impact-korean-red" | "commerce-heavy-black" | "premium-serif-gold" | "ugc-bold-white";

export type HeadlineFontPreset = {
  description: string;
  fontFamily: string;
  fontWeight: number;
  letterSpacing: number;
  lineHeight: number;
  color: string;
  textStroke?: boolean;
  textStrokeColor?: string;
  textStrokeWidth?: number;
  textShadow?: boolean;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
};

export const headlineFontPresets: Record<HeadlineFontPresetId, HeadlineFontPreset> = {
  "impact-korean-red": {
    description: "식품/공구형 광고의 초두꺼운 빨간 헤드라인",
    fontFamily:
      '"Black Han Sans", Pretendard, "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif',
    fontWeight: 900,
    letterSpacing: -4,
    lineHeight: 0.95,
    color: "#ff1f1f",
    textShadow: true,
    shadowColor: "rgba(255, 31, 31, 0.18)",
    shadowBlur: 0,
    shadowOffsetX: 1,
    shadowOffsetY: 2,
  },
  "commerce-heavy-black": {
    description: "검정색 굵은 설명형 헤드라인",
    fontFamily: 'Pretendard, "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif',
    fontWeight: 900,
    letterSpacing: -2,
    lineHeight: 1.05,
    color: "#111111",
  },
  "premium-serif-gold": {
    description: "선물/고급감 템플릿용 묵직한 골드 톤",
    fontFamily: '"Noto Serif KR", serif',
    fontWeight: 800,
    letterSpacing: -1,
    lineHeight: 1.1,
    color: "#d6a84f",
  },
  "ugc-bold-white": {
    description: "배경 이미지 위에 얹는 흰색 UGC형 굵은 문구",
    fontFamily: 'Pretendard, "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif',
    fontWeight: 900,
    letterSpacing: -3,
    lineHeight: 1,
    color: "#ffffff",
    textStroke: true,
    textStrokeColor: "#111111",
    textStrokeWidth: 4,
  },
};

export const templateHeadlinePresetMap: Record<string, HeadlineFontPresetId> = {
  "shock-headline-001": "impact-korean-red",
  "food-impact-hero-001": "impact-korean-red",
  "food-template-001": "impact-korean-red",
  "food-template-002": "impact-korean-red",
  "food-template-003": "premium-serif-gold",
  "food-template-004": "commerce-heavy-black",
  "food-template-005": "ugc-bold-white",
  "bold-commerce-001": "impact-korean-red",
  "price-proof-002": "impact-korean-red",
  "home-shopping-max-010": "impact-korean-red",
  "premium-gift-006": "premium-serif-gold",
  "ugc-meme-005": "ugc-bold-white",
};

export type BannerTemplateDefinition = {
  id: string;
  name: string;
  category: string;
  templateGroup: string;
  description: string;
  recommendedHookTypes: string[];
  recommendedAppealPoints: string[];
  style: Record<string, string | number | boolean>;
  typography: Record<string, number>;
  zones: Record<string, string>;
  copyLimits?: TemplateCopyLimits;
};

export const foodTemplateCopyLimits: Record<string, TemplateCopyLimits> = {
  "food-template-001": {
    headline: {
      maxChars: 28,
      maxLines: 2,
      minFontSize: 52,
      maxFontSize: 86,
      overflowStrategy: "shrink-wrap-ellipsis",
    },
    bodyCopy: {
      maxChars: 22,
      maxLines: 1,
      minFontSize: 26,
      maxFontSize: 40,
      overflowStrategy: "shrink-ellipsis",
    },
    highlightCopy: {
      maxChars: 10,
      maxLines: 1,
      minFontSize: 24,
      maxFontSize: 34,
      overflowStrategy: "shrink-ellipsis",
    },
    bottomBarCopy: {
      maxChars: 12,
      maxLines: 1,
      minFontSize: 26,
      maxFontSize: 42,
      overflowStrategy: "shrink-ellipsis",
    },
    cta: {
      maxChars: 8,
      maxLines: 1,
      minFontSize: 18,
      maxFontSize: 28,
      overflowStrategy: "shrink-ellipsis",
    },
    price: {
      maxChars: 12,
      maxLines: 1,
      minFontSize: 52,
      maxFontSize: 86,
      overflowStrategy: "shrink-ellipsis",
    },
  },
  "food-template-002": {
    headline: {
      maxChars: 12,
      maxLines: 2,
      minFontSize: 52,
      maxFontSize: 92,
      overflowStrategy: "shrink-wrap-ellipsis",
    },
    bodyCopy: {
      maxChars: 34,
      maxLines: 2,
      minFontSize: 24,
      maxFontSize: 34,
      overflowStrategy: "shrink-wrap-ellipsis",
    },
    highlightCopy: {
      maxChars: 24,
      maxLines: 1,
      minFontSize: 24,
      maxFontSize: 34,
      overflowStrategy: "shrink-ellipsis",
    },
    bottomBarCopy: {
      maxChars: 28,
      maxLines: 1,
      minFontSize: 24,
      maxFontSize: 34,
      overflowStrategy: "shrink-ellipsis",
    },
    cta: {
      maxChars: 8,
      maxLines: 1,
      minFontSize: 22,
      maxFontSize: 32,
      overflowStrategy: "shrink-ellipsis",
    },
    price: {
      maxChars: 12,
      maxLines: 1,
      minFontSize: 48,
      maxFontSize: 82,
      overflowStrategy: "shrink-ellipsis",
    },
  },
  "food-template-003": {
    headline: {
      maxChars: 18,
      maxLines: 2,
      minFontSize: 34,
      maxFontSize: 48,
      overflowStrategy: "shrink-wrap-ellipsis",
    },
    bodyCopy: {
      maxChars: 44,
      maxLines: 2,
      minFontSize: 18,
      maxFontSize: 30,
      overflowStrategy: "shrink-wrap-ellipsis",
    },
    highlightCopy: {
      maxChars: 24,
      maxLines: 2,
      minFontSize: 20,
      maxFontSize: 34,
      overflowStrategy: "shrink-wrap-ellipsis",
    },
    bottomBarCopy: {
      maxChars: 30,
      maxLines: 1,
      minFontSize: 22,
      maxFontSize: 34,
      overflowStrategy: "shrink-ellipsis",
    },
    cta: {
      maxChars: 10,
      maxLines: 1,
      minFontSize: 20,
      maxFontSize: 30,
      overflowStrategy: "shrink-ellipsis",
    },
    price: {
      maxChars: 12,
      maxLines: 1,
      minFontSize: 34,
      maxFontSize: 60,
      overflowStrategy: "shrink-ellipsis",
    },
  },
  "food-template-004": {
    headline: {
      maxChars: 20,
      maxLines: 2,
      minFontSize: 42,
      maxFontSize: 78,
      overflowStrategy: "shrink-wrap-ellipsis",
    },
    bodyCopy: {
      maxChars: 50,
      maxLines: 3,
      minFontSize: 20,
      maxFontSize: 34,
      overflowStrategy: "shrink-wrap-ellipsis",
    },
    highlightCopy: {
      maxChars: 22,
      maxLines: 1,
      minFontSize: 22,
      maxFontSize: 32,
      overflowStrategy: "shrink-ellipsis",
    },
    bottomBarCopy: {
      maxChars: 30,
      maxLines: 2,
      minFontSize: 22,
      maxFontSize: 32,
      overflowStrategy: "shrink-wrap-ellipsis",
    },
    cta: {
      maxChars: 10,
      maxLines: 1,
      minFontSize: 20,
      maxFontSize: 30,
      overflowStrategy: "shrink-ellipsis",
    },
    price: {
      maxChars: 12,
      maxLines: 1,
      minFontSize: 34,
      maxFontSize: 54,
      overflowStrategy: "shrink-ellipsis",
    },
  },
  "food-template-005": {
    headline: {
      maxChars: 16,
      maxLines: 2,
      minFontSize: 52,
      maxFontSize: 92,
      overflowStrategy: "shrink-wrap-ellipsis",
    },
    bodyCopy: {
      maxChars: 36,
      maxLines: 2,
      minFontSize: 24,
      maxFontSize: 36,
      overflowStrategy: "shrink-wrap-ellipsis",
    },
    highlightCopy: {
      maxChars: 24,
      maxLines: 1,
      minFontSize: 28,
      maxFontSize: 48,
      overflowStrategy: "shrink-ellipsis",
    },
    bottomBarCopy: {
      maxChars: 30,
      maxLines: 1,
      minFontSize: 26,
      maxFontSize: 42,
      overflowStrategy: "shrink-ellipsis",
    },
    cta: {
      maxChars: 10,
      maxLines: 1,
      minFontSize: 20,
      maxFontSize: 30,
      overflowStrategy: "shrink-ellipsis",
    },
    price: {
      maxChars: 12,
      maxLines: 1,
      minFontSize: 50,
      maxFontSize: 96,
      overflowStrategy: "shrink-ellipsis",
    },
  },
  "food-impact-hero-001": {
    headline: {
      maxChars: 16,
      maxLines: 2,
      minFontSize: 56,
      maxFontSize: 108,
      overflowStrategy: "shrink-wrap-ellipsis",
    },
    bodyCopy: {
      maxChars: 40,
      maxLines: 2,
      minFontSize: 28,
      maxFontSize: 43,
      overflowStrategy: "shrink-wrap-ellipsis",
    },
    highlightCopy: {
      maxChars: 26,
      maxLines: 1,
      minFontSize: 24,
      maxFontSize: 35,
      overflowStrategy: "shrink-ellipsis",
    },
    bottomBarCopy: {
      maxChars: 30,
      maxLines: 1,
      minFontSize: 24,
      maxFontSize: 37,
      overflowStrategy: "shrink-ellipsis",
    },
    cta: {
      maxChars: 10,
      maxLines: 1,
      minFontSize: 22,
      maxFontSize: 34,
      overflowStrategy: "shrink-ellipsis",
    },
    price: {
      maxChars: 12,
      maxLines: 1,
      minFontSize: 36,
      maxFontSize: 56,
      overflowStrategy: "shrink-ellipsis",
    },
  },
};

const baseFoodFont =
  'Pretendard, "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

export const foodCategoryTemplates: BannerTemplateDefinition[] = [
  {
    id: "food-template-001",
    name: "분할 고기 특가형",
    category: "식품/선물",
    templateGroup: "food",
    description:
      "좌우 분할 상품 비주얼과 하단 가격 블록으로 선물/고기 특가감을 강하게 보여주는 템플릿입니다.",
    recommendedHookTypes: ["감탄형", "가격정당화형", "가격충격형", "긴급/한정형"],
    recommendedAppealPoints: ["가성비", "실속", "즉시혜택", "후기신뢰"],
    style: {
      backgroundColor: "#ffffff",
      headlineColor: "#ff1f1f",
      bodyColor: "#111111",
      highlightBackground: "#ffe600",
      highlightTextColor: "#111111",
      bottomBarColor: "#ff1f1f",
      bottomBarTextColor: "#ffffff",
      ctaBarColor: "#e58585",
      ctaTextColor: "#ffffff",
      priceColor: "#ff1f1f",
      accentColor: "#ffe600",
      headlineFontPreset: "impact-korean-red",
      headlineFontWeight: 900,
      headlineLetterSpacing: -4,
      headlineLineHeight: 0.95,
      fontFamily: baseFoodFont,
    },
    typography: {
      headlineFontSize: 112,
      bodyFontSize: 42,
      highlightFontSize: 36,
      bottomBarFontSize: 36,
      ctaFontSize: 32,
    },
    zones: {
      headline: "top",
      body: "top-mid",
      highlight: "mid-band",
      product: "center-large",
      bottom: "bottom-bar",
      cta: "bottom-pill",
    },
    copyLimits: foodTemplateCopyLimits["food-template-001"],
  },
  {
    id: "food-template-002",
    name: "가격 폭발 특가형",
    category: "식품/선물",
    templateGroup: "food",
    description:
      "고기 이미지를 전체 배경으로 깔고 후기 박스, 원가/특가, 하단 대형 오드라인을 강조하는 식품 특가 템플릿입니다.",
    recommendedHookTypes: ["가격정당화형", "가격소구형", "긴급/한정형"],
    recommendedAppealPoints: ["가성비", "실속", "즉시혜택"],
    style: {
      backgroundColor: "#111111",
      headlineColor: "#ffffff",
      bodyColor: "#111111",
      highlightBackground: "#ffe600",
      highlightTextColor: "#111111",
      badgeColor: "#ffe600",
      bottomBarColor: "#111111",
      bottomBarTextColor: "#ffffff",
      ctaBarColor: "#ff1f1f",
      ctaTextColor: "#ffffff",
      priceColor: "#ff1f1f",
      priceStrokeColor: "#ffffff",
      priceStrokeWidth: 8,
      accentColor: "#ffe600",
      headlineFontPreset: "impact-korean-red",
      fontFamily: baseFoodFont,
    },
    typography: {
      headlineFontSize: 112,
      bodyFontSize: 38,
      highlightFontSize: 96,
      bottomBarFontSize: 34,
      ctaFontSize: 32,
    },
    zones: {
      background: "full-bleed-meat",
      headline: "top-left-review-box",
      price: "center-original-sale",
      highlight: "bottom-main-offer",
    },
    copyLimits: foodTemplateCopyLimits["food-template-002"],
  },
  {
    id: "food-template-003",
    name: "미니멀 비교 설명형",
    category: "식품/선물",
    templateGroup: "food",
    description:
      "흰 배경 2단 비교 레이아웃으로 설명형/브랜드형 상품을 차분하게 보여주는 템플릿입니다.",
    recommendedHookTypes: ["선물명분형", "가격정당화형", "전문가/권위형"],
    recommendedAppealPoints: ["선물명분", "고급감", "실속", "사회적 인정"],
    style: {
      backgroundColor: "#15100c",
      headlineColor: "#f7d27a",
      bodyColor: "#fff7e6",
      highlightBackground: "#3a2416",
      highlightTextColor: "#f7d27a",
      bottomBarColor: "#2b1a10",
      bottomBarTextColor: "#fff7e6",
      ctaBarColor: "#b8893b",
      ctaTextColor: "#ffffff",
      priceColor: "#f7d27a",
      accentColor: "#b8893b",
      headlineFontPreset: "premium-serif-gold",
      headlineFontWeight: 800,
      headlineLetterSpacing: -1,
      fontFamily: '"Noto Serif KR", serif',
    },
    typography: {
      headlineFontSize: 84,
      bodyFontSize: 36,
      highlightFontSize: 32,
      bottomBarFontSize: 30,
      ctaFontSize: 30,
    },
    zones: {
      headline: "top-premium",
      product: "center-framed",
      body: "bottom-copy",
      highlight: "gold-label",
      price: "subtle",
      cta: "gold-button",
    },
    copyLimits: foodTemplateCopyLimits["food-template-003"],
  },
  {
    id: "food-template-004",
    name: "후기 말풍선 UGC형",
    category: "식품/선물",
    templateGroup: "food",
    description: "실제 구매 후기나 SNS 반응처럼 보이는 후기/UGC형 식품 리뷰 템플릿입니다.",
    recommendedHookTypes: ["후기/리뷰형", "UGC형", "공감형", "반전/궁금증형"],
    recommendedAppealPoints: ["후기신뢰", "가성비", "실속", "감정적 공감"],
    style: {
      backgroundColor: "#fff8ef",
      headlineColor: "#111111",
      bodyColor: "#222222",
      highlightBackground: "#ffffff",
      highlightTextColor: "#111111",
      accentColor: "#ff5a2f",
      bottomBarColor: "#ff5a2f",
      bottomBarTextColor: "#ffffff",
      ctaBarColor: "#111111",
      ctaTextColor: "#ffffff",
      priceColor: "#ff5a2f",
      headlineFontPreset: "commerce-heavy-black",
      fontFamily: baseFoodFont,
    },
    typography: {
      headlineFontSize: 78,
      bodyFontSize: 34,
      highlightFontSize: 32,
      bottomBarFontSize: 32,
      ctaFontSize: 30,
    },
    zones: {
      headline: "review-top",
      body: "speech-card",
      product: "center-photo",
      highlight: "reaction-card",
      cta: "bottom-dark",
    },
    copyLimits: foodTemplateCopyLimits["food-template-004"],
  },
  {
    id: "food-template-005",
    name: "다크 임팩트 공구형",
    category: "식품/선물",
    templateGroup: "food",
    description:
      "어두운 배경 위에 대형 문구, 전면 상품, 흰 외곽선 가격을 쌓아 공구 광고처럼 강하게 보이는 템플릿입니다.",
    recommendedHookTypes: ["감탄형", "가격충격형", "선물명분형", "긴급/한정형"],
    recommendedAppealPoints: ["고급감", "가성비", "실속", "즉시혜택"],
    style: {
      backgroundColor: "#111111",
      backgroundMode: "auto-detail-blur-dark",
      backgroundBlur: "high",
      backgroundDarkOverlay: 0.55,
      headlineColor: "#ffe600",
      headlineTextStroke: true,
      headlineTextStrokeColor: "#111111",
      headlineTextStrokeWidth: 4,
      bodyColor: "#ffffff",
      highlightBackground: "#111111",
      highlightTextColor: "#ffe600",
      bottomBarColor: "#ff1f1f",
      bottomBarTextColor: "#ffffff",
      ctaBarColor: "#ff1f1f",
      ctaTextColor: "#ffffff",
      priceColor: "#ff1f1f",
      priceStrokeColor: "#ffffff",
      priceStrokeWidth: 6,
      accentColor: "#ffe600",
      headlineFontPreset: "ugc-bold-white",
      fontFamily: baseFoodFont,
    },
    typography: {
      headlineFontSize: 92,
      bodyFontSize: 36,
      highlightFontSize: 30,
      bottomBarFontSize: 34,
      ctaFontSize: 30,
    },
    zones: {
      background: "full-bleed-blur",
      headline: "top-overlay",
      product: "center-foreground",
      price: "bottom-large",
      cta: "bottom-red",
    },
    copyLimits: foodTemplateCopyLimits["food-template-005"],
  },
];

const splitMeatDealTemplate = foodCategoryTemplates.find(
  (template) => template.id === "food-template-001"
);

if (splitMeatDealTemplate) {
  Object.assign(splitMeatDealTemplate, {
    name: "분할고기특가형 템플릿",
    category: "식품/선물",
    description:
      "여러 컷의 고기/상품 이미지를 분할 배치하고, 상단 헤드라인과 하단 상품명·기존가·배지·판매가를 강하게 보여주는 식품 특가형 템플릿입니다.",
    recommendedHookTypes: ["가격정당화형", "가격충격형", "긴급/한정형", "선물명분형"],
    recommendedAppealPoints: ["가성비", "대용량", "특가", "선물 명분"],
    typography: {
      headlineFontSize: 86,
      bodyFontSize: 36,
      highlightFontSize: 30,
      bottomBarFontSize: 36,
      ctaFontSize: 24,
    },
    style: {
      ...splitMeatDealTemplate.style,
      backgroundColor: "#111111",
      headlineColor: "#ffffff",
      bodyColor: "#ffffff",
      highlightBackground: "#ff1f1f",
      highlightTextColor: "#ffffff",
      bottomBarColor: "#111111",
      bottomBarTextColor: "#ffffff",
      priceColor: "#fff238",
      accentColor: "#fff238",
      headlineFontPreset: "impact-korean-red",
      headlineFontWeight: 900,
      headlineLetterSpacing: -3,
      headlineLineHeight: 0.98,
    },
    zones: {
      headline: "top-impact-headline",
      product: "middle-split-product-images-1-to-4",
      body: "bottom-left-product-name",
      bottom: "bottom-left-original-price",
      highlight: "bottom-left-red-special-badge",
      price: "bottom-right-sale-price",
      cta: "optional-hidden",
    },
    copyLimits: foodTemplateCopyLimits["food-template-001"],
  });
}

export const templatesById = new Map(
  foodCategoryTemplates.map((template) => [template.id, template])
);
export const foodCategoryTemplateIds = foodCategoryTemplates.map((template) => template.id);

export const foodImpactHeroTemplate = {
  id: "food-impact-hero-001",
  style: {
    backgroundColor: "#ffffff",
    headlineColor: "#ff1f1f",
    headlineFontPreset: "impact-korean-red" as HeadlineFontPresetId,
    headlineFontFamily: headlineFontPresets["impact-korean-red"].fontFamily,
    headlineFontSize: 108,
    headlineFontWeight: 900,
    headlineLetterSpacing: -4,
    headlineLineHeight: 0.95,
    headlineTextStroke: false,
    headlineTextStrokeColor: "#111111",
    headlineTextStrokeWidth: 0,
    headlineShadow: true,
    headlineShadowColor: "rgba(255, 31, 31, 0.18)",
    headlineShadowBlur: 0,
    headlineShadowOffsetX: 1,
    headlineShadowOffsetY: 2,
    bodyColor: "#111111",
    highlightBackground: "#fff9a8",
    highlightTextColor: "#111111",
    bottomBarColor: "#ff1f1f",
    bottomBarTextColor: "#ffffff",
    ctaBarColor: "#e58585",
    ctaTextColor: "#ffffff",
    priceColor: "#ff1f1f",
    accentColor: "#fff9a8",
    fontFamily: 'Pretendard, "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif',
  },
  typography: {
    headlineFontSize: 108,
    bodyFontSize: 43,
    highlightFontSize: 35,
    bottomBarFontSize: 37,
    ctaFontSize: 34,
    headlineLineHeight: 0.95,
    bodyLineHeight: 1.22,
    highlightLineHeight: 1.14,
    letterSpacing: -4,
  },
  copyLimits: foodTemplateCopyLimits["food-impact-hero-001"],
};

export type FoodImpactHeroTemplate = typeof foodImpactHeroTemplate;
