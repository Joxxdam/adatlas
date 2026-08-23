type Bucket = { count: number; resetAt: number };

declare global {
  var __adatlasSiteAnalysisRateLimits: Map<string, Bucket> | undefined;
}

const buckets = globalThis.__adatlasSiteAnalysisRateLimits || (globalThis.__adatlasSiteAnalysisRateLimits = new Map<string, Bucket>());

function clientKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "local";
}

export function assertSiteAnalysisRateLimit(request: Request, scope: "discover" | "analyze" | "select") {
  const now = Date.now();
  const windowMs = 60_000;
  const limit = scope === "discover" ? 10 : scope === "analyze" ? 20 : 40;
  const key = `${scope}:${clientKey(request)}`;
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (current.count >= limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    throw new SiteAnalysisRateLimitError(retryAfterSeconds);
  }
  current.count += 1;
}

export class SiteAnalysisRateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(`요청이 많습니다. ${retryAfterSeconds}초 후 다시 시도해주세요.`);
    this.name = "SiteAnalysisRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function clearSiteAnalysisRateLimits() {
  buckets.clear();
}
