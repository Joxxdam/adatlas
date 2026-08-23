import "server-only";

import { creativeAssetRepository } from "../creative-assets/repository.server";
import { creativeGenerationJobStore } from "../creative-generation/jobStore.server";
import { buildCreativeArchiveEntries } from "./archive";
import { creativeArchiveMetadataRepository } from "./metadataRepository.server";

export async function listCreativeArchiveEntries() {
  const [assets, jobs, metadata] = await Promise.all([creativeAssetRepository.list({ limit: 500 }), creativeGenerationJobStore.list({ limit: 500 }), creativeArchiveMetadataRepository.list()]);
  return buildCreativeArchiveEntries({ assets, jobs, metadata });
}

export async function updateCreativeArchiveEntry(entryId: string, input: { savedAsReference?: boolean; tags?: string[]; note?: string }) {
  const exists = (await listCreativeArchiveEntries()).some((entry) => entry.id === entryId);
  if (!exists) throw new Error("아카이브에서 해당 이미지 콘텐츠를 찾지 못했습니다.");
  await creativeArchiveMetadataRepository.update(entryId, input);
  return (await listCreativeArchiveEntries()).find((entry) => entry.id === entryId) || null;
}

export async function deleteCreativeArchiveEntries(entryIds: string[]) {
  const requested = Array.from(new Set(entryIds.map((id) => String(id || "").trim()).filter(Boolean))).slice(0, 500);
  if (!requested.length) throw new Error("삭제할 이미지 콘텐츠를 선택해 주세요.");
  const current = await listCreativeArchiveEntries();
  const available = new Set(current.map((entry) => entry.id));
  const deletedIds = requested.filter((id) => available.has(id));
  if (!deletedIds.length) throw new Error("삭제할 아카이브 이미지 콘텐츠를 찾지 못했습니다.");
  await creativeArchiveMetadataRepository.hide(deletedIds);
  return { deletedIds, entries: await listCreativeArchiveEntries() };
}
