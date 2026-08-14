import "server-only";

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

type BigQueryGlobalCache = typeof globalThis & {
  __adAtlasBigQueryCache?: Map<string, CacheEntry<unknown>>;
};

const globalCache = globalThis as BigQueryGlobalCache;
const cache = globalCache.__adAtlasBigQueryCache || new Map<string, CacheEntry<unknown>>();

if (process.env.NODE_ENV !== "production") {
  globalCache.__adAtlasBigQueryCache = cache;
}

export function readBigQueryCache<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value as T;
}

export function writeBigQueryCache<T>(key: string, value: T, ttlMs: number) {
  cache.set(key, { expiresAt: Date.now() + ttlMs, value });
  if (cache.size <= 250) return;
  const now = Date.now();
  for (const [candidateKey, entry] of cache) {
    if (entry.expiresAt <= now || cache.size > 200) cache.delete(candidateKey);
  }
}
