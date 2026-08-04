import type { AdBrief, CreativeStrategy, ProductInfoForPrompt, ReferenceMatchResult } from "../mvp/types";
import { sceneProfiles } from "./sceneProfiles";
import type { AdvertiserProfile, SceneProfile } from "./types";

function normalize(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function tokens(value: string) {
  return new Set(
    normalize(value)
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 2)
  );
}

function overlapScore(source: Set<string>, values: string[], unit: number) {
  return values.reduce((score, value) => {
    const valueTokens = tokens(value);
    let matched = false;
    valueTokens.forEach((token) => {
      if (source.has(token)) matched = true;
    });
    return score + (matched ? unit : 0);
  }, 0);
}

export function rankSceneProfiles(params: {
  product: ProductInfoForPrompt;
  brief: AdBrief;
  advertiserProfile: AdvertiserProfile;
  strategy?: CreativeStrategy | null;
  referenceMatches?: ReferenceMatchResult[];
  limit?: number;
}): Array<{ profile: SceneProfile; score: number; reasons: string[] }> {
  const referenceText = (params.referenceMatches || [])
    .flatMap((match) => [
      match.context.visualTone,
      match.context.layoutPattern,
      match.context.reusablePattern,
      ...(match.context.appealPoints || []),
      ...(match.context.hookTypes || []),
    ])
    .filter(Boolean)
    .join(" ");
  const sourceText = [
    params.product.productName,
    params.product.category,
    params.product.mainBenefit,
    params.product.extractedDescription,
    params.product.discountInfo,
    params.brief.additionalEmphasis,
    params.strategy?.mainHookAngle,
    params.strategy?.coreAppealPoint,
    params.strategy?.suggestedVisualEmphasis,
    referenceText,
  ]
    .filter(Boolean)
    .join(" ");
  const sourceTokens = tokens(sourceText);
  const preferred = new Set([
    params.advertiserProfile.defaultSceneProfile,
    ...(params.advertiserProfile.scenePreferences || []),
  ]);

  return sceneProfiles
    .map((profile) => {
      const reasons: string[] = [];
      let score = 0;
      const categoryScore = overlapScore(sourceTokens, profile.categoryMatchers, 20);
      if (categoryScore) {
        score += categoryScore;
        reasons.push("상품 카테고리 일치");
      }
      const benefitScore = overlapScore(sourceTokens, profile.benefitMatchers || [], 12);
      if (benefitScore) {
        score += benefitScore;
        reasons.push("혜택·사용 상황 일치");
      }
      if (preferred.has(profile.id)) {
        score += profile.id === params.advertiserProfile.defaultSceneProfile ? 34 : 22;
        reasons.push("광고주 선호 장면");
      }
      if (
        params.brief.creativeIntensity === "performance" &&
        profile.compatibleArchetypes.some((id) =>
          ["giant-hook", "problem-solution", "numeric-proof", "price-event"].includes(id)
        )
      ) {
        score += 8;
        reasons.push("강전환형 광고 강도 적합");
      }
      if (referenceText && overlapScore(sourceTokens, profile.visualMood, 3)) {
        score += 5;
        reasons.push("자동 매칭 레퍼런스 톤 반영");
      }
      return { profile, score, reasons };
    })
    .sort((a, b) => b.score - a.score || a.profile.id.localeCompare(b.profile.id))
    .slice(0, Math.max(1, Math.min(5, params.limit || 3)));
}

export function selectSceneProfile(params: Parameters<typeof rankSceneProfiles>[0]) {
  return rankSceneProfiles(params)[0]?.profile || sceneProfiles[0];
}
