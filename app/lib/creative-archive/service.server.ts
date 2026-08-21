import "server-only";

import { creativeAssetRepository } from "../creative-assets/repository.server";
import { creativeGenerationJobStore } from "../creative-generation/jobStore.server";
import { buildCreativeArchiveEntries } from "./archive";
import { creativeArchiveMetadataRepository } from "./metadataRepository.server";

export async function listCreativeArchiveEntries() {
  const [assets, jobs, metadata] = await Promise.all([
    creativeAssetRepository.list({ limit: 500 }),
    creativeGenerationJobStore.list({ limit: 500 }),
    creativeArchiveMetadataRepository.list(),
  ]);
  return buildCreativeArchiveEntries({ assets, jobs, metadata });
}

export async function updateCreativeArchiveEntry(
  entryId: string,
  input: { savedAsReference?: boolean; tags?: string[]; note?: string }
) {
  const exists = (await listCreativeArchiveEntries()).some((entry) => entry.id === entryId);
  if (!exists) throw new Error("아카이브에서 해당 이미지 콘텐츠를 찾지 못했습니다.");
  await creativeArchiveMetadataRepository.update(entryId, input);
  return (await listCreativeArchiveEntries()).find((entry) => entry.id === entryId) || null;
}
