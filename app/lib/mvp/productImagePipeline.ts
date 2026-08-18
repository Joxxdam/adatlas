import type {
  ProductExtractionScope,
  ProductRepresentation,
  ProductRepresentationType,
} from "./types";

export const PRODUCT_IMAGE_PIPELINE_VERSION = "sales-unit-v1";

export function productCutoutCacheDescriptor(input: {
  contentHash: string;
  provider: string;
  representationType?: ProductRepresentationType;
  extractionScope?: ProductExtractionScope;
  selectedObjectIds?: string[];
  cropBox?: { x: number; y: number; width: number; height: number };
  cleanupStrength?: string;
}) {
  return JSON.stringify({
    source: input.contentHash,
    type: input.representationType || "single-product",
    scope: input.extractionScope || "single-item",
    objects: [...(input.selectedObjectIds || [])].sort(),
    crop: input.cropBox || null,
    provider: input.provider,
    cleanup: input.cleanupStrength || "balanced",
    version: PRODUCT_IMAGE_PIPELINE_VERSION,
  });
}

type RepresentationInput = {
  productName?: string;
  description?: string;
  category?: string;
  optionText?: string;
  packageType?: string;
  imageType?: string;
  hasAlpha?: boolean;
};

const countPatterns = [
  /(\d{1,2})\s*\+\s*(\d{1,2})/,
  /(?:^|\s)(\d{1,2})\s*(?:개|팩|병|입|종|세트|묶음|구|롤|매)(?:\s|$)/i,
  /(\d{1,2})\s*[xX×]/,
  /[xX×]\s*(\d{1,2})/,
];

export function inferExpectedUnitCount(value: string) {
  const explicitUnitCounts = [...value.matchAll(/(\d{1,2})\s*(?:개|팩|병|입|종|묶음|구|롤|매)/gi)]
    .map((match) => Number(match[1]))
    .filter((count) => Number.isFinite(count) && count > 0);
  if (/\+/.test(value) && explicitUnitCounts.length >= 2) {
    return Math.min(50, explicitUnitCounts.reduce((sum, count) => sum + count, 0));
  }
  for (const pattern of countPatterns) {
    const match = value.match(pattern);
    if (!match) continue;
    if (match[2]) return Math.min(50, Number(match[1]) + Number(match[2]));
    const count = Number(match[1]);
    if (Number.isFinite(count) && count > 1) return Math.min(50, count);
  }
  return undefined;
}

function recommendationFor(type: ProductRepresentationType): ProductExtractionScope {
  if (type === "multi-unit-set" || type === "bundle-components") return "sales-unit";
  if (type === "packaged-product" || type === "product-package-group")
    return "product-and-package";
  if (type === "plated-product") return "food-and-plate";
  if (type === "already-transparent") return "visible-all";
  return "single-item";
}

export function inferProductRepresentation(input: RepresentationInput): ProductRepresentation {
  const text = [
    input.productName,
    input.description,
    input.category,
    input.optionText,
    input.packageType,
    input.imageType,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const expectedUnitCount = inferExpectedUnitCount(text);
  const signals: Array<{ type: ProductRepresentationType; score: number; reason: string }> = [];

  if (input.hasAlpha) {
    signals.push({
      type: "already-transparent",
      score: 0.98,
      reason: "원본 이미지에 정상 알파 채널이 확인됨",
    });
  }
  if (/세트|구성|묶음|골라담|\d+\s*종|\d+\s*개|\d+\s*팩|\d+\s*병|\d+\s*입|\d+\s*\+\s*\d+|bundle|set/.test(text)) {
    signals.push({
      type: /본품|구성품|액세서리|케이스|증정|사은품/.test(text)
        ? "bundle-components"
        : "multi-unit-set",
      score: expectedUnitCount ? 0.9 : 0.78,
      reason: expectedUnitCount
        ? `상품 정보에서 ${expectedUnitCount}개 판매 구성이 확인됨`
        : "상품 정보에서 세트 또는 묶음 구성이 확인됨",
    });
  }
  if (/진공|트레이|포장|파우치|박스|팩\b|vacuum|package|tray/.test(text)) {
    signals.push({
      type: /본품.*(?:박스|케이스)|(?:박스|케이스).*본품|패키지.*함께/.test(text)
        ? "product-package-group"
        : "packaged-product",
      score: 0.8,
      reason: "포장 또는 트레이가 판매 상태의 일부로 확인됨",
    });
  }
  if (/접시|그릇|플레이팅|한상|조리예|serving|plated/.test(text)) {
    signals.push({ type: "plated-product", score: 0.76, reason: "플레이팅된 식품 신호가 확인됨" });
  }
  if (/의류|셔츠|티셔츠|바지|원피스|가방|신발|패브릭|니트|후드|스커트|apparel|bag|shoes/.test(text)) {
    signals.push({
      type: "apparel-or-soft-product",
      score: 0.86,
      reason: "유연하거나 비정형 외곽선을 가진 패션 상품으로 확인됨",
    });
  }
  if (/유리|글라스|투명|아크릴|크리스탈|반사|메탈|스테인리스|glass|transparent|reflective/.test(text)) {
    signals.push({
      type: "transparent-or-reflective-product",
      score: 0.82,
      reason: "투명 또는 반사 소재 신호가 확인됨",
    });
  }
  if (
    /생고기|고기|등심|안심|갈비|한우|육류|꽃|화분|식물|과일|채소|사과|청사과|아오리|배|복숭아|자두|포도|수박|참외|딸기|감귤|한라봉|토마토|감자|고구마|옥수수|버섯|수산|회|원물|meat|fruit|apple|produce|flower|plant/.test(
      text
    )
  ) {
    signals.push({
      type: expectedUnitCount && expectedUnitCount > 1 ? "multi-unit-set" : "irregular-product",
      score: expectedUnitCount ? 0.88 : 0.8,
      reason: expectedUnitCount
        ? `비정형 상품 ${expectedUnitCount}개가 판매 단위일 가능성이 높음`
        : "고정된 외곽선이 없는 식품·식물 유형으로 확인됨",
    });
  }

  const winner = signals.sort((a, b) => b.score - a.score)[0] || {
    type: "single-product" as const,
    score: 0.68,
    reason: "세트·포장·플레이팅 신호가 없어 대표 상품 하나를 기본 판매 단위로 판단함",
  };
  const recommendedExtractionScope = recommendationFor(winner.type);
  return {
    type: winner.type,
    confidence: winner.score,
    reason: winner.reason,
    recommendedExtractionScope,
    selectedExtractionScope: recommendedExtractionScope,
    expectedUnitCount,
  };
}

export function normalizeProductImageUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    const removable = [
      "w",
      "h",
      "width",
      "height",
      "resize",
      "quality",
      "q",
      "thumb",
      "thumbnail",
    ];
    removable.forEach((key) => url.searchParams.delete(key));
    [...url.searchParams.keys()]
      .filter((key) => /^(?:utm_|fbclid|gclid)/i.test(key))
      .forEach((key) => url.searchParams.delete(key));
    url.searchParams.sort();
    return url.toString();
  } catch {
    return value.trim();
  }
}

export function hammingDistance(left = "", right = "") {
  if (!left || left.length !== right.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) distance += 1;
  }
  return distance;
}

export function extractionScopeLabel(scope: ProductExtractionScope) {
  return {
    "single-item": "대표 상품 하나",
    "visible-all": "보이는 상품 전체",
    "sales-unit": "판매 세트 전체",
    "product-and-package": "상품과 포장 함께",
    "food-only": "음식만",
    "food-and-plate": "음식과 접시 함께",
    "manual-region": "직접 영역 선택",
    original: "원본 이미지 그대로",
  }[scope];
}

export function representationTypeLabel(type: ProductRepresentationType) {
  return {
    "single-product": "단일 상품",
    "multi-unit-set": "다중 판매 세트",
    "irregular-product": "비정형 상품",
    "packaged-product": "포장 상품",
    "product-package-group": "상품+패키지",
    "bundle-components": "분리 구성품 세트",
    "plated-product": "플레이팅 상품",
    "apparel-or-soft-product": "의류·소프트 상품",
    "transparent-or-reflective-product": "투명·반사 상품",
    "already-transparent": "투명 배경 원본",
  }[type];
}
