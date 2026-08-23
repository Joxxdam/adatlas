import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { MasterSceneArtifact, MasterSceneSpec, ProductReferenceProfile } from "./types.ts";

const CACHE_DIRECTORY = path.join(process.cwd(), "data", "creative-generation-master-scenes");
const CACHE_INDEX = path.join(CACHE_DIRECTORY, "index.json");
const PUBLIC_DIRECTORY = path.join(process.cwd(), "public", "generated-master-scenes");
let cacheWriteQueue: Promise<unknown> = Promise.resolve();

type MasterSceneCacheIndex = {
  version: 1;
  artifacts: Record<string, MasterSceneArtifact>;
};

function emptyIndex(): MasterSceneCacheIndex {
  return { version: 1, artifacts: {} };
}

async function readIndex(): Promise<MasterSceneCacheIndex> {
  try {
    const parsed = JSON.parse(await fs.readFile(CACHE_INDEX, "utf8")) as MasterSceneCacheIndex;
    return parsed?.version === 1 && parsed.artifacts ? parsed : emptyIndex();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyIndex();
    throw error;
  }
}

async function fileExists(publicPath: string) {
  if (!publicPath.startsWith("/generated-master-scenes/")) return false;
  const file = path.resolve(process.cwd(), "public", publicPath.replace(/^\/+/, ""));
  if (!file.startsWith(`${PUBLIC_DIRECTORY}${path.sep}`)) return false;
  return fs
    .access(file)
    .then(() => true)
    .catch(() => false);
}

export function masterSceneCacheKey(input: { productId: string; profile: ProductReferenceProfile; spec: MasterSceneSpec; promptVersion: string; imageModel: string; sourceAssetFile?: string; revision?: number }) {
  const payload = JSON.stringify({
    productId: input.productId,
    references: input.profile.referenceImages.filter((image) => image.usableForGeneration && !image.duplicateOf).map((image) => image.contentHash || image.url),
    concept: input.spec.concept,
    mode: input.spec.generationMode,
    promptVersion: input.promptVersion,
    imageModel: input.imageModel,
    sourceAssetFile: input.sourceAssetFile || "",
    designFingerprint: input.spec.designFingerprint,
    strategyVariation: input.spec.strategyVariation,
    revision: Math.max(0, input.revision || 0),
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export async function readCachedMasterScene(cacheKey: string) {
  const artifact = (await readIndex()).artifacts[cacheKey];
  if (!artifact || !(await fileExists(artifact.file))) return null;
  return { ...artifact, reused: true } satisfies MasterSceneArtifact;
}

export async function writeMasterSceneFile(cacheKey: string, buffer: Buffer, suffix = "") {
  await fs.mkdir(PUBLIC_DIRECTORY, { recursive: true });
  const safeSuffix = String(suffix || "")
    .replace(/[^a-z0-9-]/gi, "")
    .slice(0, 18);
  const fileName = `master-${cacheKey.slice(0, 24)}${safeSuffix ? `-${safeSuffix}` : ""}.webp`;
  const target = path.join(PUBLIC_DIRECTORY, fileName);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, buffer);
  await fs.rename(temporary, target);
  return `/generated-master-scenes/${fileName}`;
}

export async function saveMasterSceneArtifact(artifact: MasterSceneArtifact) {
  const write = cacheWriteQueue.then(async () => {
    const index = await readIndex();
    index.artifacts[artifact.cacheKey] = artifact;
    await fs.mkdir(CACHE_DIRECTORY, { recursive: true });
    const temporary = `${CACHE_INDEX}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(index, null, 2)}\n`, "utf8");
    await fs.rename(temporary, CACHE_INDEX);
    return artifact;
  });
  cacheWriteQueue = write.catch(() => undefined);
  return write;
}
