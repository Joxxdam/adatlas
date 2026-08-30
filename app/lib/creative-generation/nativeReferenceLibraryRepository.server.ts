import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { classifyNativeReferenceImage } from "./nativeReferenceClassifier.server";
import { normalizeNativeReferenceCategory, normalizeNativeReferenceCompatibility, removeManagedNativeReference, type ManagedNativeReferenceItem, type ManagedNativeReferenceManifest, type NativeReferenceCategoryGroup, type ReferenceNativeCopy } from "./referenceLibraryManagement";
import { extractReferenceNativeCopy, normalizeReferenceNativeCopy, REFERENCE_NATIVE_COPY_ANALYSIS_VERSION } from "./referenceNativeCopy.server";

const manifestPath = path.resolve(process.cwd(), "data", "native-creative-reference-library.json");
const publicRoot = path.resolve(process.cwd(), "public");
const referenceDirectory = path.join(publicRoot, "creative-references", "reference-copy");
const trashDirectory = path.resolve(process.cwd(), "data", "native-creative-reference-trash");
const maximumFileBytes = 15 * 1024 * 1024;
const maximumFilesPerUpload = 12;
const supportedFormats = new Set(["jpeg", "png", "webp"]);
const lockKey = Symbol.for("daywiz.native-reference-library-lock-v1");
const lockState = globalThis as typeof globalThis & { [lockKey]?: Promise<unknown> };
const managedManifestVersion = "native-creative-reference-library-v12-shared-selection-pools";
const managedSelectionPolicy = "레퍼런스 관리 화면에 현재 등록된 이미지만 사용하며 등록 여부 자체를 운영자의 품질 승인으로 봅니다. 기본 대카테고리는 패션·음식·화장품 세 그룹으로 유지하고 건강·웰니스와 퍼스널케어는 화장품에 포함합니다. 기본 분류는 바꾸지 않은 채 운영자가 추가 제작 풀을 지정해 같은 레퍼런스를 여러 상품군에서 함께 사용할 수 있습니다. 일반 음식 상품은 간식 추가 풀 항목까지 포함한 음식 전체 풀에서, 간식 상품은 기본 음식 > 간식 또는 추가 간식 풀에서 중복 없이 순수 무작위 선택합니다. 간식 풀 안에서는 원본 상품 형태나 조리 소품으로 추가 제외하지 않습니다. 원상품의 용기·조리도구·식재료·상차림은 현재 상품과 맞지 않으면 같은 생성 단계에서 상품에 맞는 의미 소품과 장면으로 다시 구성합니다. OCR 상태·상품 형태·슬롯 수·인물 포함 여부·호환 점수·최근 사용 여부는 추가 선택 제한으로 사용하지 않습니다. 미지정 대카테고리로 임의 보충하지 않으며 삭제된 항목은 즉시 선택 대상에서 제외됩니다.";

function normalizeManifest(value: ManagedNativeReferenceManifest): ManagedNativeReferenceManifest {
  return {
    ...value,
    items: Array.isArray(value.items)
      ? value.items.map((item, index) =>
          normalizeNativeReferenceCompatibility({
            ...item,
            nativeCopy: normalizeReferenceNativeCopy(item.nativeCopy ? { ...item.nativeCopy, referenceId: item.id } : undefined),
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

  async updateNativeCopy(id: string, nativeCopy: Partial<ReferenceNativeCopy>) {
    return serialize(async () => {
      const manifest = readNativeReferenceManifestSync();
      const target = manifest.items.find((item) => item.id === id);
      if (!target) throw new Error("레퍼런스를 찾지 못했습니다.");
      const normalized = normalizeReferenceNativeCopy({
        ...target.nativeCopy,
        ...nativeCopy,
        referenceId: id,
        updatedAt: new Date().toISOString(),
      });
      const updated = {
        ...manifest,
        version: managedManifestVersion,
        updatedAt: new Date().toISOString(),
        items: manifest.items.map((item) => (item.id === id ? { ...item, nativeCopy: normalized } : item)),
      };
      await atomicWriteManifest(updated);
      return updated;
    });
  },

  async extractNativeCopy(id: string, options: { force?: boolean } = {}) {
    const manifest = readNativeReferenceManifestSync();
    const target = manifest.items.find((item) => item.id === id);
    if (!target) throw new Error("레퍼런스를 찾지 못했습니다.");
    const imagePath = safeReferencePath(target.publicPath);
    const imageHash = createHash("sha256").update(await fs.readFile(imagePath)).digest("hex");
    if (!options.force && target.nativeCopy?.imageHash === imageHash && target.nativeCopy.analysisVersion === REFERENCE_NATIVE_COPY_ANALYSIS_VERSION) {
      return target.nativeCopy;
    }
    let nativeCopy: ReferenceNativeCopy;
    try {
      nativeCopy = await extractReferenceNativeCopy(imagePath, {
        previousAttemptCount: target.nativeCopy?.analysisVersion === REFERENCE_NATIVE_COPY_ANALYSIS_VERSION ? target.nativeCopy?.attemptCount : 0,
      });
    } catch (error) {
      nativeCopy = normalizeReferenceNativeCopy({
        ...target.nativeCopy,
        referenceId: id,
        imageHash,
        analysisVersion: REFERENCE_NATIVE_COPY_ANALYSIS_VERSION,
        analysisStatus: target.nativeCopy?.rawLines?.some((line) => line.trim()) ? "needs-review" : "unavailable",
        approvalStatus: target.nativeCopy?.approvalStatus === "manually-approved" ? "manually-approved" : "needs-review",
        analysisError: error instanceof Error ? error.message : "정밀 문구 분석에 실패했습니다.",
        attemptCount: (target.nativeCopy?.analysisVersion === REFERENCE_NATIVE_COPY_ANALYSIS_VERSION ? target.nativeCopy?.attemptCount || 0 : 0) + 1,
        useForCopyAdaptation: Boolean(target.nativeCopy?.rawLines?.length) && target.nativeCopy?.useForCopyAdaptation !== false,
        extractionSource: target.nativeCopy?.manuallyCorrected ? "manual" : "unavailable",
        updatedAt: new Date().toISOString(),
      })!;
    }
    nativeCopy.referenceId = id;
    await this.updateNativeCopy(id, nativeCopy);
    return nativeCopy;
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
