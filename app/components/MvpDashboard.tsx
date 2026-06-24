"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  AdImageAnalysisDraft,
  AdImageLabel,
  CollectedAdImage,
  GeneratedAdImage,
  GeneratedAdCopy,
  ExtractedProductInfo,
  MvpBrand,
  ProductInfoForPrompt,
} from "../lib/mvp/types";
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

type SystemFontOption = {
  id: string;
  label: string;
  fontFamily: string;
  fontFile: string;
};

type MetaCrawlItem = {
  brandName: string;
  imageUrl: string;
  localImagePath?: string;
  originalAdUrl: string;
  collectedAt: string;
};

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
    fontFamily: "AdAtlasSelectedFont, \"Cafe24 Ohsquare\", \"Noto Sans KR\", sans-serif",
    fontFile: "C:/Users/daywiz_레노버/AppData/Local/Microsoft/Windows/Fonts/Cafe24Ohsquare-v2.0.otf",
  },
  {
    id: "cafe24-dangdanghae",
    label: "Cafe24 Dangdanghae",
    fontFamily: "AdAtlasSelectedFont, \"Cafe24 Dangdanghae\", \"Noto Sans KR\", sans-serif",
    fontFile: "C:/Users/daywiz_레노버/AppData/Local/Microsoft/Windows/Fonts/Cafe24Dangdanghae-v2.0.otf",
  },
  {
    id: "cafe24-supermagic",
    label: "Cafe24 Supermagic",
    fontFamily: "AdAtlasSelectedFont, \"Cafe24 Supermagic\", \"Noto Sans KR\", sans-serif",
    fontFile: "C:/Users/daywiz_레노버/AppData/Local/Microsoft/Windows/Fonts/Cafe24Supermagic-Regular-v1.0.otf",
  },
  {
    id: "cafe24-nyangi",
    label: "Cafe24 Nyangi",
    fontFamily: "AdAtlasSelectedFont, \"Cafe24 Nyangi\", \"Noto Sans KR\", sans-serif",
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
    fontFamily: "AdAtlasSelectedFont, \"Gmarket Sans\", \"Noto Sans KR\", sans-serif",
    fontFile: "C:/Users/daywiz_레노버/AppData/Local/Microsoft/Windows/Fonts/GmarketSansTTFBold.ttf",
  },
  {
    id: "gmarket-medium",
    label: "Gmarket Sans Medium",
    fontFamily: "AdAtlasSelectedFont, \"Gmarket Sans\", \"Noto Sans KR\", sans-serif",
    fontFile: "C:/Users/daywiz_레노버/AppData/Local/Microsoft/Windows/Fonts/GmarketSansTTFMedium.ttf",
  },
  {
    id: "gmarket-light",
    label: "Gmarket Sans Light",
    fontFamily: "AdAtlasSelectedFont, \"Gmarket Sans\", \"Noto Sans KR\", sans-serif",
    fontFile: "C:/Users/daywiz_레노버/AppData/Local/Microsoft/Windows/Fonts/GmarketSansTTFLight.ttf",
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
  const [productExtractStatus, setProductExtractStatus] = useState<Status>({ kind: "idle", message: "상품 URL을 입력하면 상세페이지 정보를 먼저 불러올 수 있습니다." });
  const [strategyStatus, setStrategyStatus] = useState<Status>({ kind: "idle", message: "라벨 완료 레퍼런스 1~3개와 새 상품 정보를 입력하세요." });
  const [copyResult, setCopyResult] = useState<GeneratedAdCopy | null>(null);
  const [copyReferenceLabels, setCopyReferenceLabels] = useState<AdImageLabel[]>([]);
  const [copyStatus, setCopyStatus] = useState<Status>({ kind: "idle", message: "상품 URL을 입력하면 저장된 라벨 데이터를 참고해 광고 문구를 생성합니다." });
  const [bannerCopy, setBannerCopy] = useState<GeneratedAdCopy>(emptyBannerCopy);
  const [showCta, setShowCta] = useState(true);
  const [headlineStyleOverrides, setHeadlineStyleOverrides] = useState<HeadlineStyleOverrides>({});
  const [showAdvancedHeadlineStyle, setShowAdvancedHeadlineStyle] = useState(false);
  const [backgroundStyle, setBackgroundStyle] = useState<BackgroundStyleState>({ blurLevel: "high", dimLevel: "high" });
  const [bannerTextColors, setBannerTextColors] = useState<BannerTextColorState>({ bodyColor: "#111111", bodyFontSize: 50 });
  const [mainImageSourceMode, setMainImageSourceMode] = useState<MainImageSourceMode>("detail");
  const [uploadedMainImageDataUrl, setUploadedMainImageDataUrl] = useState("");
  const [gptMainImagePath, setGptMainImagePath] = useState("");
  const [selectedHeadlineFontId, setSelectedHeadlineFontId] = useState(systemFontOptions[0].id);
  const [selectedBodyFontId, setSelectedBodyFontId] = useState(systemFontOptions[11].id);
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
  const currentBackgroundSource =
    productInfo.backgroundMode === "auto-detail-blur-dark"
      ? productInfo.extractedMainImage || productInfo.productImagePath || productInfo.selectedBackgroundSource || ""
      : productInfo.backgroundMode === "selected-detail-blur-dark"
        ? productInfo.selectedBackgroundSource || backgroundImageOptions[0]?.value || ""
        : "";
  const currentMainProductImage =
    mainImageSourceMode === "upload"
      ? uploadedMainImageDataUrl
      : mainImageSourceMode === "gpt"
        ? gptMainImagePath
        : productInfo.productImagePath;
  const currentSecondaryProductImage =
    productInfo.secondaryProductImagePath || backgroundImageOptions.find((option) => option.value !== currentMainProductImage)?.value || currentMainProductImage;
  const currentProductImagePaths = useMemo(() => {
    if (mainImageSourceMode !== "detail") return [currentMainProductImage].filter(Boolean);
    const selected = (productInfo.productImagePaths?.length
      ? productInfo.productImagePaths
      : [productInfo.productImagePath, productInfo.secondaryProductImagePath]).filter(Boolean);
    const fallback = backgroundImageOptions[0]?.value || "";
    return (selected.length ? selected : [fallback]).filter(Boolean).slice(0, 4);
  }, [backgroundImageOptions, currentMainProductImage, mainImageSourceMode, productInfo.productImagePath, productInfo.productImagePaths, productInfo.secondaryProductImagePath]);
  const selectedHeadlineFont = systemFontOptions.find((option) => option.id === selectedHeadlineFontId) ?? systemFontOptions[0];
  const selectedBodyFont = systemFontOptions.find((option) => option.id === selectedBodyFontId) ?? systemFontOptions[11];
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

  function mergeExtractedProductInfo(current: ProductInfoForPrompt, extracted: ExtractedProductInfo): ProductInfoForPrompt {
    const extractedCategory = normalizeProductCategory(
      extracted.category,
      extracted.productName,
      extracted.description,
    );

    const galleryImages = [extracted.mainImage, ...(extracted.galleryImages ?? [])].filter(Boolean);
    const shouldRefreshSelectedBackground =
      !current.selectedBackgroundSource ||
      current.selectedBackgroundSource === current.extractedMainImage ||
      current.selectedBackgroundSource === current.productImagePath;
    const selectedBackgroundSource = shouldRefreshSelectedBackground
      ? extracted.mainImage || galleryImages[0] || ""
      : current.selectedBackgroundSource;

    return {
      ...current,
      productName: current.productName || extracted.productName || "",
      category: current.category || extractedCategory,
      price: current.price || extracted.price || "",
      discountInfo: extracted.discountInfo || current.discountInfo || "",
      mainBenefit: current.mainBenefit || extracted.description || "",
      landingUrl: current.landingUrl || extracted.landingUrl || "",
      productImagePath: extracted.mainImage || current.productImagePath || "",
      secondaryProductImagePath: current.secondaryProductImagePath || galleryImages.find((image) => image !== extracted.mainImage) || "",
      productImagePaths: current.productImagePaths?.length ? current.productImagePaths : galleryImages.slice(0, 2),
      backgroundImagePath: current.backgroundImagePath || "",
      extractedDescription: extracted.description || current.extractedDescription || "",
      extractedMainImage: extracted.mainImage || current.extractedMainImage || "",
      extractedGalleryImages: galleryImages.length ? galleryImages : current.extractedGalleryImages || [],
      selectedBackgroundSource,
      backgroundMode: current.backgroundMode === "none" ? "auto-detail-blur-dark" : current.backgroundMode || "auto-detail-blur-dark",
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
        mergedProductInfo = mergeExtractedProductInfo(current, result.productInfo);
        return mergedProductInfo;
      });
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
    setCopyStatus({ kind: "loading", message: "선택한 라벨 레퍼런스를 참고해 광고문구를 생성 중입니다." });
    setGeneratedBannerPath("");

    try {
      let productInfoForCopy = productInfo;
      const hasUrl = Boolean(productInfo.landingUrl.trim());
      const hasExtractedDetails = Boolean(productInfo.productName || productInfo.mainBenefit || productInfo.extractedDescription);

      if (hasUrl && !hasExtractedDetails) {
        setProductExtractStatus({ kind: "loading", message: "상품 상세페이지 정보를 불러오는 중입니다." });
        productInfoForCopy = await loadProductInfoFromUrl({ silent: true });
      }

      const response = await fetch("/api/strategy/generate-copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productInfo: productInfoForCopy, referenceLabels: selectedReferenceLabels }),
      });
      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? "광고문구 생성 실패");
      }

      setCopyResult(result.copy);
      setBannerCopy(result.copy);
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
  }

  async function renderBanner() {
    if (!selectedTemplate) {
      setRenderStatus({ kind: "error", message: "현재 카테고리에 사용할 수 있는 전용 템플릿이 없습니다." });
      return;
    }

    setRenderStatus({ kind: "loading", message: "SVG 템플릿을 1200x1200 PNG로 렌더링 중입니다." });

    try {
      const response = await fetch("/api/render/template-ad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: selectedTemplate.id,
          canvasSize: { width: 1200, height: 1200 },
          copy: {
            headline: bannerCopy.headline,
            bodyCopy: bannerCopy.bodyCopy,
            highlightCopy: bannerCopy.highlightCopy,
            bottomBarCopy: bannerCopy.bottomBarCopy,
            cta: showCta ? bannerCopy.cta : "",
            price: bannerCopy.price || productInfo.price,
          },
          productImagePath: currentMainProductImage,
          secondaryProductImagePath: currentSecondaryProductImage,
          productImagePaths: currentProductImagePaths,
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
            accentColor: "#fff9a8",
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
            <div className="banner-builder">
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
                        onChange={(event) => setProductInfo((current) => ({ ...current, [field.key]: event.target.value }))}
                        placeholder={field.placeholder}
                        value={productInfo[field.key] || ""}
                      />
                    )}
                  </label>
                ))}
                <button disabled={productExtractStatus.kind === "loading"} onClick={() => loadProductInfoFromUrl()} type="button">
                  상품정보 불러오기
                </button>
                <div className={`mvp-status ${productExtractStatus.kind}`}>{productExtractStatus.message}</div>
                <button disabled={copyStatus.kind === "loading"} onClick={generateBannerCopy} type="button">광고문구 생성</button>
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
                    <span>{key}</span>
                    <textarea
                      onChange={(event) => setBannerCopy((current) => ({ ...current, [key]: event.target.value }))}
                      rows={key === "headline" ? 2 : 3}
                      value={bannerCopy[key]}
                    />
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
                  <span>price</span>
                  <input
                    onChange={(event) => setProductInfo((current) => ({ ...current, price: event.target.value }))}
                    value={productInfo.price}
                  />
                </label>
                {copyResult ? <p className="strategy-empty">{copyResult.whyThisWorks}</p> : null}
              </section>

              <section className="banner-preview-panel">
                <div>
                  <p className="eyebrow">PNG Preview</p>
                  <h4>{selectedTemplate?.id || "템플릿 없음"}</h4>
                </div>
                <div className="template-picker">
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
                </div>
                <div className="background-settings render-settings">
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
                        <small>1개만 선택하면 같은 이미지가 반복되고, 최대 4개까지 배치됩니다.</small>
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
                  {mainImageSourceMode === "gpt" ? (
                    <label>
                      <span>GPT 생성 이미지 URL/경로</span>
                      <input
                        onChange={(event) => setGptMainImagePath(event.target.value)}
                        placeholder="/generated-product-images/example.png 또는 https://..."
                        value={gptMainImagePath}
                      />
                    </label>
                  ) : null}
                  {currentMainProductImage ? (
                    <div className="background-preview-thumb">
                      <img alt="선택된 메인 상품 이미지 미리보기" src={currentMainProductImage} />
                      <span>배너 중앙에 크게 들어갈 메인 상품 이미지</span>
                    </div>
                  ) : (
                    <p className="strategy-empty">상세페이지 이미지, 첨부 이미지, GPT 생성 이미지 중 하나를 선택해주세요.</p>
                  )}
                </div>
                <div className="background-settings render-settings">
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
                </div>
                <button disabled={!bannerCopy.headline || !selectedTemplate} onClick={renderBanner} type="button">배너만 다시 생성</button>
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
