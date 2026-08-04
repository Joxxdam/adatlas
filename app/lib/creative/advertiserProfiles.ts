import himnaeraFarm from "../../../data/advertisers/himnaera-farm.json";
import kookdaeHanwoo from "../../../data/advertisers/kookdae-hanwoo.json";
import originalSource from "../../../data/advertisers/original-source.json";
import type { ProductInfoForPrompt } from "../mvp/types";
import type { AdvertiserProfile } from "./types";

export const advertiserProfiles: AdvertiserProfile[] = [
  originalSource,
  kookdaeHanwoo,
  himnaeraFarm,
] as AdvertiserProfile[];

function normalize(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function productHaystack(product: ProductInfoForPrompt) {
  return normalize(
    [
      product.advertiserName,
      product.brandName,
      product.productName,
      product.category,
      product.landingUrl,
    ].join(" ")
  );
}

function profileScore(profile: AdvertiserProfile, product: ProductInfoForPrompt) {
  const haystack = productHaystack(product);
  let score = 0;
  if (normalize(product.advertiserName) === normalize(profile.name)) score += 100;
  if (normalize(product.brandName) === normalize(profile.name)) score += 90;
  for (const alias of [profile.name, ...(profile.aliases || [])]) {
    if (alias && haystack.includes(normalize(alias))) score += 45;
  }
  for (const domain of profile.domains || []) {
    if (domain && normalize(product.landingUrl).includes(normalize(domain))) score += 70;
  }
  for (const category of profile.categories) {
    if (normalize(product.category).includes(normalize(category))) score += 24;
  }
  for (const keyword of profile.brandKeywords || []) {
    if (haystack.includes(normalize(keyword))) score += 8;
  }
  return score;
}

function genericProfile(product: ProductInfoForPrompt): AdvertiserProfile {
  const text = normalize(`${product.category} ${product.productName}`);
  if (/농산|과일|채소|고구마|감자|산지|제철/.test(text)) {
    return {
      id: "generic-agriculture",
      name: product.advertiserName || product.brandName || "농산물 광고주",
      categories: [product.category || "농산물"],
      visualKeywords: ["신선함", "수확", "식탁", "산지 신뢰"],
      preferredColorHints: ["#2f7f42", "#f3bd36", "#fffdf7"],
      prohibitedVisuals: ["가짜 산지", "가짜 인증", "실제와 다른 품종"],
      productDisplayRules: ["실제 상품 이미지를 전경 핵심 레이어로 사용"],
      defaultTextStylePreset: "honest-farm-direct",
      defaultSceneProfile: "agriculture-clean-commerce",
    };
  }
  if (/육류|고기|한우|돼지|갈비|등심|식품/.test(text)) {
    return {
      id: "generic-food",
      name: product.advertiserName || product.brandName || "식품 광고주",
      categories: [product.category || "식품"],
      visualKeywords: ["맛", "식탁", "푸짐함", "실속"],
      preferredColorHints: ["#d8271c", "#ffd928", "#15110f"],
      prohibitedVisuals: ["비위생적인 식품", "실제와 다른 상품 형태"],
      productDisplayRules: ["실제 식품 사진을 핵심 레이어로 사용"],
      defaultTextStylePreset: "premium-food",
      defaultSceneProfile: "food-meat-premium-table",
    };
  }
  if (/뷰티|화장|바디|샤워|세정|스킨/.test(text)) {
    return {
      id: "generic-personal-care",
      name: product.advertiserName || product.brandName || "퍼스널케어 광고주",
      categories: [product.category || "퍼스널케어"],
      visualKeywords: ["깨끗함", "사용 장면", "감각적 효과"],
      preferredColorHints: ["#17c7ad", "#0d1b23", "#ffffff"],
      prohibitedVisuals: ["가짜 패키지", "가짜 로고", "이미지 내 글자"],
      productDisplayRules: ["실제 제품 라벨을 변형하지 않음"],
      defaultTextStylePreset: "clean-brand",
      defaultSceneProfile: "personal-care-clean-product",
    };
  }
  return {
    id: "generic-advertiser",
    name: product.advertiserName || product.brandName || "일반 광고주",
    categories: [product.category || "기타"],
    visualKeywords: ["상품 중심", "명확한 정보 위계", "전환형 구성"],
    preferredColorHints: ["#1769e0", "#ffffff", "#111111"],
    prohibitedVisuals: ["가짜 제품", "이미지 내 글자", "워터마크"],
    productDisplayRules: ["실제 상품을 핵심 레이어로 사용"],
    defaultTextStylePreset: "bold-performance",
    defaultSceneProfile: "generic-bold-performance",
  };
}

export function matchAdvertiserProfile(product: ProductInfoForPrompt): AdvertiserProfile {
  const scored = advertiserProfiles
    .map((profile) => ({ profile, score: profileScore(profile, product) }))
    .sort((a, b) => b.score - a.score);
  return scored[0]?.score > 0 ? scored[0].profile : genericProfile(product);
}
