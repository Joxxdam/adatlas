import { promises as fs } from "fs";
import path from "path";
import { CollectedAdImage, GeneratedAdImage, MvpBrand } from "./types";
import { WatchlistBrand } from "../watchlist/types";

const dataDir = path.join(process.cwd(), "data");
const brandsPath = path.join(dataDir, "mvp-brands.json");
const imagesPath = path.join(dataDir, "mvp-images.json");
const generatedPath = path.join(dataDir, "mvp-generated.json");
const watchlistPath = path.join(dataDir, "brand-watchlist.json");

async function ensureFile(filePath: string, fallback: unknown[] = []) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, `${JSON.stringify(fallback, null, 2)}\n`, "utf8");
  }
}

function brandId(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function seedBrandsFromWatchlist() {
  try {
    const raw = await fs.readFile(watchlistPath, "utf8");
    const watchlist = JSON.parse(raw) as WatchlistBrand[];
    const now = new Date().toISOString();
    const brands: MvpBrand[] = watchlist.slice(0, 100).map((item) => ({
      id: brandId(item.brand),
      brandName: item.brand,
      category: item.category,
      metaLibraryUrl: item.urls.meta ?? "",
      tiktokUrl: item.urls.tiktok ?? "",
      enabled: item.enabled,
      createdAt: now,
      updatedAt: now,
    }));
    await ensureFile(brandsPath, brands);
  } catch {
    await ensureFile(brandsPath, []);
  }
}

export async function readBrands() {
  await seedBrandsFromWatchlist();
  const raw = await fs.readFile(brandsPath, "utf8");
  return JSON.parse(raw) as MvpBrand[];
}

export async function saveBrands(brands: MvpBrand[]) {
  await ensureFile(brandsPath);
  await fs.writeFile(brandsPath, `${JSON.stringify(brands, null, 2)}\n`, "utf8");
}

export async function upsertBrand(input: Partial<MvpBrand> & { brandName: string }) {
  const brands = await readBrands();
  const now = new Date().toISOString();
  const id = input.id || brandId(input.brandName);
  const next: MvpBrand = {
    id,
    brandName: input.brandName,
    category: input.category ?? "",
    metaLibraryUrl: input.metaLibraryUrl ?? "",
    tiktokUrl: input.tiktokUrl ?? "",
    enabled: input.enabled ?? true,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  };
  const index = brands.findIndex((brand) => brand.id === id);
  if (index >= 0) {
    brands[index] = { ...brands[index], ...next, createdAt: brands[index].createdAt };
  } else {
    brands.unshift(next);
  }
  await saveBrands(brands);
  return next;
}

export async function readImages() {
  await ensureFile(imagesPath);
  const raw = await fs.readFile(imagesPath, "utf8");
  return JSON.parse(raw) as CollectedAdImage[];
}

export async function saveImages(images: CollectedAdImage[]) {
  await ensureFile(imagesPath);
  await fs.writeFile(imagesPath, `${JSON.stringify(images, null, 2)}\n`, "utf8");
}

export async function mergeImages(items: CollectedAdImage[]) {
  const existing = await readImages();
  const keyOf = (item: CollectedAdImage) => item.originalAdUrl || item.imageUrl;
  const byKey = new Map(existing.map((item) => [keyOf(item), item]));
  let added = 0;

  for (const item of items) {
    const key = keyOf(item);
    if (!byKey.has(key)) {
      added += 1;
    }
    byKey.set(key, { ...byKey.get(key), ...item });
  }

  const next = [...byKey.values()].sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
  await saveImages(next);
  return { added, total: next.length, images: next };
}

export async function readGenerated() {
  await ensureFile(generatedPath);
  const raw = await fs.readFile(generatedPath, "utf8");
  return JSON.parse(raw) as GeneratedAdImage[];
}

export async function saveGenerated(items: GeneratedAdImage[]) {
  await ensureFile(generatedPath);
  await fs.writeFile(generatedPath, `${JSON.stringify(items, null, 2)}\n`, "utf8");
}

export async function addGenerated(item: GeneratedAdImage) {
  const existing = await readGenerated();
  const next = [item, ...existing];
  await saveGenerated(next);
  return item;
}
