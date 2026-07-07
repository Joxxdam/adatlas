"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  AdImageAnalysisDraft,
  AdImageLabel,
  CollectedAdImage,
  GeneratedAdImage,
  GeneratedAdCopy,
  GeneratedImageAsset,
  GptImageCandidate,
  GptImageFailureReason,
  GptImageGenerationMode,
  GptImagePreservationMode,
  GptImageSourceMode,
  GptPromptTemplateMode,
  GptCustomPromptState,
  ExtractedProductInfo,
  MvpBrand,
  ProductImageEffectPreset,
  ProductImageMode,
  ProductImageRenderEffect,
  ProductImageState,
  ProductInfoForPrompt,
  SourceImageCandidate,
  SourceImageSelectionState,
  TemplateFittedCopy,
} from "../lib/mvp/types";
import { buildRevisionPromptFromFeedback } from "../lib/mvp/gptImageFeedback";
import { buildAutoImagePrompt } from "../lib/mvp/defaultImagePromptTemplates";
import { buildImageGenerationPrompt } from "../lib/mvp/imagePromptBuilder";
import { fitCopyToTemplate } from "../lib/mvp/templateCopyFitter";
import { foodCategoryTemplates, foodImpactHeroTemplate, type BannerTemplateDefinition } from "../../lib/bannerTemplates";

type Props = {
  initialBrands: MvpBrand[];
  initialImages: CollectedAdImage[];
  initialGenerated: GeneratedAdImage[];
};

type Status = { kind: "idle" | "loading" | "success" | "error"; message: string };

type HeadlineStyleOverrides = {
  headlineFontPreset?: "impact-korean-red" | "commerce-heavy-black" | "premium-serif-gold" | "ugc-bold-white";
  headlineFontSize?: number;
  headlineFontWeight?: number;
  headlineLetterSpacing?: number;
  headlineLineHeight?: number;
  headlineColor?: string;
  headlineTextStroke?: boolean;
  headlineTextStrokeColor?: string;
  headlineTextStrokeWidth?: number;
  headlineShadow?: boolean;
};

type BackgroundMode = "none" | "auto-detail-blur-dark" | "selected-detail-blur-dark";
type BackgroundLevel = "low" | "medium" | "high";

type BackgroundStyleState = {
  blurLevel: BackgroundLevel;
  dimLevel: BackgroundLevel;
};

type BannerTextColorState = {
  bodyColor: string;
  bodyFontSize: number;
};

type MainImageSourceMode = "detail" | "upload" | "gpt";
type ImageGenerationProvider = "openai" | "gemini";

const gptImageFailureReasonOptions: { value: GptImageFailureReason; label: string }[] = [
  { value: "original-subject-changed", label: "원본 상품이 바뀜" },
  { value: "turned-into-packaged-product", label: "포장 상품처럼 바뀜" },
  { value: "cooked-food-turned-raw", label: "조리/원물 상태가 바뀜" },
  { value: "product-too-small", label: "상품이 너무 작음" },
  { value: "bad-background", label: "배경이 어색함" },
  { value: "unwanted-text", label: "원치 않는 글씨가 생김" },
  { value: "unwanted-label-or-logo", label: "라벨/로고가 생김" },
  { value: "copied-reference-product", label: "레퍼런스를 너무 따라감" },
  { value: "weak-advertising-mood", label: "광고 느낌이 약함" },
  { value: "too-ai-looking", label: "AI 느낌이 강함" },
  { value: "wrong-composition", label: "구도가 안 맞음" },
  { value: "other", label: "기타" },
];

const preserveSourcePromptTemplate = `이 이미지는 GPT 이미지 생성의 기준 이미지입니다.

원본 이미지의 핵심 피사체, 형태, 색감, 질감, 구도, 음식의 상태를 최대한 유지해주세요.
현재 이미지가 조리된 고기 또는 상세페이지 음식 이미지라면, 이를 포장육 상품, 플라스틱 트레이 상품, 새로운 패키지 상품으로 바꾸지 마세요.

Preserve the original subject, food texture, cooked appearance, composition, color tone, and visual identity.
Do not redesign the product.
Do not replace the food with a packaged product, plastic tray product, raw meat package, or a different item.
Do not create a new package, label, logo, or container unless explicitly requested.

변경해도 되는 것은 배경, 조명, 선명도, 광고 분위기, 색 보정, 약한 그림자 정도입니다.
Edit only the background, lighting, sharpness, commercial mood, color grading, and subtle shadows.

이미지 안에는 글씨, 숫자, 로고, 캡션, 버튼 문구를 넣지 마세요.
No readable text.
No typography.
No letters.
No numbers.
No captions.

최종 이미지는 원본 이미지를 기반으로 한 글씨 없는 광고 비주얼이어야 합니다.`;

const noTextAdVisualPromptTemplate = `원본 이미지를 기반으로 1:1 비율의 이커머스 광고용 비주얼을 만들어주세요.

상품 또는 음식은 화면의 주인공처럼 크게 보이게 해주세요.
Make the product or food the main hero.
Keep the original subject recognizable.

배경과 조명은 더 광고스럽고 고급스럽게 개선해주세요.
Edit only the background, lighting, and advertising mood.

이미지 안에는 글씨를 넣지 마세요.
No readable text.
No typography.
No letters.
No numbers.
No captions.`;

const noPackageChangePromptTemplate = `중요:
원본 이미지가 포장 제품이 아니라면, 절대 포장 제품으로 바꾸지 마세요.
Do not turn the original image into a packaged product.
Do not create a plastic tray package.
Do not add a new product label.
Do not add a brand logo.
Do not change cooked food into raw meat or packaged meat.`;

const emptySourceImageSelection: SourceImageSelectionState = {
  candidates: [],
  selectedSourceImageId: "",
  selectedSourceImagePath: "",
};

const emptyProductImageState: ProductImageState = {
  originalImagePath: "",
  selectedImageMode: "original",
  cutoutApplied: false,
  effectPreset: "outline-glow-shadow",
};

const defaultCutoutProductEffect: ProductImageRenderEffect = {
  outline: true,
  outlineColor: "#ffffff",
  outlineWidth: 14,
  shadow: true,
  shadowBaseColor: "#000000",
  shadowOpacity: 0.45,
  shadowColor: "rgba(0,0,0,0.45)",
  shadowBlur: 24,
  shadowOffsetX: 0,
  shadowOffsetY: 10,
  glow: true,
  glowBaseColor: "#ffffff",
  glowOpacity: 0.55,
  glowColor: "rgba(255,255,255,0.55)",
  glowBlur: 28,
  productScale: 1.08,
  productOffsetX: 0,
  productOffsetY: 0,
  productRotation: 0,
};

const cutoutProductEffectPresets: { id: string; label: string; effect: ProductImageRenderEffect }[] = [
  {
    id: "clean-outline",
    label: "깔끔한 흰 테두리",
    effect: {
      ...defaultCutoutProductEffect,
      outlineWidth: 10,
      shadowOpacity: 0.28,
      shadowColor: "rgba(0,0,0,0.28)",
      shadowBlur: 16,
      shadowOffsetY: 6,
      glow: false,
      glowOpacity: 0.4,
      glowColor: "rgba(255,255,255,0.4)",
      glowBlur: 0,
      productScale: 1,
    },
  },
  {
    id: "strong-commerce",
    label: "강한 광고 강조",
    effect: {
      ...defaultCutoutProductEffect,
      outlineWidth: 16,
      shadowOpacity: 0.5,
      shadowColor: "rgba(0,0,0,0.5)",
      shadowBlur: 28,
      shadowOffsetY: 12,
      glowOpacity: 0.65,
      glowColor: "rgba(255,255,255,0.65)",
      glowBlur: 34,
      productScale: 1.12,
    },
  },
  {
    id: "yellow-deal",
    label: "특가식 강전환",
    effect: {
      ...defaultCutoutProductEffect,
      outlineColor: "#fff200",
      outlineWidth: 12,
      shadowOpacity: 0.6,
      shadowColor: "rgba(0,0,0,0.6)",
      shadowBlur: 30,
      shadowOffsetY: 14,
      glowBaseColor: "#fff200",
      glowOpacity: 0.5,
      glowColor: "rgba(255,242,0,0.5)",
      glowBlur: 30,
      productScale: 1.15,
    },
  },
  {
    id: "premium-gift",
    label: "고급 선물 힌트",
    effect: {
      ...defaultCutoutProductEffect,
      outlineWidth: 8,
      shadowOpacity: 0.55,
      shadowColor: "rgba(0,0,0,0.55)",
      shadowBlur: 34,
      shadowOffsetY: 16,
      glowBaseColor: "#ffdc96",
      glowOpacity: 0.35,
      glowColor: "rgba(255,220,150,0.35)",
      glowBlur: 26,
      productScale: 1.05,
    },
  },
];

type SystemFontOption = {
  id: string;
  label: string;
  fontFamily: string;
  fontFile: string;
  fontWeight?: number;
};

type MetaCrawlItem = {
  brandName: string;
  imageUrl: string;
  localImagePath?: string;
  originalAdUrl: string;
  collectedAt: string;
};

const presetBrandLogos = [
  {
    id: "gukdae-hanwoo",
    label: "국대한우 로고",
    imagePath: "/brand-logos/gukdae-hanwoo-logo.png",
  },
];

const fixedSourceReferenceImages: SourceImageCandidate[] = [
  {
    id: "fixed-seolroku-logo-reference",
    type: "detail",
    imagePath: "/source-reference-images/seolroku-logo-reference.jpg",
    originalUrl: "/source-reference-images/seolroku-logo-reference.jpg",
    label: "설록우 로고 참고 이미지",
    selected: false,
    createdAt: "preset",
  },
];

const systemFontOptions: SystemFontOption[] = [
  {
    id: "black-han-sans",
    label: "Black Han Sans",
    fontFamily: "AdAtlasSelectedFont, \"Black Han Sans\", \"Noto Sans KR\", sans-serif",
    fontFile: "C:/Users/daywiz_레노버/AppData/Local/Microsoft/Windows/Fonts/BlackHanSans-Regular.ttf",
  },
  {
    id: "cafe24-ohsquare",
    label: "Cafe24 Ohsquare",
    fontFamily: "AdAtlasSelectedFont, \"Cafe24 Ohsquare OTF\", \"Noto Sans KR\", sans-serif",
    fontFile: "C:/Users/daywiz_레노버/AppData/Local/Microsoft/Windows/Fonts/Cafe24Ohsquare-v2.0.otf",
  },
  {
    id: "cafe24-dangdanghae",
    label: "Cafe24 Dangdanghae",
    fontFamily: "AdAtlasSelectedFont, \"Cafe24 Dangdanghae OTF\", \"Noto Sans KR\", sans-serif",
    fontFile: "C:/Users/daywiz_레노버/AppData/Local/Microsoft/Windows/Fonts/Cafe24Dangdanghae-v2.0.otf",
  },
  {
    id: "cafe24-supermagic",
    label: "Cafe24 Supermagic",
    fontFamily: "AdAtlasSelectedFont, \"Cafe24 Supermagic OTF\", \"Noto Sans KR\", sans-serif",
    fontFile: "C:/Users/daywiz_레노버/AppData/Local/Microsoft/Windows/Fonts/Cafe24Supermagic-Regular-v1.0.otf",
  },
  {
    id: "cafe24-nyangi",
    label: "Cafe24 Nyangi",
    fontFamily: "AdAtlasSelectedFont, \"Cafe24 Nyangi B\", \"Noto Sans KR\", sans-serif",
    fontFile: "C:/Users/daywiz_레노버/AppData/Local/Microsoft/Windows/Fonts/Cafe24Nyangi-B-v1.0.ttf",
  },
  {
    id: "cafe24-ssukssuk",
    label: "Cafe24 Ssukssuk",
    fontFamily: "AdAtlasSelectedFont, \"Cafe24 Ssukssuk\", \"Noto Sans KR\", sans-serif",
    fontFile: "C:/Users/daywiz_레노버/AppData/Local/Microsoft/Windows/Fonts/Cafe24SsukssukRegular.ttf",
  },
  {
    id: "cafe24-behappy",
    label: "Cafe24 Behappy",
    fontFamily: "AdAtlasSelectedFont, \"Cafe24 Behappy\", \"Noto Sans KR\", sans-serif",
    fontFile: "C:/Users/daywiz_레노버/AppData/Local/Microsoft/Windows/Fonts/Cafe24Behappy.ttf",
  },
  {
    id: "cafe24-pro-slim-max",
    label: "Cafe24 PRO Slim Max",
    fontFamily: "AdAtlasSelectedFont, \"Cafe24 PRO Slim Max\", \"Noto Sans KR\", sans-serif",
    fontFile: "C:/Users/daywiz_레노버/AppData/Local/Microsoft/Windows/Fonts/Cafe24PROSlimMax.otf",
  },
  {
    id: "gmarket-bold",
    label: "Gmarket Sans Bold",
    fontFamily: "AdAtlasSelectedFont, \"Gmarket Sans TTF\", \"Noto Sans KR\", sans-serif",
    fontFile: "C:/Users/daywiz_레노버/AppData/Local/Microsoft/Windows/Fonts/GmarketSansTTFBold.ttf",
  },
  {
    id: "gmarket-medium",
    label: "Gmarket Sans Medium",
    fontFamily: "AdAtlasSelectedFont, \"Gmarket Sans TTF\", \"Noto Sans KR\", sans-serif",
    fontFile: "C:/Users/daywiz_레노버/AppData/Local/Microsoft/Windows/Fonts/GmarketSansTTFMedium.ttf",
  },
  {
    id: "gmarket-light",
    label: "Gmarket Sans Light",
    fontFamily: "AdAtlasSelectedFont, \"Gmarket Sans TTF\", \"Noto Sans KR\", sans-serif",
    fontFile: "C:/Users/daywiz_레노버/AppData/Local/Microsoft/Windows/Fonts/GmarketSansTTFLight.ttf",
  },
  {
    id: "scdream-1",
    label: "S-Core Dream 1",
    fontWeight: 100,
    fontFamily: "AdAtlasSelectedFont, \"S-Core Dream\", \"Noto Sans KR\", sans-serif",
    fontFile: "C:/Users/daywiz_레노버/AppData/Local/Microsoft/Windows/Fonts/SCDream1.otf",
  },
  {
    id: "scdream-2",
    label: "S-Core Dream 2",
    fontWeight: 200,
    fontFamily: "AdAtlasSelectedFont, \"S-Core Dream\", \"Noto Sans KR\", sans-serif",
    fontFile: "C:/Users/daywiz_레노버/AppData/Local/Microsoft/Windows/Fonts/SCDream2.otf",
  },
  {
    id: "scdream-3",
    label: "S-Core Dream 3",
    fontWeight: 300,
    fontFamily: "AdAtlasSelectedFont, \"S-Core Dream\", \"Noto Sans KR\", sans-serif",
    fontFile: "C:/Users/daywiz_레노버/AppData/Local/Microsoft/Windows/Fonts/SCDream3.otf",
  },
  {
    id: "scdream-4",
    label: "S-Core Dream 4",
    fontWeight: 400,
    fontFamily: "AdAtlasSelectedFont, \"S-Core Dream\", \"Noto Sans KR\", sans-serif",
    fontFile: "C:/Users/daywiz_레노버/AppData/Local/Microsoft/Windows/Fonts/SCDream4.otf",
  },
  {
    id: "scdream-5",
    label: "S-Core Dream 5",
    fontWeight: 500,
    fontFamily: "AdAtlasSelectedFont, \"S-Core Dream\", \"Noto Sans KR\", sans-serif",
    fontFile: "C:/Users/daywiz_레노버/AppData/Local/Microsoft/Windows/Fonts/SCDream5.otf",
  },
  {
    id: "scdream-6",
    label: "S-Core Dream 6",
    fontWeight: 600,
    fontFamily: "AdAtlasSelectedFont, \"S-Core Dream\", \"Noto Sans KR\", sans-serif",
    fontFile: "C:/Users/daywiz_레노버/AppData/Local/Microsoft/Windows/Fonts/SCDream6.otf",
  },
  {
    id: "scdream-7",
    label: "S-Core Dream 7",
    fontWeight: 700,
    fontFamily: "AdAtlasSelectedFont, \"S-Core Dream\", \"Noto Sans KR\", sans-serif",
    fontFile: "C:/Users/daywiz_레노버/AppData/Local/Microsoft/Windows/Fonts/SCDream7.otf",
  },
  {
    id: "scdream-8",
    label: "S-Core Dream 8",
    fontWeight: 800,
    fontFamily: "AdAtlasSelectedFont, \"S-Core Dream\", \"Noto Sans KR\", sans-serif",
    fontFile: "C:/Users/daywiz_레노버/AppData/Local/Microsoft/Windows/Fonts/SCDream8.otf",
  },
  {
    id: "scdream-9",
    label: "S-Core Dream 9",
    fontWeight: 900,
    fontFamily: "AdAtlasSelectedFont, \"S-Core Dream\", \"Noto Sans KR\", sans-serif",
    fontFile: "C:/Users/daywiz_레노버/AppData/Local/Microsoft/Windows/Fonts/SCDream9.otf",
  },
  {
    id: "noto-sans-kr",
    label: "Noto Sans KR",
    fontFamily: "AdAtlasSelectedFont, \"Noto Sans KR\", \"Malgun Gothic\", sans-serif",
    fontFile: "C:/Windows/Fonts/NotoSansKR-VF.ttf",
  },
  {
    id: "malgun-bold",
    label: "맑은 고딕 Bold",
    fontFamily: "AdAtlasSelectedFont, \"Malgun Gothic\", sans-serif",
    fontFile: "C:/Windows/Fonts/malgunbd.ttf",
  },
  {
    id: "malgun",
    label: "맑은 고딕",
    fontFamily: "AdAtlasSelectedFont, \"Malgun Gothic\", sans-serif",
    fontFile: "C:/Windows/Fonts/malgun.ttf",
  },
  {
    id: "noto-serif-kr",
    label: "Noto Serif KR",
    fontFamily: "AdAtlasSelectedFont, \"Noto Serif KR\", serif",
    fontFile: "C:/Windows/Fonts/NotoSerifKR-VF.ttf",
  },
  {
    id: "gulim",
    label: "굴림",
    fontFamily: "AdAtlasSelectedFont, Gulim, sans-serif",
    fontFile: "C:/Windows/Fonts/gulim.ttc",
  },
];

const categoryOptions = ["식품/선물", "뷰티/스킨케어", "패션/의류", "생활용품", "건강기능식품", "디지털/앱", "인테리어/리빙", "기타"];
const hookTypeOptions = [
  "가격정당화형",
  "가격소구형",
  "문제제기형",
  "공감형",
  "후기/리뷰형",
  "UGC형",
  "비포애프터형",
  "전문가/권위형",
  "선물명분형",
  "긴급/한정형",
  "반전/궁금증형",
  "상황제안형",
];
const appealPointOptions = [
  "가성비",
  "선물명분",
  "고급감",
  "실속",
  "불편해소",
  "체형보완",
  "성분/효능",
  "시간절약",
  "후기신뢰",
  "희소성",
  "즉시혜택",
  "자기관리",
  "사회적 인정",
];

const menus = ["카테고리 관리", "이미지 수집", "이미지 분석", "광고 생성", "결과 다운로드"];

const labelFields: { key: keyof AdImageAnalysisDraft; label: string }[] = [
  { key: "ocrText", label: "이미지 문구" },
  { key: "category", label: "카테고리" },
  { key: "hookType", label: "후킹 방식" },
  { key: "appealPoint", label: "핵심 소구점" },
  { key: "targetEmotion", label: "소비자 감정" },
  { key: "copyNuance", label: "카피 뉘앙스" },
  { key: "visualTone", label: "비주얼 톤" },
  { key: "layoutPattern", label: "레이아웃 구조" },
  { key: "whyItWorks", label: "왜 먹히는지" },
  { key: "recommendedUse", label: "응용 추천" },
];

const advancedLabelFields: { key: keyof AdImageAnalysisDraft; label: string }[] = [
  { key: "firstLineHook", label: "첫 문장 후킹" },
  { key: "copyStructure", label: "카피 구조" },
  { key: "toneOfVoice", label: "말투/톤" },
  { key: "trendElements", label: "트렌드 요소" },
  { key: "consumerInsight", label: "소비자 인사이트" },
  { key: "purchaseTrigger", label: "구매 트리거" },
  { key: "reusableCopyPattern", label: "재사용 카피 패턴" },
  { key: "visualCopyRelation", label: "비주얼-카피 연결" },
];

const emptyDraft: AdImageAnalysisDraft = {
  ocrText: "",
  category: "",
  hookType: "",
  appealPoint: "",
  targetEmotion: "",
  copyNuance: "",
  visualTone: "",
  layoutPattern: "",
  whyItWorks: "",
  recommendedUse: "",
  firstLineHook: "",
  copyStructure: "",
  toneOfVoice: "",
  trendElements: "",
  consumerInsight: "",
  purchaseTrigger: "",
  reusableCopyPattern: "",
  visualCopyRelation: "",
};

function normalizeAnalysisDraft(draft?: Partial<AdImageAnalysisDraft>): AdImageAnalysisDraft {
  return { ...emptyDraft, ...(draft ?? {}) };
}

const emptyProductInfo: ProductInfoForPrompt = {
  productName: "",
  category: "",
  price: "",
  originalPrice: "",
  oldPrice: "",
  discountInfo: "",
  mainBenefit: "",
  targetCustomer: "",
  landingUrl: "",
  productImagePath: "",
  secondaryProductImagePath: "",
  productImagePaths: [],
  backgroundImagePath: "",
  extractedDescription: "",
  extractedMainImage: "",
  extractedGalleryImages: [],
  selectedBackgroundSource: "",
  backgroundMode: "none",
  sourceImageCandidates: [],
  selectedSourceImageId: "",
  selectedSourceImagePath: "",
};

const productFields: { key: keyof ProductInfoForPrompt; label: string; placeholder: string }[] = [
  { key: "productName", label: "productName", placeholder: "예: 큐빅 헤어밴드 세트" },
  { key: "category", label: "category", placeholder: "예: 패션/의류" },
  { key: "price", label: "price", placeholder: "예: 39,900원" },
  { key: "discountInfo", label: "discountInfo", placeholder: "예: 오늘만 20% 할인" },
  { key: "mainBenefit", label: "mainBenefit", placeholder: "예: 선물하기 좋은 고급스러운 구성" },
  { key: "targetCustomer", label: "targetCustomer", placeholder: "예: 부담 없는 선물을 찾는 2030" },
  { key: "landingUrl", label: "landingUrl", placeholder: "https://..." },
];

function normalizeProductCategory(...values: string[]) {
  const text = values.join(" ").toLowerCase();

  if (/식품|한우|고기|과일|농산|수산|간식|선물|명절|추석|설/.test(text)) return "식품/선물";
  if (/뷰티|화장품|스킨|케어|크림|세럼|샴푸|향수|메이크업/.test(text)) return "뷰티/스킨케어";
  if (/패션|의류|옷|룩|원피스|팬츠|셔츠|신발|가방|주얼리|헤어밴드/.test(text)) return "패션/의류";
  if (/생활|용품|주방|청소|욕실|세제|수납/.test(text)) return "생활용품";
  if (/건강|영양|비타민|유산균|홍삼|단백질|기능식품|건기식/.test(text)) return "건강기능식품";
  if (/디지털|앱|어플|소프트웨어|전자|가전|모바일/.test(text)) return "디지털/앱";
  if (/인테리어|리빙|가구|침구|조명|홈데코/.test(text)) return "인테리어/리빙";

  return categoryOptions.includes(values[0]) ? values[0] : "기타";
}

function getSelectedProductImagePath(state: ProductImageState) {
  if (state.selectedImageMode === "styled-cutout" && state.styledCutoutImagePath) {
    return state.styledCutoutImagePath;
  }

  if (state.selectedImageMode === "cutout" && state.cutoutImagePath) {
    return state.cutoutImagePath;
  }

  return state.originalImagePath;
}

function productImageModeLabel(mode: ProductImageMode) {
  if (mode === "cutout") return "누끼본";
  if (mode === "styled-cutout") return "효과 적용 누끼본";
  return "원본";
}

function copyVisibleLength(value: string) {
  return [...String(value || "").replace(/\s+/g, "").trim()].length;
}

function hexToRgba(hex: string, opacity: number) {
  const normalized = hex.replace("#", "");
  const sixDigit = normalized.length === 3
    ? normalized.split("").map((char) => `${char}${char}`).join("")
    : normalized.padEnd(6, "0").slice(0, 6);
  const value = parseInt(sixDigit, 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red},${green},${blue},${Math.max(0, Math.min(1, opacity))})`;
}

function normalizeProductRenderEffect(effect: ProductImageRenderEffect): ProductImageRenderEffect {
  const shadowBaseColor = effect.shadowBaseColor || "#000000";
  const glowBaseColor = effect.glowBaseColor || "#ffffff";
  const shadowOpacity = effect.shadowOpacity ?? 0.45;
  const glowOpacity = effect.glowOpacity ?? 0.55;

  return {
    ...effect,
    shadowBaseColor,
    shadowOpacity,
    shadowColor: hexToRgba(shadowBaseColor, shadowOpacity),
    glowBaseColor,
    glowOpacity,
    glowColor: hexToRgba(glowBaseColor, glowOpacity),
  };
}

function buildSourceImageCandidates(extracted: ExtractedProductInfo): SourceImageCandidate[] {
  const createdAt = new Date().toISOString();
  const heroImage = extracted.heroImage || extracted.mainImage || extracted.galleryImages?.[0] || "";
  const detailImages = (extracted.detailImages?.length ? extracted.detailImages : extracted.galleryImages ?? [])
    .filter((imagePath) => imagePath && imagePath !== heroImage)
    .slice(0, 30);
  const candidates: SourceImageCandidate[] = [];

  if (heroImage) {
    candidates.push({
      id: "hero-001",
      type: "hero",
      imagePath: heroImage,
      originalUrl: heroImage,
      label: "대표 이미지",
      selected: true,
      createdAt,
    });
  }

  detailImages.forEach((imagePath, index) => {
    candidates.push({
      id: `detail-${String(index + 1).padStart(3, "0")}`,
      type: "detail",
      imagePath,
      originalUrl: imagePath,
      label: `상세 이미지 ${index + 1}`,
      selected: false,
      createdAt,
    });
  });

  return candidates;
}

const emptyBannerCopy: GeneratedAdCopy = {
  headline: "",
  bodyCopy: "",
  highlightCopy: "",
  bottomBarCopy: "",
  cta: "",
  price: "",
  hookType: "",
  appealPoint: "",
  whyThisWorks: "",
};

const legacyFoodImpactTemplateOption: BannerTemplateDefinition = {
  id: foodImpactHeroTemplate.id,
  name: "기존 식품 임팩트 템플릿",
  category: "식품/선물",
  templateGroup: "food-legacy",
  description: "기존 food-impact-hero-001 템플릿입니다. 새 템플릿과 별도로 원래 형태를 선택할 수 있습니다.",
  recommendedHookTypes: ["기존", "가격정당화형", "공감형"],
  recommendedAppealPoints: ["가성비", "구성", "즉시구매"],
  style: foodImpactHeroTemplate.style as Record<string, string | number | boolean>,
  typography: foodImpactHeroTemplate.typography,
  zones: {
    headline: "top",
    body: "top-mid",
    highlight: "mid-band",
    product: "center-large",
    bottom: "bottom-bar",
    cta: "bottom-pill",
  },
};

export function MvpDashboard({ initialBrands, initialGenerated, initialImages }: Props) {
  const [activeMenu, setActiveMenu] = useState(menus[0]);
  const [images, setImages] = useState(initialImages);
  const [generated, setGenerated] = useState(initialGenerated);
  const [labels, setLabels] = useState<AdImageLabel[]>([]);
  const [selectedImage, setSelectedImage] = useState<CollectedAdImage | null>(initialImages[0] ?? null);
  const [aiDraft, setAiDraft] = useState<AdImageAnalysisDraft>(emptyDraft);
  const [finalLabel, setFinalLabel] = useState<AdImageAnalysisDraft>(emptyDraft);
  const [labelStatus, setLabelStatus] = useState<Status>({ kind: "idle", message: "이미지를 선택하면 라벨 편집 패널이 열립니다." });
  const [selectedReferenceLabelIds, setSelectedReferenceLabelIds] = useState<string[]>([]);
  const [productInfo, setProductInfo] = useState<ProductInfoForPrompt>(emptyProductInfo);
  const [lastLoadedProductUrl, setLastLoadedProductUrl] = useState("");
  const [sourceImageSelection, setSourceImageSelection] = useState<SourceImageSelectionState>(emptySourceImageSelection);
  const [sourceImageStatus, setSourceImageStatus] = useState<Status>({ kind: "idle", message: "GPT 이미지 생성 기준이 될 원본 이미지를 선택해주세요." });
  const [productExtractStatus, setProductExtractStatus] = useState<Status>({ kind: "idle", message: "상품 URL을 입력하면 상세페이지 정보를 먼저 불러올 수 있습니다." });
  const [strategyStatus, setStrategyStatus] = useState<Status>({ kind: "idle", message: "라벨 완료 레퍼런스 1~3개와 새 상품 정보를 입력하세요." });
  const [copyResult, setCopyResult] = useState<GeneratedAdCopy | null>(null);
  const [copyReferenceLabels, setCopyReferenceLabels] = useState<AdImageLabel[]>([]);
  const [copyStatus, setCopyStatus] = useState<Status>({ kind: "idle", message: "상품 URL을 입력하면 저장된 라벨 데이터를 참고해 광고 문구를 생성합니다." });
  const [templateFittedCopy, setTemplateFittedCopy] = useState<TemplateFittedCopy | null>(null);
  const [bannerCopy, setBannerCopy] = useState<GeneratedAdCopy>(emptyBannerCopy);
  const [showCta, setShowCta] = useState(true);
  const [headlineStyleOverrides, setHeadlineStyleOverrides] = useState<HeadlineStyleOverrides>({});
  const [showAdvancedHeadlineStyle, setShowAdvancedHeadlineStyle] = useState(false);
  const [backgroundStyle, setBackgroundStyle] = useState<BackgroundStyleState>({ blurLevel: "high", dimLevel: "high" });
  const [bannerTextColors, setBannerTextColors] = useState<BannerTextColorState>({ bodyColor: "#111111", bodyFontSize: 50 });
  const [bannerAccentPhrase, setBannerAccentPhrase] = useState("");
  const [bannerAccentColor, setBannerAccentColor] = useState("#fff200");
  const [brandLogoPath, setBrandLogoPath] = useState("");
  const [brandLogoStatus, setBrandLogoStatus] = useState<Status>({ kind: "idle", message: "로고 파일을 선택하면 템플릿 2 오른쪽 상단에 배치됩니다." });
  const [showAiDisclosure, setShowAiDisclosure] = useState(false);
  const [aiDisclosureText, setAiDisclosureText] = useState("AI 활용 콘텐츠입니다.");
  const [mainImageSourceMode, setMainImageSourceMode] = useState<MainImageSourceMode>("detail");
  const [uploadedMainImageDataUrl, setUploadedMainImageDataUrl] = useState("");
  const [gptMainImagePath, setGptMainImagePath] = useState("");
  const [gptTextAdImagePath, setGptTextAdImagePath] = useState("");
  const [latestImagePrompt, setLatestImagePrompt] = useState("");
  const [gptVisualAsset, setGptVisualAsset] = useState<GeneratedImageAsset | null>(null);
  const [gptTextAdAsset, setGptTextAdAsset] = useState<GeneratedImageAsset | null>(null);
  const [gptReferenceImages, setGptReferenceImages] = useState<SourceImageCandidate[]>([]);
  const [gptImageCandidates, setGptImageCandidates] = useState<GptImageCandidate[]>([]);
  const [selectedGptImageCandidateId, setSelectedGptImageCandidateId] = useState<string | null>(null);
  const [selectedImageFailureReasons, setSelectedImageFailureReasons] = useState<GptImageFailureReason[]>([]);
  const [imageCustomFeedback, setImageCustomFeedback] = useState("");
  const [imageRevisionPrompt, setImageRevisionPrompt] = useState("");
  const [numImageCandidates, setNumImageCandidates] = useState(1);
  const [gptImageStatus, setGptImageStatus] = useState<Status>({ kind: "idle", message: "이미지 생성 버튼을 누르면 상품 정보 기반 이미지를 생성합니다." });
  const [gptTextAdStatus, setGptTextAdStatus] = useState<Status>({ kind: "idle", message: "글씨 포함 광고 이미지를 따로 생성할 수 있습니다." });
  const [gptReferenceImageStatus, setGptReferenceImageStatus] = useState<Status>({ kind: "idle", message: "참고 이미지는 분위기/구도 참고용으로만 사용됩니다." });
  const [imageGenerationProvider, setImageGenerationProvider] = useState<ImageGenerationProvider>("openai");
  const [gptImageSourceMode, setGptImageSourceMode] = useState<GptImageSourceMode>("image-edit");
  const [gptPreservationMode, setGptPreservationMode] = useState<GptImagePreservationMode>("preserve-product");
  const [gptPromptTemplateMode, setGptPromptTemplateMode] = useState<GptPromptTemplateMode>("visual-only");
  const [gptPromptState, setGptPromptState] = useState<GptCustomPromptState>({
    promptMode: "auto",
    autoPrompt: "",
    customPrompt: "",
    customPromptNote: "",
    finalPrompt: "",
  });
  const [productImageState, setProductImageState] = useState<ProductImageState>(emptyProductImageState);
  const [cutoutProductEffect, setCutoutProductEffect] = useState<ProductImageRenderEffect>(defaultCutoutProductEffect);
  const [productImageProcessStatus, setProductImageProcessStatus] = useState<Status>({
    kind: "idle",
    message: "기본은 원본 이미지를 사용합니다. 배경 제거가 필요하면 누끼 적용을 눌러주세요.",
  });
  const [hoveredDetailImage, setHoveredDetailImage] = useState<{ src: string; label: string; x: number; y: number } | null>(null);
  const [selectedHeadlineFontId, setSelectedHeadlineFontId] = useState(systemFontOptions[0].id);
  const [selectedBodyFontId, setSelectedBodyFontId] = useState("noto-sans-kr");
  const [selectedTemplateId, setSelectedTemplateId] = useState("food-template-001");
  const [generatedBannerPath, setGeneratedBannerPath] = useState("");
  const [renderStatus, setRenderStatus] = useState<Status>({ kind: "idle", message: "문구 생성 후 배너를 만들 수 있습니다." });
  const [crawledItems, setCrawledItems] = useState<MetaCrawlItem[]>([]);
  const [status, setStatus] = useState<Status>({ kind: "idle", message: "MVP 작업을 선택하세요." });
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [appealPointFilter, setAppealPointFilter] = useState("all");
  const [hookTypeFilter, setHookTypeFilter] = useState("all");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [labelStateFilter, setLabelStateFilter] = useState("all");
  const [referenceCategoryFilter, setReferenceCategoryFilter] = useState("all");

  const labelsByImageId = useMemo(() => new Map(labels.map((label) => [label.imageId, label])), [labels]);
  const selectedReferenceLabels = useMemo(
    () => selectedReferenceLabelIds.map((id) => labelsByImageId.get(id)).filter((label): label is AdImageLabel => Boolean(label)),
    [labelsByImageId, selectedReferenceLabelIds],
  );
  const referenceCategoryOptions = useMemo(() => {
    const categories = labels
      .map((label) => label.finalLabel?.category || label.category || "기타")
      .filter(Boolean);
    return Array.from(new Set(categories));
  }, [labels]);
  const filteredReferenceLabels = useMemo(
    () => labels.filter((label) => {
      const category = label.finalLabel?.category || label.category || "기타";
      return referenceCategoryFilter === "all" || category === referenceCategoryFilter;
    }),
    [labels, referenceCategoryFilter],
  );
  const backgroundImageOptions = useMemo(() => {
    const seen = new Set<string>();
    const sources = [
      { label: "대표 이미지", value: productInfo.extractedMainImage || productInfo.productImagePath },
      ...(productInfo.extractedGalleryImages ?? []).map((value, index) => ({ label: `상세 이미지 ${index + 1}`, value })),
    ];

    return sources.filter((source) => {
      if (!source.value || seen.has(source.value)) return false;
      seen.add(source.value);
      return true;
    });
  }, [productInfo.extractedGalleryImages, productInfo.extractedMainImage, productInfo.productImagePath]);
  const sourceImageCandidatesForDisplay = useMemo(() => {
    const existing = sourceImageSelection.candidates.length
      ? sourceImageSelection.candidates
      : productInfo.sourceImageCandidates ?? [];

    if (existing.length) {
      const seen = new Set(existing.map((candidate) => candidate.imagePath));
      return [
        ...existing,
        ...fixedSourceReferenceImages.filter((candidate) => !seen.has(candidate.imagePath)),
      ];
    }

    const createdAt = new Date().toISOString();
    return [
      ...backgroundImageOptions.map((option, index): SourceImageCandidate => ({
      id: index === 0 ? "hero-001" : `detail-${String(index).padStart(3, "0")}`,
      type: index === 0 ? "hero" : "detail",
      imagePath: option.value,
      originalUrl: option.value,
      label: option.label,
      selected: index === 0,
      createdAt,
      })),
      ...fixedSourceReferenceImages,
    ];
  }, [backgroundImageOptions, productInfo.sourceImageCandidates, sourceImageSelection.candidates]);
  const selectedSourceImage =
    sourceImageCandidatesForDisplay.find((candidate) => candidate.id === sourceImageSelection.selectedSourceImageId) ||
    sourceImageCandidatesForDisplay.find((candidate) => candidate.imagePath === sourceImageSelection.selectedSourceImagePath) ||
    sourceImageCandidatesForDisplay.find((candidate) => candidate.imagePath === productInfo.selectedSourceImagePath) ||
    sourceImageCandidatesForDisplay[0];
  const selectedSourceImagePath =
    selectedSourceImage?.imagePath ||
    sourceImageSelection.selectedSourceImagePath ||
    productInfo.selectedSourceImagePath ||
    productInfo.productImagePath ||
    backgroundImageOptions[0]?.value ||
    "";
  const currentBackgroundSource =
    productInfo.backgroundMode === "auto-detail-blur-dark"
      ? productInfo.productImagePath || productInfo.selectedBackgroundSource || productInfo.extractedMainImage || ""
      : productInfo.backgroundMode === "selected-detail-blur-dark"
        ? productInfo.selectedBackgroundSource || backgroundImageOptions[0]?.value || ""
        : "";
  const originalMainProductImage =
    mainImageSourceMode === "upload"
      ? uploadedMainImageDataUrl
      : mainImageSourceMode === "gpt"
        ? gptMainImagePath
        : productInfo.productImagePath;
  const currentMainProductImage = productImageState.selectedImageMode === "original"
    ? originalMainProductImage
    : getSelectedProductImagePath(productImageState) || originalMainProductImage;
  const currentSecondaryProductImage =
    productInfo.secondaryProductImagePath || backgroundImageOptions.find((option) => option.value !== originalMainProductImage)?.value || currentMainProductImage;
  const currentProductImagePaths = useMemo(() => {
    if (mainImageSourceMode !== "detail") return [currentMainProductImage].filter(Boolean);
    const selected = (productInfo.productImagePaths?.length
      ? productInfo.productImagePaths
      : [productInfo.productImagePath, productInfo.secondaryProductImagePath]).filter(Boolean);
    const fallback = backgroundImageOptions[0]?.value || "";
    const originals = (selected.length ? selected : [fallback]).filter(Boolean).slice(0, 4);
    return [currentMainProductImage || originals[0], ...originals.slice(1)].filter(Boolean).slice(0, 4);
  }, [backgroundImageOptions, currentMainProductImage, mainImageSourceMode, productInfo.productImagePath, productInfo.productImagePaths, productInfo.secondaryProductImagePath]);
  const selectedHeadlineFont = systemFontOptions.find((option) => option.id === selectedHeadlineFontId) ?? systemFontOptions[0];
  const selectedBodyFont = systemFontOptions.find((option) => option.id === selectedBodyFontId) ?? systemFontOptions.find((option) => option.id === "noto-sans-kr") ?? systemFontOptions[0];
  const categoryTemplates = useMemo(() => {
    const category = productInfo.category || "";
    const isFoodGiftCategory =
      category === "식품/선물" ||
      category.includes("식품") ||
      category.includes("선물") ||
      category.includes("food");
    return isFoodGiftCategory ? [...foodCategoryTemplates, legacyFoodImpactTemplateOption] : [];
  }, [productInfo.category]);
  const selectedTemplate = categoryTemplates.find((template) => template.id === selectedTemplateId) ?? categoryTemplates[0];
  const selectedCopyLimits = selectedTemplate?.copyLimits;
  const slotMaxChars = (key: "headline" | "bodyCopy" | "highlightCopy" | "bottomBarCopy" | "cta" | "price") => selectedCopyLimits?.[key]?.maxChars || (key === "headline" ? 14 : key === "bodyCopy" ? 32 : key === "highlightCopy" ? 24 : key === "bottomBarCopy" ? 28 : key === "cta" ? 8 : 12);
  const autoGptImagePrompt = useMemo(() => {
    const reference = selectedReferenceLabels[0]?.finalLabel;
    return buildAutoImagePrompt({
      templateMode: gptPromptTemplateMode,
      outputCanvasPreset: "sns-square-1200",
      productName: productInfo.productName,
      category: productInfo.category,
      targetCustomer: productInfo.targetCustomer,
      mainBenefit: productInfo.mainBenefit,
      discountInfo: productInfo.discountInfo,
      price: productInfo.price,
      headline: bannerCopy.headline,
      bodyCopy: bannerCopy.bodyCopy,
      highlightCopy: bannerCopy.highlightCopy,
      bottomBarCopy: bannerCopy.bottomBarCopy,
      cta: bannerCopy.cta,
      referenceVisualTone: reference?.visualTone,
      referenceLayoutPattern: reference?.layoutPattern || reference?.visualCopyRelation,
      referenceAppealPoint: reference?.appealPoint,
      referenceHookType: copyResult?.hookType || bannerCopy.hookType || reference?.hookType,
      referenceCopyNuance: reference?.copyNuance || reference?.toneOfVoice,
      selectedSourceImagePath,
      referenceImagePaths: gptReferenceImages.map((image) => image.imagePath),
      preservationMode: gptPreservationMode,
      customPromptNote: gptPromptState.customPromptNote,
    }).promptText;
  }, [
    bannerCopy,
    gptPreservationMode,
    gptReferenceImages,
    gptPromptState.customPromptNote,
    gptPromptTemplateMode,
    productInfo.category,
    productInfo.discountInfo,
    productInfo.mainBenefit,
    productInfo.price,
    productInfo.productName,
    productInfo.targetCustomer,
    selectedReferenceLabels,
    selectedSourceImagePath,
  ]);
  const finalGptImagePrompt =
    gptPromptState.promptMode === "custom" && gptPromptState.customPrompt.trim()
      ? gptPromptState.customPrompt.trim()
      : autoGptImagePrompt.trim();
  const selectedGptImageCandidate = useMemo(
    () => gptImageCandidates.find((candidate) => candidate.id === selectedGptImageCandidateId) || gptImageCandidates[0],
    [gptImageCandidates, selectedGptImageCandidateId],
  );
  const analyzedImages = images.filter((image) => labelsByImageId.has(image.id));
  const filteredImages = images.filter((image) => {
    const label = labelsByImageId.get(image.id);
    const category = label?.finalLabel.category || image.category || "기타";
    const hookType = label?.finalLabel.hookType || image.hookType || "";
    const appealPoint = label?.finalLabel.appealPoint || image.appealPoint || "";
    const platform = String(image.sourcePlatform || "").toLowerCase();
    const isLabeled = labelsByImageId.has(image.id);

    return (
      (categoryFilter === "all" || category === categoryFilter) &&
      (hookTypeFilter === "all" || hookType === hookTypeFilter) &&
      (appealPointFilter === "all" || appealPoint === appealPointFilter) &&
      (platformFilter === "all" || platform === platformFilter) &&
      (labelStateFilter === "all" || (labelStateFilter === "done" ? isLabeled : !isLabeled))
    );
  });
  const categoryCount = new Set(images.map((image) => labelsByImageId.get(image.id)?.finalLabel.category || image.category).filter(Boolean)).size;
  const hookTypeCount = new Set(images.map((image) => labelsByImageId.get(image.id)?.finalLabel.hookType || image.hookType).filter(Boolean)).size;
  const metrics = [
    ["전체 수집 이미지 수", images.length + crawledItems.length],
    ["라벨 필요 이미지 수", Math.max(0, images.length - analyzedImages.length)],
    ["라벨 완료 이미지 수", analyzedImages.length],
    ["카테고리 수", categoryCount],
    ["후킹 유형 수", hookTypeCount],
  ];

  useEffect(() => {
    refreshImages().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!categoryTemplates.length) return;
    if (!categoryTemplates.some((template) => template.id === selectedTemplateId)) {
      setSelectedTemplateId(categoryTemplates[0].id);
    }
  }, [categoryTemplates, selectedTemplateId]);

  useEffect(() => {
    setProductImageState({
      ...emptyProductImageState,
      originalImagePath: originalMainProductImage || "",
    });
    setProductImageProcessStatus({
      kind: "idle",
      message: "기본은 원본 이미지를 사용합니다. 배경 제거가 필요하면 누끼 적용을 눌러주세요.",
    });
  }, [originalMainProductImage]);

  useEffect(() => {
    setGptPromptState((current) => ({
      ...current,
      autoPrompt: autoGptImagePrompt,
      finalPrompt: current.promptMode === "custom" && current.customPrompt.trim()
        ? current.customPrompt.trim()
        : autoGptImagePrompt,
    }));
  }, [autoGptImagePrompt]);

  function buildPromptForImageMode(imageGenerationMode: GptImageGenerationMode) {
    const templateMode: GptPromptTemplateMode = imageGenerationMode === "text-in-image" ? "ad-image-with-copy" : "visual-only";
    const reference = selectedReferenceLabels[0]?.finalLabel;
    return buildAutoImagePrompt({
      templateMode,
      outputCanvasPreset: "sns-square-1200",
      productName: productInfo.productName,
      category: productInfo.category,
      targetCustomer: productInfo.targetCustomer,
      mainBenefit: productInfo.mainBenefit,
      discountInfo: productInfo.discountInfo,
      price: productInfo.price,
      headline: bannerCopy.headline,
      bodyCopy: bannerCopy.bodyCopy,
      highlightCopy: bannerCopy.highlightCopy,
      bottomBarCopy: bannerCopy.bottomBarCopy,
      cta: bannerCopy.cta,
      referenceVisualTone: reference?.visualTone,
      referenceLayoutPattern: reference?.layoutPattern || reference?.visualCopyRelation,
      referenceAppealPoint: reference?.appealPoint,
      referenceHookType: copyResult?.hookType || bannerCopy.hookType || reference?.hookType,
      referenceCopyNuance: reference?.copyNuance || reference?.toneOfVoice,
      selectedSourceImagePath,
      referenceImagePaths: gptReferenceImages.map((image) => image.imagePath),
      preservationMode: gptPreservationMode,
      customPromptNote: gptPromptState.customPromptNote,
    }).promptText;
  }

  function finalPromptForImageMode(imageGenerationMode: GptImageGenerationMode) {
    const autoPrompt = buildPromptForImageMode(imageGenerationMode);
    return gptPromptState.promptMode === "custom" && gptPromptState.customPrompt.trim()
      ? gptPromptState.customPrompt.trim()
      : autoPrompt;
  }

  async function refreshImages() {
    const response = await fetch("/api/mvp/images");
    const result = await response.json();
    setImages(result.images ?? []);
    setGenerated(result.generated ?? []);
    setLabels(result.labels ?? []);
  }

  function openLabelPanel(image: CollectedAdImage) {
    const existing = labelsByImageId.get(image.id);
    setSelectedImage(image);
    setAiDraft(normalizeAnalysisDraft(existing?.aiDraft));
    setFinalLabel(existing?.finalLabel ? normalizeAnalysisDraft(existing.finalLabel) : {
      ...emptyDraft,
      category: image.category || "",
      hookType: image.hookType || "",
      appealPoint: image.appealPoint || "",
    });
    setActiveMenu("이미지 수집");
    setLabelStatus({
      kind: existing ? "success" : "idle",
      message: existing ? "저장된 라벨을 먼저 불러왔습니다. 다시 호출하려면 재분석하기를 누르세요." : "AI 분석하기를 누르거나 직접 라벨을 입력하세요.",
    });
  }

  async function analyzeImage(image: CollectedAdImage) {
    setSelectedImage(image);
    setLabelStatus({ kind: "loading", message: `${image.category || "광고"} 이미지를 마케터 관점으로 분석 중입니다.` });

    try {
      const response = await fetch("/api/analyze/ad-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageId: image.id,
          brandName: image.brandName,
          category: image.category,
          imageUrl: image.imageUrl,
          localImagePath: image.localImagePath,
        }),
      });
      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? "AI 분석 실패");
      }

      const normalizedDraft = normalizeAnalysisDraft(result.draft);
      setAiDraft(normalizedDraft);
      setFinalLabel(normalizedDraft);
      setLabelStatus({
        kind: "success",
        message: result.isMock ? "OPENAI_API_KEY가 없어 mock 분석 초안을 만들었습니다." : "AI 분석 초안을 만들었습니다.",
      });
    } catch (error) {
      setLabelStatus({ kind: "error", message: error instanceof Error ? error.message : "AI 분석 중 오류가 발생했습니다." });
    }
  }

  async function saveLabel() {
    if (!selectedImage) {
      setLabelStatus({ kind: "error", message: "라벨을 저장할 이미지를 선택하세요." });
      return;
    }

    setLabelStatus({ kind: "loading", message: "최종 라벨을 저장 중입니다." });

    try {
      const response = await fetch("/api/labels/ad-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageId: selectedImage.id,
          category: finalLabel.category || selectedImage.category || "기타",
          brandName: selectedImage.brandName,
          sourcePlatform: selectedImage.sourcePlatform.toLowerCase(),
          localImagePath: selectedImage.localImagePath,
          aiDraft,
          finalLabel,
        }),
      });
      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? "라벨 저장 실패");
      }

      setLabels(result.labels ?? []);
      setLabelStatus({ kind: "success", message: "라벨을 저장했습니다." });
    } catch (error) {
      setLabelStatus({ kind: "error", message: error instanceof Error ? error.message : "라벨 저장 중 오류가 발생했습니다." });
    }
  }

  async function saveImageMetadata(image: CollectedAdImage, updates: Partial<CollectedAdImage>) {
    setStatus({ kind: "loading", message: "이미지 메타데이터를 저장 중입니다." });

    try {
      const response = await fetch("/api/collected-images", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: image.id, ...updates }),
      });
      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? "이미지 메타데이터 저장 실패");
      }

      setImages(result.images ?? []);
      const updated = (result.images ?? []).find((item: CollectedAdImage) => item.id === image.id);
      if (updated) setSelectedImage(updated);
      setStatus({ kind: "success", message: "이미지 메타데이터를 저장했습니다." });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "이미지 메타데이터 저장 중 오류가 발생했습니다." });
    }
  }

  function toggleReferenceSelection(imageId: string) {
    if (!labelsByImageId.has(imageId)) {
      setStrategyStatus({ kind: "error", message: "라벨 완료된 이미지만 레퍼런스로 선택할 수 있습니다." });
      return;
    }

    setSelectedReferenceLabelIds((current) => {
      if (current.includes(imageId)) {
        return current.filter((id) => id !== imageId);
      }
      if (current.length >= 3) {
        setStrategyStatus({ kind: "error", message: "레퍼런스는 최대 3개까지 선택할 수 있습니다." });
        return current;
      }
      return [...current, imageId];
    });
  }

  function updateProductInfoField(fieldKey: keyof ProductInfoForPrompt, value: string) {
    setProductInfo((current) => ({ ...current, [fieldKey]: value }));

    if (fieldKey === "landingUrl" && value.trim() !== productInfo.landingUrl.trim()) {
      setSourceImageSelection(emptySourceImageSelection);
      setSourceImageStatus({ kind: "idle", message: "새 상품 URL입니다. 상품정보를 불러오면 GPT 원본 기준 이미지 후보가 교체됩니다." });
      setProductImageState(emptyProductImageState);
      setGptMainImagePath("");
      setGptTextAdImagePath("");
      setGptVisualAsset(null);
      setGptTextAdAsset(null);
      setGptImageCandidates([]);
      setSelectedGptImageCandidateId(null);
    }
  }

  function mergeExtractedProductInfo(current: ProductInfoForPrompt, extracted: ExtractedProductInfo, replaceExtractedFields: boolean): ProductInfoForPrompt {
    const extractedCategory = normalizeProductCategory(
      extracted.category,
      extracted.productName,
      extracted.description,
    );

    const galleryImages = [extracted.mainImage, ...(extracted.galleryImages ?? [])].filter(Boolean);
    const sourceCandidates = (extracted.sourceImageCandidates?.length ? extracted.sourceImageCandidates : buildSourceImageCandidates(extracted))
      .filter((candidate, index, candidates) => candidate.imagePath && candidates.findIndex((item) => item.imagePath === candidate.imagePath) === index);
    const selectedCandidate = sourceCandidates.find((candidate) => candidate.selected) || sourceCandidates[0];
    const shouldRefreshSelectedBackground =
      !current.selectedBackgroundSource ||
      current.selectedBackgroundSource === current.extractedMainImage ||
      current.selectedBackgroundSource === current.productImagePath;
    const selectedBackgroundSource = shouldRefreshSelectedBackground
      ? extracted.mainImage || galleryImages[0] || ""
      : current.selectedBackgroundSource;
    const nextProductImagePaths = galleryImages.slice(0, 4);
    const defaultSelectedProductImagePaths = (extracted.mainImage || nextProductImagePaths[0])
      ? [extracted.mainImage || nextProductImagePaths[0]]
      : [];

    return {
      ...current,
      productName: replaceExtractedFields ? extracted.productName || "" : current.productName || extracted.productName || "",
      category: replaceExtractedFields ? extractedCategory : current.category || extractedCategory,
      price: replaceExtractedFields ? extracted.price || "" : current.price || extracted.price || "",
      originalPrice: replaceExtractedFields ? extracted.originalPrice || extracted.oldPrice || "" : current.originalPrice || current.oldPrice || extracted.originalPrice || extracted.oldPrice || "",
      oldPrice: replaceExtractedFields ? extracted.oldPrice || extracted.originalPrice || "" : current.oldPrice || current.originalPrice || extracted.oldPrice || extracted.originalPrice || "",
      discountInfo: replaceExtractedFields ? extracted.discountInfo || "" : extracted.discountInfo || current.discountInfo || "",
      mainBenefit: replaceExtractedFields ? extracted.description || "" : current.mainBenefit || extracted.description || "",
      landingUrl: replaceExtractedFields ? extracted.landingUrl || current.landingUrl || "" : current.landingUrl || extracted.landingUrl || "",
      productImagePath: replaceExtractedFields ? extracted.mainImage || nextProductImagePaths[0] || "" : extracted.mainImage || current.productImagePath || "",
      secondaryProductImagePath: replaceExtractedFields ? nextProductImagePaths.find((image) => image !== extracted.mainImage) || "" : current.secondaryProductImagePath || galleryImages.find((image) => image !== extracted.mainImage) || "",
      productImagePaths: replaceExtractedFields ? defaultSelectedProductImagePaths : current.productImagePaths?.length ? current.productImagePaths : defaultSelectedProductImagePaths,
      backgroundImagePath: replaceExtractedFields ? "" : current.backgroundImagePath || "",
      extractedDescription: replaceExtractedFields ? extracted.description || "" : extracted.description || current.extractedDescription || "",
      extractedMainImage: replaceExtractedFields ? extracted.mainImage || "" : extracted.mainImage || current.extractedMainImage || "",
      extractedGalleryImages: replaceExtractedFields ? galleryImages : galleryImages.length ? galleryImages : current.extractedGalleryImages || [],
      selectedBackgroundSource: replaceExtractedFields ? extracted.mainImage || nextProductImagePaths[0] || "" : selectedBackgroundSource,
      backgroundMode: current.backgroundMode === "none" ? "auto-detail-blur-dark" : current.backgroundMode || "auto-detail-blur-dark",
      sourceImageCandidates: replaceExtractedFields ? sourceCandidates : current.sourceImageCandidates?.length ? current.sourceImageCandidates : sourceCandidates,
      selectedSourceImageId: replaceExtractedFields ? selectedCandidate?.id || "" : current.selectedSourceImageId || selectedCandidate?.id || "",
      selectedSourceImagePath: replaceExtractedFields ? selectedCandidate?.imagePath || "" : current.selectedSourceImagePath || selectedCandidate?.imagePath || "",
    };
  }

  async function loadProductInfoFromUrl(options: { silent?: boolean } = {}) {
    const productUrl = productInfo.landingUrl.trim();

    if (!productUrl) {
      setProductExtractStatus({ kind: "error", message: "상품 URL을 먼저 입력해주세요." });
      return productInfo;
    }

    if (!options.silent) {
      setProductExtractStatus({ kind: "loading", message: "상품 상세페이지 정보를 불러오는 중입니다." });
    }

    try {
      const response = await fetch("/api/extract/product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productUrl }),
      });
      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? "상품 정보 추출 실패");
      }

      let mergedProductInfo = productInfo;
      setProductInfo((current) => {
        const replaceExtractedFields = productUrl !== lastLoadedProductUrl;
        mergedProductInfo = mergeExtractedProductInfo(current, result.productInfo, replaceExtractedFields);
        return mergedProductInfo;
      });
      setSourceImageSelection({
        candidates: mergedProductInfo.sourceImageCandidates ?? [],
        selectedSourceImageId: mergedProductInfo.selectedSourceImageId,
        selectedSourceImagePath: mergedProductInfo.selectedSourceImagePath,
      });
      setProductImageState({
        ...emptyProductImageState,
        originalImagePath: mergedProductInfo.productImagePath || mergedProductInfo.extractedMainImage || "",
        selectedImageMode: "original",
      });
      setSourceImageStatus({ kind: "success", message: "원본 기준 이미지 후보를 불러왔습니다. GPT 생성 기준 이미지를 선택할 수 있습니다." });
      setLastLoadedProductUrl(productUrl);
      setGeneratedBannerPath("");
      setGptMainImagePath("");
      setGptTextAdImagePath("");
      setGptVisualAsset(null);
      setGptTextAdAsset(null);
      setLatestImagePrompt("");
      setProductExtractStatus({ kind: "success", message: "상품 정보를 불러왔습니다. 필요한 부분은 직접 수정할 수 있습니다." });
      return mergedProductInfo;
    } catch (error) {
      setProductExtractStatus({ kind: "error", message: "상품 정보를 불러오지 못했습니다. 직접 입력해주세요." });
      if (!options.silent) {
        setCopyStatus({ kind: "error", message: error instanceof Error ? error.message : "상품 정보 추출 중 오류가 발생했습니다." });
      }
      return productInfo;
    }
  }

  async function generateBannerCopy() {
    if (!selectedTemplate) {
      setCopyStatus({
        kind: "error",
        message: "먼저 사용할 템플릿을 선택해주세요. 템플릿의 문구 영역에 맞춰 광고 문구를 생성합니다.",
      });
      return;
    }

    setCopyStatus({ kind: "loading", message: "선택한 라벨 레퍼런스를 참고해 광고문구를 생성 중입니다." });
    setGeneratedBannerPath("");

    try {
      let productInfoForCopy = productInfo;
      const hasUrl = Boolean(productInfo.landingUrl.trim());
      const hasExtractedDetails = Boolean(productInfo.productName || productInfo.mainBenefit || productInfo.extractedDescription);
      const isDifferentUrl = productInfo.landingUrl.trim() !== lastLoadedProductUrl;

      if (hasUrl && (!hasExtractedDetails || isDifferentUrl)) {
        setProductExtractStatus({ kind: "loading", message: "상품 상세페이지 정보를 불러오는 중입니다." });
        productInfoForCopy = await loadProductInfoFromUrl({ silent: true });
      }

      const response = await fetch("/api/strategy/generate-copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productInfo: productInfoForCopy,
          referenceLabels: selectedReferenceLabels,
          templateId: selectedTemplate.id,
          templateName: selectedTemplate.name,
          copyLimits: selectedTemplate.copyLimits,
        }),
      });
      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? "광고문구 생성 실패");
      }

      const generatedCopy = result.copy as GeneratedAdCopy;
      const fitted = generatedCopy.templateFit?.templateId === selectedTemplate.id
        ? {
          headline: generatedCopy.headline,
          bodyCopy: generatedCopy.bodyCopy,
          highlightCopy: generatedCopy.highlightCopy,
          bottomBarCopy: generatedCopy.bottomBarCopy,
          cta: generatedCopy.cta,
          price: generatedCopy.price,
          templateId: selectedTemplate.id,
          slotFits: fitCopyToTemplate({
            copy: generatedCopy,
            templateId: selectedTemplate.id,
            copyLimits: selectedTemplate.copyLimits,
          }).slotFits,
          createdAt: new Date().toISOString(),
        }
        : fitCopyToTemplate({
          copy: generatedCopy,
          templateId: selectedTemplate.id,
          copyLimits: selectedTemplate.copyLimits,
        });
      setCopyResult(generatedCopy);
      setTemplateFittedCopy(fitted);
      setBannerCopy({
        ...generatedCopy,
        headline: fitted.headline,
        bodyCopy: fitted.bodyCopy,
        highlightCopy: fitted.highlightCopy,
        bottomBarCopy: fitted.bottomBarCopy,
        cta: fitted.cta,
        price: fitted.price || generatedCopy.price,
      });
      setCopyReferenceLabels(result.referenceLabels ?? selectedReferenceLabels);
      setCopyStatus({
        kind: "success",
        message: result.isMock ? "OPENAI_API_KEY가 없어 mock 광고문구를 생성했습니다." : "광고문구를 생성했습니다.",
      });
    } catch (error) {
      setCopyStatus({ kind: "error", message: error instanceof Error ? error.message : "광고문구 생성 중 오류가 발생했습니다." });
    }
  }

  function setHeadlineStyleOverride<Key extends keyof HeadlineStyleOverrides>(key: Key, value: HeadlineStyleOverrides[Key] | "") {
    setHeadlineStyleOverrides((current) => {
      const next = { ...current };
      if (value === "" || value === undefined) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
  }

  function selectHeadlinePreset(value: HeadlineStyleOverrides["headlineFontPreset"]) {
    setHeadlineStyleOverrides(value ? { headlineFontPreset: value } : {});
  }

  function setHeadlineStrokeEnabled(enabled: boolean) {
    setHeadlineStyleOverrides((current) => ({
      ...current,
      headlineTextStroke: enabled,
      headlineTextStrokeWidth: enabled && !current.headlineTextStrokeWidth ? 4 : current.headlineTextStrokeWidth,
    }));
  }

  function selectUploadedMainImage(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setUploadedMainImageDataUrl(typeof reader.result === "string" ? reader.result : "");
      setMainImageSourceMode("upload");
    };
    reader.readAsDataURL(file);
  }

  function selectSourceImage(candidate: SourceImageCandidate) {
    const baseCandidates = sourceImageCandidatesForDisplay.length ? sourceImageCandidatesForDisplay : sourceImageSelection.candidates;
    const candidates = baseCandidates.map((item) => ({
      ...item,
      selected: item.id === candidate.id,
    }));
    setSourceImageSelection({
      candidates,
      selectedSourceImageId: candidate.id,
      selectedSourceImagePath: candidate.imagePath,
    });
    setProductInfo((current) => ({
      ...current,
      sourceImageCandidates: candidates,
      selectedSourceImageId: candidate.id,
      selectedSourceImagePath: candidate.imagePath,
    }));
    setSourceImageStatus({ kind: "success", message: `${candidate.label}을 GPT 원본 기준 이미지로 선택했습니다.` });
  }

  async function uploadSourceImage(file: File | undefined) {
    if (!file) return;
    setSourceImageStatus({ kind: "loading", message: "업로드 이미지를 추가하는 중입니다." });

    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/upload/source-image", {
        method: "POST",
        body: formData,
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "업로드 이미지 추가에 실패했습니다.");
      }

      const candidate = result.candidate as SourceImageCandidate;
      setSourceImageSelection((current) => {
        const candidates = [...current.candidates.filter((item) => item.imagePath !== candidate.imagePath), candidate];
        return {
          candidates,
          selectedSourceImageId: current.selectedSourceImageId || candidate.id,
          selectedSourceImagePath: current.selectedSourceImagePath || candidate.imagePath,
        };
      });
      setProductInfo((current) => {
        const candidates = [...(current.sourceImageCandidates ?? []).filter((item) => item.imagePath !== candidate.imagePath), candidate];
        return {
          ...current,
          sourceImageCandidates: candidates,
          selectedSourceImageId: current.selectedSourceImageId || candidate.id,
          selectedSourceImagePath: current.selectedSourceImagePath || candidate.imagePath,
        };
      });
      setSourceImageStatus({ kind: "success", message: "업로드 이미지가 원본 기준 이미지 후보에 추가됐습니다." });
    } catch (error) {
      setSourceImageStatus({ kind: "error", message: error instanceof Error ? error.message : "업로드 이미지 추가에 실패했습니다." });
    }
  }

  async function uploadGptReferenceImage(file: File | undefined) {
    if (!file) return;
    setGptReferenceImageStatus({ kind: "loading", message: "GPT 참고 이미지를 업로드하는 중입니다." });

    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/upload/source-image", {
        method: "POST",
        body: formData,
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "참고 이미지 업로드에 실패했습니다.");
      }

      const candidate = result.candidate as SourceImageCandidate;
      setGptReferenceImages((current) => [
        ...current.filter((item) => item.imagePath !== candidate.imagePath),
        { ...candidate, label: candidate.label.replace("직접 업로드", "참고 이미지") },
      ].slice(-3));
      setGptReferenceImageStatus({ kind: "success", message: "참고 이미지를 추가했습니다. 상품 원본은 바꾸지 않고 분위기/구도만 참고합니다." });
    } catch (error) {
      setGptReferenceImageStatus({ kind: "error", message: error instanceof Error ? error.message : "참고 이미지 업로드에 실패했습니다." });
    }
  }

  async function uploadBrandLogo(file: File | undefined) {
    if (!file) return;
    setBrandLogoStatus({ kind: "loading", message: "로고 파일을 업로드하는 중입니다." });

    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/upload/source-image", {
        method: "POST",
        body: formData,
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "로고 파일 업로드에 실패했습니다.");
      }

      const candidate = result.candidate as SourceImageCandidate;
      setBrandLogoPath(candidate.imagePath);
      setBrandLogoStatus({ kind: "success", message: "로고를 추가했습니다. 배너 생성 시 오른쪽 상단에 들어갑니다." });
    } catch (error) {
      setBrandLogoStatus({ kind: "error", message: error instanceof Error ? error.message : "로고 파일 업로드에 실패했습니다." });
    }
  }

  async function generateGptImage(imageGenerationMode: GptImageGenerationMode) {
    const hasProductContext = Boolean(productInfo.productName || productInfo.mainBenefit || productInfo.extractedDescription || bannerCopy.headline);
    const isTextInImage = imageGenerationMode === "text-in-image";
    const promptTemplateMode: GptPromptTemplateMode = isTextInImage ? "ad-image-with-copy" : "visual-only";
    const autoPromptForGeneration = buildPromptForImageMode(imageGenerationMode);
    const promptForGeneration = finalPromptForImageMode(imageGenerationMode);
    setGptPromptTemplateMode(promptTemplateMode);
    if (!hasProductContext) {
      const errorStatus = { kind: "error" as const, message: "상품 정보나 광고 문구가 있어야 이미지를 생성할 수 있습니다." };
      if (isTextInImage) setGptTextAdStatus(errorStatus);
      else setGptImageStatus(errorStatus);
      return;
    }

    if (isTextInImage) {
      setGptTextAdStatus({ kind: "loading", message: "글씨 포함 광고 이미지를 생성하는 중입니다." });
    } else {
      setGptImageStatus({ kind: "loading", message: "글씨 없는 상품 비주얼을 생성하는 중입니다." });
    }

    try {
      const response = await fetch("/api/image/generate-product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageProvider: imageGenerationProvider,
          imageGenerationMode,
          imageSourceMode: gptImageSourceMode,
          preservationMode: gptPreservationMode,
          promptMode: gptPromptState.promptMode,
          customPrompt: gptPromptState.customPrompt,
          promptTemplateMode,
          canvasPreset: "sns-square-1200",
          productName: productInfo.productName,
          category: productInfo.category,
          autoPrompt: autoPromptForGeneration,
          customPromptNote: gptPromptState.customPromptNote,
          finalPrompt: promptForGeneration,
          productInfo: {
            ...productInfo,
            productImagePath: currentMainProductImage || productInfo.productImagePath,
            productImagePaths: currentProductImagePaths,
            selectedSourceImageId: selectedSourceImage?.id,
            selectedSourceImagePath,
          },
          productImagePath: currentMainProductImage || productInfo.productImagePath,
          productImagePaths: currentProductImagePaths,
          productImageState,
          selectedSourceImagePath,
          referenceImagePaths: gptReferenceImages.map((image) => image.imagePath),
          selectedSourceImageType: selectedSourceImage?.type,
          selectedSourceImageLabel: selectedSourceImage?.label,
          selectedReferenceLabels,
          generatedCopy: bannerCopy,
          templateId: selectedTemplate?.id,
          templateSummary: selectedTemplate?.description || "",
          basePrompt: promptForGeneration,
          numCandidates: numImageCandidates,
        }),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "이미지 생성에 실패했습니다.");
      }

      const candidates: GptImageCandidate[] = Array.isArray(result.images) && result.images.length
        ? result.images
        : [{
          id: `legacy-${Date.now()}`,
          imagePath: result.imagePath,
          imageProvider: result.imageProvider || imageGenerationProvider,
          imageGenerationMode: result.imageGenerationMode || imageGenerationMode,
          imageSourceMode: result.imageSourceMode || gptImageSourceMode,
          preservationMode: result.preservationMode || gptPreservationMode,
          promptTemplateMode: result.promptTemplateMode || promptTemplateMode,
          canvasPreset: result.canvasPreset || "sns-square-1200",
          sourceImagePath: result.selectedSourceImagePath || selectedSourceImagePath,
          productName: productInfo.productName,
          category: productInfo.category,
          selectedSourceImagePath: result.selectedSourceImagePath || selectedSourceImagePath,
          promptUsed: result.promptUsed || "",
          autoPrompt: result.autoPrompt || autoPromptForGeneration,
          customPromptNote: result.customPromptNote || gptPromptState.customPromptNote,
          basePrompt: result.basePrompt || promptForGeneration,
          revisionPrompt: result.revisionPrompt || undefined,
          failureReasons: result.failureReasons || [],
          customFeedback: result.customFeedback || "",
          attempt: 1,
          createdAt: result.createdAt || new Date().toISOString(),
        }];
      const firstCandidate = candidates[0];
      const asset: GeneratedImageAsset = {
        imagePath: firstCandidate.imagePath,
        mode: firstCandidate.imageGenerationMode || imageGenerationMode,
        imageSourceMode: firstCandidate.imageSourceMode || gptImageSourceMode,
        preservationMode: firstCandidate.preservationMode || gptPreservationMode,
        promptMode: result.promptMode || gptPromptState.promptMode,
        selectedSourceImagePath: firstCandidate.selectedSourceImagePath || selectedSourceImagePath,
        promptUsed: firstCandidate.promptUsed || "",
        basePrompt: firstCandidate.basePrompt,
        revisionPrompt: firstCandidate.revisionPrompt,
        failureReasons: firstCandidate.failureReasons,
        customFeedback: firstCandidate.customFeedback,
        attempt: firstCandidate.attempt,
        parentCandidateId: firstCandidate.parentCandidateId,
        createdAt: firstCandidate.createdAt || new Date().toISOString(),
      };
      setGptImageCandidates((current) => [...candidates, ...current].slice(0, 24));
      setSelectedGptImageCandidateId(firstCandidate.id);
      setImageRevisionPrompt("");
      setSelectedImageFailureReasons([]);
      setImageCustomFeedback("");
      setLatestImagePrompt(asset.promptUsed);
      setGptPromptState((current) => ({ ...current, finalPrompt: asset.promptUsed }));

      if (isTextInImage) {
        setGptTextAdImagePath(asset.imagePath);
        setGptTextAdAsset(asset);
        setGptTextAdStatus({ kind: "success", message: `글씨 포함 광고 생성 완료: ${asset.imagePath}` });
      } else {
        setGptMainImagePath(asset.imagePath);
        setGptVisualAsset(asset);
        setMainImageSourceMode("gpt");
        setGptImageStatus({ kind: "success", message: `이미지 생성 완료: ${asset.imagePath}` });
      }
    } catch (error) {
      const errorStatus = {
        kind: "error",
        message: error instanceof Error ? error.message : isTextInImage ? "텍스트 포함 광고 이미지 생성에 실패했습니다." : "GPT 이미지 생성에 실패했습니다.",
      } as const;
      if (isTextInImage) setGptTextAdStatus(errorStatus);
      else setGptImageStatus(errorStatus);
    }
  }

  function selectGptCandidate(candidate: GptImageCandidate) {
    setSelectedGptImageCandidateId(candidate.id);
    if (candidate.imageGenerationMode === "text-in-image") {
      setGptTextAdImagePath(candidate.imagePath);
      setGptTextAdAsset({
        imagePath: candidate.imagePath,
        mode: candidate.imageGenerationMode,
        imageSourceMode: candidate.imageSourceMode,
        preservationMode: candidate.preservationMode,
        selectedSourceImagePath: candidate.selectedSourceImagePath,
        promptUsed: candidate.promptUsed,
        basePrompt: candidate.basePrompt,
        revisionPrompt: candidate.revisionPrompt,
        failureReasons: candidate.failureReasons,
        customFeedback: candidate.customFeedback,
        attempt: candidate.attempt,
        parentCandidateId: candidate.parentCandidateId,
        createdAt: candidate.createdAt,
      });
    } else {
      setGptMainImagePath(candidate.imagePath);
      setGptVisualAsset({
        imagePath: candidate.imagePath,
        mode: candidate.imageGenerationMode,
        imageSourceMode: candidate.imageSourceMode,
        preservationMode: candidate.preservationMode,
        selectedSourceImagePath: candidate.selectedSourceImagePath,
        promptUsed: candidate.promptUsed,
        basePrompt: candidate.basePrompt,
        revisionPrompt: candidate.revisionPrompt,
        failureReasons: candidate.failureReasons,
        customFeedback: candidate.customFeedback,
        attempt: candidate.attempt,
        parentCandidateId: candidate.parentCandidateId,
        createdAt: candidate.createdAt,
      });
      setMainImageSourceMode("gpt");
    }
    setLatestImagePrompt(candidate.promptUsed);
  }

  function toggleImageFailureReason(reason: GptImageFailureReason) {
    setSelectedImageFailureReasons((current) =>
      current.includes(reason) ? current.filter((item) => item !== reason) : [...current, reason],
    );
  }

  async function saveImageFeedbackRecord(params: {
    revisionPrompt: string;
    candidate?: GptImageCandidate;
    generatedImagePath?: string;
    attempt?: number;
  }) {
    try {
      const candidate = params.candidate || selectedGptImageCandidate;
      await fetch("/api/image/feedbacks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceImagePath: candidate?.sourceImagePath || candidate?.selectedSourceImagePath || selectedSourceImagePath,
          generatedImagePath: params.generatedImagePath || candidate?.imagePath,
          parentCandidateId: candidate?.parentCandidateId || candidate?.id,
          candidateId: candidate?.id,
          promptTemplateMode: candidate?.promptTemplateMode || gptPromptTemplateMode,
          canvasPreset: candidate?.canvasPreset || "sns-square-1200",
          imageGenerationMode: candidate?.imageGenerationMode || (gptPromptTemplateMode === "ad-image-with-copy" ? "text-in-image" : "visual-only"),
          imageSourceMode: candidate?.imageSourceMode || gptImageSourceMode,
          preservationMode: candidate?.preservationMode || gptPreservationMode,
          productName: productInfo.productName,
          category: productInfo.category,
          failureReasons: selectedImageFailureReasons,
          customFeedback: imageCustomFeedback,
          autoPrompt: candidate?.autoPrompt || autoGptImagePrompt,
          basePrompt: candidate?.basePrompt || candidate?.promptUsed || autoGptImagePrompt,
          revisionPrompt: params.revisionPrompt,
          promptUsed: candidate?.promptUsed,
          attempt: params.attempt || candidate?.attempt || 1,
        }),
      });
    } catch {
      const statusSetter = selectedGptImageCandidate?.imageGenerationMode === "text-in-image" ? setGptTextAdStatus : setGptImageStatus;
      statusSetter({ kind: "error", message: "이미지는 유지됐지만 피드백 JSON 저장에 실패했습니다." });
    }
  }

  async function makeImageRevisionPrompt() {
    const prompt = buildRevisionPromptFromFeedback({
      failureReasons: selectedImageFailureReasons,
      customFeedback: imageCustomFeedback,
      category: productInfo.category,
    });
    setImageRevisionPrompt(prompt);
    await saveImageFeedbackRecord({ revisionPrompt: prompt });
    setGptImageStatus({ kind: "success", message: "수정 프롬프트가 JSON에 저장되었습니다." });
    return prompt;
  }

  async function regenerateImageWithFeedback() {
    const candidate = selectedGptImageCandidate;
    if (!candidate) {
      setGptImageStatus({ kind: "error", message: "피드백을 적용할 GPT 이미지 후보를 먼저 선택해주세요." });
      return;
    }
    const revisionPrompt = imageRevisionPrompt.trim() || buildRevisionPromptFromFeedback({
      failureReasons: selectedImageFailureReasons,
      customFeedback: imageCustomFeedback,
      category: productInfo.category,
    });
    if (!imageRevisionPrompt.trim()) {
      setImageRevisionPrompt(revisionPrompt);
      await saveImageFeedbackRecord({ revisionPrompt, candidate });
    }
    const sourcePath = candidate.selectedSourceImagePath || selectedSourceImagePath;
    if (!sourcePath) {
      setGptImageStatus({ kind: "error", message: "재생성에는 원본 기준 이미지가 필요합니다." });
      return;
    }
    const isTextInImage = candidate.imageGenerationMode === "text-in-image";
    const basePromptForCandidate = candidate.basePrompt || candidate.promptUsed || buildPromptForImageMode(candidate.imageGenerationMode);
    if (isTextInImage) {
      setGptTextAdStatus({ kind: "loading", message: "피드백을 반영해 글씨 포함 광고 이미지를 다시 생성하는 중입니다." });
    } else {
      setGptImageStatus({ kind: "loading", message: "피드백을 반영해 이미지를 다시 생성하는 중입니다." });
    }

    try {
      const response = await fetch("/api/image/generate-product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageProvider: candidate.imageProvider || imageGenerationProvider,
          imageGenerationMode: candidate.imageGenerationMode || "visual-only",
          imageSourceMode: "image-edit",
          preservationMode: "preserve-product",
          promptMode: gptPromptState.promptMode,
          promptTemplateMode: candidate.promptTemplateMode || (candidate.imageGenerationMode === "text-in-image" ? "ad-image-with-copy" : "visual-only"),
          canvasPreset: candidate.canvasPreset || "sns-square-1200",
          productName: productInfo.productName,
          autoPrompt: candidate.autoPrompt || buildPromptForImageMode(candidate.imageGenerationMode),
          customPromptNote: candidate.customPromptNote || gptPromptState.customPromptNote,
          productInfo: {
            ...productInfo,
            productImagePath: currentMainProductImage || productInfo.productImagePath,
            productImagePaths: currentProductImagePaths,
            selectedSourceImageId: selectedSourceImage?.id,
            selectedSourceImagePath: sourcePath,
          },
          productImagePath: currentMainProductImage || productInfo.productImagePath,
          productImagePaths: currentProductImagePaths,
          productImageState,
          selectedSourceImagePath: sourcePath,
          referenceImagePaths: gptReferenceImages.map((image) => image.imagePath),
          selectedSourceImageType: selectedSourceImage?.type,
          selectedSourceImageLabel: selectedSourceImage?.label,
          selectedReferenceLabels,
          generatedCopy: bannerCopy,
          templateId: selectedTemplate?.id,
          templateSummary: selectedTemplate?.description || "",
          basePrompt: basePromptForCandidate,
          revisionPrompt,
          failureReasons: selectedImageFailureReasons,
          customFeedback: imageCustomFeedback,
          parentCandidateId: candidate.id,
          attempt: (candidate.attempt || 1) + 1,
          category: productInfo.category,
          numCandidates: numImageCandidates,
        }),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "피드백 재생성에 실패했습니다.");
      }

      const candidates: GptImageCandidate[] = Array.isArray(result.images) && result.images.length
        ? result.images
        : [{
          id: `revision-${Date.now()}`,
          imagePath: result.imagePath,
          imageProvider: result.imageProvider || candidate.imageProvider || imageGenerationProvider,
          imageGenerationMode: candidate.imageGenerationMode,
          imageSourceMode: "image-edit",
          preservationMode: "preserve-product",
          promptTemplateMode: candidate.promptTemplateMode || (candidate.imageGenerationMode === "text-in-image" ? "ad-image-with-copy" : "visual-only"),
          canvasPreset: "sns-square-1200",
          sourceImagePath: sourcePath,
          productName: productInfo.productName,
          category: productInfo.category,
          selectedSourceImagePath: sourcePath,
          promptUsed: result.promptUsed || revisionPrompt,
          autoPrompt: result.autoPrompt || candidate.autoPrompt || buildPromptForImageMode(candidate.imageGenerationMode),
          customPromptNote: result.customPromptNote || candidate.customPromptNote || gptPromptState.customPromptNote,
          basePrompt: basePromptForCandidate,
          revisionPrompt,
          failureReasons: selectedImageFailureReasons,
          customFeedback: imageCustomFeedback,
          attempt: (candidate.attempt || 1) + 1,
          parentCandidateId: candidate.id,
          createdAt: result.createdAt || new Date().toISOString(),
        }];
      setGptImageCandidates((current) => [...candidates, ...current].slice(0, 24));
      selectGptCandidate(candidates[0]);
      setImageRevisionPrompt(revisionPrompt);
      await saveImageFeedbackRecord({
        revisionPrompt,
        candidate,
        generatedImagePath: candidates[0].imagePath,
        attempt: candidates[0].attempt,
      });
      if (isTextInImage) {
        setGptTextAdStatus({ kind: "success", message: `피드백 재생성 완료: ${candidates[0].imagePath}` });
      } else {
        setGptImageStatus({ kind: "success", message: `피드백 재생성 완료: ${candidates[0].imagePath}` });
      }
    } catch (error) {
      const errorStatus = {
        kind: "error",
        message: error instanceof Error ? error.message : "피드백 재생성에 실패했습니다.",
      } as const;
      if (isTextInImage) setGptTextAdStatus(errorStatus);
      else setGptImageStatus(errorStatus);
    }
  }

  function setProductImageSlot(index: number, value: string) {
    setProductInfo((current) => {
      const next = [...(current.productImagePaths?.length ? current.productImagePaths : [current.productImagePath, current.secondaryProductImagePath].filter((imagePath): imagePath is string => Boolean(imagePath)))];
      next[index] = value;
      const compact = next.slice(0, 4).filter((imagePath): imagePath is string => Boolean(imagePath));
      return {
        ...current,
        productImagePath: compact[0] || "",
        secondaryProductImagePath: compact[1] || "",
        productImagePaths: compact,
      };
    });
    if (index === 0) {
      setProductImageState((current) => ({
        ...current,
        originalImagePath: value,
        selectedImageMode: "original",
        cutoutApplied: false,
        cutoutImagePath: undefined,
        styledCutoutImagePath: undefined,
      }));
    }
  }

  function selectProductImageMode(selectedImageMode: ProductImageMode) {
    setProductImageState((current) => ({ ...current, selectedImageMode }));
  }

  async function applyCutoutToProductImage() {
    if (!productImageState.originalImagePath) {
      setProductImageProcessStatus({ kind: "error", message: "누끼를 적용할 원본 이미지를 먼저 선택해 주세요." });
      return;
    }

    setProductImageProcessStatus({ kind: "loading", message: "선택한 상품 이미지의 배경을 제거하는 중입니다." });

    try {
      const response = await fetch("/api/image/remove-background", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imagePath: productImageState.originalImagePath,
          sourceImagePath: productImageState.originalImagePath,
          provider: "removebg",
          effectPreset: productImageState.effectPreset || "outline-glow-shadow",
        }),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "누끼 적용에 실패했습니다. 다른 이미지를 선택해 주세요.");
      }

      if (!result.success) {
        setProductImageState((current) => ({
          ...current,
          selectedImageMode: "original",
          cutoutApplied: false,
        }));
        setProductImageProcessStatus({
          kind: "error",
          message: result.fallbackMessage || result.error || "Background removal failed. Keeping the original image.",
        });
        return;
      }

      const cutoutImagePath = result.cutoutImagePath || result.processedImagePath;
      setProductImageState((current) => ({
        ...current,
        cutoutImagePath,
        styledCutoutImagePath: result.styledCutoutImagePath,
        selectedImageMode: result.styledCutoutImagePath ? "styled-cutout" : "cutout",
        cutoutApplied: true,
        effectPreset: current.effectPreset || "outline-glow-shadow",
      }));
      setProductImageProcessStatus({
        kind: "success",
        message: result.message || result.fallbackMessage || "Cutout image created. You can choose the original or cutout image.",
      });
    } catch (error) {
      setProductImageProcessStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "누끼 적용에 실패했습니다. 다른 이미지를 선택해 주세요.",
      });
    }
  }

  async function applyEffectToCutout() {
    if (!productImageState.cutoutImagePath) {
      setProductImageProcessStatus({ kind: "error", message: "효과를 적용하려면 먼저 누끼본을 생성해 주세요." });
      return;
    }

    setProductImageProcessStatus({ kind: "loading", message: "누끼본에 상품 강조 효과를 적용하는 중입니다." });

    try {
      const response = await fetch("/api/image/apply-product-effect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cutoutImagePath: productImageState.cutoutImagePath,
          effectPreset: productImageState.effectPreset || "outline-glow-shadow",
        }),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "효과 적용에 실패했습니다. 다른 이미지를 선택해 주세요.");
      }

      setProductImageState((current) => ({
        ...current,
        styledCutoutImagePath: result.styledCutoutImagePath,
        selectedImageMode: "styled-cutout",
      }));
      setProductImageProcessStatus({ kind: "success", message: "효과 적용 누끼본을 생성했습니다. 배너에 사용할 이미지를 선택해 주세요." });
    } catch (error) {
      setProductImageProcessStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "효과 적용에 실패했습니다. 다른 이미지를 선택해 주세요.",
      });
    }
  }

  async function renderBanner() {
    if (!selectedTemplate) {
      setRenderStatus({ kind: "error", message: "현재 카테고리에 사용할 수 있는 전용 템플릿이 없습니다." });
      return;
    }

    setRenderStatus({ kind: "loading", message: "SVG 템플릿을 1200x1200 PNG로 렌더링 중입니다." });

    try {
      const copyForRender = fitCopyToTemplate({
        copy: bannerCopy,
        templateId: selectedTemplate.id,
        copyLimits: selectedTemplate.copyLimits,
      });
      setTemplateFittedCopy(copyForRender);
      const productEffectForRender = productImageState.selectedImageMode === "original"
        ? undefined
        : normalizeProductRenderEffect(cutoutProductEffect);
      const copyPayload = selectedTemplate.id === "food-template-002"
        ? {
            headline: bannerCopy.headline,
            bodyCopy: bannerCopy.bodyCopy,
            highlightCopy: bannerCopy.highlightCopy,
            bottomBarCopy: bannerCopy.bottomBarCopy,
            cta: showCta ? bannerCopy.cta : "",
            price: bannerCopy.price || productInfo.price,
          }
        : {
            headline: copyForRender.headline,
            bodyCopy: copyForRender.bodyCopy,
            highlightCopy: copyForRender.highlightCopy,
            bottomBarCopy: copyForRender.bottomBarCopy,
            cta: showCta ? copyForRender.cta : "",
            price: copyForRender.price || bannerCopy.price || productInfo.price,
          };
      const response = await fetch("/api/render/template-ad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: selectedTemplate.id,
          canvasSize: { width: 1200, height: 1200 },
          copy: copyPayload,
          productImagePath: currentMainProductImage,
          secondaryProductImagePath: currentSecondaryProductImage,
          productImagePaths: currentProductImagePaths,
          productImageState,
          productEffect: productEffectForRender,
          productOriginalPrice: productInfo.originalPrice || productInfo.oldPrice || "",
          logoImagePath: brandLogoPath,
          aiDisclosure: {
            enabled: showAiDisclosure,
            text: aiDisclosureText,
          },
          backgroundMode: productInfo.backgroundMode || "none",
          selectedBackgroundSource: currentBackgroundSource,
          backgroundStyle: {
            blurLevel: backgroundStyle.blurLevel,
            dimLevel: backgroundStyle.dimLevel,
            scale: 1.08,
          },
          style: {
            backgroundColor: "#ffffff",
            bodyColor: bannerTextColors.bodyColor,
            bodyFontSize: bannerTextColors.bodyFontSize,
            highlightBackground: "#fff9a8",
            highlightTextColor: "#111111",
            bottomBarColor: "#ff1f1f",
            bottomBarTextColor: "#ffffff",
            ctaBarColor: "#e58585",
            ctaTextColor: "#ffffff",
            priceColor: "#ff1f1f",
            accentPhrase: bannerAccentPhrase,
            accentColor: bannerAccentColor,
            selectedFontWeight: selectedBodyFont.fontWeight,
            bodyFontWeight: selectedBodyFont.fontWeight,
            headlineFontWeight: selectedHeadlineFont.fontWeight,
            ...headlineStyleOverrides,
            fontFamily: selectedBodyFont.fontFamily,
            headlineFontFamily: selectedHeadlineFont.fontFamily.replace("AdAtlasSelectedFont", "AdAtlasHeadlineFont"),
            selectedFontFile: selectedBodyFont.fontFile,
            headlineFontFile: selectedHeadlineFont.fontFile,
          },
        }),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error ?? "배너 생성 실패");
      }

      setGeneratedBannerPath(result.imagePath);
      setRenderStatus({ kind: "success", message: "1200x1200 PNG 배너를 생성했습니다." });
    } catch (error) {
      setRenderStatus({ kind: "error", message: error instanceof Error ? error.message : "배너 생성 중 오류가 발생했습니다." });
    }
  }

  return (
    <main className="mvp-shell">
      <aside className="mvp-sidebar">
        <a className="daywiz-brand" href="https://daywiz.ai/ko/" rel="noreferrer" target="_blank">
          <img
            alt="DAYWIZ"
            src="https://framerusercontent.com/images/qf5jzCui73psKYbHJrIqtpXYQU.png"
          />
        </a>
        <div>
          <p className="eyebrow">AdAtlas MVP</p>
          <h1>광고 이미지 수집 생성기</h1>
        </div>
        <nav>
          {menus.map((menu) => (
            <button className={activeMenu === menu ? "active" : ""} key={menu} onClick={() => setActiveMenu(menu)} type="button">
              {menu}
            </button>
          ))}
        </nav>
      </aside>

      <section className="mvp-workspace">
        <header className="mvp-hero">
          <div>
            <p className="eyebrow">MVP Workflow</p>
            <h2>수집된 광고 이미지를 카테고리, 후킹 유형, 소구점 기준으로 라벨링합니다.</h2>
          </div>
          <div className="mvp-primary-actions">
            <button onClick={() => setActiveMenu("이미지 수집")} type="button">수집 이미지 라벨링</button>
            <button onClick={() => setActiveMenu("이미지 수집")} type="button">수집된 이미지 보기</button>
            <button onClick={() => setActiveMenu("광고 생성")} type="button">광고 이미지 생성하기</button>
          </div>
        </header>

        <section className="mvp-metrics">
          {metrics.map(([label, value]) => (
            <article key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </article>
          ))}
        </section>

        <div className={`mvp-status ${status.kind}`}>{status.message}</div>

        {activeMenu === "카테고리 관리" ? (
          <section className="mvp-panel">
            <div className="mvp-panel-head">
              <h3>카테고리 관리</h3>
            </div>
            <div className="taxonomy-board">
              <TaxonomyGroup title="카테고리" items={categoryOptions} />
              <TaxonomyGroup title="후킹 유형" items={hookTypeOptions} />
              <TaxonomyGroup title="소구점" items={appealPointOptions} />
            </div>
          </section>
        ) : null}

        {activeMenu === "이미지 수집" ? (
          <section className="mvp-panel">
            <div className="mvp-panel-head">
              <h3>이미지 수집</h3>
              <button onClick={refreshImages} type="button">이미지 새로고침</button>
            </div>
            <FilterBar
              appealPointFilter={appealPointFilter}
              categoryFilter={categoryFilter}
              hookTypeFilter={hookTypeFilter}
              labelStateFilter={labelStateFilter}
              platformFilter={platformFilter}
              setAppealPointFilter={setAppealPointFilter}
              setCategoryFilter={setCategoryFilter}
              setHookTypeFilter={setHookTypeFilter}
              setLabelStateFilter={setLabelStateFilter}
              setPlatformFilter={setPlatformFilter}
            />
            {crawledItems.length ? <CrawledGrid items={crawledItems} /> : null}
            <div className="labeling-workspace">
              <ImageGrid
                images={filteredImages}
                labelsByImageId={labelsByImageId}
                onAnalyze={analyzeImage}
                onMetadataSave={saveImageMetadata}
                onSelect={openLabelPanel}
                onToggleReference={toggleReferenceSelection}
                selectedReferenceIds={selectedReferenceLabelIds}
                selectedImageId={selectedImage?.id}
              />
              <LabelPanel
                aiDraft={aiDraft}
                finalLabel={finalLabel}
                hasExistingLabel={Boolean(selectedImage && labelsByImageId.has(selectedImage.id))}
                image={selectedImage}
                onAnalyze={analyzeImage}
                onDraftChange={setFinalLabel}
                onSave={saveLabel}
                status={labelStatus}
              />
            </div>
          </section>
        ) : null}

        {activeMenu === "이미지 분석" ? (
          <section className="mvp-panel">
            <div className="mvp-panel-head">
              <h3>이미지 분석</h3>
              <span className="panel-note">이미지별 카드에서 AI 분석 또는 재분석을 실행하세요.</span>
            </div>
            <div className="labeling-workspace">
              <ImageGrid
                images={filteredImages}
                labelsByImageId={labelsByImageId}
                onAnalyze={analyzeImage}
                onMetadataSave={saveImageMetadata}
                onSelect={openLabelPanel}
                onToggleReference={toggleReferenceSelection}
                selectedReferenceIds={selectedReferenceLabelIds}
                selectedImageId={selectedImage?.id}
                showAnalysis
              />
              <LabelPanel
                aiDraft={aiDraft}
                finalLabel={finalLabel}
                hasExistingLabel={Boolean(selectedImage && labelsByImageId.has(selectedImage.id))}
                image={selectedImage}
                onAnalyze={analyzeImage}
                onDraftChange={setFinalLabel}
                onSave={saveLabel}
                status={labelStatus}
              />
            </div>
          </section>
        ) : null}

        {activeMenu === "광고 생성" ? (
          <section className="mvp-panel">
            <div className="mvp-panel-head">
              <h3>Canvas/SVG 광고 배너 생성</h3>
              <span className="panel-note">문구 생성만 OpenAI를 사용할 수 있고, 배너 생성은 SVG 렌더링만 사용합니다.</span>
            </div>

            <div className={`mvp-status ${copyStatus.kind}`}>{copyStatus.message}</div>
            <div className="ad-generation-flow">
              <div className="banner-builder">
                <section className="strategy-form template-first-panel">
                <p className="eyebrow">Template First</p>
                <h4>먼저 템플릿 선택</h4>
                <label>
                  <span>사용할 템플릿</span>
                  <select
                    onChange={(event) => setSelectedTemplateId(event.target.value)}
                    value={selectedTemplate?.id || ""}
                  >
                    {categoryTemplates.length ? categoryTemplates.map((template) => (
                      <option key={template.id} value={template.id}>{template.name}</option>
                    )) : <option value="">선택 가능한 템플릿 없음</option>}
                  </select>
                </label>
                {selectedTemplate ? (
                  <p className="template-limit-summary">
                    문구 제한: headline {slotMaxChars("headline")}자 / body {slotMaxChars("bodyCopy")}자 / 하단 {slotMaxChars("bottomBarCopy")}자 / CTA {slotMaxChars("cta")}자
                  </p>
                ) : (
                  <p className="strategy-empty">먼저 사용할 템플릿을 선택해주세요.</p>
                )}
                <p className="copy-generation-note">상품 URL, 레퍼런스, 템플릿을 확인한 뒤 문구를 생성하세요.</p>
                <button disabled={copyStatus.kind === "loading"} onClick={generateBannerCopy} type="button">광고문구 생성</button>
              </section>
              <section className="strategy-reference-panel">
                <p className="eyebrow">Reference Labels</p>
                <h4>선택한 레퍼런스 {selectedReferenceLabels.length}/3</h4>
                {labels.length ? (
                  <>
                    <label className="reference-category-select">
                      <span>카테고리 먼저 선택</span>
                      <select
                        onChange={(event) => setReferenceCategoryFilter(event.target.value)}
                        value={referenceCategoryFilter}
                      >
                        <option value="all">전체 카테고리</option>
                        {referenceCategoryOptions.map((category) => (
                          <option key={category} value={category}>{category}</option>
                        ))}
                      </select>
                    </label>
                    <div className="strategy-reference-list">
                      {filteredReferenceLabels.map((label) => (
                        <article className={selectedReferenceLabelIds.includes(label.imageId) ? "selected" : ""} key={label.imageId}>
                          {label.localImagePath ? <img alt={`${label.category || label.brandName} 레퍼런스`} src={label.localImagePath} /> : null}
                          <div>
                            <strong>{label.finalLabel.category || label.category || "기타"}</strong>
                            <span>{label.finalLabel.hookType || "후킹 미입력"}</span>
                            <small>{label.finalLabel.appealPoint || "소구점 미입력"}</small>
                            <small>{label.finalLabel.copyNuance || "카피 뉘앙스 미입력"}</small>
                            <label className="inline-check">
                              <input
                                checked={selectedReferenceLabelIds.includes(label.imageId)}
                                onChange={() => toggleReferenceSelection(label.imageId)}
                                type="checkbox"
                              />
                              레퍼런스로 선택
                            </label>
                          </div>
                        </article>
                      ))}
                    </div>
                    {!filteredReferenceLabels.length ? <p className="strategy-empty">선택한 카테고리에 저장된 레퍼런스가 없습니다.</p> : null}
                  </>
                ) : (
                  <p className="strategy-empty">라벨 저장이 완료된 이미지가 없습니다. 먼저 이미지 라벨을 저장해주세요.</p>
                )}
              </section>

              <section className="strategy-form banner-product-form">
                <p className="eyebrow">Product Info</p>
                {productFields.map((field) => (
                  <label key={field.key}>
                    <span>{field.label}</span>
                    {field.key === "category" ? (
                      <select
                        onChange={(event) => setProductInfo((current) => ({ ...current, category: event.target.value }))}
                        value={productInfo.category || "기타"}
                      >
                        {categoryOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    ) : (
                      <input
                        onChange={(event) => updateProductInfoField(field.key, event.target.value)}
                        placeholder={field.placeholder}
                        value={String(productInfo[field.key] || "")}
                      />
                    )}
                  </label>
                ))}
                <button disabled={productExtractStatus.kind === "loading"} onClick={() => loadProductInfoFromUrl()} type="button">
                  상품정보 불러오기
                </button>
                <div className={`mvp-status ${productExtractStatus.kind}`}>{productExtractStatus.message}</div>
                </section>
              </div>

              <div className="banner-workspace">
                <section className="copy-edit-panel">
                <div>
                  <p className="eyebrow">Editable Copy</p>
                  <h4>생성 문구 수정</h4>
                </div>
                {(["headline", "bodyCopy", "highlightCopy", "bottomBarCopy", "cta"] as const).map((key) => (
                  <label key={key}>
                    <span>
                      {key}
                      {` ${copyVisibleLength(bannerCopy[key])}/${slotMaxChars(key)}자`}
                    </span>
                    <textarea
                      onChange={(event) => setBannerCopy((current) => ({ ...current, [key]: event.target.value }))}
                      rows={key === "headline" ? 2 : 3}
                      value={bannerCopy[key]}
                    />
                    {copyVisibleLength(bannerCopy[key]) > slotMaxChars(key) ? (
                      <small className="copy-warning">템플릿에서 잘릴 수 있습니다.</small>
                    ) : null}
                  </label>
                ))}
                <label>
                  <span>CTA 표시</span>
                  <select onChange={(event) => setShowCta(event.target.value === "show")} value={showCta ? "show" : "hide"}>
                    <option value="show">표시</option>
                    <option value="hide">표시 안 함</option>
                  </select>
                </label>
                <label>
                  <span>제목 글씨 스타일</span>
                  <select
                    onChange={(event) => selectHeadlinePreset(event.target.value as HeadlineStyleOverrides["headlineFontPreset"])}
                    value={headlineStyleOverrides.headlineFontPreset || "impact-korean-red"}
                  >
                    <option value="impact-korean-red">빨간 특가형</option>
                    <option value="commerce-heavy-black">검정 굵은형</option>
                    <option value="premium-serif-gold">고급 선물형</option>
                    <option value="ugc-bold-white">흰색 외곽선형</option>
                  </select>
                </label>
                <div className="copy-accent-controls">
                  <label>
                    <span>강조할 문구</span>
                    <input
                      onChange={(event) => setBannerAccentPhrase(event.target.value)}
                      placeholder="비워두면 자동 선택. 예: 입안에서 육즙 폭발, 등심"
                      value={bannerAccentPhrase}
                    />
                    <small>비워두면 가격/상품명/혜택 표현을 자동 강조합니다. 수동 입력은 쉼표로 구분하고, 문구 안에서 [[등심]]처럼 감싸도 됩니다.</small>
                  </label>
                  <label>
                    <span>강조 색상</span>
                    <input
                      onChange={(event) => setBannerAccentColor(event.target.value)}
                      type="color"
                      value={bannerAccentColor}
                    />
                  </label>
                </div>
                <button className="secondary-tool-button" onClick={() => setShowAdvancedHeadlineStyle((current) => !current)} type="button">
                  제목 세부 조정 {showAdvancedHeadlineStyle ? "닫기" : "열기"}
                </button>
                {showAdvancedHeadlineStyle ? (
                  <div className="advanced-style-grid">
                    <label>
                      <span>글씨 크기</span>
                      <input
                        onChange={(event) => setHeadlineStyleOverride("headlineFontSize", event.target.value ? Number(event.target.value) : "")}
                        placeholder="자동"
                        type="number"
                        value={headlineStyleOverrides.headlineFontSize ?? ""}
                      />
                    </label>
                    <label>
                      <span>굵기</span>
                      <input
                        onChange={(event) => setHeadlineStyleOverride("headlineFontWeight", event.target.value ? Number(event.target.value) : "")}
                        placeholder="900"
                        type="number"
                        value={headlineStyleOverrides.headlineFontWeight ?? ""}
                      />
                    </label>
                    <label>
                      <span>자간</span>
                      <input
                        onChange={(event) => setHeadlineStyleOverride("headlineLetterSpacing", event.target.value ? Number(event.target.value) : "")}
                        placeholder="-4"
                        type="number"
                        value={headlineStyleOverrides.headlineLetterSpacing ?? ""}
                      />
                    </label>
                    <label>
                      <span>줄 간격</span>
                      <input
                        onChange={(event) => setHeadlineStyleOverride("headlineLineHeight", event.target.value ? Number(event.target.value) : "")}
                        placeholder="0.95"
                        step="0.01"
                        type="number"
                        value={headlineStyleOverrides.headlineLineHeight ?? ""}
                      />
                    </label>
                    <label>
                      <span>제목 색상</span>
                      <input
                        onChange={(event) => setHeadlineStyleOverride("headlineColor", event.target.value)}
                        type="color"
                        value={headlineStyleOverrides.headlineColor || "#ff1f1f"}
                      />
                    </label>
                    <label>
                      <span>외곽선</span>
                      <select
                        onChange={(event) => setHeadlineStrokeEnabled(event.target.value === "on")}
                        value={headlineStyleOverrides.headlineTextStroke ? "on" : "off"}
                      >
                        <option value="off">끄기</option>
                        <option value="on">켜기</option>
                      </select>
                    </label>
                    <label>
                      <span>외곽선 색상</span>
                      <input
                        onChange={(event) => setHeadlineStyleOverride("headlineTextStrokeColor", event.target.value)}
                        type="color"
                        value={headlineStyleOverrides.headlineTextStrokeColor || "#111111"}
                      />
                    </label>
                    <label>
                      <span>외곽선 두께</span>
                      <input
                        onChange={(event) => setHeadlineStyleOverride("headlineTextStrokeWidth", event.target.value ? Number(event.target.value) : "")}
                        placeholder="0"
                        type="number"
                        value={headlineStyleOverrides.headlineTextStrokeWidth ?? ""}
                      />
                    </label>
                    <label>
                      <span>그림자</span>
                      <select
                        onChange={(event) => setHeadlineStyleOverride("headlineShadow", event.target.value === "on")}
                        value={headlineStyleOverrides.headlineShadow === false ? "off" : "on"}
                      >
                        <option value="on">켜기</option>
                        <option value="off">끄기</option>
                      </select>
                    </label>
                  </div>
                ) : null}
                <label>
                  <span>price {copyVisibleLength(productInfo.price)}/{slotMaxChars("price")}자</span>
                  <input
                    onChange={(event) => setProductInfo((current) => ({ ...current, price: event.target.value }))}
                    value={productInfo.price}
                  />
                  {copyVisibleLength(productInfo.price) > slotMaxChars("price") ? (
                    <small className="copy-warning">템플릿에서 잘릴 수 있습니다.</small>
                  ) : null}
                </label>
                {templateFittedCopy?.slotFits.some((slot) => slot.status === "trimmed") ? (
                  <p className="copy-validation-note">선택한 템플릿 제한에 맞춰 일부 문구가 자동 압축되었습니다.</p>
                ) : null}
                {copyResult ? <p className="strategy-empty">{copyResult.whyThisWorks}</p> : null}
                {copyResult?.copyValidation?.bodyCopy && (!copyResult.copyValidation.bodyCopy.ok || copyResult.copyValidation.bodyCopy.original !== copyResult.copyValidation.bodyCopy.normalized) ? (
                  <p className="copy-validation-note">바디카피의 반말/비격식 표현이 존댓말형으로 보정되었습니다.</p>
                ) : null}
                {copyResult?.referencePatternUsage ? (
                  <details className="reference-pattern-usage">
                    <summary>참고한 레퍼런스 패턴</summary>
                    <dl>
                      {[
                        ["후킹 패턴", copyResult.referencePatternUsage.usedHookPattern],
                        ["문구 구조", copyResult.referencePatternUsage.usedCopyStructure],
                        ["톤앤매너", copyResult.referencePatternUsage.usedToneOfVoice],
                        ["소비자 인사이트", copyResult.referencePatternUsage.usedConsumerInsight],
                        ["구매 트리거", copyResult.referencePatternUsage.usedPurchaseTrigger],
                        ["재사용 문구 패턴", copyResult.referencePatternUsage.usedReusablePattern],
                        ["비주얼/문구 관계", copyResult.referencePatternUsage.usedVisualCopyRelation],
                      ].filter(([, value]) => Boolean(value)).map(([label, value]) => (
                        <div key={label}>
                          <dt>{label}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                ) : null}
              </section>

              <section className="banner-preview-panel">
                <div>
                  <p className="eyebrow">PNG Preview</p>
                  <h4>{selectedTemplate?.id || "템플릿 없음"}</h4>
                </div>
                <details className="template-picker source-image-dropdown" open>
                  <summary>
                    <div>
                      <p className="eyebrow">Template</p>
                      <strong>템플릿 선택</strong>
                      <span>{selectedTemplate?.name || "선택 필요"}</span>
                    </div>
                    <b>{selectedTemplate ? "선택됨" : "선택 필요"}</b>
                  </summary>
                  <div>
                    <p className="eyebrow">Template</p>
                    <h4>템플릿 선택</h4>
                  </div>
                  {categoryTemplates.length ? (
                    <div className="template-card-list">
                      {categoryTemplates.map((template, index) => (
                        <button
                          className={selectedTemplateId === template.id ? "selected" : ""}
                          key={template.id}
                          onClick={() => setSelectedTemplateId(template.id)}
                          type="button"
                        >
                          <div>
                            <strong>{index + 1}. {template.name}</strong>
                            <span>{template.description.split(".")[0]}</span>
                            <small>문구 제한: headline {template.copyLimits?.headline?.maxChars || 14}자 / body {template.copyLimits?.bodyCopy?.maxChars || 32}자 / 하단 {template.copyLimits?.bottomBarCopy?.maxChars || 28}자 / CTA {template.copyLimits?.cta?.maxChars || 8}자</small>
                          </div>
                          {selectedTemplateId === template.id ? <b>선택됨</b> : null}
                          <div className="template-palette" aria-hidden="true">
                            {["headlineColor", "highlightBackground", "bottomBarColor", "ctaBarColor"].map((key) => (
                              <i key={key} style={{ background: String(template.style[key] || "#ffffff") }} />
                            ))}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="strategy-empty">아직 해당 카테고리 전용 템플릿이 없습니다. 식품/선물 템플릿부터 먼저 지원합니다.</p>
                  )}
                </details>
                <details className="background-settings source-image-settings source-image-dropdown">
                  <summary>
                    <div>
                      <p className="eyebrow">GPT Source</p>
                      <strong>원본 기준 이미지 선택 / GPT 이미지 생성</strong>
                      <span>GPT 생성이 필요할 때만 열어서 기준 이미지, 생성 옵션, 결과를 관리하세요.</span>
                    </div>
                    <b>{selectedSourceImagePath ? "기준 이미지 있음" : "선택 필요"}</b>
                  </summary>
                  <div className="source-image-panel-body">
                  <label>
                    <span>직접 업로드</span>
                    <input
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(event) => uploadSourceImage(event.target.files?.[0])}
                      type="file"
                    />
                  </label>
                  <div className={`mvp-status ${sourceImageStatus.kind}`}>{sourceImageStatus.message}</div>
                  <div className="source-image-layout">
                    <div className="source-image-candidates">
                      {sourceImageCandidatesForDisplay.length ? sourceImageCandidatesForDisplay.map((candidate) => (
                        <button
                          className={candidate.id === selectedSourceImage?.id ? "selected" : ""}
                          key={candidate.id}
                          onClick={() => selectSourceImage(candidate)}
                          type="button"
                        >
                          <img alt={candidate.label} src={candidate.imagePath} />
                          <span>{candidate.type === "hero" ? "대표 이미지" : candidate.type === "upload" ? "직접 업로드" : "상세 이미지"}</span>
                          <strong>{candidate.label}</strong>
                          {candidate.id === selectedSourceImage?.id ? <b>현재 원본 기준</b> : null}
                        </button>
                      )) : (
                        <p className="strategy-empty">상품정보를 불러오면 상세페이지 이미지가 원본 기준 후보로 표시됩니다.</p>
                      )}
                    </div>
                    <div className="source-image-preview">
                      <strong>현재 GPT 생성 기준 이미지</strong>
                      {selectedSourceImagePath ? (
                        <>
                          <img alt="현재 GPT 생성 기준 이미지" src={selectedSourceImagePath} />
                          <span>{selectedSourceImage?.label || "기본 대표 이미지"}</span>
                          <small>이 이미지를 기준으로 상품 원형, 색상, 포장, 표면 디테일을 최대한 유지합니다.</small>
                        </>
                      ) : (
                        <p className="strategy-empty">아직 선택된 기준 이미지가 없습니다.</p>
                      )}
                    </div>
                  </div>
                  <div className="gpt-reference-upload">
                    <div>
                      <strong>GPT 참고 이미지</strong>
                      <small>원본 상품은 위 기준 이미지를 유지하고, 참고 이미지는 분위기/구도/조명만 참고합니다. 최대 3장까지 첨부됩니다.</small>
                    </div>
                    <label>
                      <span>참고 이미지 첨부</span>
                      <input
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(event) => {
                          uploadGptReferenceImage(event.target.files?.[0]);
                          event.currentTarget.value = "";
                        }}
                        type="file"
                      />
                    </label>
                    {gptReferenceImages.length ? (
                      <div className="gpt-reference-list">
                        {gptReferenceImages.map((image) => (
                          <article key={image.id}>
                            <img alt={image.label} src={image.imagePath} />
                            <span>{image.label}</span>
                            <button
                              onClick={() => setGptReferenceImages((current) => current.filter((item) => item.id !== image.id))}
                              type="button"
                            >
                              제거
                            </button>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="strategy-empty">참고 이미지가 없으면 원본 기준 이미지만 사용합니다.</p>
                    )}
                    <p className={`mvp-status ${gptReferenceImageStatus.kind}`}>{gptReferenceImageStatus.message}</p>
                  </div>
                  <details className="gpt-generator-dropdown">
                    <summary>
                      <div>
                        <p className="eyebrow">Optional GPT</p>
                        <strong>GPT 이미지 생성</strong>
                        <span>선택한 원본 기준 이미지로 광고용 이미지를 생성합니다.</span>
                      </div>
                      <b>{gptVisualAsset || gptTextAdAsset ? "생성 결과 있음" : "선택 사항"}</b>
                    </summary>
                    <div className="gpt-image-generator">
                      <div>
                        <p className="eyebrow">GPT Image</p>
                        <h4>GPT 이미지 생성</h4>
                        <p className="source-help">상품 원본을 최대한 유지하려면 “선택 이미지 기준 생성 + 상품 원본 최대한 유지”를 사용하세요.</p>
                      </div>
                      <div className="gpt-compact-controls">
                        <label>
                          <span>이미지 생성 엔진</span>
                          <select
                            onChange={(event) => setImageGenerationProvider(event.target.value as ImageGenerationProvider)}
                            value={imageGenerationProvider}
                          >
                            <option value="openai">GPT 이미지 생성</option>
                            <option value="gemini">나노바나나</option>
                          </select>
                          <small>{imageGenerationProvider === "gemini" ? "Gemini API Key로 나노바나나 이미지 생성을 사용합니다." : "OpenAI 이미지 생성 API를 사용합니다."}</small>
                        </label>
                        <label>
                          <span>생성 방식</span>
                          <select
                            onChange={(event) => setGptImageSourceMode(event.target.value as GptImageSourceMode)}
                            value={gptImageSourceMode}
                          >
                            <option value="image-edit">선택 이미지 기준으로 생성</option>
                            <option value="text-to-image">새 이미지 생성</option>
                          </select>
                          <small>{gptImageSourceMode === "image-edit" ? "선택한 원본 기준 이미지를 바탕으로 배경/조명/무드를 보정합니다." : "상품 정보를 바탕으로 새 이미지를 생성합니다. 원본 상품 유지력은 낮을 수 있습니다."}</small>
                        </label>
                        <label>
                          <span>원본 유지</span>
                          <select
                            onChange={(event) => setGptPreservationMode(event.target.value as GptImagePreservationMode)}
                            value={gptPreservationMode}
                          >
                            <option value="preserve-product">상품 원본 최대한 유지</option>
                            <option value="free-generate">자유 생성</option>
                          </select>
                          <small>상품 형태, 포장, 색상, 개수, 라벨 위치 보존 여부입니다.</small>
                        </label>
                        <label>
                          <span>프롬프트</span>
                          <select
                            onChange={(event) => setGptPromptState((current) => ({
                              ...current,
                              promptMode: event.target.value as "auto" | "custom",
                              finalPrompt: event.target.value === "custom" && current.customPrompt.trim()
                                ? current.customPrompt.trim()
                                : autoGptImagePrompt,
                            }))}
                            value={gptPromptState.promptMode}
                          >
                            <option value="auto">자동 프롬프트</option>
                            <option value="custom">직접 작성 프롬프트</option>
                          </select>
                          <small>{gptPromptState.promptMode === "custom" ? "직접 작성한 프롬프트가 실제 생성에 우선 적용됩니다." : "상품정보와 기준 이미지로 자동 생성합니다."}</small>
                        </label>
                        <label>
                          <span>자동 프롬프트 목적</span>
                          <select
                            onChange={(event) => {
                              const templateMode = event.target.value as GptPromptTemplateMode;
                              setGptPromptTemplateMode(templateMode);
                              setGptPromptState((current) => ({
                                ...current,
                                promptMode: "auto",
                                customPrompt: "",
                              }));
                            }}
                            value={gptPromptTemplateMode}
                          >
                            <option value="visual-only">글씨 없는 광고 비주얼</option>
                            <option value="ad-image-with-copy">문구 포함 광고 배너</option>
                          </select>
                          <small>두 모드 모두 1200x1200 SNS 배너 기준으로 자동 작성됩니다.</small>
                        </label>
                        <label>
                          <span>후보 개수</span>
                          <select
                            onChange={(event) => setNumImageCandidates(Number(event.target.value))}
                            value={numImageCandidates}
                          >
                            <option value={1}>1개</option>
                            <option value={2}>2개</option>
                            <option value={3}>3개</option>
                            <option value={4}>4개</option>
                          </select>
                          <small>빠르게 보려면 1개, 비교가 필요하면 2~4개를 선택하세요.</small>
                        </label>
                      </div>
                      <details className="gpt-prompt-panel">
                        <summary>프롬프트 설정 열기</summary>
                        <label>
                          <span>세부 수정 프롬프트</span>
                          <textarea
                            onChange={(event) => setGptPromptState((current) => ({
                              ...current,
                              customPromptNote: event.target.value,
                            }))}
                            placeholder="예: 배경은 더 어둡게, 고기 색감은 원본처럼 유지, 포장 트레이처럼 만들지 말 것."
                            rows={3}
                            value={gptPromptState.customPromptNote || ""}
                          />
                          <small>전체 프롬프트를 다시 쓰지 않고, 자동 프롬프트 뒤에 추가로 붙일 지시만 적습니다.</small>
                        </label>
                        <label>
                          <span>자동 생성 프롬프트</span>
                          <textarea
                            onChange={(event) => setGptPromptState((current) => ({
                              ...current,
                              promptMode: "custom",
                              customPrompt: event.target.value,
                              finalPrompt: event.target.value,
                            }))}
                            rows={9}
                            value={gptPromptState.promptMode === "custom" && gptPromptState.customPrompt ? gptPromptState.customPrompt : autoGptImagePrompt}
                          />
                          <small>자동 프롬프트를 직접 수정하면 직접 작성 프롬프트 모드로 전환됩니다.</small>
                        </label>
                        <label>
                          <span>직접 작성 프롬프트</span>
                          <textarea
                            onChange={(event) => setGptPromptState((current) => ({
                              ...current,
                              promptMode: "custom",
                              customPrompt: event.target.value,
                              finalPrompt: event.target.value,
                            }))}
                            placeholder="예: 원본 이미지의 구운 고기 형태와 질감은 유지하고, 포장육 상품처럼 바꾸지 마세요. 배경과 조명만 광고스럽게 개선해주세요. 글씨는 넣지 마세요."
                            rows={6}
                            value={gptPromptState.customPrompt}
                          />
                        </label>
                        <div className="gpt-prompt-actions">
                          <button onClick={() => setGptPromptState((current) => ({
                            ...current,
                            promptMode: "custom",
                            customPrompt: preserveSourcePromptTemplate,
                            finalPrompt: preserveSourcePromptTemplate,
                          }))} type="button">
                            원본 이미지 유지형 프롬프트 불러오기
                          </button>
                          <button onClick={() => setGptPromptState((current) => ({
                            ...current,
                            promptMode: "custom",
                            customPrompt: noTextAdVisualPromptTemplate,
                            finalPrompt: noTextAdVisualPromptTemplate,
                          }))} type="button">
                            글씨 없는 광고 비주얼 프롬프트 불러오기
                          </button>
                          <button onClick={() => setGptPromptState((current) => {
                            const base = current.customPrompt.trim() || autoGptImagePrompt;
                            const customPrompt = `${base}\n\n${noPackageChangePromptTemplate}`.trim();
                            return {
                              ...current,
                              promptMode: "custom",
                              customPrompt,
                              finalPrompt: customPrompt,
                            };
                          })} type="button">
                            포장 변경 금지 프롬프트 추가
                          </button>
                        </div>
                        <label>
                          <span>실제 생성에 사용될 최종 프롬프트</span>
                          <textarea readOnly rows={5} value={finalGptImagePrompt} />
                        </label>
                      </details>
                      <label>
                        <span>GPT 이미지 전용 결과 URL/경로</span>
                        <input
                          onChange={(event) => {
                            setGptMainImagePath(event.target.value);
                            if (event.target.value) setMainImageSourceMode("gpt");
                          }}
                          placeholder="/generated-product-images/example.png 또는 https://..."
                          value={gptMainImagePath}
                        />
                      </label>
                      <div className="gpt-image-actions">
                        <button
                          disabled={gptImageStatus.kind === "loading"}
                          onClick={() => generateGptImage("visual-only")}
                          type="button"
                        >
                          {gptImageStatus.kind === "loading" ? "이미지 생성 중..." : "이미지만 생성"}
                        </button>
                        <button
                          disabled={gptTextAdStatus.kind === "loading"}
                          onClick={() => generateGptImage("text-in-image")}
                          type="button"
                        >
                          {gptTextAdStatus.kind === "loading" ? "광고 생성 중..." : "글씨까지 생성"}
                        </button>
                      </div>
                      <p className={`mvp-status ${gptImageStatus.kind}`}>{gptImageStatus.message}</p>
                      <p className={`mvp-status ${gptTextAdStatus.kind}`}>{gptTextAdStatus.message}</p>
                    </div>
                  </details>
                  <details className="gpt-generator-dropdown gpt-result-dropdown">
                    <summary>
                      <div>
                        <p className="eyebrow">Optional GPT</p>
                        <strong>GPT 생성 결과</strong>
                        <span>생성한 이미지가 있을 때만 열어서 메인 이미지나 최종 광고안으로 채택하세요.</span>
                      </div>
                      <b>{gptImageCandidates.length || gptVisualAsset || gptTextAdAsset || gptMainImagePath || gptTextAdImagePath ? "결과 있음" : "비어 있음"}</b>
                    </summary>
                    <p className="source-help">
                      이미지 생성 결과가 마음에 들지 않으면 실패 이유를 선택하고 다시 생성할 수 있습니다. 정확한 상품 형태, 한글 문구, 가격, CTA는 이미지 생성보다 템플릿 합성이 더 안정적입니다.
                    </p>
                    <div className="gpt-result-grid">
                      <article className="gpt-image-result">
                        <strong>GPT 이미지 생성 결과</strong>
                        <span>글씨 없는 비주얼</span>
                        {gptVisualAsset?.imagePath || gptMainImagePath ? (
                          <>
                            <img alt="GPT 이미지 전용 결과" src={gptVisualAsset?.imagePath || gptMainImagePath} />
                            <button onClick={() => {
                              const imagePath = gptVisualAsset?.imagePath || gptMainImagePath;
                              setGptMainImagePath(imagePath);
                              setMainImageSourceMode("gpt");
                            }} type="button">
                              이 이미지를 메인 상품 이미지로 사용
                            </button>
                          </>
                        ) : (
                          <p className="strategy-empty">[이미지만 생성] 결과가 여기에 표시됩니다.</p>
                        )}
                      </article>
                      <article className="gpt-image-result">
                        <strong>GPT 글씨 포함 광고 생성 결과</strong>
                        <span>완성형 광고안</span>
                        {gptTextAdAsset?.imagePath || gptTextAdImagePath ? (
                          <>
                            <img alt="GPT 글씨 포함 광고 결과" src={gptTextAdAsset?.imagePath || gptTextAdImagePath} />
                            <button onClick={() => {
                              const imagePath = gptTextAdAsset?.imagePath || gptTextAdImagePath;
                              setGeneratedBannerPath(imagePath);
                            }} type="button">
                              이 이미지를 최종 광고안으로 채택
                            </button>
                          </>
                        ) : (
                          <p className="strategy-empty">[글씨까지 생성] 결과가 여기에 표시됩니다.</p>
                        )}
                      </article>
                    </div>
                    {gptImageCandidates.length ? (
                      <div className="gpt-candidate-panel">
                        <div>
                          <p className="eyebrow">Candidates</p>
                          <h4>생성 후보</h4>
                        </div>
                        <div className="source-candidate-grid">
                          {gptImageCandidates.map((candidate) => (
                            <article
                              className={`source-candidate-card ${selectedGptImageCandidate?.id === candidate.id ? "selected" : ""}`}
                              key={candidate.id}
                            >
                              <button onClick={() => selectGptCandidate(candidate)} type="button">
                                <img alt="GPT 생성 후보" src={candidate.imagePath} />
                                <span>{candidate.imageGenerationMode === "text-in-image" ? "글씨 포함" : "이미지 전용"} · {candidate.attempt}차</span>
                                <small>{candidate.imageSourceMode === "image-edit" ? "원본 기준" : "새 생성"}</small>
                              </button>
                              <div className="gpt-prompt-actions">
                                <button onClick={() => selectGptCandidate(candidate)} type="button">이 이미지 선택</button>
                                <button onClick={() => {
                                  setSelectedGptImageCandidateId(candidate.id);
                                  setSelectedImageFailureReasons(candidate.failureReasons || []);
                                  setImageCustomFeedback(candidate.customFeedback || "");
                                  setImageRevisionPrompt(candidate.revisionPrompt || "");
                                }} type="button">
                                  피드백 작성 기준
                                </button>
                              </div>
                              <details className="gpt-prompt-panel">
                                <summary>생성/수정 기록 보기</summary>
                                <textarea readOnly rows={8} value={[
                                  `id: ${candidate.id}`,
                                  `imagePath: ${candidate.imagePath}`,
                                  `sourceImagePath: ${candidate.sourceImagePath || candidate.selectedSourceImagePath || ""}`,
                                  `promptTemplateMode: ${candidate.promptTemplateMode || ""}`,
                                  `canvasPreset: ${candidate.canvasPreset || ""}`,
                                  `attempt: ${candidate.attempt}`,
                                  `imageGenerationMode: ${candidate.imageGenerationMode}`,
                                  `imageSourceMode: ${candidate.imageSourceMode}`,
                                  `preservationMode: ${candidate.preservationMode}`,
                                  `selectedSourceImagePath: ${candidate.selectedSourceImagePath || ""}`,
                                  `parentCandidateId: ${candidate.parentCandidateId || ""}`,
                                  `productName: ${candidate.productName || ""}`,
                                  `category: ${candidate.category || ""}`,
                                  `createdAt: ${candidate.createdAt}`,
                                  "",
                                  "[autoPrompt]",
                                  candidate.autoPrompt || "",
                                  "",
                                  "[customPromptNote]",
                                  candidate.customPromptNote || "",
                                  "",
                                  "[basePrompt]",
                                  candidate.basePrompt || "",
                                  "",
                                  "[revisionPrompt]",
                                  candidate.revisionPrompt || "",
                                  "",
                                  "[failureReasons]",
                                  (candidate.failureReasons || []).join(", "),
                                  "",
                                  "[customFeedback]",
                                  candidate.customFeedback || "",
                                  "",
                                  "[promptUsed]",
                                  candidate.promptUsed || "",
                                ].join("\n")} />
                              </details>
                            </article>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <div className="gpt-candidate-panel">
                      <div>
                        <p className="eyebrow">Feedback Loop</p>
                        <h4>실패 이유 선택 후 다시 생성</h4>
                        <p className="source-help">선택한 후보의 원본 기준 이미지를 유지한 채, 아래 피드백을 수정 프롬프트로 바꿔 재생성합니다.</p>
                      </div>
                      <div className="feedback-reason-list">
                        {gptImageFailureReasonOptions.map((option) => (
                          <label className="feedback-reason-option" key={option.value}>
                            <input
                              checked={selectedImageFailureReasons.includes(option.value)}
                              onChange={() => toggleImageFailureReason(option.value)}
                              type="checkbox"
                            />
                            <span>{option.label}</span>
                          </label>
                        ))}
                      </div>
                      <label>
                        <span>추가 피드백</span>
                        <textarea
                          onChange={(event) => setImageCustomFeedback(event.target.value)}
                          placeholder="예: 고기 색감은 유지하고 배경만 더 깔끔하게. 포장 트레이처럼 만들지 말 것."
                          rows={4}
                          value={imageCustomFeedback}
                        />
                      </label>
                      <label>
                        <span>수정 프롬프트</span>
                        <textarea
                          readOnly
                          rows={7}
                          value={imageRevisionPrompt}
                        />
                      </label>
                      <div className="gpt-image-actions">
                        <button onClick={makeImageRevisionPrompt} type="button">수정 프롬프트 만들기</button>
                        <button
                          disabled={!selectedGptImageCandidate || gptImageStatus.kind === "loading" || gptTextAdStatus.kind === "loading"}
                          onClick={regenerateImageWithFeedback}
                          type="button"
                        >
                          이 피드백으로 다시 생성
                        </button>
                      </div>
                    </div>
                    {latestImagePrompt ? (
                      <p className="prompt-summary">최근 GPT 이미지 프롬프트: {latestImagePrompt.slice(0, 220)}{latestImagePrompt.length > 220 ? "..." : ""}</p>
                    ) : null}
                  </details>
                  </div>
                </details>
                <details className="background-settings render-settings source-image-dropdown">
                  <summary>
                    <div>
                      <p className="eyebrow">Render Background</p>
                      <strong>메인 이미지 / 누끼 설정</strong>
                      <span>{currentMainProductImage ? productImageModeLabel(productImageState.selectedImageMode) : "이미지 선택 필요"}</span>
                    </div>
                    <b>{currentMainProductImage ? "설정됨" : "선택 필요"}</b>
                  </summary>
                  <div>
                    <p className="eyebrow">Render Image</p>
                    <h4>메인 상품 이미지 설정</h4>
                  </div>
                  <label>
                    <span>메인 이미지 소스</span>
                    <select
                      onChange={(event) => setMainImageSourceMode(event.target.value as MainImageSourceMode)}
                      value={mainImageSourceMode}
                    >
                      <option value="detail">상세페이지 이미지 선택</option>
                      <option value="upload">내 이미지 첨부</option>
                      <option value="gpt">GPT 생성 이미지 경로</option>
                    </select>
                  </label>
                  {mainImageSourceMode === "detail" ? (
                    <>
                      <label>
                        <span>메인으로 쓸 상세 이미지</span>
                        <select
                          disabled={!backgroundImageOptions.length}
                          onChange={(event) => setProductImageSlot(0, event.target.value)}
                          value={currentProductImagePaths[0] || backgroundImageOptions[0]?.value || ""}
                        >
                          {backgroundImageOptions.length ? backgroundImageOptions.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          )) : <option value="">추출된 상세 이미지 없음</option>}
                        </select>
                      </label>
                      <label>
                        <span>선택 이미지 수</span>
                        <small>선택한 이미지 개수만 배치합니다. 1개면 1장, 2개면 2장, 최대 4장까지 들어갑니다.</small>
                      </label>
                      {[1, 2, 3].map((slotIndex) => (
                        <label key={`product-image-slot-${slotIndex}`}>
                          <span>{slotIndex + 1}번째 상품 이미지</span>
                          <select
                            disabled={!backgroundImageOptions.length}
                            onChange={(event) => setProductImageSlot(slotIndex, event.target.value)}
                            value={currentProductImagePaths[slotIndex] || ""}
                          >
                            <option value="">선택 안 함</option>
                            {backgroundImageOptions.map((option) => (
                              <option key={`slot-${slotIndex}-${option.value}`} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </label>
                      ))}
                      <div className="detail-image-strip">
                        {backgroundImageOptions.map((option) => (
                          <button
                            aria-label={`${option.label} 메인 이미지로 선택`}
                            className={(currentProductImagePaths[0] || backgroundImageOptions[0]?.value) === option.value ? "selected" : ""}
                            key={`main-${option.value}`}
                            onClick={() => setProductImageSlot(0, option.value)}
                            type="button"
                          >
                            <img alt={option.label} src={option.value} />
                            <span>{option.label}</span>
                            <img alt={`${option.label} 크게 보기`} className="detail-image-hover-preview" src={option.value} />
                          </button>
                        ))}
                      </div>
                    </>
                  ) : null}
                  {mainImageSourceMode === "upload" ? (
                    <label>
                      <span>이미지 첨부</span>
                      <input
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(event) => selectUploadedMainImage(event.target.files?.[0])}
                        type="file"
                      />
                    </label>
                  ) : null}
                  {currentMainProductImage ? (
                    <div className="background-preview-thumb">
                      <img alt="선택된 메인 상품 이미지 미리보기" src={currentMainProductImage} />
                      <span>현재 배너에 사용하는 이미지: {productImageModeLabel(productImageState.selectedImageMode)}</span>
                    </div>
                  ) : (
                    <p className="strategy-empty">상세페이지 이미지, 첨부 이미지, GPT 생성 이미지 중 하나를 선택해주세요.</p>
                  )}
                  <div className="product-cutout-panel">
                    <p>기본은 원본 이미지를 사용합니다. 배경 제거가 필요하면 누끼 적용을 눌러주세요.</p>
                    <div className="background-style-grid">
                      <button
                        disabled={!productImageState.originalImagePath || productImageProcessStatus.kind === "loading"}
                        onClick={applyCutoutToProductImage}
                        type="button"
                      >
                        누끼 적용
                      </button>
                      <button
                        disabled={!productImageState.cutoutImagePath || productImageProcessStatus.kind === "loading"}
                        onClick={applyEffectToCutout}
                        type="button"
                      >
                        효과 적용
                      </button>
                    </div>
                    <label>
                      <span>효과 프리셋</span>
                      <select
                        onChange={(event) => setProductImageState((current) => ({ ...current, effectPreset: event.target.value as ProductImageEffectPreset }))}
                        value={productImageState.effectPreset || "outline-glow-shadow"}
                      >
                        <option value="none">none</option>
                        <option value="clean-outline">clean-outline</option>
                        <option value="soft-glow">soft-glow</option>
                        <option value="commerce-shadow">commerce-shadow</option>
                        <option value="outline-glow-shadow">outline-glow-shadow</option>
                      </select>
                    </label>
                    <label>
                      <span>배너 이미지 모드</span>
                      <select
                        onChange={(event) => selectProductImageMode(event.target.value as ProductImageMode)}
                        value={productImageState.selectedImageMode}
                      >
                        <option value="original">원본 이미지 사용</option>
                        <option disabled={!productImageState.cutoutImagePath} value="cutout">누끼 이미지 사용</option>
                        <option disabled={!productImageState.styledCutoutImagePath} value="styled-cutout">효과 적용 누끼 사용</option>
                      </select>
                    </label>
                    <div className={`mvp-status ${productImageProcessStatus.kind}`}>{productImageProcessStatus.message}</div>
                    <div className="product-image-variant-grid">
                      <button
                        className={productImageState.selectedImageMode === "original" ? "selected" : ""}
                        disabled={!productImageState.originalImagePath}
                        onClick={() => selectProductImageMode("original")}
                        type="button"
                      >
                        {productImageState.originalImagePath ? <img alt="원본 이미지" src={productImageState.originalImagePath} /> : null}
                        <span>원본</span>
                      </button>
                      <button
                        className={productImageState.selectedImageMode === "cutout" ? "selected" : ""}
                        disabled={!productImageState.cutoutImagePath}
                        onClick={() => selectProductImageMode("cutout")}
                        type="button"
                      >
                        {productImageState.cutoutImagePath ? <img alt="누끼 이미지" src={productImageState.cutoutImagePath} /> : null}
                        <span>누끼본</span>
                      </button>
                      <button
                        className={productImageState.selectedImageMode === "styled-cutout" ? "selected" : ""}
                        disabled={!productImageState.styledCutoutImagePath}
                        onClick={() => selectProductImageMode("styled-cutout")}
                        type="button"
                      >
                        {productImageState.styledCutoutImagePath ? <img alt="효과 적용 누끼 이미지" src={productImageState.styledCutoutImagePath} /> : null}
                        <span>효과본</span>
                      </button>
                    </div>
                    {productImageState.cutoutImagePath ? (
                      <details className="cutout-effect-controls" open={productImageState.selectedImageMode !== "original"}>
                        <summary>누끼 이미지 효과</summary>
                        <p className="strategy-empty">미리보기는 대략적인 효과이며, 최종 배너는 1200x1200 렌더링 결과를 기준으로 확인해주세요.</p>
                        <div className="cutout-effect-presets">
                          {cutoutProductEffectPresets.map((preset) => (
                            <button key={preset.id} onClick={() => setCutoutProductEffect(preset.effect)} type="button">
                              {preset.label}
                            </button>
                          ))}
                        </div>
                        <div
                          className="cutout-effect-preview"
                          style={{
                            filter: `${cutoutProductEffect.shadow ? `drop-shadow(${cutoutProductEffect.shadowOffsetX}px ${cutoutProductEffect.shadowOffsetY}px ${cutoutProductEffect.shadowBlur}px ${normalizeProductRenderEffect(cutoutProductEffect).shadowColor})` : ""} ${cutoutProductEffect.glow ? `drop-shadow(0 0 ${cutoutProductEffect.glowBlur}px ${normalizeProductRenderEffect(cutoutProductEffect).glowColor})` : ""}`,
                            transform: `translate(${cutoutProductEffect.productOffsetX / 8}px, ${cutoutProductEffect.productOffsetY / 8}px) rotate(${cutoutProductEffect.productRotation}deg) scale(${cutoutProductEffect.productScale})`,
                          }}
                        >
                          <img
                            alt="누끼 효과 미리보기"
                            src={productImageState.cutoutImagePath}
                            style={{ filter: cutoutProductEffect.outline ? `drop-shadow(0 0 ${Math.max(1, cutoutProductEffect.outlineWidth / 2)}px ${cutoutProductEffect.outlineColor})` : undefined }}
                          />
                        </div>
                        <div className="cutout-effect-grid">
                          <label className="inline-check"><input checked={cutoutProductEffect.outline} onChange={(event) => setCutoutProductEffect((current) => ({ ...current, outline: event.target.checked }))} type="checkbox" />테두리 사용</label>
                          <label><span>테두리 색상</span><input onChange={(event) => setCutoutProductEffect((current) => ({ ...current, outlineColor: event.target.value }))} type="color" value={cutoutProductEffect.outlineColor} /></label>
                          <label><span>테두리 두께 {cutoutProductEffect.outlineWidth}</span><input max="40" min="0" onChange={(event) => setCutoutProductEffect((current) => ({ ...current, outlineWidth: Number(event.target.value) }))} type="range" value={cutoutProductEffect.outlineWidth} /></label>
                          <label className="inline-check"><input checked={cutoutProductEffect.shadow} onChange={(event) => setCutoutProductEffect((current) => ({ ...current, shadow: event.target.checked }))} type="checkbox" />그림자 사용</label>
                          <label><span>그림자 색상</span><input onChange={(event) => setCutoutProductEffect((current) => ({ ...current, shadowBaseColor: event.target.value }))} type="color" value={cutoutProductEffect.shadowBaseColor || "#000000"} /></label>
                          <label><span>그림자 투명도 {cutoutProductEffect.shadowOpacity ?? 0.45}</span><input max="1" min="0" onChange={(event) => setCutoutProductEffect((current) => ({ ...current, shadowOpacity: Number(event.target.value) }))} step="0.05" type="range" value={cutoutProductEffect.shadowOpacity ?? 0.45} /></label>
                          <label><span>그림자 번짐 {cutoutProductEffect.shadowBlur}</span><input max="60" min="0" onChange={(event) => setCutoutProductEffect((current) => ({ ...current, shadowBlur: Number(event.target.value) }))} type="range" value={cutoutProductEffect.shadowBlur} /></label>
                          <label><span>그림자 X {cutoutProductEffect.shadowOffsetX}</span><input max="50" min="-50" onChange={(event) => setCutoutProductEffect((current) => ({ ...current, shadowOffsetX: Number(event.target.value) }))} type="range" value={cutoutProductEffect.shadowOffsetX} /></label>
                          <label><span>그림자 Y {cutoutProductEffect.shadowOffsetY}</span><input max="50" min="-50" onChange={(event) => setCutoutProductEffect((current) => ({ ...current, shadowOffsetY: Number(event.target.value) }))} type="range" value={cutoutProductEffect.shadowOffsetY} /></label>
                          <label className="inline-check"><input checked={cutoutProductEffect.glow} onChange={(event) => setCutoutProductEffect((current) => ({ ...current, glow: event.target.checked }))} type="checkbox" />글로우 사용</label>
                          <label><span>글로우 색상</span><input onChange={(event) => setCutoutProductEffect((current) => ({ ...current, glowBaseColor: event.target.value }))} type="color" value={cutoutProductEffect.glowBaseColor || "#ffffff"} /></label>
                          <label><span>글로우 투명도 {cutoutProductEffect.glowOpacity ?? 0.55}</span><input max="1" min="0" onChange={(event) => setCutoutProductEffect((current) => ({ ...current, glowOpacity: Number(event.target.value) }))} step="0.05" type="range" value={cutoutProductEffect.glowOpacity ?? 0.55} /></label>
                          <label><span>글로우 강도 {cutoutProductEffect.glowBlur}</span><input max="80" min="0" onChange={(event) => setCutoutProductEffect((current) => ({ ...current, glowBlur: Number(event.target.value) }))} type="range" value={cutoutProductEffect.glowBlur} /></label>
                          <label><span>상품 크기 {cutoutProductEffect.productScale}</span><input max="1.6" min="0.6" onChange={(event) => setCutoutProductEffect((current) => ({ ...current, productScale: Number(event.target.value) }))} step="0.01" type="range" value={cutoutProductEffect.productScale} /></label>
                          <label><span>좌우 위치 {cutoutProductEffect.productOffsetX}</span><input max="300" min="-300" onChange={(event) => setCutoutProductEffect((current) => ({ ...current, productOffsetX: Number(event.target.value) }))} type="range" value={cutoutProductEffect.productOffsetX} /></label>
                          <label><span>상하 위치 {cutoutProductEffect.productOffsetY}</span><input max="300" min="-300" onChange={(event) => setCutoutProductEffect((current) => ({ ...current, productOffsetY: Number(event.target.value) }))} type="range" value={cutoutProductEffect.productOffsetY} /></label>
                          <label><span>회전 {cutoutProductEffect.productRotation}</span><input max="20" min="-20" onChange={(event) => setCutoutProductEffect((current) => ({ ...current, productRotation: Number(event.target.value) }))} type="range" value={cutoutProductEffect.productRotation} /></label>
                        </div>
                      </details>
                    ) : null}
                  </div>
                </details>
                <details className="background-settings render-settings source-image-dropdown">
                  <summary>
                    <div>
                      <p className="eyebrow">Render Image</p>
                      <strong>메인 이미지 / 누끼 설정</strong>
                      <span>{currentMainProductImage ? productImageModeLabel(productImageState.selectedImageMode) : "이미지 선택 필요"}</span>
                    </div>
                    <b>{currentMainProductImage ? "설정됨" : "선택 필요"}</b>
                  </summary>
                  <div>
                    <p className="eyebrow">Render Background</p>
                    <h4>배경 이미지 설정</h4>
                  </div>
                  <label>
                    <span>배경 모드</span>
                    <select
                      onChange={(event) => setProductInfo((current) => ({ ...current, backgroundMode: event.target.value as BackgroundMode }))}
                      value={productInfo.backgroundMode || "none"}
                    >
                      <option value="none">배경 없음</option>
                      <option value="auto-detail-blur-dark">대표 이미지 자동 배경</option>
                      <option value="selected-detail-blur-dark">상세 이미지 선택 배경</option>
                    </select>
                  </label>
                  <label>
                    <span>상세 이미지 선택</span>
                    <select
                      disabled={productInfo.backgroundMode !== "selected-detail-blur-dark" || !backgroundImageOptions.length}
                      onChange={(event) => setProductInfo((current) => ({ ...current, selectedBackgroundSource: event.target.value }))}
                      value={productInfo.selectedBackgroundSource || backgroundImageOptions[0]?.value || ""}
                    >
                      {backgroundImageOptions.length ? backgroundImageOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      )) : <option value="">추출된 상세 이미지 없음</option>}
                    </select>
                  </label>
                  {productInfo.backgroundMode === "selected-detail-blur-dark" ? (
                    <div className="detail-image-strip">
                      {backgroundImageOptions.map((option) => (
                        <button
                          aria-label={`${option.label} 배경 이미지로 선택`}
                          className={(productInfo.selectedBackgroundSource || backgroundImageOptions[0]?.value) === option.value ? "selected" : ""}
                          key={`background-${option.value}`}
                          onClick={() => setProductInfo((current) => ({ ...current, selectedBackgroundSource: option.value }))}
                          type="button"
                        >
                          <img alt={option.label} src={option.value} />
                          <span>{option.label}</span>
                          <img alt={`${option.label} 크게 보기`} className="detail-image-hover-preview" src={option.value} />
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="background-style-grid">
                    <label>
                      <span>흐림 강도</span>
                      <select
                        onChange={(event) => setBackgroundStyle((current) => ({ ...current, blurLevel: event.target.value as BackgroundLevel }))}
                        value={backgroundStyle.blurLevel}
                      >
                        <option value="low">낮음</option>
                        <option value="medium">중간</option>
                        <option value="high">높음</option>
                      </select>
                    </label>
                    <label>
                      <span>어둡게</span>
                      <select
                        onChange={(event) => setBackgroundStyle((current) => ({ ...current, dimLevel: event.target.value as BackgroundLevel }))}
                        value={backgroundStyle.dimLevel}
                      >
                        <option value="low">낮음</option>
                        <option value="medium">중간</option>
                        <option value="high">높음</option>
                      </select>
                    </label>
                  </div>
                  {currentBackgroundSource ? (
                    <div className="background-preview-thumb">
                      <img alt="선택된 배경 이미지 미리보기" src={currentBackgroundSource} />
                      <span>{productInfo.backgroundMode === "auto-detail-blur-dark" ? "대표 이미지 자동 배경" : "선택한 상세 이미지 배경"}</span>
                    </div>
                  ) : (
                    <p className="strategy-empty">상품정보를 불러오면 상세페이지 이미지가 배경 후보로 표시됩니다.</p>
                  )}
                  <label>
                    <span>헤드라인 색상</span>
                    <input
                      onChange={(event) => setHeadlineStyleOverride("headlineColor", event.target.value)}
                      type="color"
                      value={headlineStyleOverrides.headlineColor || "#ff1f1f"}
                    />
                  </label>
                  <label>
                    <span>헤드라인 폰트</span>
                    <select
                      onChange={(event) => setSelectedHeadlineFontId(event.target.value)}
                      value={selectedHeadlineFontId}
                    >
                      {systemFontOptions.map((option) => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>본문 문구 색상</span>
                    <input
                      onChange={(event) => setBannerTextColors((current) => ({ ...current, bodyColor: event.target.value }))}
                      type="color"
                      value={bannerTextColors.bodyColor}
                    />
                  </label>
                  <label>
                    <span>배너 폰트</span>
                    <select
                      onChange={(event) => setSelectedBodyFontId(event.target.value)}
                      value={selectedBodyFontId}
                    >
                      {systemFontOptions.map((option) => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>본문 문구 크기</span>
                    <input
                      max="80"
                      min="18"
                      onChange={(event) => setBannerTextColors((current) => ({ ...current, bodyFontSize: Number(event.target.value) || 50 }))}
                      type="number"
                      value={bannerTextColors.bodyFontSize}
                    />
                  </label>
                </details>
                <details className="background-settings logo-settings source-image-dropdown">
                  <summary>
                    <div>
                      <p className="eyebrow">Brand Logo</p>
                      <strong>로고 설정</strong>
                      <span>{brandLogoPath ? "로고 선택됨" : "선택 안 함"}</span>
                    </div>
                    <b>{brandLogoPath ? "사용" : "미사용"}</b>
                  </summary>
                  <div>
                    <p className="eyebrow">Brand Logo</p>
                    <h4>로고 설정</h4>
                  </div>
                  <label>
                    <span>로고 파일 선택</span>
                    <input
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(event) => {
                        uploadBrandLogo(event.target.files?.[0]);
                        event.currentTarget.value = "";
                      }}
                      type="file"
                    />
                  </label>
                  <label>
                    <span>기본 로고 선택</span>
                    <select
                      onChange={(event) => {
                        const logo = presetBrandLogos.find((item) => item.imagePath === event.target.value);
                        setBrandLogoPath(event.target.value);
                        setBrandLogoStatus(event.target.value
                          ? { kind: "success", message: `${logo?.label || "로고"}를 적용했습니다. 배너 생성 시 오른쪽 상단에 들어갑니다.` }
                          : { kind: "idle", message: "로고를 선택하지 않았습니다." });
                      }}
                      value={presetBrandLogos.some((item) => item.imagePath === brandLogoPath) ? brandLogoPath : ""}
                    >
                      <option value="">선택 안 함</option>
                      {presetBrandLogos.map((logo) => (
                        <option key={logo.id} value={logo.imagePath}>{logo.label}</option>
                      ))}
                    </select>
                  </label>
                  <div className="preset-logo-grid">
                    {presetBrandLogos.map((logo) => (
                      <button
                        className={brandLogoPath === logo.imagePath ? "selected" : ""}
                        key={logo.id}
                        onClick={() => {
                          setBrandLogoPath(logo.imagePath);
                          setBrandLogoStatus({ kind: "success", message: `${logo.label}를 적용했습니다. 배너 생성 시 오른쪽 상단에 들어갑니다.` });
                        }}
                        type="button"
                      >
                        <img alt={logo.label} src={logo.imagePath} />
                        <span>{logo.label}</span>
                      </button>
                    ))}
                  </div>
                  {brandLogoPath ? (
                    <div className="logo-preview-thumb">
                      <img alt="선택한 로고" src={brandLogoPath} />
                      <button onClick={() => setBrandLogoPath("")} type="button">로고 제거</button>
                    </div>
                  ) : (
                    <p className="strategy-empty">로고를 선택하면 템플릿 2 오른쪽 상단에 배치됩니다.</p>
                  )}
                  <div className={`mvp-status ${brandLogoStatus.kind}`}>{brandLogoStatus.message}</div>
                </details>
                <button disabled={!bannerCopy.headline || !selectedTemplate} onClick={renderBanner} type="button">배너만 다시 생성</button>
                <details className="background-settings ai-disclosure-settings source-image-dropdown">
                  <summary>
                    <div>
                      <p className="eyebrow">Caption</p>
                      <strong>AI 고지 자막</strong>
                      <span>{showAiDisclosure ? aiDisclosureText : "표시 안 함"}</span>
                    </div>
                    <b>{showAiDisclosure ? "표시" : "숨김"}</b>
                  </summary>
                  <div>
                    <p className="eyebrow">Caption</p>
                    <h4>AI 고지 자막</h4>
                  </div>
                  <label>
                    <span>표시 여부</span>
                    <select
                      onChange={(event) => setShowAiDisclosure(event.target.value === "show")}
                      value={showAiDisclosure ? "show" : "hide"}
                    >
                      <option value="hide">표시 안 함</option>
                      <option value="show">가운데 하단에 표시</option>
                    </select>
                  </label>
                  <label>
                    <span>자막 문구</span>
                    <input
                      disabled={!showAiDisclosure}
                      onChange={(event) => setAiDisclosureText(event.target.value)}
                      value={aiDisclosureText}
                    />
                  </label>
                  <p className="strategy-empty">선택한 경우에만 모든 템플릿의 가운데 하단에 아주 작게 들어갑니다.</p>
                </details>
                <div className={`mvp-status ${renderStatus.kind}`}>{renderStatus.message}</div>
                {generatedBannerPath ? (
                  <>
                    <img alt="생성된 광고 배너" src={generatedBannerPath} />
                    <a className="download-button" download href={generatedBannerPath}>PNG 다운로드</a>
                  </>
                ) : (
                  <div className="empty-banner-preview">
                    <strong>와 진심 미쳤다</strong>
                    <span>캠핑용 고기로 샀어요 입에서 살살 녹고</span>
                    <em>이 구성에 이 가격이면 가족 선물각</em>
                    <i aria-hidden="true" />
                    <b>잡내 없이 부드러운 오늘의 특가 구성</b>
                    <small>구성 보러가기 &gt;</small>
                  </div>
                )}
                </section>
              </div>
            </div>
          </section>
        ) : null}

        {activeMenu === "결과 다운로드" ? (
          <section className="mvp-panel">
            <div className="mvp-panel-head">
              <h3>생성 기록</h3>
            </div>
            <div className="download-list">
              {generated.length ? generated.map((item) => (
                <article key={item.id}>
                  <strong>{item.productName}</strong>
                  <span>{new Date(item.createdAt).toLocaleString("ko-KR")}</span>
                </article>
              )) : <article><strong>아직 저장된 이미지 생성 결과가 없습니다.</strong><span>이번 단계는 전략/카피/프롬프트 생성까지만 제공합니다.</span></article>}
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}

function CrawledGrid({ items }: { items: MetaCrawlItem[] }) {
  return (
    <div className="mvp-image-grid">
      {items.map((item) => (
        <article key={`${item.imageUrl}-${item.originalAdUrl}`}>
          <img alt={`${item.brandName} 수집 광고 이미지`} src={item.localImagePath || item.imageUrl} />
          <div>
            <strong>{item.brandName}</strong>
            <span>{new Date(item.collectedAt).toLocaleString("ko-KR")}</span>
            {item.originalAdUrl ? (
              <a href={item.originalAdUrl} rel="noreferrer" target="_blank">광고 원본 보기</a>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}

function TaxonomyGroup({ title, items }: { title: string; items: string[] }) {
  return (
    <section>
      <h4>{title}</h4>
      <div>
        {items.map((item) => <span key={item}>{item}</span>)}
      </div>
    </section>
  );
}

function FilterBar({
  appealPointFilter,
  categoryFilter,
  hookTypeFilter,
  labelStateFilter,
  platformFilter,
  setAppealPointFilter,
  setCategoryFilter,
  setHookTypeFilter,
  setLabelStateFilter,
  setPlatformFilter,
}: {
  appealPointFilter: string;
  categoryFilter: string;
  hookTypeFilter: string;
  labelStateFilter: string;
  platformFilter: string;
  setAppealPointFilter: (value: string) => void;
  setCategoryFilter: (value: string) => void;
  setHookTypeFilter: (value: string) => void;
  setLabelStateFilter: (value: string) => void;
  setPlatformFilter: (value: string) => void;
}) {
  return (
    <div className="taxonomy-filters">
      <label>
        <span>카테고리</span>
        <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
          <option value="all">전체</option>
          {categoryOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <label>
        <span>소구점</span>
        <select value={appealPointFilter} onChange={(event) => setAppealPointFilter(event.target.value)}>
          <option value="all">전체</option>
          {appealPointOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <label>
        <span>후킹 유형</span>
        <select value={hookTypeFilter} onChange={(event) => setHookTypeFilter(event.target.value)}>
          <option value="all">전체</option>
          {hookTypeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <label>
        <span>플랫폼</span>
        <select value={platformFilter} onChange={(event) => setPlatformFilter(event.target.value)}>
          <option value="all">전체</option>
          <option value="meta">meta</option>
          <option value="tiktok">tiktok</option>
          <option value="manual">manual</option>
        </select>
      </label>
      <label>
        <span>라벨 상태</span>
        <select value={labelStateFilter} onChange={(event) => setLabelStateFilter(event.target.value)}>
          <option value="all">전체</option>
          <option value="needed">라벨 필요</option>
          <option value="done">라벨 완료</option>
        </select>
      </label>
    </div>
  );
}

function ImageGrid({
  images,
  labelsByImageId,
  onAnalyze,
  onMetadataSave,
  onSelect,
  onToggleReference,
  selectedReferenceIds,
  selectedImageId,
  showAnalysis = false,
}: {
  images: CollectedAdImage[];
  labelsByImageId: Map<string, AdImageLabel>;
  onAnalyze: (image: CollectedAdImage) => void;
  onMetadataSave: (image: CollectedAdImage, updates: Partial<CollectedAdImage>) => void;
  onSelect: (image: CollectedAdImage) => void;
  onToggleReference: (imageId: string) => void;
  selectedReferenceIds: string[];
  selectedImageId?: string;
  showAnalysis?: boolean;
}) {
  return (
    <div className="mvp-image-grid">
      {images.map((image) => (
        <article className={selectedImageId === image.id ? "selected" : ""} key={image.id} onClick={() => onSelect(image)}>
          {(() => {
            const existingLabel = labelsByImageId.get(image.id);
            const displayCategory = existingLabel?.finalLabel.category || image.category || "기타";
            const displayHookType = existingLabel?.finalLabel.hookType || image.hookType || "";
            const displayAppealPoint = existingLabel?.finalLabel.appealPoint || image.appealPoint || "";

            return (
              <>
          <div className={`label-badge ${existingLabel ? "done" : "needed"}`}>
            {existingLabel ? "라벨 완료" : "라벨 필요"}
          </div>
          {existingLabel ? (
            <label className="reference-check" onClick={(event) => event.stopPropagation()}>
              <input
                checked={selectedReferenceIds.includes(image.id)}
                onChange={() => onToggleReference(image.id)}
                type="checkbox"
              />
              레퍼런스로 선택
            </label>
          ) : null}
          <img alt={`${image.category || "광고"} 이미지`} src={image.localImagePath || image.imageUrl} />
          <div>
            <strong>{displayCategory}</strong>
            <span>{displayHookType || "후킹 미지정"} / {displayAppealPoint || "소구점 미지정"} / {image.sourcePlatform}</span>
            <div className="metadata-editor" onClick={(event) => event.stopPropagation()}>
              <select
                aria-label="카테고리"
                defaultValue={displayCategory}
                onChange={(event) => onMetadataSave(image, { category: event.target.value })}
              >
                {categoryOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
              <select
                aria-label="후킹 유형"
                defaultValue={displayHookType}
                onChange={(event) => onMetadataSave(image, { hookType: event.target.value })}
              >
                <option value="">후킹 유형</option>
                {hookTypeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
              <select
                aria-label="소구점"
                defaultValue={displayAppealPoint}
                onChange={(event) => onMetadataSave(image, { appealPoint: event.target.value })}
              >
                <option value="">소구점</option>
                {appealPointOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
              <input
                aria-label="브랜드명 optional"
                defaultValue={image.brandName}
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  if (value !== image.brandName) onMetadataSave(image, { brandName: value });
                }}
                placeholder="브랜드명 optional"
              />
              <select
                aria-label="플랫폼"
                defaultValue={String(image.sourcePlatform).toLowerCase()}
                onChange={(event) => onMetadataSave(image, { sourcePlatform: event.target.value as CollectedAdImage["sourcePlatform"] })}
              >
                <option value="meta">meta</option>
                <option value="tiktok">tiktok</option>
                <option value="manual">manual</option>
              </select>
            </div>
            {showAnalysis && existingLabel ? <p>{existingLabel.finalLabel.copyNuance || existingLabel.finalLabel.hookType}</p> : null}
            <button
              onClick={(event) => {
                event.stopPropagation();
                onAnalyze(image);
              }}
              type="button"
            >
              {existingLabel ? "재분석하기" : "AI 분석하기"}
            </button>
          </div>
              </>
            );
          })()}
        </article>
      ))}
    </div>
  );
}

function LabelPanel({
  aiDraft,
  finalLabel,
  hasExistingLabel,
  image,
  onAnalyze,
  onDraftChange,
  onSave,
  status,
}: {
  aiDraft: AdImageAnalysisDraft;
  finalLabel: AdImageAnalysisDraft;
  hasExistingLabel: boolean;
  image: CollectedAdImage | null;
  onAnalyze: (image: CollectedAdImage) => void;
  onDraftChange: (draft: AdImageAnalysisDraft) => void;
  onSave: () => void;
  status: Status;
}) {
  return (
    <aside className="label-panel">
      {image ? (
        <>
          <div className="label-preview">
            <img alt={`${image.category || "광고"} 라벨 편집 이미지`} src={image.localImagePath || image.imageUrl} />
            <div>
              <p className="eyebrow">Ad Image Label</p>
              <h3>{finalLabel.category || image.category || "기타"}</h3>
              <span>{finalLabel.hookType || image.hookType || "후킹 미지정"} / {finalLabel.appealPoint || image.appealPoint || "소구점 미지정"} / {image.sourcePlatform}</span>
            </div>
          </div>
          <div className={`mvp-status ${status.kind}`}>{status.message}</div>
          <div className="label-actions">
            <button onClick={() => onAnalyze(image)} type="button">{hasExistingLabel ? "재분석하기" : "AI 분석하기"}</button>
            <button onClick={onSave} type="button">라벨 저장</button>
          </div>
          <section className="ai-draft-box">
            <h4>AI 분석 초안</h4>
            <p>{aiDraft.whyItWorks || "아직 분석 초안이 없습니다."}</p>
          </section>
          <form className="label-form">
            <h4>기본 분석</h4>
            {labelFields.map((field) => (
              <label key={field.key}>
                <span>{field.label}</span>
                {field.key === "category" || field.key === "hookType" || field.key === "appealPoint" ? (
                  <select
                    onChange={(event) => onDraftChange({ ...finalLabel, [field.key]: event.target.value })}
                    value={finalLabel[field.key]}
                  >
                    <option value="">선택</option>
                    {(field.key === "category" ? categoryOptions : field.key === "hookType" ? hookTypeOptions : appealPointOptions).map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                ) : (
                  <textarea
                    onChange={(event) => onDraftChange({ ...finalLabel, [field.key]: event.target.value })}
                    rows={field.key === "whyItWorks" || field.key === "recommendedUse" ? 4 : 3}
                    value={finalLabel[field.key]}
                  />
                )}
              </label>
            ))}
            <h4>심화 카피 분석</h4>
            {advancedLabelFields.map((field) => (
              <label key={field.key}>
                <span>{field.label}</span>
                <textarea
                  onChange={(event) => onDraftChange({ ...finalLabel, [field.key]: event.target.value })}
                  rows={field.key === "reusableCopyPattern" || field.key === "visualCopyRelation" ? 4 : 3}
                  value={finalLabel[field.key]}
                />
              </label>
            ))}
          </form>
        </>
      ) : (
        <div className="empty-label-panel">
          <p className="eyebrow">Ad Image Label</p>
          <h3>이미지를 선택하세요</h3>
          <p>이미지 카드에서 AI 분석 초안을 만들고 최종 라벨로 저장할 수 있습니다.</p>
        </div>
      )}
    </aside>
  );
}
