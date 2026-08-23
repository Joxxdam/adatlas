import { matchBenchmarkPatterns } from "./benchmarkPatternMatcher.ts";
import { buildProductTreatment } from "./buildProductTreatment";
import { buildScenePrompt } from "./buildScenePrompt";
import { getSceneProfile } from "./sceneProfiles";
import { rankSceneProfiles } from "./selectSceneProfile";
import { getVisualArchetype } from "./visualArchetypes";
import type { BuildVisualDirectionsInput, VisualDirection } from "./types";

function family(category: string, productName: string) {
  const text = `${category} ${productName}`.toLowerCase();
  if (/바디|샤워|뷰티|화장|퍼스널|세정|스킨/.test(text)) return "personal-care";
  if (/농산|과일|채소|감자|고구마|산지|수확/.test(text)) return "agriculture";
  if (/고기|육류|한우|축산|갈비|등심|식품|선물/.test(text)) return "food";
  return "generic";
}

function archetypeChoices(params: BuildVisualDirectionsInput) {
  const categoryFamily = family(params.product.category, params.product.productName);
  const angle = `${params.strategy?.headline || params.strategy?.mainHookAngle || ""} ${params.strategy?.keyAppeal || params.strategy?.coreAppealPoint || ""} ${params.strategy?.sceneDescription || ""} ${(params.strategy?.backgroundTags || []).join(" ")} ${params.brief.additionalEmphasis || ""}`;
  const priceLed = /가격|특가|할인|가성비|구성|절약/.test(angle) || Boolean(params.product.discountInfo);
  const problemLed = /문제|불편|고민|냄새|체취|귀찮|부족/.test(angle);
  const premiumLed = /프리미엄|선물|품질|고급|신뢰/.test(angle);

  if (categoryFamily === "personal-care") {
    return [problemLed ? "problem-solution" : "giant-hook", priceLed ? "numeric-proof" : "product-hero", "community-review"];
  }
  if (categoryFamily === "agriculture") {
    return [priceLed ? "price-event" : "product-hero", "three-benefits", premiumLed ? "premium-product" : "seasonal-context"];
  }
  if (categoryFamily === "food") {
    return [priceLed ? "price-event" : "giant-hook", premiumLed ? "premium-product" : "product-hero", /캠핑|가족|모임|식탁/.test(angle) ? "lifestyle-context" : "problem-solution"];
  }
  return ["giant-hook", problemLed ? "problem-solution" : "product-hero", "three-benefits"];
}

function titleFor(archetypeId: string, index: number) {
  const labels: Record<string, string> = {
    "giant-hook": "한눈에 꽂히는 초대형 후킹",
    "problem-solution": "불편을 먼저 찌르는 문제 해결",
    "numeric-proof": "숫자와 근거가 보이는 증명형",
    "product-hero": "실제 상품이 주인공인 감각형",
    "three-benefits": "구매 이유를 세 줄로 정리한 3포인트형",
    "community-review": "광고 같지 않은 커뮤니티 후기형",
    "seasonal-context": "지금 필요한 이유가 보이는 시즌형",
    "price-event": "가격과 구성을 한 번에 읽는 행사형",
    "lifestyle-context": "사용 장면이 먼저 이해되는 상황형",
    "premium-product": "품질과 명분을 살린 프리미엄형",
  };
  return labels[archetypeId] || `비주얼 방향 ${index + 1}`;
}

function templateFor(categoryFamily: string, archetypeId: string) {
  if (categoryFamily === "personal-care") {
    if (["numeric-proof", "three-benefits"].includes(archetypeId)) return "auto-beauty-proof-002";
    if (["product-hero", "premium-product"].includes(archetypeId)) return "auto-beauty-editorial-001";
    return "auto-body-solution-001";
  }
  if (categoryFamily === "agriculture") return "auto-produce-market-001";
  if (categoryFamily === "food") {
    if (["lifestyle-context", "problem-solution"].includes(archetypeId)) return "food-template-005";
    return "auto-meat-impact-001";
  }
  return undefined;
}

function textStyleFor(params: BuildVisualDirectionsInput, archetypeId: string) {
  const categoryFamily = family(params.product.category, params.product.productName);
  if (archetypeId === "community-review") return "community-review";
  if (archetypeId === "price-event") return "price-commerce";
  if (archetypeId === "seasonal-context") return "seasonal-impact";
  if (["problem-solution", "lifestyle-context"].includes(archetypeId)) {
    return "lifestyle-problem-solution";
  }
  if (categoryFamily === "personal-care") {
    return /쿨|민트|시원/.test(`${params.product.mainBenefit} ${params.product.productName}`) ? "cooling-impact" : params.advertiserProfile?.defaultTextStylePreset || "clean-brand";
  }
  if (categoryFamily === "agriculture") return "honest-farm-direct";
  if (categoryFamily === "food") return "premium-food";
  return params.advertiserProfile?.defaultTextStylePreset || "bold-performance";
}

function arrangementFor(archetypeId: string) {
  if (archetypeId === "three-benefits") return { count: 3, placement: "three-item rhythm across the middle", scale: "medium", rotation: [-4, 0, 4] };
  if (archetypeId === "community-review") return { count: 2, placement: "lower-right group beside the review card", scale: "medium", rotation: [-3, 3] };
  if (archetypeId === "price-event") return { count: 2, placement: "large center product group above the price block", scale: "large", rotation: [-2, 2] };
  return { count: 1, placement: "single center-right hero", scale: "hero", rotation: [-3] };
}

export function buildVisualDirections(params: BuildVisualDirectionsInput): VisualDirection[] {
  if (!params.advertiserProfile) throw new Error("광고주 프로필이 필요합니다.");
  const categoryFamily = family(params.product.category, params.product.productName);
  const sceneRanking = rankSceneProfiles({
    product: params.product,
    brief: params.brief,
    advertiserProfile: params.advertiserProfile,
    strategy: params.strategy,
    referenceMatches: params.referenceMatches,
    limit: 5,
  });
  const archetypeIds = Array.from(new Set(archetypeChoices(params))).slice(0, 3);
  while (archetypeIds.length < 3) archetypeIds.push(["product-hero", "giant-hook", "three-benefits"][archetypeIds.length]);

  return archetypeIds.map((archetypeId, index) => {
    const archetype = getVisualArchetype(archetypeId);
    const compatible = sceneRanking.find((item, sceneIndex) => sceneIndex >= index && item.profile.compatibleArchetypes.includes(archetypeId)) || sceneRanking.find((item) => item.profile.compatibleArchetypes.includes(archetypeId)) || sceneRanking[index] || sceneRanking[0];
    const profile = compatible?.profile || getSceneProfile(params.advertiserProfile!.defaultSceneProfile || "generic-bold-performance");
    const scenePromptPlan = buildScenePrompt({
      profile,
      archetype,
      product: params.product,
      advertiserProfile: params.advertiserProfile!,
      strategy: params.strategy,
      variation: index,
    });
    const referencePatternsUsed = (params.referenceMatches || [])
      .slice(0, 3)
      .flatMap((match) => [match.context.layoutPattern, match.context.visualTone, match.context.reusablePattern])
      .filter((value): value is string => Boolean(value));
    const benchmarkPatternsUsed = matchBenchmarkPatterns({
      category: params.product.category,
      archetypeId,
      limit: 3,
    });
    const colors = profile.colorHints || params.advertiserProfile!.preferredColorHints || [];
    return {
      id: `${archetypeId}-${profile.id}-${index + 1}`,
      title: titleFor(archetypeId, index),
      archetypeId,
      sceneProfileId: profile.id,
      textStylePresetId: textStyleFor(params, archetypeId),
      recommendedTemplateId: templateFor(categoryFamily, archetypeId),
      mood: profile.visualMood,
      productArrangement: arrangementFor(archetypeId),
      graphicComponents: archetype.graphicComponents,
      colorDirection: colors,
      headlineTreatment: `${archetype.name} 규칙으로 1~2줄, 첫 시선에서 읽히는 크기와 대비를 사용합니다.`,
      footerTreatment: archetype.useFooterBar ? "가격·근거·CTA를 하나의 하단 전환 영역으로 묶습니다." : "하단은 짧은 CTA만 두고 상품 시야를 확보합니다.",
      scenePromptPlan,
      benchmarkPatternsUsed,
      referencePatternsUsed: Array.from(new Set(referencePatternsUsed)).slice(0, 5),
      reason: `${compatible?.reasons.join(", ") || "상품 카테고리"}를 기준으로 ${profile.label} 장면과 ${archetype.name} 구성을 결합했습니다. 실제 상품은 별도 레이어로 유지합니다.`,
      advertiserProfileId: params.advertiserProfile!.id,
      productTreatment: buildProductTreatment({
        archetypeId,
        intensity: params.brief.creativeIntensity,
        colorHints: colors,
      }),
    };
  });
}
