import type { HookHypothesisCandidate, HookHypothesisScore } from "./types.ts";

export const HOOK_QUALITY_VERSION = "hook-quality-v3-normalized-claim-scene-style-diverse";

export function normalizePlannerScoreValues<T extends Record<string, number>>(scores: T): T {
  const values = Object.values(scores).filter(Number.isFinite);
  const scale = values.length && Math.max(...values) <= 10 ? 10 : 1;
  return Object.fromEntries(Object.entries(scores).map(([key, value]) => [key, Math.max(0, Math.min(100, Math.round((Number(value) || 0) * scale)))])) as T;
}

export function recomputeHookTotal(score: Omit<HookHypothesisScore, "total">) {
  return Math.round(score.evidenceStrength * 0.18 + score.specificity * 0.12 + score.purchaseReasonStrength * 0.12 + score.distinctiveness * 0.12 + score.attentionPotential * 0.1 + score.visualizability * 0.12 + score.advertisingFit * 0.09 + score.claimSafety * 0.1 + score.categoryPrior * 0.03 + score.novelty * 0.02);
}

function signature(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^가-힣a-z0-9]/g, "");
}

function claimCluster(candidate: HookHypothesisCandidate) {
  return signature(candidate.coreClaim || candidate.verifiedEvidence[0] || candidate.customerReason);
}

export function selectQualityDiverseHooks(candidates: HookHypothesisCandidate[], count = 6) {
  const sorted = [...candidates].sort((left, right) => right.score.total - left.score.total || left.id.localeCompare(right.id));
  const selected: HookHypothesisCandidate[] = [];
  const mainHooks = new Set<string>();
  const claims = new Set<string>();
  const scenes = new Set<string>();
  const tags = new Map<string, number>();
  const styles = new Map<string, number>();
  let priceCount = 0;

  const add = (candidate: HookHypothesisCandidate, strictDistribution: boolean) => {
    const main = signature(candidate.mainHook);
    const claim = claimCluster(candidate);
    const scene = signature(candidate.sceneKey);
    const tagCount = tags.get(candidate.primaryTag) || 0;
    const style = candidate.sentenceStyle || "declaration";
    const styleCount = styles.get(style) || 0;
    if (mainHooks.has(main) || !main) return false;
    // Claims and scenes define the actual experiment axis. Never relax these
    // constraints merely to fill six slots.
    if (!claim || claims.has(claim) || !scene || scenes.has(scene)) return false;
    // A third candidate with the same appeal point makes the six creatives feel
    // like wording variants rather than meaningfully different ad hypotheses.
    if (tagCount >= 2 || (strictDistribution && styleCount >= 2)) return false;
    if (candidate.primaryTag === "price-value" && priceCount >= 2) return false;
    selected.push({ ...candidate, status: "selected" });
    mainHooks.add(main);
    claims.add(claim);
    scenes.add(scene);
    tags.set(candidate.primaryTag, tagCount + 1);
    styles.set(style, styleCount + 1);
    if (candidate.primaryTag === "price-value") priceCount += 1;
    return true;
  };

  const distinctTagTarget = Math.min(count, 4, new Set(sorted.map((candidate) => candidate.primaryTag)).size);
  for (const candidate of sorted) {
    if (tags.size >= distinctTagTarget || selected.length >= count) break;
    if (tags.has(candidate.primaryTag)) continue;
    add(candidate, true);
  }
  for (const candidate of sorted) {
    if (selected.length >= count) break;
    if (selected.some((item) => item.id === candidate.id)) continue;
    add(candidate, true);
  }
  for (const candidate of sorted) {
    if (selected.length >= count) break;
    if (!selected.some((item) => item.id === candidate.id)) add(candidate, false);
  }
  return selected.slice(0, count);
}
