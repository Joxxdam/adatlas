import { createHash } from "node:crypto";
import { resolveMetaDailyBudget } from "./budget.ts";
import { META_AUTOMATION_OFF_POLICY } from "./featureOptOutRegistry.ts";
import type { MetaDraftRegistrationInput, MetaPreflightResult } from "./types.ts";

const supportedSalesObjectives = new Set(["OUTCOME_SALES", "CONVERSIONS", "PRODUCT_CATALOG_SALES"]);

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function metaPayloadHash(value: unknown) {
  return createHash("sha256").update(stable(value)).digest("hex");
}

function isSafeLandingUrl(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function mediaCompatibility(input: MetaDraftRegistrationInput) {
  const ratios = new Set(input.creatives.map((creative) => creative.mediaRatio));
  const placements = input.baselineAdSet.placements.map((value) => value.toLowerCase());
  const needsVertical = placements.some((value) => /story|reel/.test(value));
  if (needsVertical && !ratios.has("9:16")) {
    return {
      ok: false,
      detail: "Stories 또는 Reels 게재 위치에는 9:16 결과가 필요합니다. 자동 자르기는 수행하지 않습니다.",
    };
  }
  return { ok: true, detail: `승인 미디어 비율 ${[...ratios].join(", ")}` };
}

export function validateMetaDraftPreflight(
  input: MetaDraftRegistrationInput,
  options: {
    defaultDailyBudgetUsd: number;
    budgetByAccount: Record<string, { currency: string; dailyBudgetMinor: number }>;
    maxAdsPerRequest: number;
  }
): MetaPreflightResult {
  const budget = resolveMetaDailyBudget(input.adAccount, options);
  const media = mediaCompatibility(input);
  const uniqueHooks = new Set(input.creatives.map((creative) => creative.hookCode));
  const urlsValid = input.creatives.every((creative) => isSafeLandingUrl(creative.landingUrl) && creative.utm.trim().length > 0 && creative.landingUrl === input.creatives[0]?.landingUrl);
  const accountRelation = input.campaign.accountId === input.adAccount.id && input.baselineAdSet.accountId === input.adAccount.id && input.baselineAdSet.campaignId === input.campaign.id;
  const purchaseReady = input.conversionEvent === "PURCHASE" && input.baselineAdSet.promotedObject.customEventType === "PURCHASE" && Boolean(input.pixelId || input.datasetId);
  const isCatalog = input.campaign.objective === "PRODUCT_CATALOG_SALES";
  const campaignSafe = supportedSalesObjectives.has(input.campaign.objective) && !isCatalog && input.campaign.budgetMode === "ABO" && !input.campaign.isAdvantagePlus && !(input.campaign.specialAdCategories || []).length;
  const creativeCountSafe = input.creatives.length > 0 && input.creatives.length <= Math.min(6, options.maxAdsPerRequest) && uniqueHooks.size === input.creatives.length;
  const approvedCreatives = input.creatives.every((creative) => creative.approved && Boolean(creative.mediaPath) && Boolean(creative.materialCode) && creative.mediaType === "image");
  const checks = [
    {
      key: "campaign",
      label: "기존 판매·웹 전환 ABO 캠페인",
      ok: campaignSafe,
      detail: input.campaign.budgetMode === "CBO" ? "선택한 캠페인은 캠페인 예산 방식이므로 광고 세트 일 예산 USD 5 또는 승인된 계정 통화 예산을 적용할 수 없습니다." : campaignSafe ? "캠페인은 수정하지 않고 새 PAUSED 광고 세트만 만듭니다." : "수동 판매·웹 전환 ABO 캠페인만 지원합니다.",
    },
    {
      key: "relationship",
      label: "광고 계정·캠페인·기준 광고 세트 관계",
      ok: accountRelation,
      detail: accountRelation ? "선택한 자산의 소속 관계가 일치합니다." : "선택 자산 관계가 일치하지 않습니다.",
    },
    {
      key: "conversion",
      label: "웹사이트 Purchase 전환",
      ok: purchaseReady,
      detail: purchaseReady ? "픽셀·데이터셋과 Purchase 이벤트를 확인했습니다." : "Purchase 전환 자산 확인이 필요합니다.",
    },
    {
      key: "budget",
      label: "고정 일 예산",
      ok: budget.ok,
      detail: budget.ok ? `${budget.display} · API 값 ${budget.dailyBudgetMinor}` : budget.reason || "예산 확인 실패",
    },
    {
      key: "creative-count",
      label: "상품 1개·소재 최대 6개",
      ok: creativeCountSafe,
      detail: `${input.creatives.length}개 단일 미디어 광고`,
    },
    {
      key: "approved-creatives",
      label: "승인된 제작 결과",
      ok: approvedCreatives,
      detail: approvedCreatives ? "소재코드가 발급된 단일 이미지 결과만 사용합니다." : "제작 결과에서 승인된 광고 이미지가 준비되어야 합니다.",
    },
    {
      key: "landing",
      label: "단일 랜딩 URL·소재코드·UTM",
      ok: urlsValid,
      detail: urlsValid ? "모든 광고가 동일 승인 URL과 고유 UTM을 사용합니다." : "랜딩 URL 또는 UTM을 확인해 주세요.",
    },
    {
      key: "media",
      label: "게재 위치·미디어 비율",
      ok: media.ok,
      detail: media.detail,
    },
    {
      key: "automation",
      label: "Meta 자동 기능 강제 OFF",
      ok: true,
      detail: `${META_AUTOMATION_OFF_POLICY.label} · SHOP_NOW · 단일 미디어`,
    },
    {
      key: "status",
      label: "광고 세트·광고 PAUSED",
      ok: true,
      detail: "ACTIVE 상태는 생성 요청과 허용 목록 모두에서 차단됩니다.",
    },
  ];
  const ok = checks.every((check) => check.ok);
  return {
    ok,
    status: ok ? "ready" : "blocked",
    checks,
    budget,
    draft: {
      adSetName: `AdAtlas_${input.productName}_T${String(input.testRound).padStart(2, "0")}`,
      adSetStatus: "PAUSED",
      adStatuses: "PAUSED",
      ctaLabel: "지금 구매하기",
      ctaEnum: "SHOP_NOW",
      featurePolicy: "ALL_AUTOMATIONS_OFF",
    },
    payloadHash: metaPayloadHash(input),
  };
}
