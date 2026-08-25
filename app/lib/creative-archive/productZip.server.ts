import "server-only";

import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import sharp from "sharp";
import { readCreativeRasterAsset } from "../creative-generation/assets.server";
import { creativeGenerationJobStore } from "../creative-generation/jobStore.server";
import { resolveValidatedNativeDownload } from "../creative-generation/nativeCreativeStorage.server";
import { resolveCreativeArchiveDeliveryFile } from "./branding.server";
import { listCreativeArchiveEntries } from "./service.server";
import type { CreativeArchiveEntry } from "./types";

const MAX_PRODUCT_ARCHIVE_ENTRIES = 500;

type ProductArchiveFailure = {
  entryId: string;
  materialCode: string;
  reason: string;
};

function safeSegment(value: string, fallback: string) {
  const cleaned = String(value || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+|\.+$/g, "")
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

function materialLabel(entry: CreativeArchiveEntry, index: number) {
  return safeSegment(entry.materialCode || entry.assetCode || entry.hookCode, `creative-${String(index + 1).padStart(2, "0")}`);
}

async function rasterExtension(data: Buffer) {
  const metadata = await sharp(data).metadata();
  if (!metadata.width || !metadata.height) throw new Error("이미지 해상도를 확인할 수 없습니다.");
  if (metadata.format === "jpeg") return "jpg";
  if (["png", "webp", "avif"].includes(metadata.format || "")) return metadata.format as "png" | "webp" | "avif";
  throw new Error("ZIP에 담을 수 있는 래스터 이미지 형식이 아닙니다.");
}

async function readActiveArchiveImage(entry: CreativeArchiveEntry) {
  if (entry.jobId && entry.resultId) {
    const job = await creativeGenerationJobStore.get(entry.jobId);
    const result = job?.results.find((candidate) => candidate.id === entry.resultId);
    if (job && result?.nativeCreative?.finalPath) {
      return readFile(resolveValidatedNativeDownload(job, result.id));
    }
  }

  if (entry.deliveryBranding) {
    try {
      return await readFile(await resolveCreativeArchiveDeliveryFile(entry.id));
    } catch {
      // Native job branding is resolved above. Older archive metadata may have
      // been removed, so fall through to the original archive image.
    }
  }

  return readCreativeRasterAsset(entry.downloadUrl || entry.imageUrl);
}

export async function createCreativeArchiveProductZip(entryIds: string[]) {
  const requestedIds = Array.from(new Set(entryIds.map((id) => String(id || "").trim()).filter(Boolean)));
  if (!requestedIds.length || requestedIds.length > MAX_PRODUCT_ARCHIVE_ENTRIES) {
    throw new Error("상품 ZIP 대상은 1장 이상 500장 이하로 선택해 주세요.");
  }

  const allEntries = await listCreativeArchiveEntries();
  const byId = new Map(allEntries.map((entry) => [entry.id, entry]));
  const entries = requestedIds.map((id) => byId.get(id)).filter((entry): entry is CreativeArchiveEntry => Boolean(entry));
  if (!entries.length) throw new Error("ZIP으로 내려받을 상품 이미지를 찾지 못했습니다.");

  const first = entries[0];
  if (entries.some((entry) => entry.advertiserName !== first.advertiserName || entry.productName !== first.productName)) {
    throw new Error("하나의 상품에 속한 이미지만 ZIP으로 내려받을 수 있습니다.");
  }

  const missingIds = requestedIds.filter((id) => !byId.has(id));
  const orderedEntries = [...entries].sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.hookCode.localeCompare(right.hookCode));
  const zip = new JSZip();
  const included: Array<{ entryId: string; fileName: string; materialCode: string; status: string; createdAt: string }> = [];
  const failures: ProductArchiveFailure[] = missingIds.map((entryId) => ({ entryId, materialCode: "", reason: "아카이브에서 삭제되었거나 찾을 수 없습니다." }));
  const usedNames = new Set<string>();

  for (let index = 0; index < orderedEntries.length; index += 1) {
    const entry = orderedEntries[index];
    try {
      const data = await readActiveArchiveImage(entry);
      const extension = await rasterExtension(data);
      const base = `${String(index + 1).padStart(2, "0")}-${materialLabel(entry, index)}`;
      let fileName = `${base}.${extension}`;
      let duplicate = 2;
      while (usedNames.has(fileName)) fileName = `${base}-${duplicate++}.${extension}`;
      usedNames.add(fileName);
      zip.file(`images/${fileName}`, data);
      included.push({
        entryId: entry.id,
        fileName: `images/${fileName}`,
        materialCode: entry.materialCode || entry.assetCode || entry.hookCode,
        status: entry.status,
        createdAt: entry.createdAt,
      });
    } catch (error) {
      failures.push({
        entryId: entry.id,
        materialCode: entry.materialCode || entry.assetCode || entry.hookCode,
        reason: error instanceof Error ? error.message : "이미지 파일을 읽지 못했습니다.",
      });
    }
  }

  if (!included.length) throw new Error(failures[0]?.reason || "ZIP으로 내려받을 완성 이미지가 없습니다.");

  const generatedAt = new Date().toISOString();
  zip.file(
    "archive-manifest.json",
    `${JSON.stringify(
      {
        version: "creative-archive-product-zip-v1",
        advertiserName: first.advertiserName,
        productName: first.productName,
        generatedAt,
        requestedCount: requestedIds.length,
        includedCount: included.length,
        failedCount: failures.length,
        included,
        failures,
      },
      null,
      2
    )}\n`
  );
  if (failures.length) {
    zip.file(
      "실패-보고서.txt",
      [`상품: ${first.productName}`, `정상 포함: ${included.length}장`, `누락: ${failures.length}장`, "", ...failures.map((failure, index) => `${index + 1}. ${failure.materialCode || failure.entryId}: ${failure.reason}`)].join("\n")
    );
  }

  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return {
    buffer,
    fileName: `${safeSegment(first.productName, "product")}-${included.length}장.zip`,
    includedCount: included.length,
    failedCount: failures.length,
  };
}
