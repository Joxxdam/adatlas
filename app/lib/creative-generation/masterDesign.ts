import { getCreativeBlueprint } from "./blueprints.ts";
import { chooseTextColor, relativeLuminance } from "../mvp/colorUtils.ts";
import type {
  BrandProfile,
  CategoryProfile,
  CreativeBlueprintId,
  DynamicTextBox,
  MasterCreativeDirection,
  PlacementBox,
  ProductCompositionPlan,
  ProductTruth,
} from "./types.ts";
import { creativeBlueprintIds } from "./types.ts";

type MasterLayoutGeometry = {
  product: PlacementBox;
  headline: PlacementBox;
  body: PlacementBox;
  proof?: PlacementBox;
  offer?: PlacementBox;
  cta: PlacementBox;
};

const geometry: Record<CreativeBlueprintId, MasterLayoutGeometry> = {
  "problem-solution-split": {
    product: { x: 610, y: 190, width: 520, height: 790 },
    headline: { x: 64, y: 100, width: 500, height: 250 },
    body: { x: 64, y: 400, width: 500, height: 170 },
    offer: { x: 64, y: 850, width: 450, height: 110 },
    cta: { x: 64, y: 1030, width: 330, height: 82 },
  },
  "editorial-story": {
    product: { x: 655, y: 330, width: 470, height: 670 },
    headline: { x: 64, y: 75, width: 820, height: 225 },
    body: { x: 64, y: 350, width: 440, height: 150 },
    offer: { x: 64, y: 950, width: 520, height: 100 },
    cta: { x: 64, y: 1065, width: 330, height: 80 },
  },
  "chat-ugc": {
    product: { x: 90, y: 180, width: 500, height: 640 },
    headline: { x: 560, y: 170, width: 570, height: 185 },
    body: { x: 500, y: 400, width: 630, height: 185 },
    proof: { x: 420, y: 655, width: 710, height: 105 },
    offer: { x: 420, y: 790, width: 710, height: 105 },
    cta: { x: 790, y: 1060, width: 340, height: 82 },
  },
  "comparison-versus": {
    product: { x: 690, y: 230, width: 430, height: 650 },
    headline: { x: 64, y: 100, width: 540, height: 250 },
    body: { x: 64, y: 430, width: 520, height: 180 },
    proof: { x: 64, y: 720, width: 500, height: 100 },
    offer: { x: 64, y: 850, width: 500, height: 100 },
    cta: { x: 64, y: 1050, width: 340, height: 82 },
  },
  "product-hero-lifestyle": {
    product: { x: 580, y: 190, width: 570, height: 790 },
    headline: { x: 64, y: 105, width: 500, height: 250 },
    body: { x: 64, y: 425, width: 500, height: 185 },
    offer: { x: 64, y: 850, width: 480, height: 105 },
    cta: { x: 64, y: 1040, width: 340, height: 82 },
  },
  "proof-data": {
    product: { x: 710, y: 400, width: 420, height: 650 },
    headline: { x: 64, y: 80, width: 1030, height: 230 },
    body: { x: 64, y: 380, width: 570, height: 170 },
    proof: { x: 64, y: 620, width: 550, height: 110 },
    offer: { x: 64, y: 770, width: 550, height: 110 },
    cta: { x: 64, y: 1040, width: 340, height: 82 },
  },
};

function masterPalette(brand: BrandProfile, fallback: string[]) {
  const palette = [...brand.primaryColors, ...brand.secondaryColors, ...fallback].filter((color) =>
    /^#[0-9a-f]{6}$/i.test(color)
  );
  const background = [...palette].sort(
    (left, right) => relativeLuminance(left) - relativeLuminance(right)
  )[0] || "#101827";
  const accent =
    palette.find((color) => color !== background && relativeLuminance(color) >= 0.28) ||
    palette.find((color) => color !== background) ||
    "#08d8b6";
  return {
    background,
    foreground: chooseTextColor(background),
    accent,
    secondary: palette.find((color) => color !== background && color !== accent) || "#ffcf33",
  };
}

function slotConstraint(blueprintId: CreativeBlueprintId, slotId: string) {
  return getCreativeBlueprint(blueprintId).slots.find((slot) => slot.id === slotId);
}

function textBox(
  blueprintId: CreativeBlueprintId,
  slotId: "headline" | "body" | "proof" | "offer" | "cta",
  box: PlacementBox,
  defaults: {
    maxChars: number;
    maxLines: number;
    fontSize: number;
    minFontSize: number;
    padding: number;
    container: DynamicTextBox["container"];
    colorRole: DynamicTextBox["colorRole"];
    fillRole?: DynamicTextBox["fillRole"];
    align?: DynamicTextBox["align"];
  }
): DynamicTextBox {
  const constraint = slotConstraint(blueprintId, slotId);
  return {
    ...box,
    maxChars:
      slotId === "headline"
        ? 18
        : slotId === "body"
          ? 28
          : constraint?.maxChars || defaults.maxChars,
    maxLines:
      slotId === "headline" || slotId === "body"
        ? 2
        : constraint?.maxLines || defaults.maxLines,
    fontSize: defaults.fontSize,
    minFontSize:
      slotId === "headline"
        ? 48
        : slotId === "body"
          ? 28
          : Math.max(defaults.minFontSize, constraint?.minFontSize || defaults.minFontSize),
    lineHeight: slotId === "headline" ? 1.12 : 1.18,
    padding: defaults.padding,
    align: defaults.align || "left",
    container: defaults.container,
    colorRole: defaults.colorRole,
    fillRole: defaults.fillRole,
  };
}

function proofText(truth: ProductTruth) {
  const numericBenefit = truth.facts.find(
    (fact) =>
      /^(verified-benefit|ingredient)/.test(fact.key) && fact.numericTokens.length > 0
  );
  return numericBenefit?.value || "";
}

function hasReviewEvidence(truth: ProductTruth) {
  return Boolean(
    truth.product.reviewSources?.length ||
      truth.product.creativeContext?.reviewInsightSummaries?.length ||
      truth.facts.some((fact) => /^review/.test(fact.key))
  );
}

function hasComparisonEvidence(truth: ProductTruth) {
  return Boolean(
    (truth.product.originalPrice || truth.product.oldPrice) && truth.product.price
  );
}

function selectBlueprint(params: {
  truth: ProductTruth;
  brand: BrandProfile;
  category: CategoryProfile;
  excluded?: CreativeBlueprintId[];
}) {
  const { truth, brand, category } = params;
  const excluded = new Set(params.excluded || []);
  const transparent = Boolean(truth.confirmedProductImage?.transparent);
  const proof = proofText(truth);
  const scored = category.preferredBlueprints
    .filter((id) => !excluded.has(id))
    .map((id, categoryIndex) => {
      const blueprint = getCreativeBlueprint(id);
      const brandIndex = brand.preferredBlueprints.indexOf(id);
      let score = 100 - categoryIndex * 7 - (brandIndex < 0 ? 24 : brandIndex * 3);
      // Opaque packshots remain eligible for the layout, but their composition
      // safely falls back to one product instead of repeat/overlap treatment.
      if (blueprint.productComposition?.requiresTransparentProduct && !transparent) score -= 8;
      if (id === "proof-data" && !proof && !hasComparisonEvidence(truth)) score -= 100;
      if (id === "chat-ugc" && !hasReviewEvidence(truth)) score -= 65;
      if (id === "comparison-versus" && !hasComparisonEvidence(truth)) score -= 25;
      if (
        ["food-meat", "agriculture", "fashion"].includes(category.id) &&
        id === "editorial-story"
      )
        score += 32;
      if (
        ["personal-care", "household-goods"].includes(category.id) &&
        id === "problem-solution-split"
      )
        score += 32;
      if (category.id === "generic-commerce" && id === "product-hero-lifestyle") score += 34;
      if (!transparent && id === "product-hero-lifestyle") score += 18;
      return { id, score };
    })
    .sort((left, right) => right.score - left.score);
  return scored[0]?.id || "product-hero-lifestyle";
}

function productComposition(
  blueprintId: CreativeBlueprintId,
  truth: ProductTruth,
  productBox: PlacementBox
): ProductCompositionPlan {
  const requested = getCreativeBlueprint(blueprintId).productComposition;
  if (requested && (!requested.requiresTransparentProduct || truth.confirmedProductImage?.transparent)) {
    const original = getCreativeBlueprint(blueprintId).productBox;
    const scaleX = productBox.width / original.width;
    const scaleY = productBox.height / original.height;
    return {
      ...requested,
      instances: requested.instances.map((instance) => ({
        ...instance,
        x: Math.round(productBox.x + (instance.x - original.x) * scaleX),
        y: Math.round(productBox.y + (instance.y - original.y) * scaleY),
        width: Math.round(instance.width * scaleX),
        height: Math.round(instance.height * scaleY),
      })),
    };
  }
  return {
    mode: "single",
    requiresTransparentProduct: false,
    instances: [
      { ...productBox, role: "primary", fit: "contain", rotation: 0 },
    ],
  };
}

export function selectMasterCreativeDirection(params: {
  truth: ProductTruth;
  brand: BrandProfile;
  category: CategoryProfile;
  preserveMasterDesignId?: string;
  excludedMasterDesignIds?: CreativeBlueprintId[];
}): MasterCreativeDirection {
  const preserved = creativeBlueprintIds.find((blueprintId) =>
    params.preserveMasterDesignId?.includes(`-${blueprintId}-`)
  );
  const blueprintId =
    preserved ||
    selectBlueprint({
      truth: params.truth,
      brand: params.brand,
      category: params.category,
      excluded: params.excludedMasterDesignIds,
    });
  const layout = geometry[blueprintId];
  const colors = masterPalette(params.brand, params.category.fallbackColors);
  const proof = proofText(params.truth);
  const offer = [params.truth.product.discountInfo, params.truth.product.price]
    .filter(Boolean)
    .join(" · ");
  const productKind = params.truth.confirmedProductImage?.transparent ? "cutout" : "packshot";
  return {
    id: `master-${params.category.id}-${blueprintId}-${productKind}`,
    categoryProfileId: params.category.id,
    layoutFamily: blueprintId,
    backgroundAssetId: "pending",
    productComposition: productComposition(blueprintId, params.truth, layout.product),
    headlineBox: textBox(blueprintId, "headline", layout.headline, {
      maxChars: 18,
      maxLines: 2,
      fontSize: 62,
      minFontSize: 48,
      padding: 22,
      container: blueprintId === "chat-ugc" ? "panel" : "none",
      colorRole: blueprintId === "chat-ugc" ? "background" : "foreground",
      fillRole: blueprintId === "chat-ugc" ? "foreground" : undefined,
    }),
    subCopyBox: textBox(blueprintId, "body", layout.body, {
      maxChars: 28,
      maxLines: 2,
      fontSize: 34,
      minFontSize: 28,
      padding: 20,
      container: blueprintId === "chat-ugc" ? "panel" : "none",
      colorRole: blueprintId === "chat-ugc" ? "background" : "accent",
      fillRole: blueprintId === "chat-ugc" ? "secondary" : undefined,
    }),
    proofBox: layout.proof
      ? textBox(blueprintId, "proof", layout.proof, {
          maxChars: 24,
          maxLines: 2,
          fontSize: 34,
          minFontSize: 30,
          padding: 18,
          container: "panel",
          colorRole: "foreground",
          fillRole: "background",
        })
      : undefined,
    offerBox: layout.offer
      ? textBox(blueprintId, "offer", layout.offer, {
          maxChars: 26,
          maxLines: 2,
          fontSize: 36,
          minFontSize: 30,
          padding: 18,
          container: "panel",
          colorRole: "background",
          fillRole: "accent",
        })
      : undefined,
    logoBox:
      blueprintId === "problem-solution-split"
        ? { x: 430, y: 1030, width: 150, height: 82 }
        : getCreativeBlueprint(blueprintId).logoBox,
    ctaBox: textBox(blueprintId, "cta", layout.cta, {
      maxChars: 10,
      maxLines: 1,
      fontSize: 28,
      minFontSize: 26,
      padding: 18,
      container: "pill",
      colorRole: "background",
      fillRole: "accent",
      align: "center",
    }),
    palette: colors,
    typography: {
      fontFamily: "Noto Sans KR",
      headlineFontSize: 62,
      subCopyFontSize: 34,
      ctaFontSize: 28,
    },
    fixedFacts: {
      proof: proof || undefined,
      offer: offer || undefined,
      price: params.truth.product.price || undefined,
      promotion: params.truth.product.discountInfo || undefined,
      cta: "상품 보러가기",
    },
    selectionReasons: [
      `카테고리 ${params.category.label}의 선호 레이아웃 반영`,
      `상품 이미지 유형 ${productKind} 반영`,
      proof ? "검증된 수치 근거 슬롯 사용 가능" : "근거 없는 데이터 시각화 제외",
    ],
    locked: true,
  };
}

export function masterDesignGeometry(blueprintId: CreativeBlueprintId) {
  return geometry[blueprintId];
}
