import "server-only";
import { isTrustedAutoProductionRequest } from "./requestPolicy";

export class AutoProductionAccessError extends Error {}

export function verifyAutoProductionAccess(request: Request, mutation = false) {
  const trusted = isTrustedAutoProductionRequest({
    url: request.url,
    host: request.headers.get("host"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    origin: request.headers.get("origin"),
    suppliedToken: request.headers.get("x-adatlas-auto-production-token"),
    configuredToken: process.env.ADATLAS_AUTO_PRODUCTION_TOKEN,
    mutation,
  });
  if (!trusted) {
    throw new AutoProductionAccessError(mutation ? "자동 제작 변경 요청은 localhost 브라우저 또는 내부 자동 제작 토큰에서만 허용됩니다." : "자동 제작 정보는 이 컴퓨터의 localhost에서만 확인할 수 있습니다.");
  }
}
