import type { AutoProductionAdvertiserConfig, AutoProductionProductCandidate, AutoProductionRole } from "./types";
import { autoProductionRoles } from "./types.ts";

function finite(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function roleScore(candidate: AutoProductionProductCandidate, role: AutoProductionRole) {
  const sales = finite(candidate.currentSales ?? candidate.revenue);
  const previous = finite(candidate.previousSales);
  const orders = finite(candidate.orders);
  const conversion = finite(candidate.conversionRate);
  const impressions = finite(candidate.impressions);
  if (role === "core-expansion") return candidate.selectionScore + Math.log10(sales + 1) * 10 + Math.log10(orders + 1) * 8;
  if (role === "low-exposure-opportunity") return candidate.selectionScore + conversion * 700 - Math.log10(impressions + 1) * 3;
  if (role === "reactivation") return candidate.selectionScore + (previous > sales && previous > 0 ? 25 : 0) + Math.log10(previous + 1) * 8;
  return candidate.selectionScore + (candidate.isNew ? 25 : 0) + (candidate.isSeasonal ? 16 : 0) + (candidate.reviewCount ? 6 : 0);
}

export function eligibleAutoProductionCandidates(
  candidates: AutoProductionProductCandidate[],
  config: AutoProductionAdvertiserConfig,
  recentProductIds: ReadonlySet<string> = new Set()
) {
  const urls = new Set<string>();
  return candidates.filter((candidate) => {
    if (!candidate.productUrl || !candidate.imageUrl || candidate.soldOut) return false;
    if (!candidate.productInfo.verifiedBenefits?.length && !candidate.productInfo.mainBenefit) return false;
    if (config.excludedProductIds.includes(candidate.id) || (candidate.externalId && config.excludedProductIds.includes(candidate.externalId))) return false;
    if (config.excludedCategories.some((category) => candidate.category.includes(category))) return false;
    if (config.productVisibilityMode === "site-visible-only" && candidate.siteVisible !== true) return false;
    if (recentProductIds.has(candidate.id) || Boolean(candidate.externalId && recentProductIds.has(candidate.externalId))) return false;
    if (urls.has(candidate.productUrl)) return false;
    urls.add(candidate.productUrl);
    return true;
  });
}

export function selectAutoProductionCandidates(
  candidates: AutoProductionProductCandidate[],
  config: AutoProductionAdvertiserConfig,
  recentProductIds: ReadonlySet<string> = new Set()
) {
  const eligible = eligibleAutoProductionCandidates(candidates, config, recentProductIds);
  const limit = Math.min(config.productsPerRun, config.maxImagesPerRun);
  const selected: AutoProductionProductCandidate[] = [];
  const selectedIds = new Set<string>();
  const priorities = config.selectionPriorities.length ? config.selectionPriorities : autoProductionRoles;

  for (const requiredId of config.requiredProductIds) {
    if (selected.length >= limit) break;
    const required = eligible.find((candidate) =>
      !selectedIds.has(candidate.id) &&
      (candidate.id === requiredId || candidate.externalId === requiredId)
    );
    if (!required) continue;
    selected.push(required);
    selectedIds.add(required.id);
  }

  for (const role of priorities) {
    const best = eligible
      .filter((candidate) => !selectedIds.has(candidate.id))
      .sort((left, right) => roleScore(right, role) - roleScore(left, role))[0];
    if (!best || selected.length >= limit) continue;
    selected.push({ ...best, recommendationRole: role });
    selectedIds.add(best.id);
  }
  for (const candidate of [...eligible].sort((a, b) => b.selectionScore - a.selectionScore)) {
    if (selected.length >= limit) break;
    if (selectedIds.has(candidate.id)) continue;
    selected.push(candidate);
    selectedIds.add(candidate.id);
  }
  return selected;
}

export function plannedImageCount(configs: AutoProductionAdvertiserConfig[]) {
  return configs
    .filter((config) => config.enabled)
    .reduce((sum, config) => {
      const perProduct = config.fullHookTestForNewProducts ? 6 : config.creativesPerProduct;
      return sum + Math.min(config.productsPerRun * perProduct, config.maxImagesPerRun);
    }, 0);
}
