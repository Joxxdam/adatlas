import "server-only";

import crypto from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { readCreativeRasterAsset } from "../creative-generation/assets.server";
import { normalizeDeliveryBrandingRequest, type DeliveryBrandingRequest } from "../creative-generation/deliveryBranding";
import { renderDeliveryBrandedRaster } from "../creative-generation/deliveryBranding.server";
import { applyDeliveryBrandingToJob } from "../creative-generation/deliveryBrandingJob.server";
import { creativeGenerationJobStore } from "../creative-generation/jobStore.server";
import { creativeArchiveMetadataRepository } from "./metadataRepository.server";
import { listCreativeArchiveEntries } from "./service.server";
import type { CreativeArchiveEntry, StoredCreativeArchiveDeliveryBranding } from "./types";

const archiveDeliveryRoot = path.join(process.cwd(), ".data", "creative-archive", "delivery");

export type ArchiveBrandingInput = DeliveryBrandingRequest & {
  entryIds: string[];
};

function archiveDeliveryPath(entryId: string) {
  const key = crypto.createHash("sha256").update(entryId).digest("hex").slice(0, 32);
  return path.join(archiveDeliveryRoot, `${key}.jpg`);
}

function cleanEntryIds(values: string[]) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean))).slice(0, 100);
}

async function partitionBrandingTargets(targets: CreativeArchiveEntry[]) {
  const jobIds = Array.from(new Set(targets.map((entry) => entry.jobId).filter(Boolean))) as string[];
  const jobs = await Promise.all(jobIds.map(async (jobId) => [jobId, await creativeGenerationJobStore.get(jobId)] as const));
  const jobsById = new Map(jobs);
  const jobTargets = new Map<string, string[]>();
  const archiveTargets: CreativeArchiveEntry[] = [];
  for (const entry of targets) {
    const job = entry.jobId ? jobsById.get(entry.jobId) : undefined;
    const result = job && entry.resultId ? job.results.find((candidate) => candidate.id === entry.resultId) : undefined;
    if (job && result?.imagePath && result.nativeCreative?.finalPath) {
      jobTargets.set(job.id, [...(jobTargets.get(job.id) || []), result.id]);
    } else if (entry.brandingEligible) {
      archiveTargets.push(entry);
    }
  }
  return { jobTargets, archiveTargets };
}

export async function applyCreativeArchiveBranding(input: ArchiveBrandingInput) {
  const entryIds = cleanEntryIds(input.entryIds);
  if (!entryIds.length) throw new Error("로고 또는 AI 고지를 적용할 이미지를 선택해 주세요.");
  const { logoId, aiDisclosure, clear } = normalizeDeliveryBrandingRequest(input);

  const entries = await listCreativeArchiveEntries();
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const targets = entryIds.map((id) => byId.get(id)).filter((entry): entry is CreativeArchiveEntry => Boolean(entry));
  if (!targets.length) throw new Error("선택한 아카이브 이미지를 찾지 못했습니다.");

  const { jobTargets, archiveTargets } = await partitionBrandingTargets(targets);

  let appliedCount = 0;
  const errors: string[] = [];
  const jobUpdates = await Promise.allSettled(
    Array.from(jobTargets, ([jobId, resultIds]) =>
      applyDeliveryBrandingToJob(jobId, {
        logoId,
        aiDisclosure,
        clear,
        resultIds,
      })
    )
  );
  jobUpdates.forEach((result) => {
    if (result.status === "fulfilled") appliedCount += result.value.appliedCount;
    else errors.push(result.reason instanceof Error ? result.reason.message : "생성 결과 후처리에 실패했습니다.");
  });

  const metadata = archiveTargets.length ? await creativeArchiveMetadataRepository.list() : {};
  for (let index = 0; index < archiveTargets.length; index += 2) {
    const batch = archiveTargets.slice(index, index + 2);
    const settled = await Promise.allSettled(
      batch.map(async (entry) => {
        if (clear) {
          await creativeArchiveMetadataRepository.updateDeliveryBranding(entry.id, undefined);
          return;
        }
        const originalSource = metadata[entry.id]?.deliveryBranding?.sourceImagePath || entry.imageUrl;
        const output = archiveDeliveryPath(entry.id);
        await renderDeliveryBrandedRaster(await readCreativeRasterAsset(originalSource), output, {
          logoId,
          aiDisclosure,
        });
        const deliveryBranding: StoredCreativeArchiveDeliveryBranding = {
          logoId,
          aiDisclosure,
          imagePath: output,
          sourceImagePath: originalSource,
          updatedAt: new Date().toISOString(),
        };
        await creativeArchiveMetadataRepository.updateDeliveryBranding(entry.id, deliveryBranding);
      })
    );
    settled.forEach((result) => {
      if (result.status === "fulfilled") appliedCount += 1;
      else errors.push(result.reason instanceof Error ? result.reason.message : "아카이브 이미지 후처리에 실패했습니다.");
    });
  }

  if (!appliedCount) throw new Error(errors[0] || "선택한 이미지에 후처리를 적용하지 못했습니다.");
  return {
    appliedCount,
    failedCount: targets.length - appliedCount,
    errors: Array.from(new Set(errors)).slice(0, 5),
    entries: await listCreativeArchiveEntries(),
  };
}

export async function resolveCreativeArchiveDeliveryFile(entryId: string) {
  const [entries, metadata] = await Promise.all([listCreativeArchiveEntries(), creativeArchiveMetadataRepository.list()]);
  if (!entries.some((entry) => entry.id === entryId)) throw new Error("아카이브 이미지를 찾지 못했습니다.");
  const delivery = metadata[entryId]?.deliveryBranding;
  if (!delivery?.imagePath) throw new Error("적용된 로고 또는 AI 고지 이미지가 없습니다.");
  const resolved = path.resolve(delivery.imagePath);
  if (!resolved.startsWith(`${archiveDeliveryRoot}${path.sep}`) || !existsSync(resolved)) {
    throw new Error("아카이브 후처리 이미지 경로가 올바르지 않습니다.");
  }
  return resolved;
}
