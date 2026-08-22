import type { ProductInfoForPrompt, SourceImageCandidate } from "../mvp/types";
import type {
  CreativeImageAsset,
  CreativeImageRole,
  FactVerification,
  ProductFact,
  ProductEvidenceType,
  ProductTruth,
} from "./types";

export const PRODUCT_TRUTH_VERSION = "product-truth-v2-structured";

function compact(values: Array<string | undefined>) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

const titleNoisePattern = /(?:\[[^\]]{0,40}(?:특가|한정|무료배송|이벤트|증정|쿠폰)[^\]]*\]|[★☆◆◇♥♡●■▶▷✔✓🔥🚨]|(?:^|\s)(?:오늘만|지금만|초특가|한정판매|한정특가|무료배송|최저가|핫딜|소량입고|품절임박|단독특가)(?:\s|$))/giu;

export function cleanProductTitle(rawTitle: string, brandName = "") {
  let value = String(rawTitle || "")
    .normalize("NFKC")
    .replace(/<[^>]*>/g, " ")
    .replace(titleNoisePattern, " ")
    .replace(/(?:^|\s)\d+\s*\+\s*\d+(?:\s|$)/g, " ")
    .replace(/(?:^|\s)\d{1,3}\s*%\s*(?:할인|OFF)?(?:\s|$)/gi, " ")
    .replace(/(?:^|\s)\d[\d,.]*\s*원(?:\s|$)/g, " ")
    .replace(/\s*\(\d+\)\s*$/g, " ");
  if (brandName.trim()) {
    const escaped = brandName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    value = value.replace(new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`, "giu"), " ");
  }
  return value.replace(/\s+/g, " ").trim() || String(rawTitle || "").replace(/\s+/g, " ").trim();
}

function firstMatch(value: string, pattern: RegExp) {
  return String(value || "").match(pattern)?.[0]?.trim();
}

function isOriginLike(value: string) {
  return /(?:원산지|산지|국내산|국산|[가-힣]{2,12}산(?:\s|$))/u.test(String(value || ""));
}

function isPromotionLike(value: string) {
  return /(?:\d+\s*\+\s*\d+|\d{1,3}\s*%|할인|쿠폰|증정|특가|무료\s*배송|한정\s*판매)/iu.test(String(value || ""));
}

function normalizedProductTruth(product: ProductInfoForPrompt, rawTitle?: string) {
  const rawProductTitle = String(rawTitle || product.productName || "").replace(/\s+/g, " ").trim();
  const cleanProductName = cleanProductTitle(rawProductTitle, product.brandName || product.advertiserName || "");
  const description = [product.extractedDescription, product.mainBenefit, ...(product.verifiedBenefits || [])].filter(Boolean).join(" · ");
  const ingredientValues = compact(product.ingredients || []).filter((value) => !isOriginLike(value) && !isPromotionLike(value));
  const verifiedBenefits = compact([product.mainBenefit, ...(product.verifiedBenefits || [])]).filter((value) => !isPromotionLike(value));
  const quantity = firstMatch(`${rawProductTitle} ${description}`, /\d[\d,.]*\s*(?:ml|mL|l|L|g|kg|개|팩|병|박스|세트|종)/i);
  const composition = firstMatch(`${rawProductTitle} ${description}`, /(?:\d+\s*\+\s*\d+|\d+\s*(?:개|팩|병|종)\s*(?:구성|세트)|세트\s*구성)/i);
  const shipping = firstMatch(`${rawProductTitle} ${description}`, /(?:무료\s*배송|당일\s*출고|오늘\s*출발|새벽\s*배송)/i);
  const promotion = firstMatch(`${rawProductTitle} ${description}`, /(?:\d+\s*\+\s*\d+|\d{1,3}\s*%\s*할인|쿠폰|증정|한정\s*(?:특가|판매)|무료\s*배송)/i);
  const origin = firstMatch(`${description} ${(product.ingredients || []).join(" ")}`, /(?:원산지\s*[:：]?\s*)?(?:국내산|국산|[가-힣]{2,12}산)(?=\s|[,·/]|$)/u);
  const seasonOrEvent = firstMatch(`${rawProductTitle} ${description}`, /(?:봄|여름|가을|겨울|명절|설날|추석|크리스마스|신상품|시즌|\d{1,2}일\s*한정|한정\s*판매)/u);
  const packageOrOption = product.packageType || composition || firstMatch(`${rawProductTitle} ${description}`, /(?:파우치|튜브|병|팩|박스|세트|택\s*\d+|옵션\s*\d+)/u);
  const reviewEvidence = compact([
    ...(product.reviewSources || []).map((review) => review.keySentence || review.sourceContext),
    ...(product.creativeContext?.reviewInsightSummaries || []),
  ]).slice(0, 6);
  return {
    rawProductTitle,
    cleanProductName,
    brandName: String(product.brandName || product.advertiserName || "").trim(),
    category: String(product.category || "").trim(),
    price: product.price || undefined,
    originalPrice: product.originalPrice || product.oldPrice || undefined,
    discount: product.discountInfo || undefined,
    discountInfo: product.discountInfo || undefined,
    promotion,
    quantity,
    composition,
    shipping,
    origin,
    ingredients: ingredientValues,
    verifiedBenefits,
    seasonOrEvent,
    packageOrOption,
    uspCandidates: compact([...verifiedBenefits, ...ingredientValues]).slice(0, 8),
    reviewEvidence,
    targetCustomer: product.targetCustomer || undefined,
    target: product.targetCustomer || undefined,
    usageOccasions: compact([
      product.targetCustomer,
      ...(product.verifiedBenefits || []).filter((value) => /(?:때|후|전|매일|운동|출근|퇴근|외출|여행|식사|샤워)/u.test(value)),
    ]).slice(0, 5),
    useSituations: compact([
      product.targetCustomer,
      ...(product.verifiedBenefits || []).filter((value) => /(?:때|후|전|매일|운동|출근|퇴근|외출|여행|식사|샤워)/u.test(value)),
    ]).slice(0, 5),
  };
}

export function extractNumericTokens(value: string) {
  return Array.from(
    new Set(
      String(value || "")
        .match(/-?\d[\d,.]*(?:\s?(?:%|°c|℃|원|ml|mL|l|L|g|kg|개|팩|병|점|명|회|배))?/gi)
        ?.map((token) => token.replace(/\s+/g, "").toLowerCase()) || []
    )
  );
}

function stableId(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function imageAsset(params: {
  path: string | undefined;
  role: CreativeImageRole;
  source: CreativeImageAsset["source"];
  verified: boolean;
  reason: string;
  hasText?: boolean;
  transparent?: boolean;
  validationStatus?: CreativeImageAsset["validationStatus"];
  classificationSignals?: string[];
}): CreativeImageAsset | null {
  const imagePath = String(params.path || "").trim();
  if (!imagePath) return null;
  return {
    id: `image-${params.role}-${stableId(imagePath)}`,
    path: imagePath,
    role: params.role,
    source: params.source,
    verified: params.verified,
    reason: params.reason,
    hasText: params.hasText,
    transparent: params.transparent,
    validationStatus:
      params.validationStatus || (params.verified ? "confirmed" : "excluded"),
    classificationSignals: params.classificationSignals,
  };
}

const promotionalFilePattern = /(?:^|[-_/.])(banner|event|promotion|promo|sale|detail|review|advert?|coupon|campaign)(?:[-_/.]|$)/i;

function classifySourceImage(
  imagePath: string,
  candidate: SourceImageCandidate | undefined,
  fallback: CreativeImageRole,
  source: CreativeImageAsset["source"],
  allowFullFrameProductPhoto = false
) {
  const signals: string[] = [];
  const ratio = candidate?.width && candidate?.height
    ? Math.max(candidate.width / candidate.height, candidate.height / candidate.width)
    : 0;
  const filenameLooksPromotional = promotionalFilePattern.test(imagePath);
  const longDetail =
    ratio >= 3.2 ||
    (!allowFullFrameProductPhoto &&
      (candidate?.sourceType === "detail-content" || candidate?.type === "detail"));
  const mixedBanner = Boolean(
    candidate?.hasMultipleObjects && !candidate.multipleObjectsAreSalesUnit
  );
  if (filenameLooksPromotional) signals.push("광고·프로모션 파일명");
  if (longDetail) signals.push("상세페이지형 비율·출처");
  if (candidate?.hasText) signals.push("이미지 내 텍스트");
  if (mixedBanner) signals.push("판매 단위가 아닌 복수 객체");
  if (candidate?.warnings?.length) signals.push(...candidate.warnings.slice(0, 2));

  if (filenameLooksPromotional || longDetail || candidate?.hasText || mixedBanner) {
    return {
      role: "detail-image" as const,
      verified: false,
      validationStatus: "excluded" as const,
      reason: `${signals.join(" · ")} 신호가 확인되어 상품 합성에서 제외`,
      signals,
    };
  }

  const confirmedSource =
    source === "user-confirmed" ||
    source === "known-product" ||
    candidate?.alreadyTransparent ||
    candidate?.sourceType === "structured-data" ||
    candidate?.sourceType === "open-graph" ||
    candidate?.sourceType === "product-gallery" ||
    candidate?.type === "hero";
  if (!confirmedSource && source === "source-candidate") {
    return {
      role: fallback,
      verified: false,
      validationStatus: "needs-confirmation" as const,
      reason: "상품 단독 이미지인지 확정할 근거가 부족해 사용자 확인이 필요",
      signals: ["상품 중심 여부 불확실"],
    };
  }
  return {
    role: candidate?.alreadyTransparent ? ("product-cutout" as const) : fallback,
    verified: true,
    validationStatus: "confirmed" as const,
    reason: "상품 대표·갤러리 또는 사용자 확정 이미지",
    signals: candidate?.alreadyTransparent ? ["투명 배경"] : ["상품 이미지 출처 확인"],
  };
}

function uniqueImageAssets(values: Array<CreativeImageAsset | null>) {
  const seen = new Set<string>();
  return values.filter((asset): asset is CreativeImageAsset => {
    if (!asset) return false;
    const key = `${asset.role}|${asset.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildImageAssets(input: {
  product: ProductInfoForPrompt;
  productImagePaths?: string[];
  selectedAdImages?: string[];
  imageAssets?: CreativeImageAsset[];
}) {
  const product = input.product;
  const sourceCandidates = new Map(
    (product.sourceImageCandidates || []).map((candidate) => [candidate.imagePath, candidate])
  );
  const selectedReferences = new Set(
    (input.selectedAdImages || []).map((value) => String(value || "").trim()).filter(Boolean)
  );
  const candidateAsset = (
    imagePath: string | undefined,
    fallback: CreativeImageRole,
    source: CreativeImageAsset["source"],
    reason: string,
    verified = true
  ) => {
    const path = String(imagePath || "").trim();
    if (!path) return null;
    const candidate = sourceCandidates.get(path);
    const naturalProductPhoto = Boolean(
      candidate &&
      !candidate.alreadyTransparent &&
      !candidate.hasText &&
      /식품|농산|과일|채소|육류|수산/i.test(product.category || "") &&
      ["irregular-product", "plated-product"].includes(
        product.productRepresentation?.type || ""
      )
    );
    const classification = classifySourceImage(
      path,
      candidate,
      naturalProductPhoto ? "product-lifestyle" : fallback,
      source,
      naturalProductPhoto
    );
    return imageAsset({
      path,
      role: classification.role,
      source,
      verified: verified && classification.verified,
      validationStatus: classification.validationStatus,
      reason: classification.verified ? reason : classification.reason,
      hasText: candidate?.hasText,
      transparent: candidate?.alreadyTransparent,
      classificationSignals: classification.signals,
    });
  };
  // Explicit role assignments come from the product workbench or the known
  // product registry. selectedAdImages itself still creates reference-only
  // assets below and never promotes an image to a product role.
  const explicitAssets = (input.imageAssets || []).map((asset) => ({
    ...asset,
    validationStatus:
      asset.validationStatus ||
      (asset.verified && ["product-cutout", "product-packshot", "product-lifestyle"].includes(asset.role)
        ? "confirmed"
        : "excluded"),
  }));
  const requestedProductAssets = (input.productImagePaths || [])
    .filter((path) => !selectedReferences.has(String(path || "").trim()))
    .map((path) =>
      candidateAsset(path, "product-packshot", "user-confirmed", "사용자가 상품 이미지로 확정")
    );
  const productAssets = [
    ...explicitAssets,
    ...requestedProductAssets,
    ...(product.productImagePaths || []).filter((path) => !selectedReferences.has(path)).map((path) =>
      candidateAsset(path, "product-packshot", "product-page", "상품정보의 제품 이미지")
    ),
    selectedReferences.has(product.productImagePath)
      ? null
      : candidateAsset(
          product.productImagePath,
          product.productCutoutAvailable ? "product-cutout" : "product-packshot",
          "product-page",
          product.productCutoutAvailable ? "확정된 상품 누끼" : "상품정보의 대표 제품 이미지"
        ),
    selectedReferences.has(product.secondaryProductImagePath || "")
      ? null
      : candidateAsset(
          product.secondaryProductImagePath,
          "product-packshot",
          "product-page",
          "상품정보의 보조 제품 이미지"
        ),
    selectedReferences.has(product.selectedSourceImagePath || "")
      ? null
      : candidateAsset(
          product.selectedSourceImagePath,
          "product-packshot",
          "source-candidate",
          "상품 이미지 작업대에서 선택된 제품 이미지"
        ),
    selectedReferences.has(product.extractedMainImage || "")
      ? null
      : candidateAsset(
          product.extractedMainImage,
          "product-packshot",
          "product-page",
          "상세페이지의 대표 제품 이미지"
        ),
    ...(product.extractedGalleryImages || []).map((path) =>
      imageAsset({
        path,
        role: "detail-image",
        source: "product-page",
        verified: false,
        validationStatus: "excluded",
        reason: "상세 갤러리 이미지는 문구·배너 포함 가능성이 있어 합성 후보에서 제외",
      })
    ),
  ];
  const referenceAssets = (input.selectedAdImages || []).map((path) =>
    imageAsset({
      path,
      role: "ad-reference",
      source: "selected-reference",
      verified: true,
      validationStatus: "excluded",
      reason: "레이아웃·색감·정보 위계 참고 전용이며 상품 합성에는 사용하지 않음",
      hasText: sourceCandidates.get(path)?.hasText,
    })
  );
  const all = uniqueImageAssets([...productAssets, ...referenceAssets]);
  const compositableRoles = new Set<CreativeImageRole>([
    "product-cutout",
    "product-packshot",
    "product-lifestyle",
  ]);
  const compositable = all.filter(
    (asset) =>
      asset.verified &&
      asset.validationStatus !== "needs-confirmation" &&
      compositableRoles.has(asset.role)
  );
  compositable.sort((left, right) => {
    const score = (asset: CreativeImageAsset) =>
      (asset.role === "product-cutout" ? 300 : asset.role === "product-packshot" ? 200 : 100) +
      (asset.source === "known-product" ? 80 : asset.source === "user-confirmed" ? 60 : 0);
    return score(right) - score(left);
  });
  return {
    imageAssets: all,
    referenceImages: all.filter((asset) => asset.role === "ad-reference"),
    productImages: compositable,
  };
}

function fact(
  key: string,
  label: string,
  value: string | undefined,
  verification: FactVerification,
  source: ProductFact["source"],
  sourceUrl?: string
): ProductFact | null {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  const evidenceType: ProductEvidenceType = key.startsWith("review")
    ? "review"
    : key.startsWith("ingredient")
      ? "ingredient"
      : key === "origin"
        ? "origin"
          : key === "quantity"
          ? "quantity"
          : key === "package-option"
            ? /(?:\d+\s*(?:개|팩|병|세트|종)|세트\s*구성|묶음|택\s*\d+|옵션|포함)/iu.test(normalized)
              ? "composition"
              : "other"
            : key === "season-event"
              ? "usage"
      : key === "price" || key === "original-price"
        ? "price"
        : key === "discount" || key.includes("promotion")
          ? "offer"
          : key === "target"
            ? "target"
            : key === "product-name" || key === "brand-name" || key === "category"
              ? "identity"
              : key.includes("benefit") || key.includes("usp")
                ? "usp"
                : extractNumericTokens(normalized).length
                  ? "numeric"
                  : "other";
  const specificity = Math.min(
    100,
    30 +
      Math.min(30, normalized.length) +
      (extractNumericTokens(normalized).length ? 25 : 0) +
      (evidenceType === "identity" ? -20 : 10)
  );
  const strength = Math.max(
    10,
    Math.min(
      100,
      (verification === "verified" || verification === "source-backed" ? 55 : 38) +
        (evidenceType === "usp" || evidenceType === "review" || evidenceType === "offer" ? 20 : 5) +
        (extractNumericTokens(normalized).length ? 15 : 0)
    )
  );
  return {
    id: `fact-${key}-${stableId(normalized)}`,
    key,
    label,
    value: normalized,
    verification,
    source,
    sourceUrl,
    usableInCopy: verification !== "unverified",
    numericTokens: extractNumericTokens(normalized),
    strength,
    specificity,
    evidenceType,
  };
}

function freeTextClaims(product: ProductInfoForPrompt) {
  return compact([
    product.mainBenefit,
    ...(product.verifiedBenefits || []),
    ...(product.ingredients || [])
      .filter((ingredient) => !isOriginLike(ingredient) && !isPromotionLike(ingredient))
      .map((ingredient) => `${ingredient} 함유`),
  ]);
}

export function buildProductTruth(input: {
  product: ProductInfoForPrompt;
  rawProductTitle?: string;
  productImagePaths?: string[];
  selectedAdImages?: string[];
  imageAssets?: CreativeImageAsset[];
  source?: "landing-page" | "user-input";
}): ProductTruth {
  const product = input.product;
  const normalizedTruth = normalizedProductTruth(product, input.rawProductTitle);
  const contentNotes = product.creativeContext?.appliedContentNotes || [];
  const landingSource = input.source === "landing-page" && Boolean(product.landingUrl);
  const verification: FactVerification = landingSource ? "source-backed" : "user-provided";
  const source: ProductFact["source"] = landingSource ? "landing-page" : "user-input";
  const candidates = [
    fact("product-name", "상품명", product.productName, verification, source, product.landingUrl),
    fact("brand-name", "브랜드", product.brandName || product.advertiserName, verification, source, product.landingUrl),
    fact("category", "카테고리", product.category, verification, source, product.landingUrl),
    fact("price", "판매가", product.price, verification, source, product.landingUrl),
    fact(
      "original-price",
      "기존가",
      product.originalPrice || product.oldPrice,
      verification,
      source,
      product.landingUrl
    ),
    fact("discount", "할인 정보", product.discountInfo, verification, source, product.landingUrl),
    fact("main-benefit", "핵심 혜택", product.mainBenefit, verification, source, product.landingUrl),
    fact("target", "추천 대상", product.targetCustomer, verification, source, product.landingUrl),
    ...(product.verifiedBenefits || []).map((benefit, index) =>
      fact(`verified-benefit-${index + 1}`, "상세페이지 혜택", benefit, verification, source, product.landingUrl)
    ),
    ...normalizedTruth.ingredients.map((ingredient, index) =>
      fact(`ingredient-${index + 1}`, "성분", ingredient, verification, source, product.landingUrl)
    ),
    fact("origin", "원산지", normalizedTruth.origin, verification, source, product.landingUrl),
    fact("quantity", "판매 단위", normalizedTruth.quantity, verification, source, product.landingUrl),
    fact("package-option", "패키지·옵션", normalizedTruth.packageOrOption, verification, source, product.landingUrl),
    fact("season-event", "시즌·이벤트", normalizedTruth.seasonOrEvent, verification, source, product.landingUrl),
    ...(product.reviewSources || [])
      .map((review) => review.keySentence || review.sourceContext || "")
      .filter(Boolean)
      .map((review, index) =>
        fact(`review-${index + 1}`, "확인된 후기", review, verification, source, product.landingUrl)
      ),
    ...(product.creativeContext?.reviewInsightSummaries || []).map((review, index) =>
      fact(`review-insight-${index + 1}`, "후기 인사이트", review, verification, source, product.landingUrl)
    ),
    ...contentNotes
      .filter((note) => !note.prohibited && ["PRODUCT_USP", "REVIEW_INSIGHT", "TARGET_AUDIENCE", "PROMOTION"].includes(note.type))
      .map((note, index) =>
        fact(
          note.type === "REVIEW_INSIGHT"
            ? `review-note-${index + 1}`
            : `content-note-${note.type.toLowerCase()}-${index + 1}`,
          note.title || note.type,
          note.content,
          "user-provided",
          "user-input"
        )
      ),
  ].filter((item): item is ProductFact => Boolean(item));
  const claims = freeTextClaims(product);
  const unverifiedClaims = claims.filter(
    (claim) => !landingSource && extractNumericTokens(claim).length > 0
  );
  const verifiedClaims = claims.filter((claim) => !unverifiedClaims.includes(claim));
  const allowedNumericTokens = compact(
    candidates
      .filter((item) => item.usableInCopy && !unverifiedClaims.includes(item.value))
      .flatMap((item) => item.numericTokens)
  );
  const images = buildImageAssets(input);
  const imagePaths = images.productImages.map((asset) => asset.path);
  const coreEvidence = candidates
    .filter((item) => item.usableInCopy)
    .map((item) => ({
      factId: item.id,
      summary: `${item.label}: ${item.value}`,
      strength: item.strength || 0,
      specificity: item.specificity || 0,
      evidenceType: item.evidenceType || "other" as const,
    }))
    .sort((left, right) => {
      const identityPenalty = (value: ProductEvidenceType) => value === "identity" ? 35 : 0;
      return (
        right.strength + right.specificity - identityPenalty(right.evidenceType) -
        (left.strength + left.specificity - identityPenalty(left.evidenceType))
      );
    })
    .slice(0, 5);
  const required = [product.productName, product.category, product.price, product.mainBenefit, imagePaths[0]];
  const completeness = Math.round((required.filter(Boolean).length / required.length) * 100);
  return {
    productId: product.creativeContext?.productId || `product-${stableId(product.landingUrl || product.productName)}`,
    product,
    normalized: normalizedTruth,
    facts: candidates,
    verifiedClaims,
    unverifiedClaims,
    allowedNumericTokens,
    blockedClaimPatterns: [
      "판매량",
      "매출",
      "재고",
      "마진",
      "roas",
      "회원 수",
      "구매 수",
      "의학적으로",
      "100% 효과",
      ...contentNotes
        .filter((note) => (note.prohibited && note.type !== "AVOIDED_HOOK") || note.type === "PROHIBITED_EXPRESSION")
        .map((note) => note.content),
      ...unverifiedClaims,
    ],
    imageAssets: images.imageAssets,
    referenceImages: images.referenceImages,
    imagePaths,
    confirmedProductImage: images.productImages[0],
    coreEvidence,
    needsConfirmationImages: images.imageAssets.filter(
      (asset) => asset.validationStatus === "needs-confirmation"
    ),
    completeness,
    createdAt: new Date().toISOString(),
  };
}

export function validateCopyAgainstTruth(copy: string, truth: ProductTruth) {
  const numericTokens = extractNumericTokens(copy);
  const unauthorizedNumericTokens = numericTokens.filter(
    (token) => !truth.allowedNumericTokens.includes(token)
  );
  const lowerCopy = copy.toLowerCase();
  const blockedClaims = truth.blockedClaimPatterns.filter(
    (pattern) => pattern && lowerCopy.includes(pattern.toLowerCase())
  );
  return {
    valid: unauthorizedNumericTokens.length === 0 && blockedClaims.length === 0,
    numericTokens,
    unauthorizedNumericTokens,
    blockedClaims,
  };
}
