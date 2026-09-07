import "server-only";

import { timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { GenerationAccessError, type GenerationAccessPrincipal } from "./generationAccess";
export { assertGenerationJobAccess, canAccessGenerationJob, GenerationAccessError, requestOwnerForAccess } from "./generationAccess";
export type { GenerationAccessPrincipal } from "./generationAccess";

const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const accessJwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function isLoopback(value: string) {
  return loopbackHosts.has(value.toLowerCase());
}

function hostName(value: string) {
  const first = value.split(",")[0]?.trim() || "";
  if (first.startsWith("[")) return first.slice(0, first.indexOf("]") + 1);
  return first.split(":")[0] || "";
}

function sameSecret(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isLocalBrowserRequest(request: Request) {
  const requestUrl = new URL(request.url);
  const host = hostName(request.headers.get("host") || requestUrl.host);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  // cloudflared가 origin Host를 localhost로 덮어쓰는 설정이어도 외부 요청을
  // 로컬 브라우저로 오인하지 않습니다.
  if (request.headers.has("cf-ray") || request.headers.has("cf-connecting-ip") || (forwardedFor && !isLoopback(forwardedFor))) return false;
  if (!isLoopback(requestUrl.hostname) || !isLoopback(host) || (forwardedHost && !isLoopback(hostName(forwardedHost)))) return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return isLoopback(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function cloudflareAccessConfig() {
  const rawTeamDomain = String(process.env.ADATLAS_CLOUDFLARE_ACCESS_TEAM_DOMAIN || "").trim();
  const audiences = String(process.env.ADATLAS_CLOUDFLARE_ACCESS_AUD || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!rawTeamDomain || !audiences.length) return null;

  let teamDomain: URL;
  try {
    teamDomain = new URL(rawTeamDomain.includes("://") ? rawTeamDomain : `https://${rawTeamDomain}`);
  } catch {
    throw new GenerationAccessError("Cloudflare Access 서버 설정이 올바르지 않습니다.", 503);
  }
  if (
    teamDomain.protocol !== "https:"
    || !teamDomain.hostname.toLowerCase().endsWith(".cloudflareaccess.com")
    || Boolean(teamDomain.username || teamDomain.password || teamDomain.port)
    || (teamDomain.pathname !== "/" && teamDomain.pathname !== "")
    || teamDomain.search
    || teamDomain.hash
  ) {
    throw new GenerationAccessError("Cloudflare Access 서버 설정이 올바르지 않습니다.", 503);
  }
  return {
    issuer: teamDomain.origin,
    audiences,
    jwksUrl: new URL("/cdn-cgi/access/certs", teamDomain.origin),
  };
}

function remoteJwks(issuer: string, jwksUrl: URL) {
  const existing = accessJwksByIssuer.get(issuer);
  if (existing) return existing;
  const created = createRemoteJWKSet(jwksUrl, {
    timeoutDuration: 5_000,
    cooldownDuration: 30_000,
    cacheMaxAge: 10 * 60_000,
  });
  accessJwksByIssuer.set(issuer, created);
  return created;
}

async function verifyCloudflareAccess(request: Request): Promise<Extract<GenerationAccessPrincipal, { kind: "cloudflare-access" }>> {
  const config = cloudflareAccessConfig();
  if (!config) {
    throw new GenerationAccessError("외부 접속용 Cloudflare Access 인증이 아직 서버에 설정되지 않았습니다.", 503);
  }
  const token = String(request.headers.get("cf-access-jwt-assertion") || "").trim();
  if (!token) throw new GenerationAccessError("Cloudflare Access 로그인이 필요합니다.");

  try {
    const { payload } = await jwtVerify(token, remoteJwks(config.issuer, config.jwksUrl), {
      issuer: config.issuer,
      audience: config.audiences,
      algorithms: ["RS256"],
    });
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    const subject = typeof payload.sub === "string" ? payload.sub.trim() : email;
    if (!subject) throw new Error("missing Access subject");
    return {
      kind: "cloudflare-access",
      subject,
      email: email || undefined,
    };
  } catch {
    throw new GenerationAccessError("Cloudflare Access 인증을 확인하지 못했습니다. 다시 로그인해 주세요.");
  }
}

/**
 * localhost와 서버 내부 토큰은 기존처럼 허용하고, 외부 요청은 Cloudflare
 * Access가 서명한 JWT를 검증한 뒤에만 허용합니다.
 */
export async function verifyLocalGenerationAccess(request: Request): Promise<GenerationAccessPrincipal> {
  const configuredToken = String(process.env.ADATLAS_INTERNAL_GENERATION_TOKEN || "").trim();
  const suppliedToken = String(request.headers.get("x-adatlas-generation-token") || "").trim();
  if (configuredToken && suppliedToken && sameSecret(suppliedToken, configuredToken)) return { kind: "internal" };
  if (isLocalBrowserRequest(request)) return { kind: "local" };
  return verifyCloudflareAccess(request);
}

export function localAccessError(error: unknown) {
  return error instanceof GenerationAccessError;
}

export function localAccessErrorStatus(error: unknown) {
  return error instanceof GenerationAccessError ? error.status : undefined;
}
