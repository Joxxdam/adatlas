import type { GeneratedAdCopy, ProductInfoForPrompt } from "../mvp/types";
import type { CreativeQualityScore, SceneCandidate, VisualDirection } from "./types";

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function numbers(value: string) {
  return Array.from(
    value.matchAll(/\d[\d,.]*(?:\s*(?:만원대|만원|천원|%|kg|g|ml|l|원|개|팩|세트|장|병))?/gi)
  ).map((match) => match[0].replace(/[\s,]/g, "").toLowerCase());
}

function priceValue(token: string) {
  const numeric = Number(token.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(numeric)) return null;
  if (token.includes("만원")) return numeric * 10000;
  if (token.includes("천원")) return numeric * 1000;
  if (token.includes("원")) return numeric;
  return null;
}

function numberIsSupported(token: string, factTokens: string[]) {
  if (factTokens.includes(token)) return true;
  if (token.endsWith("만원대")) {
    const band = Number(token.replace(/[^\d.]/g, ""));
    if (!Number.isFinite(band)) return false;
    return factTokens.some((fact) => {
      const value = priceValue(fact);
      return value !== null && value >= band * 10000 && value < (band + 1) * 10000;
    });
  }
  const claimedPrice = priceValue(token);
  if (claimedPrice === null) return false;
  return factTokens.some((fact) => priceValue(fact) === claimedPrice);
}

export function evaluateCreativeQuality(params: {
  direction: VisualDirection;
  product: ProductInfoForPrompt;
  copy?: Partial<GeneratedAdCopy>;
  productImagePaths?: string[];
  sceneCandidate?: SceneCandidate | null;
}): CreativeQualityScore {
  const warnings: string[] = [];
  const recommendations: string[] = [];
  const headline = String(params.copy?.headline || "").trim();
  const allCopy = [params.copy?.headline, params.copy?.bodyCopy, params.copy?.highlightCopy, params.copy?.bottomBarCopy, params.copy?.price].filter(Boolean).join(" ");
  const productFacts = [params.product.productName, params.product.price, params.product.originalPrice, params.product.oldPrice, params.product.discountInfo, params.product.mainBenefit, params.product.extractedDescription].filter(Boolean).join(" ");
  const productImages = (params.productImagePaths || []).filter(Boolean);
  const factNumbers = numbers(productFacts);
  const unverifiedNumbers = numbers(allCopy).filter(
    (number) => !numberIsSupported(number, factNumbers)
  );

  let hookStrength = headline ? 88 : 42;
  if (headline.length > 28) {
    hookStrength -= 14;
    warnings.push("헤드라인이 길어 1~2초 안에 읽히기 어렵습니다.");
    recommendations.push("헤드라인을 24자 안팎의 한 문장으로 줄이세요.");
  }
  if (!headline) recommendations.push("선택한 방향에 맞는 한 줄 후킹 문구를 생성하세요.");

  const hierarchy = clamp(78 + (params.direction.graphicComponents.length >= 4 ? 8 : 0));
  const productVisibility = clamp(productImages.length ? 90 : 38);
  if (!productImages.length) {
    warnings.push("실제 상품 이미지가 선택되지 않았습니다.");
    recommendations.push("상세페이지 원본 또는 투명 PNG를 상품 레이어로 선택하세요.");
  }
  const sceneRelevance = clamp(params.sceneCandidate ? 90 : 72);
  if (!params.sceneCandidate) recommendations.push("추천 장면 후보를 생성하면 카테고리 적합도를 높일 수 있습니다.");
  const textReadability = clamp(params.direction.scenePromptPlan.textSafeZones.length ? 88 : 62);
  const compositionBalance = clamp(
    params.direction.scenePromptPlan.productSafeZone.widthRatio >= 0.42 ? 88 : 68
  );
  const benchmarkSimilarity = clamp(
    70 + Math.min(18, params.direction.benchmarkPatternsUsed.length * 4)
  );
  let factualSafety = 96;
  if (unverifiedNumbers.length) {
    factualSafety -= Math.min(36, unverifiedNumbers.length * 12);
    warnings.push(`상품 정보에서 확인되지 않은 숫자 표현을 점검하세요: ${unverifiedNumbers.join(", ")}`);
    recommendations.push("가격·중량·할인율은 추출된 상품 정보에 있는 값만 사용하세요.");
  }
  const scores = {
    hookStrength: clamp(hookStrength),
    hierarchy,
    productVisibility,
    sceneRelevance,
    textReadability,
    compositionBalance,
    benchmarkSimilarity,
    factualSafety: clamp(factualSafety),
  };
  const overall = clamp(
    scores.hookStrength * 0.15 +
      scores.hierarchy * 0.13 +
      scores.productVisibility * 0.17 +
      scores.sceneRelevance * 0.12 +
      scores.textReadability * 0.13 +
      scores.compositionBalance * 0.12 +
      scores.benchmarkSimilarity * 0.1 +
      scores.factualSafety * 0.08
  );
  if (overall < 78) recommendations.push("상품 크기, 헤드라인 길이, 장면 대비를 조정한 뒤 다시 렌더링하세요.");

  return { ...scores, overall, warnings, recommendations };
}
