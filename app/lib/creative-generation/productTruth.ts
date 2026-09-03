import type { ProductInfoForPrompt, SourceImageCandidate } from "../mvp/types";
import { isDifferentProductImage } from "../mvp/productImageIdentity.ts";
import type { CreativeImageAsset, CreativeImageRole, FactVerification, ProductFact, ProductEvidenceType, ProductTruth } from "./types";
import { isAmbiguousMerchantCredentialCreativeSignal, isDomesticOriginCreativeSignal, isIncompleteOcrCopyFragment, isMalformedProductSignal, isMeatProductContext, isMerchantCredentialCreativeSignal, isNonDomesticOriginCreativeSignal, isOriginCreativeSignal, isPackageLabelOcrCopyNoise, isPriceOnlyCreativeSignal, isProhibitedAdCopySignal, isPromotionalProductSignal, isShippingCreativeSignal, isVagueStandaloneSensoryClaim, removeOriginCreativePhrases } from "./productSignalHygiene.ts";

export const PRODUCT_TRUTH_VERSION = "product-truth-v11-brandless-copy-and-clean-title";

function compact(values: Array<string | undefined>) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

const titleNoisePattern = /(?:\[[^\]]{0,80}(?:특가|한정|무료배송|이벤트|증정|쿠폰|사전예약|추석|명절|최저가|\d[\d,.]*\s*원)[^\]]*\]|\*[^*]{0,40}(?:특가|한정|무료배송|이벤트|증정|쿠폰|사전예약|추석|명절|맞이|최저가)[^*]*\*|★[^★]{0,25}(?:특가|한정|팩|도매|예약|최저가)[^★]*★|💥[^💥]{0,25}(?:특가|한정|도매|예약|최저가)[^💥]*💥|[★☆◆◇♥♡●■▶▷✔✓🔥🚨💥]|(?:^|\s)(?:오늘만|지금만|초특가|추석특가|추석사전예약|추석맞이(?:특가)?|명절맞이(?:특가)?|한정판매|한정특가|무료배송|(?:전국\s*)?최저가(?:\s*도전)?|하루\s*\d[\d,.]*\s*개\s*한정|핫딜|소량입고|품절임박|단독특가|긴급특가|MD추천|역대급|괴물용량|왕도매가격|도매가격|파격특가|당일생산)(?=[!?,.~\s-]|$))/giu;

export function cleanProductTitle(rawTitle: string, brandName = "") {
  let value = String(rawTitle || "")
    .normalize("NFKC")
    .replace(/<[^>]*>/g, " ")
    // 상품명 뒤에 붙은 운영·제작 메모는 판매 상품의 정체성이 아니다.
    // 이 꼬리말을 먼저 제거해야 하이픈 뒤의 `당일생산`을 상품명 본체로
    // 오인해 다운로드 파일명과 광고 문구에 사용하는 일을 막을 수 있다.
    .replace(/\s*[-–—]\s*당일\s*(?:생산|제작)(?:\s*\([^)]*\))?\s*$/giu, " ")
    .replace(titleNoisePattern, " ")
    // 상세페이지 SEO 제목에서 상품 앞에 붙는 캠페인형 수식어다. 숙성 방식은
    // 아래 titleBackedClaims에서 별도 사실로 보존하고 상품명에서는 분리한다.
    .replace(/^\s*(?:\d+\s*일\s*)?(?:(?:추석|설날?|명절)\s*맞이\s*)?(?:웻\s*에이징\s*)?숙성한\s*(?:(?:미친\s*맛|왕\s*도매\s*가격)\s*)?[-:–—!]?\s*/iu, " ")
    .replace(/[★☆*✅⚡💥]+/gu, " ")
    .replace(/^\s*(?:(?:첫\s*출시|신규\s*출시|출시\s*기념|입점\s*기념|런칭\s*기념|오픈\s*기념|신상품)\s*[-:–—·/]?\s*)+/giu, " ")
    .replace(/\s*[&＆]\s*/g, " · ")
    .replace(/(?:오르기\s*전\s*가격에|가격\s*오르기\s*전|추석\s*사전\s*예약\s*가능|후기\s*1등|왕\s*도매\s*가격|파격\s*특가|당일\s*생산)/giu, " ")
    // SEO 상품명 앞에 붙은 출시·입점 캠페인 토큰은 상품 정체성이 아니다.
    // 하이픈에 붙어 있어도 광고 문구로 흘러가지 않도록 정규화 단계에서 제거한다.
    .replace(/^(?:(?:첫\s*출시|신규\s*출시|출시\s*기념|입점\s*기념|런칭\s*기념|오픈\s*기념|신상품)\s*[-:–—·/]?\s*)+/giu, " ")
    .replace(/\([^)]*(?:실속\s*도매팩|사전\s*예약|후기\s*1등|선별\s*숙성|당일\s*생산)[^)]*\)/giu, " ")
    .replace(/(?:지방\s*손질\s*[·&＆/+]?\s*로스\s*제거|대한\s*선별|\d+중\s*선별한?|하이\s*마블\s*특|실속\s*도매팩|선별\s*상품|왕\s*도매\s*가격|프리미엄)/giu, " ")
    .replace(/(?:^|\s)(?:재구매|최고의\s*간식|인기\s*간식|추천\s*상품|대용량|괴물\s*용량)(?=\s|$)/giu, " ")
    .replace(/(?:^|\s)\d[\d,.]*\s*원(?:\s|$)/g, " ")
    .replace(/\s*[!?,]+\s*/g, " ")
    .replace(/(?:^|\s)-(?=\s|$)/g, " ")
    .replace(/(?:^|\s)\d+\s*\+\s*\d+(?:\s|$)/g, " ")
    .replace(/(?:^|\s)\d{1,3}\s*%\s*(?:할인|OFF)?(?:\s|$)/gi, " ")
    .replace(/(?:^|\s)\d[\d,.]*\s*원(?:\s|$)/g, " ")
    .replace(/\s*\(\d+\)\s*$/g, " ");
  if (brandName.trim()) {
    const escaped = brandName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    value = value.replace(new RegExp(escaped, "giu"), " ");
  }
  value = value
    // 판매자가 브랜드 필드를 분리하지 못한 경우에도 `탑브랜드한우`처럼
    // 카테고리명 앞에 붙은 브랜드성 토큰만 제거하고 `한우`는 보존한다.
    .replace(/(?:^|[\s\-:–—])[^\s/]{1,20}?브랜드(?=(?:한우|소고기|쇠고기|돼지고기|육우|화장품|건강기능식품|영양제))/giu, " ")
    // 같은 부위를 SEO용 슬래시로 반복한 표현은 한 번만 남긴다.
    .replace(/(^|\s)([^\s/]{2,20})\s*\/\s*\2(?=\s|$)/giu, "$1$2");
  if (/웻\s*에이징/iu.test(value)) value = value.replace(/숙성한(?=\s|$)/giu, " ");
  return (
    value.replace(/^\s*[-:–—]+|[-:–—]+\s*$/gu, " ").replace(/\s+/g, " ").trim() ||
    String(rawTitle || "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function comparableSignal(value: string | undefined) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase();
}

export function isPlausibleTargetCustomer(value: string | undefined, comparisons: Array<string | undefined> = []) {
  const target = String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!target || target.length > 72 || isProhibitedAdCopySignal(target)) return false;
  if (/(?:특가|할인|쿠폰|가격|오르기\s*전|쏩니다|판매|당일\s*생산|무료\s*배송|[★☆✅]|!!)/iu.test(target)) return false;
  if (!/(?:고객|분들?|사람|가정|가족|부모|아이|직장인|주부|학생|캠핑|여행|선물|혼밥|자취|식사|저녁|아침|명절\s*준비)/u.test(target)) return false;
  const signature = comparableSignal(target);
  if (comparisons.some((candidate) => {
    const other = comparableSignal(candidate);
    return other && (signature === other || signature.includes(other) || other.includes(signature));
  })) return false;
  return true;
}

function titleBackedClaims(rawTitle: string) {
  const value = String(rawTitle || "").normalize("NFKC");
  const claims: string[] = [];
  if (/지방\s*손질\s*(?:[&＆·/+]|및)?\s*로스\s*제거/iu.test(value)) {
    claims.push("지방을 손질하고 로스를 제거한 구성");
  } else if (/지방\s*손질/iu.test(value)) {
    claims.push("지방을 손질한 구성");
  } else if (/로스\s*제거/iu.test(value)) {
    claims.push("로스를 제거한 구성");
  }
  if (/감칠맛\s*비법\s*숙성/iu.test(value)) claims.push("감칠맛을 살린 비법 숙성");
  if (/웻\s*에이징/iu.test(value)) claims.push("웻에이징 숙성");
  const selection = value.match(/(\d+)중\s*선별/iu)?.[1];
  if (selection) claims.push(`${selection}중 선별`);
  if (/하이\s*마블/iu.test(value)) claims.push("하이마블 구성");
  const pack = value.match(/(\d[\d,.]*\s*(?:g|kg|ml|l))\s*[x×]\s*(\d+)\s*팩/iu);
  const composition = pack ? `${pack[1].replace(/\s+/g, "")} × ${pack[2]}팩` : undefined;
  return { claims, composition };
}

function firstMatch(value: string, pattern: RegExp) {
  return String(value || "")
    .match(pattern)?.[0]
    ?.trim();
}

function isOriginLike(value: string) {
  return /(?:원산지|산지|국내산|국산|호주산|미국산|뉴질랜드산|캐나다산|제주산)(?:\s|$|[:：,·/])/u.test(`${String(value || "")} `);
}

export function isPromotionLike(value: string) {
  return isPriceOnlyCreativeSignal(value) || isPromotionalProductSignal(value) || /(?:\d+\s*\+\s*\d+|할인|쿠폰|증정|특가|무료\s*배송|한정\s*판매|도매\s*(?:원가|가격|가)|소값\s*(?:가격)?|가격\s*오르기\s*전|오르기\s*전|파격|쏩니다|빠른\s*구매)/iu.test(String(value || ""));
}

function normalizedProductTruth(product: ProductInfoForPrompt, rawTitle?: string) {
  const rawProductTitle = String(rawTitle || product.productName || "")
    .replace(/\s+/g, " ")
    .trim();
  // rawProductTitle은 구성·프로모션 근거 추출에만 보존한다. 이미 한 번 정제된
  // productName이 있으면 광고에서 보이는 상품 정체성은 그 값을 우선한다.
  const cleanedTitle = cleanProductTitle(product.productName || rawProductTitle, product.brandName || product.advertiserName || "");
  const cleanProductName = isMeatProductContext(product) ? cleanedTitle : removeOriginCreativePhrases(cleanedTitle);
  const description = [product.extractedDescription, product.mainBenefit, ...(product.verifiedBenefits || [])].filter((value): value is string => Boolean(value) && !isProhibitedAdCopySignal(value)).join(" · ");
  const ingredientValues = compact(product.ingredients || []).filter((value) => !isOriginLike(value) && !isPromotionLike(value) && !isMalformedProductSignal(value) && !isProhibitedAdCopySignal(value));
  const verifiedBenefits = compact([product.mainBenefit, ...(product.verifiedBenefits || [])]).filter((value) => !isPromotionLike(value) && !isPriceOnlyCreativeSignal(value) && !isMalformedProductSignal(value) && !isProhibitedAdCopySignal(value) && !isOriginLike(value) && !isNonDomesticOriginCreativeSignal(value));
  const quantity = firstMatch(`${rawProductTitle} ${description}`, /\d[\d,.]*\s*(?:ml|mL|l|L|g|kg)/i);
  const salesUnit = firstMatch(`${cleanProductName} ${description}`, /(?:\d[\d,.]*\s*(?:봉지|개입|개|팩|병|박스|세트|종)|\d+\s*[~-]\s*\d+\s*인분)(?!\s*(?:구성|세트))/i);
  const backedByTitle = titleBackedClaims(rawProductTitle);
  const composition = backedByTitle.composition || firstMatch(`${rawProductTitle} ${description}`, /(?:\d+\s*\+\s*\d+|\d+\s*(?:개|팩|병|종)\s*(?:구성|세트)|세트\s*구성)/i);
  const shipping = firstMatch(`${rawProductTitle} ${description}`, /(?:무료\s*배송|당일\s*출고|오늘\s*출발|새벽\s*배송)/i);
  const promotion = firstMatch(`${rawProductTitle} ${description}`, /(?:\d+\s*\+\s*\d+|\d{1,3}\s*%\s*할인|쿠폰|증정|한정\s*(?:특가|판매))/i);
  const advertisingDiscountInfo = isShippingCreativeSignal(product.discountInfo) ? undefined : product.discountInfo;
  const origin = firstMatch(`${rawProductTitle} ${description} ${(product.ingredients || []).join(" ")}`, /(?:원산지\s*[:：]?\s*[가-힣]{2,12}산|국내산|국산|호주산|미국산|뉴질랜드산|캐나다산|제주산)(?=\s|[,·/]|$)/u);
  const seasonOrEvent = firstMatch(`${rawProductTitle} ${description}`, /(?:봄|여름|가을|겨울|명절|설날|추석|크리스마스|신상품|시즌|\d{1,2}일\s*한정|한정\s*판매)/u);
  const packageOrOption = product.packageType || composition || firstMatch(`${cleanProductName} ${description}`, /(?:파우치|튜브|병|팩|박스|세트|택\s*\d+|옵션\s*\d+)/u);
  const promotionalTokens = compact(rawProductTitle.match(/(?:오늘만|지금만|초특가|한정판매|한정특가|무료배송|최저가|핫딜|소량입고|품절임박|단독특가|긴급특가|MD추천|역대급|괴물용량|반란|\d{1,3}\s*%\s*(?:할인|OFF)?|\d+\s*\+\s*\d+)/giu) || []);
  const offerTokens = compact([product.price, product.originalPrice || product.oldPrice, advertisingDiscountInfo, promotion]);
  const selectionTokens = compact(rawProductTitle.match(/(?:택\s*\d+|옵션\s*\d+|골라\s*담기|선택\s*구성|\d+종\s*선택)/giu) || []);
  const volumeTokens = compact([quantity, salesUnit, composition]);
  const titleDescriptor = firstMatch(cleanProductName, /(?:바삭달콤|쫀득달콤|쫄깃달달|상큼한|달콤한|고소한|쫄깃한|부드러운|촉촉한|산뜻한|시원한|진한|담백한|매콤한)/u);
  const removablePackageToken = packageOrOption && /(?:\d|택\s*\d+|옵션\s*\d+|구성|×|x)/iu.test(packageOrOption) ? packageOrOption : undefined;
  const removableTitleTokens = [quantity, salesUnit, composition, removablePackageToken, titleDescriptor, ...promotionalTokens]
    .filter((token): token is string => Boolean(token));
  const baseProductName = removableTitleTokens
    .reduce<string>((value, token) => value.replace(token, " "), cleanProductName.replace(/\(\s*\d[\d,.]*\s*(?:g|kg|ml|l)\s*[x×]\s*\d+\s*팩\s*\)/giu, " "))
    .replace(/(?:^|\s)(?:국내산|국산|부드러운|고급|선별)(?=\s|$)/gu, " ")
    .replace(/(?:^|\s)(?:박스|팩)(?=\s|$)/gu, " ")
    .replace(/(?:^|\s)(?:건강\s*간식|간편식|인기\s*간식|추천\s*상품|최고의\s*간식|재구매|대용량|괴물\s*용량)(?:\s|$)/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const verifiedDescriptor = titleDescriptor || verifiedBenefits[0] || ingredientValues[0] || undefined;
  const safeTargetCustomer = isPlausibleTargetCustomer(product.targetCustomer, [product.mainBenefit, ...verifiedBenefits]) ? product.targetCustomer : undefined;
  const reviewEvidence = compact([...(product.reviewSources || []).map((review) => review.keySentence || review.sourceContext), ...(product.creativeContext?.reviewInsightSummaries || [])]).filter((value) => !isProhibitedAdCopySignal(value)).slice(0, 6);
  return {
    rawProductTitle,
    cleanProductName,
    baseProductName: baseProductName || cleanProductName,
    baseName: baseProductName || cleanProductName,
    verifiedDescriptor,
    descriptor: verifiedDescriptor || baseProductName || cleanProductName,
    salesUnit: salesUnit || composition || quantity,
    promotionalTokens,
    offerTokens,
    selectionTokens,
    volumeTokens,
    promotionTokens: promotionalTokens,
    brandName: String(product.brandName || product.advertiserName || "").trim(),
    category: String(product.category || "").trim(),
    price: product.price || undefined,
    originalPrice: product.originalPrice || product.oldPrice || undefined,
    discount: advertisingDiscountInfo || undefined,
    discountInfo: advertisingDiscountInfo || undefined,
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
    targetCustomer: safeTargetCustomer,
    target: safeTargetCustomer,
    usageOccasions: compact([safeTargetCustomer, ...verifiedBenefits.filter((value) => /(?:때|후|전|매일|운동|출근|퇴근|외출|여행|식사|샤워)/u.test(value))]).slice(0, 5),
    useSituations: compact([safeTargetCustomer, ...verifiedBenefits.filter((value) => /(?:때|후|전|매일|운동|출근|퇴근|외출|여행|식사|샤워)/u.test(value))]).slice(0, 5),
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

function imageAsset(params: { path: string | undefined; role: CreativeImageRole; source: CreativeImageAsset["source"]; verified: boolean; reason: string; width?: number; height?: number; hasText?: boolean; transparent?: boolean; validationStatus?: CreativeImageAsset["validationStatus"]; classificationSignals?: string[]; productFocusRatio?: number }): CreativeImageAsset | null {
  const imagePath = String(params.path || "").trim();
  if (!imagePath) return null;
  return {
    id: `image-${params.role}-${stableId(imagePath)}`,
    path: imagePath,
    role: params.role,
    source: params.source,
    verified: params.verified,
    reason: params.reason,
    width: params.width,
    height: params.height,
    hasText: params.hasText,
    transparent: params.transparent,
    validationStatus: params.validationStatus || (params.verified ? "confirmed" : "excluded"),
    classificationSignals: params.classificationSignals,
    productFocusRatio: params.productFocusRatio,
  };
}

const promotionalFilePattern = /(?:^|[-_/.])(banner|event|promotion|promo|sale|detail|review|advert?|coupon|campaign)(?:[-_/.]|$)/i;

function classifySourceImage(imagePath: string, candidate: SourceImageCandidate | undefined, fallback: CreativeImageRole, source: CreativeImageAsset["source"], allowFullFrameProductPhoto = false) {
  const signals: string[] = [];
  const ratio = candidate?.width && candidate?.height ? Math.max(candidate.width / candidate.height, candidate.height / candidate.width) : 0;
  const filenameLooksPromotional = promotionalFilePattern.test(imagePath);
  const longDetail = ratio >= 3.2 || (!allowFullFrameProductPhoto && (candidate?.sourceType === "detail-content" || candidate?.type === "detail"));
  const mixedBanner = Boolean(candidate?.hasMultipleObjects && !candidate.multipleObjectsAreSalesUnit);
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

  const confirmedSource = source === "user-confirmed" || source === "known-product" || candidate?.sourceType === "structured-data" || candidate?.sourceType === "open-graph";
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

function buildImageAssets(input: { product: ProductInfoForPrompt; productImagePaths?: string[]; selectedAdImages?: string[]; imageAssets?: CreativeImageAsset[] }) {
  const product = input.product;
  const belongsToCurrentProduct = (path: string | undefined) => !isDifferentProductImage(product.landingUrl, path);
  const sourceCandidates = new Map((product.sourceImageCandidates || []).filter((candidate) => belongsToCurrentProduct(candidate.imagePath)).map((candidate) => [candidate.imagePath, candidate]));
  const selectedReferences = new Set((input.selectedAdImages || []).map((value) => String(value || "").trim()).filter(Boolean));
  const confirmedProductPaths = new Set((product.confirmedProductImagePaths || []).map((value) => String(value || "").trim()).filter((value) => Boolean(value) && belongsToCurrentProduct(value)));
  const candidateAsset = (imagePath: string | undefined, fallback: CreativeImageRole, source: CreativeImageAsset["source"], reason: string, verified = true) => {
    const path = String(imagePath || "").trim();
    if (!path || !belongsToCurrentProduct(path)) return null;
    const candidate = sourceCandidates.get(path);
    const naturalProductPhoto = Boolean(candidate && !candidate.alreadyTransparent && !candidate.hasText && /식품|농산|과일|채소|육류|수산/i.test(product.category || "") && ["irregular-product", "plated-product"].includes(product.productRepresentation?.type || ""));
    const classification = classifySourceImage(path, candidate, naturalProductPhoto ? "product-lifestyle" : fallback, source, naturalProductPhoto);
    const finalVerified = verified && classification.verified;
    return imageAsset({
      path,
      role: classification.role,
      source,
      verified: finalVerified,
      validationStatus: finalVerified ? classification.validationStatus : classification.validationStatus === "excluded" ? "excluded" : "needs-confirmation",
      reason: finalVerified ? reason : classification.validationStatus === "excluded" ? classification.reason : "자동 수집 갤러리라 상품 이미지로 확정되지 않음",
      width: candidate?.width,
      height: candidate?.height,
      hasText: candidate?.hasText,
      transparent: candidate?.alreadyTransparent,
      classificationSignals: classification.signals,
      productFocusRatio: candidate?.salesUnitMatchScore,
    });
  };
  // Explicit role assignments come from the product workbench or the known
  // product registry. selectedAdImages itself still creates reference-only
  // assets below and never promotes an image to a product role.
  const explicitAssets = (input.imageAssets || [])
    .filter((asset) => asset.role === "ad-reference" || belongsToCurrentProduct(asset.path))
    .map((asset) => ({
      ...asset,
      validationStatus: asset.validationStatus || (asset.verified && ["product-cutout", "product-packshot", "product-lifestyle"].includes(asset.role) ? "confirmed" : "excluded"),
    }));
  const requestedProductAssets = (input.productImagePaths || []).filter((path) => !selectedReferences.has(String(path || "").trim())).map((path) => candidateAsset(path, "product-packshot", "user-confirmed", "사용자가 상품 이미지로 확정"));
  const productAssets = [
    ...explicitAssets,
    ...requestedProductAssets,
    ...(product.confirmedProductImagePaths || []).filter((path) => !selectedReferences.has(path)).map((path) => candidateAsset(path, "product-packshot", "product-page", "대표 이미지 또는 JSON-LD에서 확인한 현재 상품 이미지")),
    ...(product.productImagePaths || []).filter((path) => !selectedReferences.has(path) && !confirmedProductPaths.has(path)).map((path) => candidateAsset(path, "product-packshot", "product-page", "자동 수집 상품 이미지 후보", false)),
    selectedReferences.has(product.productImagePath) || confirmedProductPaths.has(product.productImagePath) ? null : candidateAsset(product.productImagePath, product.productCutoutAvailable ? "product-cutout" : "product-packshot", "product-page", product.productCutoutAvailable ? "상품 누끼 후보" : "상품정보의 대표 제품 이미지 후보", false),
    selectedReferences.has(product.secondaryProductImagePath || "") || confirmedProductPaths.has(product.secondaryProductImagePath || "") ? null : candidateAsset(product.secondaryProductImagePath, "product-packshot", "product-page", "자동 수집 보조 제품 이미지", false),
    selectedReferences.has(product.selectedSourceImagePath || "") || confirmedProductPaths.has(product.selectedSourceImagePath || "") ? null : candidateAsset(product.selectedSourceImagePath, "product-packshot", "source-candidate", "자동 분석에서 선택된 제품 이미지 후보", false),
    selectedReferences.has(product.extractedMainImage || "") || confirmedProductPaths.has(product.extractedMainImage || "") ? null : candidateAsset(product.extractedMainImage, "product-packshot", "product-page", "상세페이지의 대표 제품 이미지 후보", false),
    ...(product.extractedGalleryImages || []).filter(belongsToCurrentProduct).map((path) =>
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
  const compositableRoles = new Set<CreativeImageRole>(["product-cutout", "product-packshot", "product-lifestyle"]);
  const compositable = all.filter((asset) => asset.verified && asset.validationStatus !== "needs-confirmation" && compositableRoles.has(asset.role));
  compositable.sort((left, right) => {
    const score = (asset: CreativeImageAsset) => (asset.role === "product-cutout" ? 300 : asset.role === "product-packshot" ? 200 : 100) + (asset.source === "known-product" ? 80 : asset.source === "user-confirmed" ? 60 : 0);
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
  sourceUrl?: string,
  overrides: Partial<Pick<ProductFact, "copyEligibility" | "evidenceType" | "sourceDocument" | "sourceSheet" | "sourceCells">> = {}
): ProductFact | null {
  const normalized = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  const inferredEvidenceType: ProductEvidenceType = key.startsWith("review") ? "review" : key.startsWith("ingredient") ? "ingredient" : key === "origin" ? "origin" : key === "quantity" ? "quantity" : key === "package-option" ? (/(?:\d+\s*(?:개|팩|병|세트|종)|세트\s*구성|묶음|택\s*\d+|옵션|포함)/iu.test(normalized) ? "composition" : "other") : key === "season-event" ? "usage" : key === "price" || key === "original-price" ? "price" : key === "discount" || key.includes("promotion") ? "offer" : key === "target" ? "target" : key === "product-name" || key === "brand-name" || key === "category" ? "identity" : key.includes("benefit") || key.includes("usp") ? "usp" : extractNumericTokens(normalized).length ? "numeric" : "other";
  const merchantCredential = isMerchantCredentialCreativeSignal(normalized);
  const ambiguousMerchantCredential = isAmbiguousMerchantCredentialCreativeSignal(normalized);
  const resolvedEvidenceType: ProductEvidenceType = merchantCredential ? "merchant-proof" : overrides.evidenceType || inferredEvidenceType;
  const specificity = Math.min(100, 30 + Math.min(30, normalized.length) + (extractNumericTokens(normalized).length ? 25 : 0) + (resolvedEvidenceType === "identity" ? -20 : resolvedEvidenceType === "merchant-proof" ? -10 : 10));
  const strength = Math.max(10, Math.min(100, (verification === "verified" || verification === "source-backed" ? 55 : 38) + (resolvedEvidenceType === "usp" || resolvedEvidenceType === "review" || resolvedEvidenceType === "offer" ? 20 : resolvedEvidenceType === "merchant-proof" ? -10 : 5) + (extractNumericTokens(normalized).length ? 15 : 0)));
  const originAllowedInCopy = resolvedEvidenceType !== "origin" || isDomesticOriginCreativeSignal(normalized);
  const copyEligibility: NonNullable<ProductFact["copyEligibility"]> =
    ambiguousMerchantCredential || !originAllowedInCopy
      ? "blocked"
      :
    verification === "unverified"
      ? "blocked"
      : isVagueStandaloneSensoryClaim(normalized)
        ? "proofOnly"
      : resolvedEvidenceType === "price" || resolvedEvidenceType === "offer"
        ? "offerOnly"
        : resolvedEvidenceType === "identity"
          ? "identityOnly"
          : resolvedEvidenceType === "merchant-proof" || resolvedEvidenceType === "review" || resolvedEvidenceType === "origin" || resolvedEvidenceType === "composition" || resolvedEvidenceType === "quantity" || resolvedEvidenceType === "numeric"
            ? "proofOnly"
            : "headlineEligible";
  return {
    id: `fact-${key}-${stableId(normalized)}`,
    key,
    label,
    value: normalized,
    verification,
    source,
    sourceUrl,
    usableInCopy: verification !== "unverified" && originAllowedInCopy && !ambiguousMerchantCredential,
    numericTokens: extractNumericTokens(normalized),
    strength,
    specificity,
    evidenceType: resolvedEvidenceType,
    copyEligibility: ambiguousMerchantCredential || !originAllowedInCopy ? "blocked" : merchantCredential ? "proofOnly" : overrides.copyEligibility || copyEligibility,
    sourceDocument: overrides.sourceDocument,
    sourceSheet: overrides.sourceSheet,
    sourceCells: overrides.sourceCells,
  };
}

function vendorResearchEvidenceType(kind: string): ProductEvidenceType {
  if (kind === "origin") return "origin";
  // 시칠리아 레몬·히말라야 민트처럼 원료의 희소성과 향을 설명하는 산지 서사는
  // 일반 원산지 표기와 분리한다. 비육류 원산지 차단 정책은 유지하면서도
  // 업체가 제공한 원료 스토리를 ingredient 근거로 사용할 수 있게 한다.
  if (kind === "ingredient-provenance") return "ingredient";
  if (kind === "vendor-narrative") return "usp";
  if (kind === "usage") return "usage";
  if (kind === "target") return "target";
  if (kind === "certification") return "certification";
  if (kind === "ingredient-proof") return "ingredient";
  if (kind === "numeric-proof") return "numeric";
  if (kind === "sensory" || kind === "texture" || kind === "process") return "usp";
  return "other";
}

function detailOcrFactPolicy(value: string): { evidenceType: ProductEvidenceType; copyEligibility: NonNullable<ProductFact["copyEligibility"]> } {
  if (isMerchantCredentialCreativeSignal(value)) return { evidenceType: "merchant-proof", copyEligibility: "proofOnly" };
  if (/(?:판매가|정가|기존가|할인가|가격|특가|할인|\d[\d,.]*\s*원)/iu.test(value)) return { evidenceType: "offer", copyEligibility: "offerOnly" };
  if (/(?:국내산|국산|원산지|산지)/iu.test(value)) return { evidenceType: "origin", copyEligibility: "proofOnly" };
  if (/(?:원재료|원료|성분|함량|함유)/iu.test(value)) return { evidenceType: "ingredient", copyEligibility: "proofOnly" };
  if (/(?:\d[\d,.]*\s*(?:kg|g|ml|l|개|팩|봉|병|박스)|구성|중량|용량|개입)/iu.test(value)) return { evidenceType: "quantity", copyEligibility: "proofOnly" };
  if (/(?:섭취|조리|활용|곁들|함께\s*먹|간식|식사|다과|선물|캠핑)/iu.test(value)) return { evidenceType: "usage", copyEligibility: "headlineEligible" };
  return { evidenceType: "usp", copyEligibility: "headlineEligible" };
}

function freeTextClaims(product: ProductInfoForPrompt) {
  return compact([product.mainBenefit, ...(product.verifiedBenefits || []), ...(product.ingredients || []).filter((ingredient) => !isOriginLike(ingredient) && !isPromotionLike(ingredient)).map((ingredient) => `${ingredient} 함유`)])
    .filter((value) => !isPromotionLike(value) && !isMalformedProductSignal(value) && !isProhibitedAdCopySignal(value) && !isNonDomesticOriginCreativeSignal(value))
    .filter((value) => isMeatProductContext(product) || !isOriginCreativeSignal(value));
}

export function buildProductTruth(input: { product: ProductInfoForPrompt; rawProductTitle?: string; productImagePaths?: string[]; selectedAdImages?: string[]; imageAssets?: CreativeImageAsset[]; source?: "landing-page" | "user-input" }): ProductTruth {
  const product = input.product;
  const originCopyAllowed = isMeatProductContext(product);
  const normalizedTruth = normalizedProductTruth(product, input.rawProductTitle);
  const contentNotes = product.creativeContext?.appliedContentNotes || [];
  const landingSource = input.source === "landing-page" && Boolean(product.landingUrl);
  const verification: FactVerification = landingSource ? "source-backed" : "user-provided";
  const source: ProductFact["source"] = landingSource ? "landing-page" : "user-input";
  const titleClaims = titleBackedClaims(normalizedTruth.rawProductTitle);
  const vendorFacts = (product.vendorResearch?.facts || [])
    .filter((item) => item.copyEligibility !== "blocked" && item.copyEligibility !== "researchOnly" && !isProhibitedAdCopySignal(item.value))
    .map((item) =>
      fact(`vendor-${item.id}`, item.label, item.value, "user-provided", "vendor-research", undefined, {
        copyEligibility: item.copyEligibility === "headlineEligible" ? "headlineEligible" : "proofOnly",
        evidenceType: vendorResearchEvidenceType(item.kind),
        sourceDocument: product.vendorResearch?.sourceDocument,
        sourceSheet: item.sourceSheet,
        sourceCells: item.sourceCells,
      })
    )
    .filter((item): item is ProductFact => Boolean(item));
  const detailOcrFacts = (product.detailImageOcrInsights || [])
    .flatMap((insight) => insight.copyFacts.map((value) => ({ insight, value })))
    // 과거 캐시에 이미 copyFacts로 저장된 패키지 라벨도 ProductTruth 진입
    // 경계에서 한 번 더 차단해 수동·자동 신규 작업에 동일하게 적용합니다.
    .filter(({ value }) => !isPackageLabelOcrCopyNoise(value) && !isMalformedProductSignal(value) && !isIncompleteOcrCopyFragment(value) && !isAmbiguousMerchantCredentialCreativeSignal(value) && !isProhibitedAdCopySignal(value) && !isNonDomesticOriginCreativeSignal(value))
    .map(({ insight, value }, index) => {
      const policy = detailOcrFactPolicy(value);
      return fact(`detail-ocr-${index + 1}`, "상세 이미지에서 확인된 상품 사실", value, "source-backed", "landing-page", insight.imageUrl, policy);
    })
    .filter((item): item is ProductFact => Boolean(item));
  const candidateFacts = [
    ...vendorFacts,
    ...detailOcrFacts,
    fact("base-product-name", "정제 상품명", normalizedTruth.baseProductName || normalizedTruth.cleanProductName, verification, source, product.landingUrl),
    fact("verified-descriptor", "확인된 상품 표현", normalizedTruth.verifiedDescriptor, verification, source, product.landingUrl),
    // 브랜드는 상품 동일성·후처리 로고 선택에만 보존한다. 기본 광고 문구에는
    // 절대 사용하지 않으므로 ProductTruth 단계에서 copyEligibility를 차단한다.
    fact("brand-name", "브랜드", product.brandName || product.advertiserName, verification, source, product.landingUrl, {
      copyEligibility: "blocked",
      evidenceType: "identity",
    }),
    fact("category", "카테고리", product.category, verification, source, product.landingUrl),
    fact("price", "판매가", product.price, verification, source, product.landingUrl),
    fact("original-price", "기존가", product.originalPrice || product.oldPrice, verification, source, product.landingUrl),
    fact("discount", "할인 정보", normalizedTruth.discountInfo, verification, source, product.landingUrl),
    fact("main-benefit", "핵심 혜택", normalizedTruth.verifiedBenefits[0], verification, source, product.landingUrl),
    fact("target", "추천 대상", normalizedTruth.targetCustomer, verification, source, product.landingUrl),
    ...titleClaims.claims.map((claim, index) => fact(`title-benefit-${index + 1}`, "상품명에서 확인된 특징", claim, verification, source, product.landingUrl)),
    fact("title-composition", "상품명에서 확인된 구성", titleClaims.composition, verification, source, product.landingUrl),
    ...normalizedTruth.verifiedBenefits
      .filter((benefit) => comparableSignal(benefit) !== comparableSignal(normalizedTruth.verifiedBenefits[0]))
      .map((benefit, index) => fact(`verified-benefit-${index + 1}`, "상세페이지 혜택", benefit, verification, source, product.landingUrl)),
    ...normalizedTruth.ingredients.map((ingredient, index) => fact(`ingredient-${index + 1}`, "성분", ingredient, verification, source, product.landingUrl)),
    fact("origin", "원산지", normalizedTruth.origin, verification, source, product.landingUrl),
    fact("quantity", "판매 단위", normalizedTruth.quantity, verification, source, product.landingUrl),
    fact("package-option", "패키지·옵션", normalizedTruth.packageOrOption, verification, source, product.landingUrl),
    fact("season-event", "시즌·이벤트", normalizedTruth.seasonOrEvent, verification, source, product.landingUrl),
    ...(product.reviewSources || [])
      .map((review) => review.keySentence || review.sourceContext || "")
      .filter((review) => Boolean(review) && !isProhibitedAdCopySignal(review))
      .map((review, index) => fact(`review-${index + 1}`, "확인된 후기", review, verification, source, product.landingUrl)),
    ...(product.creativeContext?.reviewInsightSummaries || []).filter((review) => !isProhibitedAdCopySignal(review)).map((review, index) => fact(`review-insight-${index + 1}`, "후기 인사이트", review, verification, source, product.landingUrl)),
    ...contentNotes.filter((note) => !note.prohibited && !isProhibitedAdCopySignal(note.content) && ["PRODUCT_USP", "REVIEW_INSIGHT", "TARGET_AUDIENCE", "PROMOTION"].includes(note.type)).map((note, index) => fact(note.type === "REVIEW_INSIGHT" ? `review-note-${index + 1}` : `content-note-${note.type.toLowerCase()}-${index + 1}`, note.title || note.type, note.content, "user-provided", "user-input")),
  ]
    .filter((item): item is ProductFact => Boolean(item))
    .map((item) => {
      const originSignal = item.evidenceType === "origin" || isOriginCreativeSignal(item.value);
      if (!originSignal) return item;
      if (!originCopyAllowed || isNonDomesticOriginCreativeSignal(item.value)) {
        return { ...item, evidenceType: "origin" as const, usableInCopy: false, copyEligibility: "blocked" as const };
      }
      return { ...item, evidenceType: "origin" as const, copyEligibility: "proofOnly" as const };
    });
  const seenFactValues = new Set<string>();
  const candidates = candidateFacts.filter((item) => {
    if (item.evidenceType === "shipping" || isMalformedProductSignal(item.value) || isIncompleteOcrCopyFragment(item.value) || isProhibitedAdCopySignal(item.value)) return false;
    const key = comparableSignal(item.value);
    if (!key || seenFactValues.has(key)) return false;
    seenFactValues.add(key);
    return true;
  });
  const claims = freeTextClaims(product);
  const unverifiedClaims = claims.filter((claim) => !landingSource && extractNumericTokens(claim).length > 0);
  const verifiedClaims = claims.filter((claim) => !unverifiedClaims.includes(claim));
  const allowedNumericTokens = compact(candidates.filter((item) => item.usableInCopy && !unverifiedClaims.includes(item.value)).flatMap((item) => item.numericTokens));
  const images = buildImageAssets(input);
  const imagePaths = images.productImages.map((asset) => asset.path);
  const coreEvidence = candidates
    .filter((item) => item.usableInCopy && item.evidenceType !== "merchant-proof")
    .map((item) => ({
      factId: item.id,
      summary: `${item.label}: ${item.value}`,
      strength: item.strength || 0,
      specificity: item.specificity || 0,
      evidenceType: item.evidenceType || ("other" as const),
    }))
    .sort((left, right) => {
      const scopePenalty = (value: ProductEvidenceType) => value === "identity" ? 35 : value === "merchant-proof" ? 55 : 0;
      return right.strength + right.specificity - scopePenalty(right.evidenceType) - (left.strength + left.specificity - scopePenalty(left.evidenceType));
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
    blockedClaimPatterns: ["판매량", "매출", "재고", "마진", "roas", "회원 수", "구매 수", "의학적으로", "100% 효과", ...(product.vendorResearch?.blockedClaims || []), ...contentNotes.filter((note) => (note.prohibited && note.type !== "AVOIDED_HOOK") || note.type === "PROHIBITED_EXPRESSION").map((note) => note.content), ...unverifiedClaims],
    productCopyConstraints: compact(product.productCopyConstraints || []),
    imageAssets: images.imageAssets,
    referenceImages: images.referenceImages,
    imagePaths,
    confirmedProductImage: images.productImages[0],
    coreEvidence,
    needsConfirmationImages: images.imageAssets.filter((asset) => asset.validationStatus === "needs-confirmation"),
    completeness,
    createdAt: new Date().toISOString(),
  };
}

export function validateCopyAgainstTruth(copy: string, truth: ProductTruth) {
  // 레퍼런스의 `1. 2. 3.` 같은 목록 순번은 상품 수치 주장이 아니다.
  const copyWithoutListOrdinals = String(copy || "").replace(/(^|\n)\s*\d{1,2}\s*[.)]\s*/g, "$1");
  const numericTokens = extractNumericTokens(copyWithoutListOrdinals);
  const unauthorizedNumericTokens = numericTokens.filter((token) => !truth.allowedNumericTokens.includes(token));
  const lowerCopy = copy.toLowerCase();
  const blockedClaims = truth.blockedClaimPatterns.filter((pattern) => pattern && lowerCopy.includes(pattern.toLowerCase()));
  const shippingCopyDetected = isShippingCreativeSignal(copy);
  const nonDomesticOriginDetected = isNonDomesticOriginCreativeSignal(copy);
  const originCopyDetected = isOriginCreativeSignal(copy);
  const disallowedOriginDetected = originCopyDetected && (!isMeatProductContext(truth.product) || nonDomesticOriginDetected);
  const prohibitedAdCopyDetected = isProhibitedAdCopySignal(copy);
  const packageLabelOcrNoiseDetected = isPackageLabelOcrCopyNoise(copy);
  const malformedProductSignalDetected = isMalformedProductSignal(copy);
  return {
    valid: unauthorizedNumericTokens.length === 0 && blockedClaims.length === 0 && !shippingCopyDetected && !disallowedOriginDetected && !prohibitedAdCopyDetected && !packageLabelOcrNoiseDetected && !malformedProductSignalDetected,
    numericTokens,
    unauthorizedNumericTokens,
    blockedClaims,
    shippingCopyDetected,
    nonDomesticOriginDetected,
    originCopyDetected,
    disallowedOriginDetected,
    prohibitedAdCopyDetected,
    packageLabelOcrNoiseDetected,
    malformedProductSignalDetected,
  };
}
