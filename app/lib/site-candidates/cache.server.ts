import "server-only";

import fs from "node:fs";
import path from "node:path";

import type { SiteCandidateAnalysisResult, SiteCandidateSelection, SiteDiscoveryResult } from "./types";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_FILE = path.join(process.cwd(), ".data", "site-candidates", "cache.json");

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

type PersistedCache = {
  version: 1;
  savedAt: string;
  discoveries: Array<[string, CacheEntry<SiteDiscoveryResult>]>;
  analyses: Array<[string, CacheEntry<SiteCandidateAnalysisResult>]>;
  selections: Array<[string, CacheEntry<SiteCandidateSelection>]>;
  discoveryByUrl: Array<[string, CacheEntry<string>]>;
  analysisByDiscovery: Array<[string, CacheEntry<string>]>;
};

function restoreCache(): SiteCandidateCache {
  const empty: SiteCandidateCache = {
    discoveries: new Map(),
    analyses: new Map(),
    selections: new Map(),
    discoveryByUrl: new Map(),
    analysisByDiscovery: new Map(),
  };
  try {
    const stored = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as PersistedCache;
    if (stored.version !== 1) return empty;
    const now = Date.now();
    const active = <T>(entries: Array<[string, CacheEntry<T>]>) => new Map(entries.filter(([, entry]) => entry.expiresAt > now));
    return {
      discoveries: active(stored.discoveries || []),
      analyses: active(stored.analyses || []),
      selections: active(stored.selections || []),
      discoveryByUrl: active(stored.discoveryByUrl || []),
      analysisByDiscovery: active(stored.analysisByDiscovery || []),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("사이트 후보 캐시를 복구하지 못했습니다.");
    }
    return empty;
  }
}

const cache: SiteCandidateCache = globalThis.__adatlasSiteCandidateCache || (globalThis.__adatlasSiteCandidateCache = restoreCache());
cache.discoveryByUrl ||= new Map<string, CacheEntry<string>>();
cache.analysisByDiscovery ||= new Map<string, CacheEntry<string>>();

function prune<T>(store: Map<string, CacheEntry<T>>) {
  const now = Date.now();
  let changed = false;
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) {
      store.delete(key);
      changed = true;
    }
  }
  return changed;
}

function persist() {
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  const temporary = `${CACHE_FILE}.${process.pid}.tmp`;
  const value: PersistedCache = {
    version: 1,
    savedAt: new Date().toISOString(),
    discoveries: [...cache.discoveries],
    analyses: [...cache.analyses],
    selections: [...cache.selections],
    discoveryByUrl: [...cache.discoveryByUrl],
    analysisByDiscovery: [...cache.analysisByDiscovery],
  };
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, CACHE_FILE);
}

function set<T>(store: Map<string, CacheEntry<T>>, key: string, value: T) {
  prune(store);
  store.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

function get<T>(store: Map<string, CacheEntry<T>>, key: string): T | undefined {
  if (prune(store)) persist();
  return store.get(key)?.value;
}

export const siteCandidateCache: SiteCandidateCacheStore = {
  setDiscovery(value: SiteDiscoveryResult) {
    set(cache.discoveries, value.discoveryId, value);
    set(cache.discoveryByUrl, value.normalizedUrl, value.discoveryId);
    set(cache.discoveryByUrl, value.inputUrl, value.discoveryId);
    persist();
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
    persist();
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
    persist();
  },
  getSelection(id: string) {
    return get(cache.selections, id);
  },
};
