import type { ProductReferenceImage, ProductReferenceProfile, ProductTruth } from "./types.ts";

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function unique(values: Array<string | undefined>) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function firstFact(truth: ProductTruth, pattern: RegExp) {
  return truth.facts.find((fact) => pattern.test(`${fact.key} ${fact.label}`) && fact.usableInCopy)?.value;
}

function token(value: string, pattern: RegExp) {
  return String(value || "")
    .match(pattern)?.[0]
    ?.replace(/\s+/g, " ")
    .trim();
}

function identityRules(truth: ProductTruth) {
  const value = `${truth.product.category} ${truth.product.detectedProductType || ""}`.toLowerCase();
  if (/패션|의류|원피스|상의|하의|신발|가방|fashion/.test(value)) {
    return {
      preserve: ["상품 종류와 실루엣", "실제 색상과 패턴", "소매·넥라인·포켓·버튼 등 확인 가능한 디테일"],
      forbid: ["다른 색상 옵션", "새 패턴", "다른 핏과 길이", "확인되지 않은 장식"],
      silhouette: "실제 착용 또는 상품 사진의 외곽 실루엣",
      proportions: "원본의 핏·길이·소매 비율",
      texture: "원본 사진에서 확인되는 원단과 표면감",
    };
  }
  if (/육류|한우|고기|수산|생선|해산물|농산|과일|채소/.test(value)) {
    return {
      preserve: ["실제 품목·부위·품종", "생물·조리 상태", "색감과 표면 질감", "판매 수량과 포장 구성"],
      forbid: ["다른 부위·품종", "생물과 조리 상태 변경", "확인되지 않은 원산지·등급", "새 포장과 라벨"],
      silhouette: "원본의 품목·부위·품종 형태",
      proportions: "실제 판매 구성과 크기 관계",
      texture: "원본의 결·지방·껍질·단면 또는 신선도 질감",
    };
  }
  if (/가구|리빙|소파|테이블|의자|침대/.test(value)) {
    return {
      preserve: ["전체 구조", "실제 소재와 컬러", "다리·손잡이·버튼 등 주요 부품", "구성품"],
      forbid: ["다른 구조의 가구", "확인되지 않은 부품", "오해를 만드는 크기 비례"],
      silhouette: "원본의 전체 가구·리빙 구조",
      proportions: "원본의 가로·세로·높이 비율",
      texture: "원본에서 확인되는 소재 표면",
    };
  }
  if (/전자|기기|가전|디바이스|device/.test(value)) {
    return {
      preserve: ["외형과 베젤", "버튼·포트 위치", "실제 색상", "구성품"],
      forbid: ["새 버튼·포트", "다른 화면 비율", "확인되지 않은 액세서리"],
      silhouette: "실제 기기 외형",
      proportions: "원본 화면·베젤·본체 비율",
      texture: "원본의 금속·유리·플라스틱 표면",
    };
  }
  return {
    preserve: ["제품 또는 용기의 실루엣", "대표 색상", "라벨·로고의 위치", "용량·수량과 구성"],
    forbid: ["새 상품명·라벨·인증마크", "다른 용기와 뚜껑", "다른 색상 옵션", "확인되지 않은 구성품"],
    silhouette: "대표 정면 이미지의 제품·패키지 외곽선",
    proportions: "원본의 높이·폭·뚜껑 또는 포장 비율",
    texture: "원본에서 확인되는 용기·포장·내용물 표면",
  };
}

export function buildProductReferenceProfile(truth: ProductTruth, referenceImages: ProductReferenceImage[]): ProductReferenceProfile {
  const product = truth.product;
  const identity = identityRules(truth);
  const productText = [product.productName, product.extractedDescription, ...truth.verifiedClaims].filter(Boolean).join(" ");
  const quantity = token(productText, /\d[\d,.]*\s*(?:kg|g|ml|mL|L|개|팩|병|매|입|세트)\b/i);
  const volume = token(productText, /\d[\d,.]*\s*(?:ml|mL|L)\b/);
  const count = token(productText, /\d[\d,.]*\s*(?:개|팩|병|매|입)\b/);
  // `original-price` must not be mistaken for `origin`.
  const origin = firstFact(truth, /^(?:origin|source-origin)(?:\s|$)|원산지|산지/);
  const optionName = firstFact(truth, /option|옵션/);
  const material = firstFact(truth, /^(?:material|fabric)(?:\s|$)|소재|원단|재질/);
  const pattern = firstFact(truth, /^(?:pattern|print)(?:\s|$)|패턴|무늬/);
  const includedItems = truth.facts.filter((fact) => /구성|세트|included|composition/.test(`${fact.key} ${fact.label}`) && fact.usableInCopy).map((fact) => fact.value);
  const usable = referenceImages.filter((image) => image.usableForGeneration && !image.duplicateOf);
  const identityReferences = usable.filter((image) => ["primary-product", "front-package", "product-detail", "worn", "cooked"].includes(image.role));
  const referenceSufficiency = usable.length >= 4 && identityReferences.length >= 2 ? "high" : usable.length >= 2 && identityReferences.length >= 1 ? "medium" : "low";
  const primaryColor = product.productColors?.[0] || product.brandColors?.[0];
  const secondaryColors = unique([...(product.productColors || []).slice(1), ...(product.brandColors || []).filter((color) => color !== primaryColor)]).slice(0, 6);
  const packageType = product.packageType || firstFact(truth, /package|포장|용기/);
  const signatureDetails = unique([
    packageType ? `포장·용기 형태: ${packageType}` : undefined,
    primaryColor ? `대표 색상: ${primaryColor}` : undefined,
    quantity ? `표시 구성: ${quantity}` : undefined,
    ...referenceImages
      .filter((image) => image.importance >= 70)
      .slice(0, 3)
      .map((image) => image.description),
  ]);
  const idSeed = JSON.stringify({
    productId: truth.productId,
    references: referenceImages.map((image) => image.contentHash || image.url),
    facts: truth.facts.filter((fact) => fact.usableInCopy).map((fact) => [fact.key, fact.value]),
  });
  return {
    id: `product-reference-${stableHash(idSeed)}`,
    productName: product.productName,
    brandName: product.brandName || product.advertiserName,
    category: product.category,
    subCategory: product.productSubCategory,
    immutableFacts: {
      productType: product.detectedProductType,
      packageType,
      packageShape: packageType,
      primaryColor,
      secondaryColors: secondaryColors.length ? secondaryColors : undefined,
      logoDescription: product.brandName ? `${product.brandName} 브랜드 표기 위치를 원본과 동일하게 유지` : undefined,
      labelLayout: referenceImages.some((image) => image.role === "front-package") ? "정면 패키지 레퍼런스의 라벨 배치" : undefined,
      quantity,
      volume,
      count,
      material,
      pattern,
      mainIngredients: product.ingredients?.length ? unique(product.ingredients) : undefined,
      origin,
      optionName,
      includedItems: includedItems.length ? unique(includedItems) : undefined,
    },
    visualIdentity: {
      silhouette: identity.silhouette,
      proportions: identity.proportions,
      surfaceTexture: identity.texture,
      signatureDetails,
      mustPreserve: unique([...identity.preserve, ...signatureDetails]),
      mustNotGenerate: unique(identity.forbid),
    },
    verifiedClaims: unique(truth.facts.filter((fact) => fact.usableInCopy).map((fact) => fact.value)),
    prohibitedClaims: unique([...truth.blockedClaimPatterns, "상세페이지에서 확인되지 않은 원산지·등급·인증·효능·함량·할인율·후기 수·판매량·배송 조건"]),
    referenceImages,
    referenceSufficiency,
    createdAt: new Date().toISOString(),
  };
}
