import type { AppFeatureKey } from "./AppFeatureNavigation";
import type { ProductCreationHandoff } from "../lib/store-analysis/types";
import type {
  AdImageAnalysisDraft,
  BatchRenderResult,
  CollectedAdImage,
  ExtractedProductInfo,
  GeneratedAdCopy,
  GeneratedAdImage,
  GptImageFailureReason,
  MvpBrand,
  ProductImageMode,
  ProductImageRenderEffect,
  ProductImageState,
  ProductInfoForPrompt,
  SelectedAdImageState,
  SourceImageCandidate,
  SourceImageSelectionState,
} from "../lib/mvp/types";
import { compactUniqueImagePaths } from "../lib/mvp/imageSelectionResolver";
import { beautyCategoryTemplates, foodCategoryTemplates, foodImpactHeroTemplate, healthCategoryTemplates, qualityFoodTemplates, type BannerTemplateDefinition } from "../../lib/bannerTemplates";
import { categoryOptions } from "./features/reference-management/ReferenceAnalysisPanels";

type MvpMenu = "카테고리 관리" | "이미지 수집" | "이미지 분석" | "광고 생성" | "결과 다운로드";

type Props = {
  initialBrands: MvpBrand[];
  initialImages: CollectedAdImage[];
  initialGenerated: GeneratedAdImage[];
  initialCreationHandoff?: ProductCreationHandoff | null;
  initialProductUrl?: string;
  initialActiveMenu?: MvpMenu;
  initialWorkflowStep?: "product" | "hooks" | "creative" | "results";
  activeFeature?: AppFeatureKey;
};

type Status = { kind: "idle" | "loading" | "success" | "error"; message: string };

type RecentProductSummary = {
  productName: string;
  landingUrl: string;
  imagePath: string;
  brandName: string;
  price: string;
};

const recentProductsStorageKey = "adatlas-recent-products";
const legacyManualProductionToolsAvailable = false;

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
  brightness: number;
  overlayOpacity: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  flipHorizontal: boolean;
};

type BannerTextColorState = {
  bodyColor: string;
  bodyFontSize: number;
};

type MainImageSourceMode = "detail" | "upload" | "gpt";
type ImageGenerationProvider = "openai" | "gemini";

function batchZipTimestamp(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return String(date.getFullYear()) + pad(date.getMonth() + 1) + pad(date.getDate()) + "-" + pad(date.getHours()) + pad(date.getMinutes());
}

function batchResultImageUrl(result: BatchRenderResult) {
  return result.downloadUrl || result.imagePath || "";
}

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
  effectPreset: "commerce-shadow",
};

const emptySelectedAdImages: SelectedAdImageState = {
  selectedImagePaths: [],
  primaryImagePath: "",
  secondaryImagePath: "",
  source: "unknown",
  updatedAt: "",
};

const emptyRecommendationIds: string[] = [];

const defaultCutoutProductEffect: ProductImageRenderEffect = {
  outline: false,
  outlineColor: "#ffffff",
  outlineWidth: 2,
  shadow: true,
  shadowBaseColor: "#000000",
  shadowOpacity: 0.45,
  shadowColor: "rgba(0,0,0,0.45)",
  shadowBlur: 24,
  shadowOffsetX: 0,
  shadowOffsetY: 10,
  glow: false,
  glowBaseColor: "#ffffff",
  glowOpacity: 0.55,
  glowColor: "rgba(255,255,255,0.55)",
  glowBlur: 28,
  productScale: 1.08,
  productOffsetX: 0,
  productOffsetY: 0,
  productRotation: 0,
};

const cutoutProductEffectPresets: {
  id: string;
  label: string;
  effect: ProductImageRenderEffect;
}[] = [
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

const presetBrandLogos = [
  {
    id: "gukdae-hanwoo",
    label: "국대한우 로고",
    imagePath: "/brand-logos/gukdae-hanwoo-logo-exact.png",
  },
  {
    id: "daehan-hanwoo",
    label: "대한한우 로고",
    imagePath: "/brand-logos/advertisers/daehan-hanwoo.png",
  },
  {
    id: "himnaera-farm",
    label: "힘내라농가 로고",
    imagePath: "/brand-logos/advertisers/himnaera-farm.png",
  },
  {
    id: "original-source",
    label: "오리지널소스 로고",
    imagePath: "/brand-logos/original-source-logo.png",
  },
  {
    id: "ririnco",
    label: "리리앤코 로고",
    imagePath: "/brand-logos/ririnco-logo.png",
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
  advertiserName: "",
  brandName: "",
  copyGuideId: "",
  copyGuideContext: undefined,
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
  reviewSources: [],
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

const advertiserOptions = [
  { label: "선택 안 함", value: "", guideId: "" },
  { label: "국대한우", value: "국대한우", guideId: "kookdae-hanwoo" },
  { label: "대한한우", value: "대한한우", guideId: "daehan-hanwoo" },
  { label: "힘내라농가", value: "힘내라농가", guideId: "fighting-farm" },
  { label: "오리지널소스", value: "오리지널소스", guideId: "original-source" },
];

function normalizeProductCategory(...values: string[]) {
  const text = values.filter(Boolean).join(" ").toLowerCase();
  const firstCategory = values.find((value) => categoryOptions.includes(value));
  if (firstCategory) return firstCategory;

  if (/(식품|선물|한우|고기|소고기|돼지고기|갈비|등심|안심|스테이크|정육|육류|과일|복숭아|사과|배|포도|감귤|귤|딸기|수박|참외|멜론|토마토|채소|야채|쌀|잡곡|고구마|감자|옥수수|농산|농가|수산|간식|명절|추석|설날|푸드|food|meat|beef|gift)/i.test(text)) return "식품/선물";
  if (/(뷰티|화장품|스킨|케어|크림|앰플|향수|메이크업|beauty|cosmetic|skin)/i.test(text)) return "뷰티/스킨케어";
  if (/(패션|의류|옷|룩|자켓|셔츠|신발|가방|주얼리|웨어|fashion|apparel)/i.test(text)) return "패션/의류";
  if (/(생활|용품|주방|청소|정리|세제|수납|daily|household)/i.test(text)) return "생활용품";
  if (/(건강|영양|비타민|유산균|홍삼|오메가|기능식품|health|supplement)/i.test(text)) return "건강기능식품";
  if (/(디지털|앱|어플|소프트웨어|전자|가전|모바일|digital|app|software)/i.test(text)) return "디지털/앱";
  if (/(인테리어|리빙|가구|침구|조명|홈데코|interior|living|furniture)/i.test(text)) return "인테리어/리빙";

  return "기타";
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
  return [
    ...String(value || "")
      .replace(/\s+/g, "")
      .trim(),
  ].length;
}

function hexToRgba(hex: string, opacity: number) {
  const normalized = hex.replace("#", "");
  const sixDigit =
    normalized.length === 3
      ? normalized
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
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
  const detailImages = (extracted.detailImages?.length ? extracted.detailImages : (extracted.galleryImages ?? [])).filter((imagePath) => imagePath && imagePath !== heroImage).slice(0, 30);
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

function extractedProductImagePaths(extracted: ExtractedProductInfo, sourceCandidates: SourceImageCandidate[] = []) {
  return compactUniqueImagePaths([extracted.mainImage, extracted.heroImage, ...(extracted.galleryImages ?? []), ...(extracted.detailImages ?? []), ...sourceCandidates.map((candidate) => candidate.imagePath)]);
}

function confirmedExtractedProductImagePaths(extracted: ExtractedProductInfo) {
  // 신규 추출 응답은 확정 배열을 명시한다. 빈 배열도 "확정 이미지 없음"을
  // 뜻하므로 자동 갤러리의 main/hero를 다시 승격하지 않는다. 필드가 없는
  // 과거 저장 데이터만 대표 이미지를 하위 호환으로 사용한다.
  return compactUniqueImagePaths(extracted.confirmedProductImages === undefined
    ? [extracted.mainImage, extracted.heroImage]
    : extracted.confirmedProductImages).slice(0, 6);
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

const allCreatableTemplates = Array.from(new Map([...beautyCategoryTemplates, ...healthCategoryTemplates, ...qualityFoodTemplates, ...foodCategoryTemplates, legacyFoodImpactTemplateOption].map((template) => [template.id, template])).values());

export {
  advertiserOptions,
  allCreatableTemplates,
  batchResultImageUrl,
  batchZipTimestamp,
  buildSourceImageCandidates,
  confirmedExtractedProductImagePaths,
  copyVisibleLength,
  cutoutProductEffectPresets,
  defaultCutoutProductEffect,
  emptyBannerCopy,
  emptyDraft,
  emptyProductImageState,
  emptyProductInfo,
  emptyRecommendationIds,
  emptySelectedAdImages,
  emptySourceImageSelection,
  extractedProductImagePaths,
  fixedSourceReferenceImages,
  getSelectedProductImagePath,
  gptImageFailureReasonOptions,
  legacyFoodImpactTemplateOption,
  legacyManualProductionToolsAvailable,
  noPackageChangePromptTemplate,
  noTextAdVisualPromptTemplate,
  normalizeAnalysisDraft,
  normalizeProductCategory,
  normalizeProductRenderEffect,
  preserveSourcePromptTemplate,
  presetBrandLogos,
  productFields,
  productImageModeLabel,
  recentProductsStorageKey,
};
export type {
  BackgroundLevel,
  BackgroundMode,
  BackgroundStyleState,
  BannerTextColorState,
  HeadlineStyleOverrides,
  ImageGenerationProvider,
  MainImageSourceMode,
  MvpMenu,
  Props,
  RecentProductSummary,
  Status,
};


