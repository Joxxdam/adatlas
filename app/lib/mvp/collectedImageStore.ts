import { promises as fs } from "fs";
import crypto from "crypto";
import path from "path";
import { CollectedAdImage } from "./types";

const imageDir = path.join(process.cwd(), "public", "collected-images");
const dataPath = path.join(process.cwd(), "data", "collected-ad-images.json");
const imageExtPattern = /\.(png|jpe?g|webp|gif|avif)$/i;

function idFromPath(localImagePath: string) {
  return `img-${crypto.createHash("sha256").update(localImagePath).digest("hex").slice(0, 16)}`;
}

function toLocalPath(fileName: string) {
  return `/collected-images/${fileName}`;
}

async function ensureFiles() {
  await fs.mkdir(imageDir, { recursive: true });
  await fs.mkdir(path.dirname(dataPath), { recursive: true });

  try {
    await fs.access(dataPath);
  } catch {
    await fs.writeFile(dataPath, "[]\n", "utf8");
  }
}

async function listCollectedFiles() {
  await fs.mkdir(imageDir, { recursive: true });
  const entries = await fs.readdir(imageDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && imageExtPattern.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

export async function readCollectedAdImages() {
  await ensureFiles();
  const raw = await fs.readFile(dataPath, "utf8");
  const existing = JSON.parse(raw.replace(/^\uFEFF/, "")) as CollectedAdImage[];
  const byPath = new Map(existing.map((item) => [item.localImagePath || item.imageUrl || "", item]));
  const now = new Date().toISOString();
  let changed = false;

  for (const fileName of await listCollectedFiles()) {
    const localImagePath = toLocalPath(fileName);
    if (byPath.has(localImagePath)) continue;

    byPath.set(localImagePath, {
      id: idFromPath(localImagePath),
      brandName: "",
      category: "기타",
      hookType: "",
      appealPoint: "",
      sourcePlatform: "meta",
      localImagePath,
      originalAdUrl: "",
      collectedAt: now,
    });
    changed = true;
  }

  const next = [...byPath.values()].sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
  if (changed) {
    await saveCollectedAdImages(next);
  }

  return next;
}

export async function saveCollectedAdImages(items: CollectedAdImage[]) {
  await ensureFiles();
  await fs.writeFile(dataPath, `${JSON.stringify(items, null, 2)}\n`, "utf8");
}

export async function updateCollectedAdImage(input: Partial<CollectedAdImage> & { id: string }) {
  const images = await readCollectedAdImages();
  const index = images.findIndex((image) => image.id === input.id);

  if (index < 0) {
    throw new Error("이미지를 찾을 수 없습니다.");
  }

  images[index] = {
    ...images[index],
    brandName: input.brandName ?? images[index].brandName,
    category: input.category ?? images[index].category ?? "기타",
    hookType: input.hookType ?? images[index].hookType ?? "",
    appealPoint: input.appealPoint ?? images[index].appealPoint ?? "",
    sourcePlatform: input.sourcePlatform ?? images[index].sourcePlatform,
    originalAdUrl: input.originalAdUrl ?? images[index].originalAdUrl ?? "",
  };

  await saveCollectedAdImages(images);
  return images[index];
}
