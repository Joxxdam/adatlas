import "server-only";

const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function isLoopback(value: string) {
  return loopbackHosts.has(value.toLowerCase());
}

function hostName(value: string) {
  const first = value.split(",")[0]?.trim() || "";
  if (first.startsWith("[")) return first.slice(0, first.indexOf("]") + 1);
  return first.split(":")[0] || "";
}

export function verifyLocalGenerationAccess(request: Request) {
  const configuredToken = String(process.env.ADATLAS_INTERNAL_GENERATION_TOKEN || "").trim();
  const suppliedToken = String(request.headers.get("x-adatlas-generation-token") || "").trim();
  if (configuredToken && suppliedToken && suppliedToken === configuredToken) return;

  const requestUrl = new URL(request.url);
  const host = hostName(request.headers.get("host") || requestUrl.host);
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (!isLoopback(requestUrl.hostname) || !isLoopback(host) || (forwardedHost && !isLoopback(hostName(forwardedHost)))) {
    throw new Error("AI 광고 생성 API는 이 컴퓨터의 localhost에서만 사용할 수 있습니다.");
  }
  const origin = request.headers.get("origin");
  if (origin && !isLoopback(new URL(origin).hostname)) {
    throw new Error("외부 브라우저에서는 로컬 AI 광고 생성을 시작할 수 없습니다.");
  }
}

export function localAccessError(error: unknown) {
  return error instanceof Error && /localhost|외부 브라우저/.test(error.message);
}
