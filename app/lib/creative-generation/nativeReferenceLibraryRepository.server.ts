import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { classifyNativeReferenceImage } from "./nativeReferenceClassifier.server";
import { normalizeNativeReferenceCategory, normalizeNativeReferenceCompatibility, removeManagedNativeReference, type ManagedNativeReferenceItem, type ManagedNativeReferenceManifest, type NativeReferenceCategoryGroup } from "./referenceLibraryManagement";

const manifestPath = path.resolve(process.cwd(), "data", "native-creative-reference-library.json");
const publicRoot = path.resolve(process.cwd(), "public");
const referenceDirectory = path.join(publicRoot, "creative-references", "reference-copy");
const trashDirectory = path.resolve(process.cwd(), "data", "native-creative-reference-trash");
const maximumFileBytes = 15 * 1024 * 1024;
const maximumFilesPerUpload = 12;
const supportedFormats = new Set(["jpeg", "png", "webp"]);
const lockKey = Symbol.for("daywiz.native-reference-library-lock-v1");
const lockState = globalThis as typeof globalThis & { [lockKey]?: Promise<unknown> };
const managedManifestVersion = "native-creative-reference-library-v7-food-produce";
const managedSelectionPolicy = "레퍼런스 관리 화면에 현재 등록된 이미지만 사용합니다. 대카테고리는 패션·식품·화장품 세 그룹으로 유지하며 건강·웰니스와 퍼스널케어는 화장품에 포함합니다. 식품의 과일/농산물은 운영자가 지정한 하위 태그로 관리하며, 과일·농산물 상품은 이 태그가 있는 식품 레퍼런스만 사용합니다. 고기와 일반 식품은 과일/농산물 태그 항목을 포함한 식품 전체 풀을 사용합니다. 상품 형태·구도·슬롯 호환 점수를 통과한 후보만 무작위 선택하며, 다른 상품군이나 비호환 레퍼런스로 보충하지 않습니다. 삭제된 항목은 즉시 선택 대상에서 제외됩니다.";

function normalizeManifest(value: ManagedNativeReferenceManifest): ManagedNativeReferenceManifest {
  return {
    ...value,
    items: Array.isArray(value.items)
      ? value.items.map((item, index) =>
          normalizeNativeReferenceCompatibility({
            ...item,
            ordinal: Number(item.ordinal) || index + 1,
            categoryGroup: normalizeNativeReferenceCategory(item.categoryGroup),
          })
        )
      : [],
  };
}

export function readNativeReferenceManifestSync() {
  const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as ManagedNativeReferenceManifest;
  return normalizeManifest(parsed);
}

async function atomicWriteManifest(manifest: ManagedNativeReferenceManifest) {
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  const temporary = `${manifestPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await fs.rename(temporary, manifestPath);
}

async function serialize<T>(work: () => Promise<T>) {
  const previous = lockState[lockKey] || Promise.resolve();
  const next = previous.then(work, work);
  lockState[lockKey] = next.catch(() => undefined);
  return next;
}

function safeReferencePath(publicPath: string) {
  const resolved = path.resolve(publicRoot, publicPath.replace(/^\/+/, ""));
  if (!resolved.startsWith(`${referenceDirectory}${path.sep}`)) {
    throw new Error("허용되지 않은 레퍼런스 이미지 경로입니다.");
  }
  return resolved;
}

async function normalizeUpload(file: File) {
  if (!file.size || file.size > maximumFileBytes) {
    throw new Error(`${file.name || "이미지"}: 파일 크기는 15MB 이하여야 합니다.`);
  }
  const input = Buffer.from(await file.arrayBuffer());
  const metadata = await sharp(input, { limitInputPixels: 50_000_000 }).metadata();
  if (!metadata.format || !supportedFormats.has(metadata.format)) {
    throw new Error(`${file.name || "이미지"}: JPEG, PNG, WebP만 업로드할 수 있습니다.`);
  }
  if ((metadata.width || 0) < 300 || (metadata.height || 0) < 300) {
    throw new Error(`${file.name || "이미지"}: 가로·세로가 각각 300px 이상이어야 합니다.`);
  }
  const output = await sharp(input, { limitInputPixels: 50_000_000 }).rotate().resize(1200, 1200, { fit: "contain", background: "#ffffff" }).flatten({ background: "#ffffff" }).toColorspace("srgb").jpeg({ quality: 88, progressive: true, mozjpeg: true }).toBuffer();
  return {
    buffer: output,
    inputHash: createHash("sha256").update(input).digest("hex"),
    contentHash: createHash("sha256").update(output).digest("hex"),
  };
}

export const nativeReferenceLibraryRepository = {
  list() {
    return readNativeReferenceManifestSync();
  },

  async add(files: File[]) {
    if (!files.length) throw new Error("업로드할 레퍼런스 이미지를 선택해 주세요.");
    if (files.length > maximumFilesPerUpload) {
      throw new Error(`한 번에 최대 ${maximumFilesPerUpload}장까지 업로드할 수 있습니다.`);
    }
    return serialize(async () => {
      const manifest = readNativeReferenceManifestSync();
      const existingHashes = new Set(manifest.items.map((item) => item.contentHash).filter(Boolean));
      for (const item of manifest.items) {
        if (item.contentHash) continue;
        try {
          const existing = await fs.readFile(safeReferencePath(item.publicPath));
          existingHashes.add(createHash("sha256").update(existing).digest("hex"));
        } catch {
          // 누락 파일은 목록 복구나 삭제로 정리할 수 있도록 업로드 자체를 막지 않는다.
        }
      }
      const createdPaths: string[] = [];
      const added: ManagedNativeReferenceItem[] = [];
      let nextOrdinal = Math.max(0, ...manifest.items.map((item) => item.ordinal)) + 1;
      await fs.mkdir(referenceDirectory, { recursive: true });
      try {
        for (const file of files) {
          const normalized = await normalizeUpload(file);
          if (existingHashes.has(normalized.inputHash) || existingHashes.has(normalized.contentHash)) continue;
          const id = `reference-upload-${randomUUID()}`;
          const fileName = `${id}.jpg`;
          const outputPath = path.join(referenceDirectory, fileName);
          await fs.writeFile(outputPath, normalized.buffer, { flag: "wx" });
          createdPaths.push(outputPath);
          const classification = await classifyNativeReferenceImage({
            imagePath: outputPath,
            sourceFile: path.basename(file.name || fileName),
          });
          added.push(
            normalizeNativeReferenceCompatibility({
              id,
              publicPath: `/creative-references/reference-copy/${fileName}`,
              sourceFile: path.basename(file.name || fileName).slice(0, 180),
              layoutFamily: "managed-reference",
              categoryGroup: classification.categoryGroup,
              ...classification.compatibility,
              ordinal: nextOrdinal,
              contentHash: normalized.contentHash,
              uploadedAt: new Date().toISOString(),
              classificationMethod: classification.classificationMethod,
            })
          );
          nextOrdinal += 1;
          existingHashes.add(normalized.contentHash);
        }
        if (!added.length) throw new Error("새로 추가할 이미지가 없습니다. 이미 등록된 이미지인지 확인해 주세요.");
        const updated = {
          ...manifest,
          version: managedManifestVersion,
          updatedAt: new Date().toISOString(),
          sourceLabel: "레퍼런스 관리 화면에서 운영하는 제작용 이미지 라이브러리",
          selectionPolicy: managedSelectionPolicy,
          items: [...manifest.items, ...added],
        };
        await atomicWriteManifest(updated);
        return { manifest: updated, added };
      } catch (error) {
        await Promise.all(createdPaths.map((filePath) => fs.unlink(filePath).catch(() => undefined)));
        throw error;
      }
    });
  },

  async updateCategory(id: string, categoryGroup: NativeReferenceCategoryGroup) {
    return this.updateCompatibility(id, { categoryGroup });
  },

  async updateCompatibility(id: string, patch: Partial<ManagedNativeReferenceItem>) {
    return serialize(async () => {
      const manifest = readNativeReferenceManifestSync();
      if (!manifest.items.some((item) => item.id === id)) throw new Error("레퍼런스를 찾지 못했습니다.");
      const updated = {
        ...manifest,
        version: managedManifestVersion,
        updatedAt: new Date().toISOString(),
        selectionPolicy: managedSelectionPolicy,
        items: manifest.items.map((item) =>
          item.id === id
            ? normalizeNativeReferenceCompatibility({
                ...item,
                ...patch,
                id: item.id,
                publicPath: item.publicPath,
                sourceFile: item.sourceFile,
                ordinal: item.ordinal,
                categoryGroup: normalizeNativeReferenceCategory(patch.categoryGroup ?? item.categoryGroup),
                classificationMethod: "manual" as const,
              })
            : item
        ),
      };
      await atomicWriteManifest(updated);
      return updated;
    });
  },

  async remove(id: string) {
    return serialize(async () => {
      const manifest = readNativeReferenceManifestSync();
      const target = manifest.items.find((item) => item.id === id);
      if (!target) throw new Error("레퍼런스를 찾지 못했습니다.");
      const sourcePath = safeReferencePath(target.publicPath);
      await fs.mkdir(trashDirectory, { recursive: true });
      const trashPath = path.join(trashDirectory, `${Date.now()}-${path.basename(sourcePath)}`);
      let movedToTrash = false;
      try {
        await fs.rename(sourcePath, trashPath);
        movedToTrash = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      try {
        const updated = {
          ...manifest,
          version: managedManifestVersion,
          updatedAt: new Date().toISOString(),
          selectionPolicy: managedSelectionPolicy,
          items: removeManagedNativeReference(manifest.items, id),
        };
        await atomicWriteManifest(updated);
        return { manifest: updated, removed: target, recoverablePath: trashPath };
      } catch (error) {
        if (movedToTrash) await fs.rename(trashPath, sourcePath).catch(() => undefined);
        throw error;
      }
    });
  },
};
