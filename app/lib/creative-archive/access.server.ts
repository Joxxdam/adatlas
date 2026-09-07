import "server-only";

import { creativeGenerationJobStore } from "../creative-generation/jobStore.server";
import {
  assertGenerationJobAccess,
  canAccessGenerationJob,
  GenerationAccessError,
  type GenerationAccessPrincipal,
} from "../creative-generation/localGenerationAccess.server";
import type { CreativeArchiveEntry } from "./types";

export async function canAccessCreativeArchiveEntry(principal: GenerationAccessPrincipal, entry: CreativeArchiveEntry) {
  if (principal.kind !== "cloudflare-access") return true;
  if (!entry.jobId) return false;
  const job = await creativeGenerationJobStore.get(entry.jobId);
  return Boolean(job && canAccessGenerationJob(principal, job));
}

export async function filterCreativeArchiveEntriesForAccess(
  principal: GenerationAccessPrincipal,
  entries: CreativeArchiveEntry[]
) {
  if (principal.kind !== "cloudflare-access") return entries;
  const jobIds = Array.from(new Set(entries.map((entry) => entry.jobId).filter((value): value is string => Boolean(value))));
  const jobs = await Promise.all(jobIds.map((jobId) => creativeGenerationJobStore.get(jobId)));
  const visibleJobIds = new Set(
    jobs
      .filter((job) => Boolean(job && canAccessGenerationJob(principal, job)))
      .map((job) => job!.id)
  );
  return entries.filter((entry) => Boolean(entry.jobId && visibleJobIds.has(entry.jobId)));
}

export async function assertCreativeArchiveEntryAccess(principal: GenerationAccessPrincipal, entry: CreativeArchiveEntry) {
  if (principal.kind !== "cloudflare-access") return;
  if (!entry.jobId) throw new GenerationAccessError("이 계정에서 만든 이미지 콘텐츠가 아닙니다.");
  const job = await creativeGenerationJobStore.get(entry.jobId);
  if (!job) throw new GenerationAccessError("이 계정에서 만든 이미지 콘텐츠가 아닙니다.");
  assertGenerationJobAccess(principal, job);
}

export async function assertCreativeArchiveEntriesAccess(
  principal: GenerationAccessPrincipal,
  entries: CreativeArchiveEntry[],
  entryIds: string[]
) {
  if (principal.kind !== "cloudflare-access") return;
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  for (const entryId of entryIds) {
    const entry = byId.get(entryId);
    if (!entry) throw new GenerationAccessError("아카이브에서 해당 이미지 콘텐츠를 찾지 못했습니다.");
    await assertCreativeArchiveEntryAccess(principal, entry);
  }
}
