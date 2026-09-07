import type { GenerationJob, GenerationRequestOwner } from "./types";

export type GenerationAccessPrincipal =
  | { kind: "local" | "internal" }
  | { kind: "cloudflare-access"; subject: string; email?: string };

export class GenerationAccessError extends Error {
  readonly status: 403 | 503;

  constructor(message: string, status: 403 | 503 = 403) {
    super(message);
    this.name = "GenerationAccessError";
    this.status = status;
  }
}

export function requestOwnerForAccess(principal: GenerationAccessPrincipal): GenerationRequestOwner | undefined {
  return principal.kind === "cloudflare-access"
    ? { provider: "cloudflare-access", subject: principal.subject, email: principal.email }
    : undefined;
}

export function canAccessGenerationJob(principal: GenerationAccessPrincipal, job: Pick<GenerationJob, "requestedBy">) {
  if (principal.kind !== "cloudflare-access") return true;
  return job.requestedBy?.provider === "cloudflare-access" && job.requestedBy.subject === principal.subject;
}

export function assertGenerationJobAccess(principal: GenerationAccessPrincipal, job: Pick<GenerationJob, "requestedBy">) {
  if (!canAccessGenerationJob(principal, job)) {
    throw new GenerationAccessError("이 계정에서 요청한 광고 제작 작업이 아닙니다.");
  }
}
