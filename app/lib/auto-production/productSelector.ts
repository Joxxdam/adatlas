import type { AutoProductionAdvertiserConfig, AutoProductionProductCandidate, AutoProductionRole } from "./types";
import { autoProductionRoles } from "./types.ts";
import { candidateIdentityKeys, productFamilyKey } from "./productIdentity.ts";
import { AUTO_PRODUCTION_CREATIVES_PER_PRODUCT, confirmedAutoProductionProductCount } from "./policy.ts";

export const autoProductionRoleLabels: Record<AutoProductionRole, string> = {
  "core-expansion": "꾸준히 잘 팔리는 주력상품",
  "low-exposure-opportunity": "광고 노출을 늘려볼 상품",
  reactivation: "구매 반응이 좋은 성장 후보",
  "new-exploration": "새롭게 테스트할 상품",
};

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

export function eligibleAutoProductionCandidates(candidates: AutoProductionProductCandidate[], config: AutoProductionAdvertiserConfig, recentProductIds: ReadonlySet<string> = new Set()) {
  const urls = new Set<string>();
  const identityKeys = new Set<string>();
  return candidates.filter((candidate) => {
    if (!candidate.productUrl || !candidate.imageUrl || candidate.soldOut) return false;
    // `needs-review`는 상품 이미지가 없는 상태가 아니라, 세트 전체 구성처럼
    // 보조 확인이 필요한 상태다. 실제 상품으로 판별된 대표 이미지가 한 장이라도
    // 있으면 경고를 남기고 제작을 계속한다. 완전히 쓸 수 없는 `rejected`만 제외한다.
    if (candidate.imageVerificationStatus === "rejected") return false;
    if (!candidate.productInfo.verifiedBenefits?.length && !candidate.productInfo.mainBenefit) return false;
    if ([candidate.id, candidate.externalId, candidate.productCode, candidate.sku].some((value) => Boolean(value && config.excludedProductIds.includes(value)))) return false;
    if (config.excludedCategories.some((category) => candidate.category.includes(category))) return false;
    if (config.productVisibilityMode === "site-visible-only" && candidate.siteVisible !== true) return false;
    const keys = candidateIdentityKeys(candidate);
    if (keys.some((key) => recentProductIds.has(key)) || recentProductIds.has(candidate.id) || Boolean(candidate.externalId && recentProductIds.has(candidate.externalId))) return false;
    if (urls.has(candidate.productUrl)) return false;
    if (keys.some((key) => identityKeys.has(key) && !key.startsWith("family:"))) return false;
    urls.add(candidate.productUrl);
    keys.forEach((key) => identityKeys.add(key));
    return true;
  });
}

export function selectAutoProductionCandidates(candidates: AutoProductionProductCandidate[], config: AutoProductionAdvertiserConfig, recentProductIds: ReadonlySet<string> = new Set()) {
  const eligible = eligibleAutoProductionCandidates(candidates, config, recentProductIds);
  const limit = config.productsPerRun;
  const selected: AutoProductionProductCandidate[] = [];
  const selectedIds = new Set<string>();
  const selectedFamilies = new Set<string>();
  const priorities = config.selectionPriorities.length ? config.selectionPriorities : autoProductionRoles;

  for (const requiredId of config.requiredProductIds) {
    if (selected.length >= limit) break;
    const required = eligible.find((candidate) => !selectedIds.has(candidate.id) && (candidate.id === requiredId || candidate.externalId === requiredId));
    if (!required) continue;
    const family = required.productFamilyKey || productFamilyKey(required);
    if (selectedFamilies.has(family)) continue;
    selected.push({ ...required, productFamilyKey: family, recommendationReason: autoProductionRoleLabels[required.recommendationRole] });
    selectedIds.add(required.id);
    selectedFamilies.add(family);
  }

  for (const role of priorities) {
    const best = eligible.filter((candidate) => !selectedIds.has(candidate.id) && !selectedFamilies.has(candidate.productFamilyKey || productFamilyKey(candidate))).sort((left, right) => roleScore(right, role) - roleScore(left, role))[0];
    if (!best || selected.length >= limit) continue;
    const family = best.productFamilyKey || productFamilyKey(best);
    selected.push({ ...best, productFamilyKey: family, recommendationRole: role, recommendationReason: autoProductionRoleLabels[role] });
    selectedIds.add(best.id);
    selectedFamilies.add(family);
  }
  for (const candidate of [...eligible].sort((a, b) => b.selectionScore - a.selectionScore)) {
    if (selected.length >= limit) break;
    if (selectedIds.has(candidate.id)) continue;
    const family = candidate.productFamilyKey || productFamilyKey(candidate);
    if (selectedFamilies.has(family)) continue;
    selected.push({ ...candidate, productFamilyKey: family, recommendationReason: autoProductionRoleLabels[candidate.recommendationRole] });
    selectedIds.add(candidate.id);
    selectedFamilies.add(family);
  }
  return selected;
}

export function plannedImageCount(configs: AutoProductionAdvertiserConfig[]) {
  return configs
    .filter((config) => config.enabled && confirmedAutoProductionProductCount(config) > 0)
    .reduce((sum, config) => {
      return sum + confirmedAutoProductionProductCount(config) * AUTO_PRODUCTION_CREATIVES_PER_PRODUCT;
    }, 0);
}
