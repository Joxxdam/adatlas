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
};

declare global {
  var __adatlasSiteCandidateCache: SiteCandidateCache | undefined;
}

const cache: SiteCandidateCache =
  globalThis.__adatlasSiteCandidateCache ||
  (globalThis.__adatlasSiteCandidateCache = {
    discoveries: new Map<string, CacheEntry<SiteDiscoveryResult>>(),
    analyses: new Map<string, CacheEntry<SiteCandidateAnalysisResult>>(),
    selections: new Map<string, CacheEntry<SiteCandidateSelection>>(),
  });

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

export const siteCandidateCache = {
  setDiscovery(value: SiteDiscoveryResult) {
    set(cache.discoveries, value.discoveryId, value);
  },
  getDiscovery(id: string) {
    return get(cache.discoveries, id);
  },
  setAnalysis(value: SiteCandidateAnalysisResult) {
    set(cache.analyses, value.analysisId, value);
  },
  getAnalysis(id: string) {
    return get(cache.analyses, id);
  },
  setSelection(value: SiteCandidateSelection) {
    set(cache.selections, value.selectionId, value);
  },
  getSelection(id: string) {
    return get(cache.selections, id);
  },
};
