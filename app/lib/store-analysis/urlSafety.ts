import { lookup } from "dns/promises";
import { isIP } from "net";

const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_HTML_BYTES = 2_000_000;
const MAX_IMAGE_BYTES = 12_000_000;
const MAX_REDIRECTS = 4;

export class StoreAnalysisNetworkError extends Error {
  readonly code:
    | "INVALID_URL"
    | "UNSAFE_URL"
    | "DNS_FAILED"
    | "TIMEOUT"
    | "ACCESS_BLOCKED"
    | "INVALID_CONTENT_TYPE"
    | "RESPONSE_TOO_LARGE"
    | "TOO_MANY_REDIRECTS"
    | "REQUEST_FAILED";

  constructor(
    message: string,
    code:
      | "INVALID_URL"
      | "UNSAFE_URL"
      | "DNS_FAILED"
      | "TIMEOUT"
      | "ACCESS_BLOCKED"
      | "INVALID_CONTENT_TYPE"
      | "RESPONSE_TOO_LARGE"
      | "TOO_MANY_REDIRECTS"
      | "REQUEST_FAILED"
  ) {
    super(message);
    this.name = "StoreAnalysisNetworkError";
    this.code = code;
  }
}

function ipv4ToNumber(value: string) {
  const parts = value.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return undefined;
  }
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function ipv4InCidr(value: string, base: string, prefix: number) {
  const address = ipv4ToNumber(value);
  const network = ipv4ToNumber(base);
  if (address === undefined || network === undefined) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (address & mask) === (network & mask);
}

export function isPrivateIpAddress(address: string) {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized.startsWith("::ffff:")) {
    return isPrivateIpAddress(normalized.slice("::ffff:".length));
  }
  if (isIP(normalized) === 4) {
    return [
      ["0.0.0.0", 8],
      ["10.0.0.0", 8],
      ["100.64.0.0", 10],
      ["127.0.0.0", 8],
      ["169.254.0.0", 16],
      ["172.16.0.0", 12],
      ["192.0.0.0", 24],
      ["192.0.2.0", 24],
      ["192.168.0.0", 16],
      ["198.18.0.0", 15],
      ["198.51.100.0", 24],
      ["203.0.113.0", 24],
      ["224.0.0.0", 4],
      ["240.0.0.0", 4],
    ].some(([base, prefix]) => ipv4InCidr(normalized, String(base), Number(prefix)));
  }
  if (isIP(normalized) === 6) {
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("::") ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89a-f]/.test(normalized) ||
      normalized.startsWith("ff") ||
      normalized.startsWith("2001:db8")
    );
  }
  return true;
}

function unsafeHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return (
    !normalized ||
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".lan") ||
    normalized === "0.0.0.0"
  );
}

export async function validatePublicHttpUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(String(value || "").trim());
  } catch {
    throw new StoreAnalysisNetworkError("올바른 쇼핑몰 URL을 입력해주세요.", "INVALID_URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new StoreAnalysisNetworkError(
      "http 또는 https 공개 URL만 분석할 수 있습니다.",
      "UNSAFE_URL"
    );
  }
  if (unsafeHostname(parsed.hostname)) {
    throw new StoreAnalysisNetworkError(
      "내부망 또는 로컬 주소는 분석할 수 없습니다.",
      "UNSAFE_URL"
    );
  }

  const literalType = isIP(parsed.hostname.replace(/^\[|\]$/g, ""));
  if (literalType && isPrivateIpAddress(parsed.hostname)) {
    throw new StoreAnalysisNetworkError(
      "사설 IP 또는 내부망 주소는 분석할 수 없습니다.",
      "UNSAFE_URL"
    );
  }

  if (!literalType) {
    let records: Array<{ address: string }>;
    try {
      records = await lookup(parsed.hostname, { all: true, verbatim: true });
    } catch {
      throw new StoreAnalysisNetworkError(
        "쇼핑몰 도메인의 네트워크 주소를 확인하지 못했습니다.",
        "DNS_FAILED"
      );
    }
    if (!records.length || records.some((record) => isPrivateIpAddress(record.address))) {
      throw new StoreAnalysisNetworkError(
        "내부망으로 연결될 수 있는 주소는 분석할 수 없습니다.",
        "UNSAFE_URL"
      );
    }
  }

  parsed.hash = "";
  return parsed;
}

export function normalizedStoreHostname(value: string) {
  try {
    return new URL(value).hostname
      .toLowerCase()
      .replace(/^www\./, "")
      .replace(/\.$/, "");
  } catch {
    return "";
  }
}

export function isSameStoreDomain(candidate: string, storeUrl: string) {
  const candidateHost = normalizedStoreHostname(candidate);
  const storeHost = normalizedStoreHostname(storeUrl);
  return Boolean(candidateHost && storeHost && candidateHost === storeHost);
}

async function readLimitedBody(response: Response, maxBytes: number) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength && contentLength > maxBytes) {
    throw new StoreAnalysisNetworkError(
      "응답 크기가 허용 범위를 초과했습니다.",
      "RESPONSE_TOO_LARGE"
    );
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new StoreAnalysisNetworkError(
        "응답 크기가 허용 범위를 초과했습니다.",
        "RESPONSE_TOO_LARGE"
      );
    }
    chunks.push(value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function decodeHtml(bytes: Uint8Array, contentType: string) {
  const contentTypeCharset = contentType
    .match(/charset\s*=\s*([^;\s]+)/i)?.[1]
    ?.replace(/["']/g, "");
  const utf8Sample = new TextDecoder("utf-8").decode(bytes.slice(0, 4096));
  const metaCharset = utf8Sample.match(/<meta[^>]+charset=["']?\s*([^"'\s/>]+)/i)?.[1];
  const charset = (contentTypeCharset || metaCharset || "utf-8").toLowerCase();
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export type SafeHtmlResponse = {
  requestedUrl: string;
  finalUrl: string;
  html: string;
  status: number;
  contentType: string;
};

export type SafeTextResponse = SafeHtmlResponse;

export async function safeFetchPublicText(
  value: string,
  options: {
    timeoutMs?: number;
    maxBytes?: number;
    userAgent?: string;
    allowedContentTypes?: RegExp;
  } = {}
): Promise<SafeTextResponse> {
  let current = await validatePublicHttpUrl(value);
  const requestedUrl = current.toString();
  const allowedContentTypes =
    options.allowedContentTypes || /(?:text\/html|application\/xhtml\+xml|application\/xml|text\/xml|text\/plain)/i;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    let response: Response;
    try {
      response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(options.timeoutMs || DEFAULT_TIMEOUT_MS),
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml,text/xml,text/plain;q=0.8",
          "User-Agent": options.userAgent || "Mozilla/5.0 (compatible; AdAtlasStoreAnalyzer/1.0)",
        },
      });
    } catch (error) {
      if (error instanceof Error && /abort|timeout/i.test(`${error.name} ${error.message}`)) {
        throw new StoreAnalysisNetworkError("요청 시간이 초과되었습니다.", "TIMEOUT");
      }
      throw new StoreAnalysisNetworkError("쇼핑몰 페이지 요청에 실패했습니다.", "REQUEST_FAILED");
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new StoreAnalysisNetworkError(
          "리디렉션 위치를 확인하지 못했습니다.",
          "REQUEST_FAILED"
        );
      }
      if (redirectCount === MAX_REDIRECTS) {
        throw new StoreAnalysisNetworkError("리디렉션 횟수가 너무 많습니다.", "TOO_MANY_REDIRECTS");
      }
      current = await validatePublicHttpUrl(new URL(location, current).toString());
      continue;
    }

    await validatePublicHttpUrl(response.url || current.toString());
    if (!response.ok) {
      const blocked = [401, 403, 407, 429, 451].includes(response.status);
      throw new StoreAnalysisNetworkError(
        blocked
          ? `사이트 접근이 제한되었습니다. (HTTP ${response.status})`
          : `쇼핑몰 페이지 요청에 실패했습니다. (HTTP ${response.status})`,
        blocked ? "ACCESS_BLOCKED" : "REQUEST_FAILED"
      );
    }
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (contentType && !allowedContentTypes.test(contentType)) {
      throw new StoreAnalysisNetworkError(
        "분석할 수 없는 콘텐츠 유형입니다.",
        "INVALID_CONTENT_TYPE"
      );
    }
    const bytes = await readLimitedBody(response, options.maxBytes || MAX_HTML_BYTES);
    return {
      requestedUrl,
      finalUrl: response.url || current.toString(),
      html: decodeHtml(bytes, contentType),
      status: response.status,
      contentType,
    };
  }
  throw new StoreAnalysisNetworkError("리디렉션 횟수가 너무 많습니다.", "TOO_MANY_REDIRECTS");
}

export async function safeFetchHtml(
  value: string,
  options: { timeoutMs?: number; maxBytes?: number; userAgent?: string } = {}
): Promise<SafeHtmlResponse> {
  let current = await validatePublicHttpUrl(value);
  const requestedUrl = current.toString();
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    let response: Response;
    try {
      response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(options.timeoutMs || DEFAULT_TIMEOUT_MS),
        headers: {
          Accept: "text/html,application/xhtml+xml;q=0.9",
          "User-Agent": options.userAgent || "Mozilla/5.0 (compatible; AdAtlasStoreAnalyzer/1.0)",
        },
      });
    } catch (error) {
      if (error instanceof Error && /abort|timeout/i.test(`${error.name} ${error.message}`)) {
        throw new StoreAnalysisNetworkError("요청 시간이 초과되었습니다.", "TIMEOUT");
      }
      throw new StoreAnalysisNetworkError("쇼핑몰 페이지 요청에 실패했습니다.", "REQUEST_FAILED");
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new StoreAnalysisNetworkError(
          "리디렉션 위치를 확인하지 못했습니다.",
          "REQUEST_FAILED"
        );
      }
      if (redirectCount === MAX_REDIRECTS) {
        throw new StoreAnalysisNetworkError("리디렉션 횟수가 너무 많습니다.", "TOO_MANY_REDIRECTS");
      }
      current = await validatePublicHttpUrl(new URL(location, current).toString());
      continue;
    }

    await validatePublicHttpUrl(response.url || current.toString());
    if (!response.ok) {
      const blocked = [401, 403, 407, 429, 451].includes(response.status);
      throw new StoreAnalysisNetworkError(
        blocked
          ? `사이트 접근이 제한되었습니다. (HTTP ${response.status})`
          : `쇼핑몰 페이지 요청에 실패했습니다. (HTTP ${response.status})`,
        blocked ? "ACCESS_BLOCKED" : "REQUEST_FAILED"
      );
    }
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!/(?:text\/html|application\/xhtml\+xml)/.test(contentType)) {
      throw new StoreAnalysisNetworkError(
        "HTML 페이지가 아닌 응답은 분석할 수 없습니다.",
        "INVALID_CONTENT_TYPE"
      );
    }
    const bytes = await readLimitedBody(response, options.maxBytes || MAX_HTML_BYTES);
    return {
      requestedUrl,
      finalUrl: response.url || current.toString(),
      html: decodeHtml(bytes, contentType),
      status: response.status,
      contentType,
    };
  }
  throw new StoreAnalysisNetworkError("리디렉션 횟수가 너무 많습니다.", "TOO_MANY_REDIRECTS");
}

export async function validateRemoteImageUrl(value: string) {
  let current = await validatePublicHttpUrl(value);
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    let response: Response;
    try {
      response = await fetch(current, {
        method: "HEAD",
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; AdAtlasStoreAnalyzer/1.0)" },
      });
    } catch {
      return false;
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirectCount === MAX_REDIRECTS) return false;
      current = await validatePublicHttpUrl(new URL(location, current).toString());
      continue;
    }
    if (response.status === 405 || response.status === 501) {
      try {
        response = await fetch(current, {
          method: "GET",
          redirect: "manual",
          cache: "no-store",
          signal: AbortSignal.timeout(8_000),
          headers: {
            Range: "bytes=0-1023",
            "User-Agent": "Mozilla/5.0 (compatible; AdAtlasStoreAnalyzer/1.0)",
          },
        });
      } catch {
        return false;
      }
    }
    if (!response.ok) return false;
    await validatePublicHttpUrl(response.url || current.toString());
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const contentLength = Number(response.headers.get("content-length") || 0);
    return contentType.startsWith("image/") && (!contentLength || contentLength <= MAX_IMAGE_BYTES);
  }
  return false;
}

export type RobotsPolicy = {
  found: boolean;
  disallowedPaths: string[];
};

export async function readRobotsPolicy(storeUrl: string): Promise<RobotsPolicy> {
  const root = new URL(storeUrl);
  const robotsUrl = new URL("/robots.txt", root).toString();
  try {
    let safeUrl = await validatePublicHttpUrl(robotsUrl);
    let response: Response | undefined;
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      response = await fetch(safeUrl, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(6_000),
        headers: { "User-Agent": "AdAtlasStoreAnalyzer/1.0" },
      });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      if (!location || redirectCount === MAX_REDIRECTS) {
        return { found: false, disallowedPaths: [] };
      }
      const redirected = await validatePublicHttpUrl(new URL(location, safeUrl).toString());
      if (!isSameStoreDomain(redirected.toString(), storeUrl)) {
        return { found: false, disallowedPaths: [] };
      }
      safeUrl = redirected;
    }
    if (!response?.ok) return { found: false, disallowedPaths: [] };
    await validatePublicHttpUrl(response.url || safeUrl.toString());
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (contentType && !/(?:text\/plain|text\/html|application\/octet-stream)/.test(contentType)) {
      return { found: false, disallowedPaths: [] };
    }
    const bytes = await readLimitedBody(response, 200_000);
    const text = new TextDecoder("utf-8").decode(bytes);
    const disallowedPaths: string[] = [];
    let appliesToUs = false;
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.replace(/#.*$/, "").trim();
      if (!line) continue;
      const separator = line.indexOf(":");
      if (separator < 0) continue;
      const key = line.slice(0, separator).trim().toLowerCase();
      const value = line.slice(separator + 1).trim();
      if (key === "user-agent") {
        appliesToUs = value === "*" || /adatlas/i.test(value);
      } else if (key === "disallow" && appliesToUs && value) {
        disallowedPaths.push(value);
      }
    }
    return { found: true, disallowedPaths: Array.from(new Set(disallowedPaths)) };
  } catch {
    return { found: false, disallowedPaths: [] };
  }
}

export function robotsAllowsUrl(policy: RobotsPolicy, value: string) {
  if (!policy.found || !policy.disallowedPaths.length) return true;
  const parsed = new URL(value);
  const path = `${parsed.pathname}${parsed.search}`;
  return !policy.disallowedPaths.some((rule) => {
    const normalizedRule = rule.trim();
    if (!normalizedRule) return false;

    const anchoredAtEnd = normalizedRule.endsWith("$");
    const source = anchoredAtEnd ? normalizedRule.slice(0, -1) : normalizedRule;
    const pattern = source
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");

    return new RegExp(`^${pattern}${anchoredAtEnd ? "$" : ""}`).test(path);
  });
}
