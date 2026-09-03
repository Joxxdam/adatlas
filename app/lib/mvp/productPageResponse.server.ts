export function isPrivateHostname(hostname: string) {
  const lower = hostname.toLowerCase();
  if (["localhost", "0.0.0.0"].includes(lower)) return true;
  if (/^127\./.test(lower)) return true;
  if (/^10\./.test(lower)) return true;
  if (/^192\.168\./.test(lower)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(lower)) return true;
  if (/^\[?::1\]?$/.test(lower)) return true;
  return false;
}

export function isSafeHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol) && !isPrivateHostname(parsed.hostname);
  } catch {
    return false;
  }
}

function normalizeCharset(value: string) {
  const normalized = value.trim().toLowerCase().replace(/["']/g, "");
  if (["euc-kr", "ks_c_5601-1987", "ks_c_5601", "cp949", "x-windows-949"].includes(normalized)) {
    return "euc-kr";
  }
  if (["utf8", "utf-8"].includes(normalized)) return "utf-8";
  return normalized || "utf-8";
}

function charsetFromContentType(contentType: string | null) {
  const match = contentType?.match(/charset\s*=\s*([^;\s]+)/i);
  return match?.[1] ? normalizeCharset(match[1]) : "";
}

function charsetFromHtmlSample(html: string) {
  const match = html.match(/<meta[^>]+charset=["']?\s*([^"'\s/>]+)/i);
  if (match?.[1]) return normalizeCharset(match[1]);

  const httpEquivMatch = html.match(/<meta[^>]+http-equiv=["']content-type["'][^>]+content=["'][^"']*charset=([^"'\s;]+)/i);
  return httpEquivMatch?.[1] ? normalizeCharset(httpEquivMatch[1]) : "";
}

export function decodeHtmlResponse(buffer: ArrayBuffer, contentType: string | null) {
  const bytes = new Uint8Array(buffer);
  const utf8Sample = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 4096));
  const charset = charsetFromContentType(contentType) || charsetFromHtmlSample(utf8Sample) || "utf-8";

  try {
    return new TextDecoder(charset, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
}
