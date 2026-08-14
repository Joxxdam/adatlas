import type { SiteAdCandidate, SiteCandidateTier } from "./types";

const TIER_TARGET: Record<SiteCandidateTier, number> = {
  "evidence-backed": 3,
  "content-potential": 3,
  experiment: 2,
};

export function selectDiverseSiteCandidates(candidates: SiteAdCandidate[], limit = 8) {
  const ranked = [...candidates].sort((a, b) => b.score.total - a.score.total);
  const selected: SiteAdCandidate[] = [];
  const selectedIds = new Set<string>();
  const typeCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();

  const add = (candidate: SiteAdCandidate, relaxed = false) => {
    if (selectedIds.has(candidate.id) || selected.length >= limit) return false;
    const typeCount = typeCounts.get(candidate.primaryRecommendationType) || 0;
    const category = candidate.product.category || "미분류";
    const categoryCount = categoryCounts.get(category) || 0;
    if (!relaxed && (typeCount >= 2 || categoryCount >= 3)) return false;
    selected.push(candidate);
    selectedIds.add(candidate.id);
    typeCounts.set(candidate.primaryRecommendationType, typeCount + 1);
    categoryCounts.set(category, categoryCount + 1);
    return true;
  };

  for (const tier of Object.keys(TIER_TARGET) as SiteCandidateTier[]) {
    let count = 0;
    for (const candidate of ranked.filter((item) => item.tier === tier)) {
      if (add(candidate)) count += 1;
      if (count >= TIER_TARGET[tier]) break;
    }
  }
  for (const candidate of ranked) add(candidate);
  for (const candidate of ranked) add(candidate, true);

  return selected.slice(0, limit).map((candidate, index) => ({
    ...candidate,
    rank: index + 1,
  }));
}
