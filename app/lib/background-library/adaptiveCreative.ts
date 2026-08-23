import type { ExtractedPalette, GeneratedAdCopy, ProductInfoForPrompt } from "../mvp/types.ts";
import { chooseTextColor, contrastRatio, ensureContrast, mixColors } from "../mvp/colorUtils.ts";
import type { AdaptiveCreativePlan, AdaptiveLayoutVariant, AdaptivePlacementBox, AutomaticLayoutPreset, BackgroundHookType, BackgroundLibraryItem, BackgroundSelectionMode } from "./types.ts";

type LayoutContext = {
  background: BackgroundLibraryItem;
  hookType: BackgroundHookType;
  product: Partial<ProductInfoForPrompt>;
  copy?: Partial<GeneratedAdCopy>;
  palette: ExtractedPalette;
  productAspectRatio?: number;
  productHasTransparency?: boolean;
  backgroundSelectionMode?: BackgroundSelectionMode;
  hookId?: string;
  now?: string;
};

const variants: AdaptiveLayoutVariant[] = ["copy-focused", "product-focused", "content-focused"];

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

function preferredSide(background: BackgroundLibraryItem) {
  if (background.textSafeArea.includes("left")) return "left" as const;
  if (background.textSafeArea.includes("right")) return "right" as const;
  return "center" as const;
}

function layoutCandidates(context: LayoutContext): AutomaticLayoutPreset[] {
  const { background, hookType } = context;
  const side = preferredSide(background);
  const priceDriven = Boolean(context.product.price || context.product.discountInfo) && ["price_offer", "urgency", "gifting"].includes(hookType);
  const layouts: AutomaticLayoutPreset[] = [];

  if (priceDriven) layouts.push("price-focused", "centered-product-promotion");
  if (background.category === "fashion") layouts.push("fashion-lookbook");
  if (["ingredient_scene", "pattern_texture"].includes(background.assetType)) {
    layouts.push("ingredient-story", "product-grounded");
  }
  if (hookType === "sensory" && !background.includesPerson) {
    layouts.push("ingredient-story");
  }
  if (background.includesPerson) layouts.push("people-scene", "lifestyle-caption");
  if (["lifestyle_photo", "people_photo"].includes(background.assetType)) {
    layouts.push("editorial-overlay", "lifestyle-caption");
  }
  if (hookType === "premium" || background.brightness === "dark") {
    layouts.push("premium-minimal");
  }
  if (side === "left") layouts.push("text-left-product-right");
  else if (side === "right") layouts.push("text-right-product-left");
  else if (background.textSafeArea.startsWith("top")) layouts.push("text-top-product-bottom");
  else if (background.textSafeArea.startsWith("bottom")) layouts.push("text-bottom-product-top");
  layouts.push("product-grounded", "split-panel", "text-top-product-bottom");

  return unique(layouts).slice(0, 3);
}

function boxesFor(layout: AutomaticLayoutPreset, variant: AdaptiveLayoutVariant, aspectRatio = 0.82, background?: BackgroundLibraryItem) {
  const productWidth = Math.round(variant === "product-focused" ? 570 : variant === "content-focused" ? 390 : 475);
  const productHeight = Math.round(Math.min(730, productWidth / Math.max(0.48, aspectRatio)));
  const leftText = { x: 70, y: 88, width: 510, height: 250 };
  const rightText = { x: 620, y: 88, width: 510, height: 250 };
  let text: AdaptivePlacementBox = leftText;
  let body: AdaptivePlacementBox = { x: 74, y: 350, width: 480, height: 120 };
  let product: AdaptivePlacementBox = {
    x: 1200 - productWidth - 74,
    y: 1200 - productHeight - 74,
    width: productWidth,
    height: productHeight,
  };
  let price: AdaptivePlacementBox = { x: 72, y: 830, width: 470, height: 112 };
  let cta: AdaptivePlacementBox = { x: 72, y: 980, width: 310, height: 86 };

  if (["text-right-product-left", "fashion-lookbook"].includes(layout)) {
    text = rightText;
    body = { x: 626, y: 350, width: 480, height: 120 };
    product = { x: 70, y: 1200 - productHeight - 70, width: productWidth, height: productHeight };
    price = { x: 628, y: 830, width: 470, height: 112 };
    cta = { x: 818, y: 980, width: 310, height: 86 };
  } else if (["text-top-product-bottom", "ingredient-story"].includes(layout)) {
    text = { x: 92, y: 62, width: 1016, height: 220 };
    body = { x: 190, y: 285, width: 820, height: 96 };
    product = {
      x: (1200 - productWidth) / 2,
      y: 1200 - productHeight - 56,
      width: productWidth,
      height: productHeight,
    };
    price = { x: 72, y: 990, width: 250, height: 100 };
    cta = { x: 818, y: 1000, width: 310, height: 82 };
  } else if (layout === "text-bottom-product-top") {
    text = { x: 82, y: 820, width: 1036, height: 220 };
    body = { x: 190, y: 1040, width: 820, height: 90 };
    product = {
      x: (1200 - productWidth) / 2,
      y: 64,
      width: productWidth,
      height: productHeight,
    };
    price = { x: 66, y: 690, width: 240, height: 96 };
    cta = { x: 824, y: 692, width: 310, height: 82 };
  } else if (["centered-product-promotion", "price-focused"].includes(layout)) {
    text = { x: 70, y: 58, width: 1060, height: 150 };
    body = { x: 170, y: 220, width: 860, height: 92 };
    product = {
      x: (1200 - productWidth) / 2,
      y: 400,
      width: productWidth,
      height: Math.min(productHeight, 500),
    };
    price = { x: 72, y: 930, width: 650, height: 136 };
    cta = { x: 804, y: 970, width: 324, height: 90 };
  } else if (["lifestyle-caption", "people-scene", "editorial-overlay"].includes(layout)) {
    const textOnRight = (background?.textSafeArea || "top-left").includes("right");
    text = textOnRight ? { x: 642, y: 72, width: 488, height: 210 } : { x: 70, y: 72, width: 500, height: 210 };
    body = { ...text, y: 294, height: 86 };
    const gaze = background?.personGaze || "none";
    const productOnLeft = gaze === "left" || (gaze !== "right" && (background?.personPosition === "right" || textOnRight));
    const sceneProductHeight = Math.min(productHeight, 520);
    product = productOnLeft ? { x: 64, y: 1200 - sceneProductHeight - 62, width: productWidth, height: sceneProductHeight } : { x: 1200 - productWidth - 64, y: 1200 - sceneProductHeight - 62, width: productWidth, height: sceneProductHeight };
    price = { x: text.x, y: 430, width: 300, height: 78 };
    cta = { x: text.x, y: 524, width: 230, height: 74 };
  } else if (layout === "premium-minimal") {
    text = { x: 74, y: 112, width: 480, height: 250 };
    body = { x: 78, y: 382, width: 430, height: 106 };
    product = { x: 620, y: 170, width: productWidth, height: Math.min(730, productHeight) };
    price = { x: 76, y: 884, width: 360, height: 96 };
    cta = { x: 76, y: 1004, width: 250, height: 76 };
  } else if (layout === "product-grounded") {
    text = { x: 70, y: 76, width: 600, height: 240 };
    body = { x: 74, y: 330, width: 490, height: 110 };
    product = { x: 580, y: 1200 - productHeight - 44, width: productWidth, height: productHeight };
    price = { x: 72, y: 850, width: 390, height: 100 };
    cta = { x: 72, y: 976, width: 290, height: 84 };
  }

  return { text, body, product, price, cta };
}

function planPalette(background: BackgroundLibraryItem, palette: ExtractedPalette) {
  const darkBackground = background.brightness === "dark";
  const sample = darkBackground ? "#181818" : palette.backgroundColor;
  const initialText = darkBackground ? "#ffffff" : chooseTextColor(sample, "#151515", "#ffffff");
  const headline = ensureContrast(initialText, sample, 4.5);
  const body = ensureContrast(headline, sample, 4.5);
  const accent = ensureContrast(contrastRatio(palette.accentColor, sample) >= 3 ? palette.accentColor : palette.primaryColor, sample, 3.2);
  const ctaBackground = contrastRatio(accent, sample) >= 2.2 ? accent : mixColors(accent, headline, 0.28);
  return {
    headline,
    body,
    price: ensureContrast(darkBackground ? palette.highlightColor : palette.dangerColor, sample, 4.5),
    accent,
    ctaBackground,
    ctaText: chooseTextColor(ctaBackground),
    panel: darkBackground ? "#000000" : "#ffffff",
  };
}

function alignFor(layout: AutomaticLayoutPreset): "left" | "center" | "right" {
  if (["text-right-product-left", "fashion-lookbook"].includes(layout)) return "right";
  if (["text-top-product-bottom", "text-bottom-product-top", "centered-product-promotion", "price-focused", "ingredient-story"].includes(layout)) return "center";
  return "left";
}

function gradientDirection(layout: AutomaticLayoutPreset, background: BackgroundLibraryItem) {
  if (["text-right-product-left", "fashion-lookbook"].includes(layout)) return "right" as const;
  if (["text-top-product-bottom", "ingredient-story"].includes(layout)) return "top" as const;
  if (layout === "text-bottom-product-top") return "bottom" as const;
  if (["lifestyle-caption", "people-scene", "editorial-overlay"].includes(layout)) {
    if (background.textSafeArea.includes("left")) return "left" as const;
    if (background.textSafeArea.includes("right")) return "right" as const;
    if (background.textSafeArea.startsWith("bottom")) return "bottom" as const;
    return "top" as const;
  }
  return "left" as const;
}

function decorationFor(background: BackgroundLibraryItem, layout: AutomaticLayoutPreset): AdaptiveCreativePlan["decorationStyle"] {
  if (["price-focused", "centered-product-promotion"].includes(layout)) return "promotion";
  if (layout === "ingredient-story" || background.assetType === "ingredient_scene") return "ingredient";
  if (["fashion-lookbook", "editorial-overlay", "premium-minimal"].includes(layout)) return "editorial";
  if (["lifestyle-caption", "people-scene"].includes(layout)) return "minimal";
  return "none";
}

export function generateAdaptiveCreativePlans(context: LayoutContext): AdaptiveCreativePlan[] {
  const now = context.now || new Date().toISOString();
  const productId = context.product.landingUrl || context.product.productName || "product";
  const hookId = String(context.hookId || context.hookType);
  const palette = planPalette(context.background, context.palette);
  const layouts = layoutCandidates(context);
  return variants.map((variant, index) => {
    const layout = layouts[index] || layouts[0] || "split-panel";
    const boxes = boxesFor(layout, variant, context.productAspectRatio, context.background);
    const align = alignFor(layout);
    const complexBackground = context.background.contrast === "high" || context.background.includesPerson;
    const useTextPanel = complexBackground || ["lifestyle-caption", "people-scene", "editorial-overlay"].includes(layout);
    const groundY = context.background.groundArea?.y || Math.min(1120, boxes.product.y + boxes.product.height);
    const productComposition =
      context.productHasTransparency === false || variant === "product-focused"
        ? { mode: "single" as const, count: 1 as const, scaleStep: 0, overlapRatio: 0 }
        : variant === "copy-focused"
          ? {
              mode: "repeat-overlap" as const,
              count: 3 as const,
              scaleStep: 0.2,
              overlapRatio: 0.36,
            }
          : {
              mode: "scale-contrast" as const,
              count: 2 as const,
              scaleStep: 0.28,
              overlapRatio: 0.24,
            };
    return {
      id: `${context.background.id}-${variant}`,
      productId,
      hookId,
      backgroundId: context.background.id,
      backgroundSelectionMode: context.backgroundSelectionMode || "recommended",
      layoutType: layout,
      layoutVariant: variant,
      productPlacement: {
        ...boxes.product,
        scale: variant === "product-focused" ? 1.08 : variant === "content-focused" ? 0.9 : 1,
        rotation: 0,
        groundY,
      },
      productComposition,
      textPlacement: {
        ...boxes.text,
        align,
        fontSize: variant === "copy-focused" ? 76 : variant === "content-focused" ? 56 : 64,
        maxLines: 2,
        color: palette.headline,
      },
      bodyPlacement: {
        ...boxes.body,
        align,
        fontSize: variant === "content-focused" ? 30 : 34,
        maxLines: 3,
        color: palette.body,
      },
      pricePlacement: {
        ...boxes.price,
        align: layout === "price-focused" ? "left" : align,
        fontSize: layout === "price-focused" ? 72 : 50,
        maxLines: 1,
        color: palette.price,
        visible: Boolean(context.product.price),
      },
      ctaPlacement: {
        ...boxes.cta,
        align: "center",
        fontSize: 28,
        maxLines: 1,
        color: palette.ctaText,
        visible: Boolean(context.copy?.cta),
      },
      colorPalette: palette,
      contrastAdjustments: {
        useTextPanel,
        panelOpacity: useTextPanel ? (context.background.brightness === "dark" ? 0.38 : 0.68) : 0,
        gradientDirection: useTextPanel ? gradientDirection(layout, context.background) : "none",
        productSeparation: context.background.contrast === "high" ? 0.42 : 0.28,
      },
      backgroundAdjustments: {
        brightness: context.background.brightness === "dark" ? 0.94 : 1,
        blur: 0,
        scale: 1.04,
        offsetX: 0,
        offsetY: 0,
      },
      decorationStyle: decorationFor(context.background, layout),
      rationale: variant === "copy-focused" ? "안전 영역의 큰 후킹과 동일 상품 3개 겹침을 조합한 반복 강조형" : variant === "product-focused" ? "접지면과 대형 상품 비율을 우선한 단일 히어로형" : context.background.includesPerson ? `${context.background.personAction || "인물 행동"}을 가리지 않는 큰 상품+작은 상품 대비형` : "배경 장면과 큰 상품+작은 상품을 함께 보여주는 크기 대비형",
      createdAt: now,
      updatedAt: now,
    };
  });
}

export function updateAdaptiveCreativePlan(plan: AdaptiveCreativePlan, patch: Partial<AdaptiveCreativePlan>): AdaptiveCreativePlan {
  return { ...plan, ...patch, updatedAt: new Date().toISOString() };
}
