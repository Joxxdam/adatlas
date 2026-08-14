import "server-only";

import { randomUUID } from "crypto";
import { uniqueStrings } from "../store-analysis/htmlUtils";
import { extractorForPlatform, detectStorePlatform } from "../store-analysis/platformDetector";
import type { DiscoveredProductLink } from "../store-analysis/types";
import {
  isSameStoreDomain,
  readRobotsPolicy,
  robotsAllowsUrl,
  safeFetchHtml,
} from "../store-analysis/urlSafety";
import { siteCandidateCache } from "./cache.server";
import { selectDiverseSiteCandidates } from "./diversity";
import { detectSitePageType } from "./pageClassifier";
import { extractSiteProductRecord } from "./productSignals";
import { buildSiteAdCandidate, exclusionReasons } from "./scoring";
import type {
  SiteAdCandidate,
  SiteCandidateAnalysisResult,
  SiteCandidateSelection,
  SiteDiscoveryResult,
} from "./types";

const MAX_CONCURRENCY = 3;
const REQUEST_GAP_MS = 140;
const TOTAL_ANALYSIS_TIMEOUT_MS = 75_000;

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  let nextRequestAt = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const wait = Math.max(0, nextRequestAt - Date.now());
      nextRequestAt = Math.max(Date.now(), nextRequestAt) + REQUEST_GAP_MS;
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return results;
}

export function cacheSiteDiscovery(result: SiteDiscoveryResult) {
  siteCandidateCache.setDiscovery(result);
  return result;
}

export async function analyzeDiscoveredSite(discoveryId: string) {
  const discovery = siteCandidateCache.getDiscovery(discoveryId);
  if (!discovery) {
    throw new Error("사이트 탐색 결과가 만료되었습니다. URL부터 다시 분석해주세요.");
  }
  if (!discovery.products.length) {
    const empty: SiteCandidateAnalysisResult = {
      analysisId: `site-analysis-${randomUUID()}`,
      discovery,
      candidates: [],
      analyzedProductCount: 0,
      excludedProductCount: 0,
      failedProductCount: 0,
      warnings: discovery.warnings,
      analyzedAt: new Date().toISOString(),
      disclaimer:
        "사이트 공개정보를 기반으로 광고 콘텐츠 후보를 추천합니다. 실제 판매·광고 성과가 아니며 광고 테스트로 검증해야 합니다.",
    };
    siteCandidateCache.setAnalysis(empty);
    return empty;
  }

  const startedAt = Date.now();
  const robots = await readRobotsPolicy(discovery.normalizedUrl);
  const warnings = [...discovery.warnings];
  let excludedProductCount = 0;
  let failedProductCount = 0;
  const analyzed = await mapWithConcurrency(
    discovery.products.slice(0, 30),
    MAX_CONCURRENCY,
    async (item) => {
      if (Date.now() - startedAt >= TOTAL_ANALYSIS_TIMEOUT_MS) {
        failedProductCount += 1;
        return null;
      }
      if (
        !isSameStoreDomain(item.url, discovery.normalizedUrl) ||
        !robotsAllowsUrl(robots, item.url)
      ) {
        failedProductCount += 1;
        return null;
      }
      try {
        const response = await safeFetchHtml(item.url, { timeoutMs: 12_000 });
        if (
          !isSameStoreDomain(response.finalUrl, discovery.normalizedUrl) ||
          detectSitePageType(response.finalUrl, response.html) !== "product"
        ) {
          excludedProductCount += 1;
          return null;
        }
        const platform = detectStorePlatform(response.finalUrl, response.html);
        const extractor = extractorForPlatform(platform);
        const discoveredLink: DiscoveredProductLink = {
          url: response.finalUrl,
          label: item.label,
          category: item.category,
          discoveredFrom: item.discoveredFrom,
          isBest: item.isBest,
          isNew: item.isNew,
          isDiscounted: item.isDiscounted,
        };
        const summary = extractor.extractProductSummary(
          response.finalUrl,
          response.html,
          discoveredLink
        );
        const detail = extractor.extractProductDetail(
          response.finalUrl,
          response.html,
          summary,
          true
        );
        const product = extractSiteProductRecord({
          html: response.html,
          summary,
          detail,
          brandName: discovery.brandName || discovery.storeName,
        });
        const exclusions = exclusionReasons(product);
        if (exclusions.length) {
          excludedProductCount += 1;
          warnings.push(`${product.productName}: ${exclusions.join(", ")}`);
          return null;
        }
        return buildSiteAdCandidate(product);
      } catch (error) {
        failedProductCount += 1;
        warnings.push(
          `${item.label || item.url}: ${error instanceof Error ? error.message : "상품 분석 실패"}`
        );
        return null;
      }
    }
  );
  if (Date.now() - startedAt >= TOTAL_ANALYSIS_TIMEOUT_MS) {
    warnings.push("전체 분석 시간 제한으로 일부 상품만 분석했습니다.");
  }
  const available = analyzed.filter(
    (candidate): candidate is SiteAdCandidate => candidate !== null
  );
  const candidates = selectDiverseSiteCandidates(available, 8);
  const result: SiteCandidateAnalysisResult = {
    analysisId: `site-analysis-${randomUUID()}`,
    discovery: {
      ...discovery,
      analyzableProductCount: available.length,
    },
    candidates,
    analyzedProductCount: available.length,
    excludedProductCount,
    failedProductCount,
    warnings: uniqueStrings(warnings, 40),
    analyzedAt: new Date().toISOString(),
    disclaimer:
      "사이트 공개정보를 기반으로 광고 콘텐츠 후보를 추천합니다. 실제 판매·광고 성과가 아닌 페이지 기반 분석이며, 최종 성과는 광고 테스트로 검증해야 합니다.",
  };
  siteCandidateCache.setAnalysis(result);
  return result;
}

export function selectSiteCandidate(analysisId: string, candidateId: string) {
  const analysis = siteCandidateCache.getAnalysis(analysisId);
  if (!analysis) {
    throw new Error("사이트 후보 분석 결과가 만료되었습니다. 사이트를 다시 분석해주세요.");
  }
  const candidate = analysis.candidates.find((item) => item.id === candidateId);
  if (!candidate) throw new Error("선택한 광고 후보를 찾지 못했습니다.");
  const selection: SiteCandidateSelection = {
    selectionId: `site-selection-${randomUUID()}`,
    analysisId,
    candidate,
    createdAt: new Date().toISOString(),
  };
  siteCandidateCache.setSelection(selection);
  return selection;
}
