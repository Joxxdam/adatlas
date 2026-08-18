import "server-only";

import { createHash } from "node:crypto";
import { readBigQueryCache, writeBigQueryCache } from "./cache.server";
import {
  decodeBigQueryAdvertiserId,
  encodeBigQueryAdvertiserId,
  queryBigQueryAdvertisers,
  queryBigQueryProductSignals,
} from "./repository.server";
import { buildCandidatesFromSignals, buildProductFamilies } from "./scoring";
import type {
  BigQueryAdCandidate,
  BigQueryAdvertiser,
  BigQueryCandidateCapability,
  BigQueryCandidatePeriod,
  BigQueryCandidateResponse,
  BigQueryRecommendationType,
} from "./types";
import { bigQueryRecommendationTypes } from "./types";

const ADVERTISER_CACHE_MS = 5 * 60 * 1_000;
const CANDIDATE_CACHE_MS = 4 * 60 * 1_000;

function shiftDate(date: string, days: number) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error("BigQuery 기준 날짜를 해석하지 못했습니다.");
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function periodDays(period: BigQueryCandidatePeriod) {
  if (period === "8w") return 56;
  if (period === "12w") return 84;
  return 28;
}

function periodRange(latestDataDate: string, period: BigQueryCandidatePeriod) {
  const days = periodDays(period);
  const currentEnd = latestDataDate;
  const currentStart = shiftDate(currentEnd, -(days - 1));
  const previousEnd = shiftDate(currentStart, -1);
  const previousStart = shiftDate(previousEnd, -(days - 1));
  const twelveWeekStart = shiftDate(currentEnd, -83);
  const historyStart = previousStart < twelveWeekStart ? previousStart : twelveWeekStart;
  return { currentStart, currentEnd, previousStart, previousEnd, historyStart };
}

function sourceTable(source: "host24" | "hostmk") {
  return source === "host24"
    ? "first-project-394906.FACT_HOST24.PRODUCT"
    : "first-project-394906.FACT_HOSTMK.PRODUCT";
}

function capabilities(source: "host24" | "hostmk"): BigQueryCandidateCapability[] {
  const activeSource = sourceTable(source);
  return [
    {
      type: "core-scale",
      availability: "analysis-ready",
      reason: "매출·구매 기여도와 노출 대비 구매 반응을 함께 보고 확장 후보를 찾습니다.",
      sourceTables: [activeSource],
    },
    {
      type: "core-recovery",
      availability: "analysis-ready",
      reason: "기여도가 높은 주력상품 중 최근 반응 회복 테스트가 필요한 후보를 찾습니다.",
      sourceTables: [activeSource],
    },
    {
      type: "hidden-potential",
      availability: "analysis-ready",
      reason: "노출은 상대적으로 적지만 노출 대비 구매 반응이 확인된 후보를 찾습니다.",
      sourceTables: [activeSource],
    },
    {
      type: "creative-improvement",
      availability: "analysis-ready",
      reason: "판매 기여는 있으나 메시지 개선 실험이 필요한 후보를 찾습니다.",
      sourceTables: [activeSource],
    },
  ];
}

function recommendationTypeCounts(candidates: BigQueryAdCandidate[]) {
  return Object.fromEntries(
    bigQueryRecommendationTypes.map((type) => [
      type,
      candidates.filter((candidate) => candidate.primaryType === type).length,
    ])
  ) as Record<BigQueryRecommendationType, number>;
}

function matchesCandidateType(candidate: BigQueryAdCandidate, type: BigQueryRecommendationType) {
  return candidate.primaryType === type;
}

function candidateId(input: {
  advertiser: BigQueryAdvertiser;
  period: BigQueryCandidatePeriod;
  productName: string;
}) {
  const brand = Buffer.from(input.advertiser.name, "utf8").toString("base64url");
  const productHash = createHash("sha256").update(input.productName).digest("hex").slice(0, 18);
  return `bqc.${input.advertiser.source}.${input.period}.${brand}.${productHash}`;
}

function parseCandidateId(value: string) {
  const [prefix, source, period, brand, productHash, extra] = value.split(".");
  if (
    prefix !== "bqc" ||
    extra ||
    (source !== "host24" && source !== "hostmk") ||
    (period !== "4w" && period !== "8w" && period !== "12w") ||
    !brand ||
    !/^[a-f0-9]{18}$/.test(productHash || "")
  ) {
    return null;
  }
  try {
    const brandName = Buffer.from(brand, "base64url").toString("utf8").trim();
    if (!brandName || brandName.length > 160) return null;
    return { source, period, brandName } as const;
  } catch {
    return null;
  }
}

export async function listBigQueryAdvertisers() {
  const cacheKey = "bigquery-advertisers:v1";
  const cached = readBigQueryCache<{
    advertisers: BigQueryAdvertiser[];
    processedBytes: number;
    generatedAt: string;
  }>(cacheKey);
  if (cached) return { ...cached, cacheHit: true };
  const result = await queryBigQueryAdvertisers();
  const value = {
    advertisers: result.rows,
    processedBytes: result.processedBytes,
    cacheHit: result.cacheHit,
    generatedAt: new Date().toISOString(),
  };
  writeBigQueryCache(cacheKey, value, ADVERTISER_CACHE_MS);
  return value;
}

export async function getBigQueryCandidates(input: {
  advertiserId: string;
  period: BigQueryCandidatePeriod;
  type?: BigQueryRecommendationType | "all";
}) {
  const decoded = decodeBigQueryAdvertiserId(input.advertiserId);
  if (!decoded) throw new Error("유효한 BigQuery 광고주를 선택해 주세요.");
  const advertiserList = await listBigQueryAdvertisers();
  const advertiser = advertiserList.advertisers.find(
    (item) => item.id === input.advertiserId && item.source === decoded.source
  );
  if (!advertiser) throw new Error("선택한 광고주의 최신 집계 데이터를 찾지 못했습니다.");

  const cacheKey = `bigquery-candidates:v5:${input.advertiserId}:${input.period}`;
  let response = readBigQueryCache<BigQueryCandidateResponse>(cacheKey);
  if (response) {
    response = { ...response, cacheHit: true, processedBytes: 0 };
  } else {
    const range = periodRange(advertiser.latestDataDate, input.period);
    const signals = await queryBigQueryProductSignals({
      source: advertiser.source,
      brandName: advertiser.name,
      ...range,
    });
    const candidates = buildCandidatesFromSignals(signals.rows, {
      advertiserId: advertiser.id,
      source: advertiser.source,
      brandId: advertiser.brandId,
      brandName: advertiser.name,
      category: advertiser.category,
      storeUrl: advertiser.storeUrl,
      analysisPeriodStart: range.currentStart,
      analysisPeriodEnd: range.currentEnd,
      comparisonPeriodStart: range.previousStart,
      comparisonPeriodEnd: range.previousEnd,
      sourceTable: sourceTable(advertiser.source),
      candidateId: (row) => candidateId({ advertiser, period: input.period, productName: row.productName }),
    });
    response = {
      candidates,
      productFamilies: buildProductFamilies(signals.rows),
      typeCounts: recommendationTypeCounts(candidates),
      advertiser,
      period: input.period,
      latestDataDate: advertiser.latestDataDate,
      capabilities: capabilities(advertiser.source),
      partial: false,
      processedBytes: signals.processedBytes,
      cacheHit: signals.cacheHit,
      generatedAt: new Date().toISOString(),
    };
    writeBigQueryCache(cacheKey, response, CANDIDATE_CACHE_MS);
  }

  if (!response) throw new Error("BigQuery 광고 후보 응답을 구성하지 못했습니다.");

  const selectedType = input.type;
  if (!selectedType || selectedType === "all") return response;
  return {
    ...response,
    candidates: response.candidates.filter((candidate) => matchesCandidateType(candidate, selectedType)),
  };
}

export async function getBigQueryCandidate(candidateIdValue: string): Promise<BigQueryAdCandidate | null> {
  const parsed = parseCandidateId(candidateIdValue);
  if (!parsed) return null;
  const advertiserId = encodeBigQueryAdvertiserId(parsed.source, parsed.brandName);
  const response = await getBigQueryCandidates({
    advertiserId,
    period: parsed.period,
    type: "all",
  });
  return response.candidates.find((candidate) => candidate.id === candidateIdValue) || null;
}
