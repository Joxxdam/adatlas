import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Stage 1 is intentionally non-generative. The curated reference raster is
 * copied byte-for-byte so no layout, copy, color, crop, detail or typography
 * can drift before product replacement begins.
 */
export async function copyReferenceStructureLosslessly(sourcePath: string, outputPath: string) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const source = await readFile(sourcePath);
  await copyFile(sourcePath, outputPath);
  const copied = await readFile(outputPath);
  const sourceHash = sha256(source);
  const copiedHash = sha256(copied);
  if (source.length !== copied.length || sourceHash !== copiedHash) {
    throw new Error("광고 레퍼런스 원본 복사 무결성 검증에 실패했습니다.");
  }
  return { sourceHash, copiedHash, bytes: copied.length };
}
