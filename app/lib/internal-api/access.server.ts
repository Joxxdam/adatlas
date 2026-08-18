import { timingSafeEqual } from "node:crypto";

export class InternalApiAccessError extends Error {
  readonly status: 401 | 503;

  constructor(message: string, status: 401 | 503) {
    super(message);
    this.name = "InternalApiAccessError";
    this.status = status;
  }
}

function safeEqual(first: string, second: string) {
  const left = Buffer.from(first);
  const right = Buffer.from(second);
  return left.length === right.length && timingSafeEqual(left, right);
}

function requestCredential(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) return bearer;
  const proxyHeader = request.headers.get("x-adatlas-internal-token")?.trim();
  if (proxyHeader) return proxyHeader;
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("adatlas_internal_token="))
    ?.slice("adatlas_internal_token=".length);
  return cookie ? decodeURIComponent(cookie) : "";
}

export function assertInternalApiAccess(request: Request) {
  if (process.env.NODE_ENV !== "production") return;
  const configured = process.env.ADATLAS_INTERNAL_API_TOKEN?.trim();
  if (!configured) {
    throw new InternalApiAccessError(
      "내부 데이터 API 인증이 설정되지 않아 요청을 차단했습니다.",
      503
    );
  }
  const supplied = requestCredential(request);
  if (!supplied || !safeEqual(supplied, configured)) {
    throw new InternalApiAccessError("내부 데이터 API 인증이 필요합니다.", 401);
  }
}
