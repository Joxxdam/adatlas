import "server-only";

import type {
  SiteCandidateAnalysisResult,
  SiteCandidateSelection,
  SiteDiscoveryResult,
} from "./types";

const CACHE_TTL_MS = 20 * 60 * 1000;

type CacheEntry<T> = { value: T; expiresAt: number };
type SiteCandidateCache = {
  discoveries: Map<string, CacheEntry<SiteDiscoveryResult>>;
  analyses: Map<string, CacheEntry<SiteCandidateAnalysisResult>>;
  selections: Map<string, CacheEntry<SiteCandidateSelection>>;
  discoveryByUrl: Map<string, CacheEntry<string>>;
  analysisByDiscovery: Map<string, CacheEntry<string>>;
};

export interface SiteCandidateCacheStore {
  setDiscovery(value: SiteDiscoveryResult): void;
  getDiscovery(id: string): SiteDiscoveryResult | undefined;
  getDiscoveryByUrl(url: string): SiteDiscoveryResult | undefined;
  setAnalysis(value: SiteCandidateAnalysisResult): void;
  getAnalysis(id: string): SiteCandidateAnalysisResult | undefined;
  getAnalysisByDiscovery(id: string): SiteCandidateAnalysisResult | undefined;
  setSelection(value: SiteCandidateSelection): void;
  getSelection(id: string): SiteCandidateSelection | undefined;
}

declare global {
  var __adatlasSiteCandidateCache: SiteCandidateCache | undefined;
}

const cache: SiteCandidateCache =
  globalThis.__adatlasSiteCandidateCache ||
  (globalThis.__adatlasSiteCandidateCache = {
    discoveries: new Map<string, CacheEntry<SiteDiscoveryResult>>(),
    analyses: new Map<string, CacheEntry<SiteCandidateAnalysisResult>>(),
    selections: new Map<string, CacheEntry<SiteCandidateSelection>>(),
    discoveryByUrl: new Map<string, CacheEntry<string>>(),
    analysisByDiscovery: new Map<string, CacheEntry<string>>(),
  });
cache.discoveryByUrl ||= new Map<string, CacheEntry<string>>();
cache.analysisByDiscovery ||= new Map<string, CacheEntry<string>>();

function prune<T>(store: Map<string, CacheEntry<T>>) {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
}

function set<T>(store: Map<string, CacheEntry<T>>, key: string, value: T) {
  prune(store);
  store.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

function get<T>(store: Map<string, CacheEntry<T>>, key: string): T | undefined {
  prune(store);
  return store.get(key)?.value;
}

export const siteCandidateCache: SiteCandidateCacheStore = {
  setDiscovery(value: SiteDiscoveryResult) {
    set(cache.discoveries, value.discoveryId, value);
    set(cache.discoveryByUrl, value.normalizedUrl, value.discoveryId);
    set(cache.discoveryByUrl, value.inputUrl, value.discoveryId);
  },
  getDiscovery(id: string) {
    return get(cache.discoveries, id);
  },
  getDiscoveryByUrl(url: string) {
    const id = get(cache.discoveryByUrl, url);
    return id ? get(cache.discoveries, id) : undefined;
  },
  setAnalysis(value: SiteCandidateAnalysisResult) {
    set(cache.analyses, value.analysisId, value);
    set(cache.analysisByDiscovery, value.discovery.discoveryId, value.analysisId);
  },
  getAnalysis(id: string) {
    return get(cache.analyses, id);
  },
  getAnalysisByDiscovery(id: string) {
    const analysisId = get(cache.analysisByDiscovery, id);
    return analysisId ? get(cache.analyses, analysisId) : undefined;
  },
  setSelection(value: SiteCandidateSelection) {
    set(cache.selections, value.selectionId, value);
  },
  getSelection(id: string) {
    return get(cache.selections, id);
  },
};
