import { promises as fs } from "fs";
import path from "path";
import { crawlMetaAdLibrary } from "../meta-crawler/crawlMetaAdLibrary";
import { CollectedAdImage, CollectionStatus, MvpBrand } from "./types";

const publicDir = path.join(process.cwd(), "public", "mvp-images");

function imageId(brandName: string, url: string) {
  const hash = Buffer.from(url).toString("base64url").slice(0, 24);
  return `${brandName.toLowerCase().replace(/[^a-z0-9가-힣]+/g, "-")}-${hash}`;
}

async function downloadImage(imageUrl: string, id: string) {
  try {
    await fs.mkdir(publicDir, { recursive: true });
    const response = await fetch(imageUrl);
    if (!response.ok) return undefined;
    const contentType = response.headers.get("content-type") ?? "";
    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const fileName = `${id}.${ext}`;
    const filePath = path.join(publicDir, fileName);
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(filePath, buffer);
    return `/mvp-images/${fileName}`;
  } catch {
    return undefined;
  }
}

export async function collectMetaImagesForBrand(brand: MvpBrand, limit = 20) {
  if (!brand.metaLibraryUrl) {
    throw new Error("Meta Ad Library URL이 없습니다.");
  }

  const result = await crawlMetaAdLibrary({
    brandName: brand.brandName,
    metaLibraryUrl: brand.metaLibraryUrl,
    limit,
  });

  const images: CollectedAdImage[] = [];
  for (const ad of result.ads) {
    const imageUrl = ad.imageUrl || ad.videoThumbnailUrl;
    if (!imageUrl) continue;
    const id = imageId(brand.brandName, ad.adSnapshotUrl || imageUrl);
    const localImagePath = await downloadImage(imageUrl, id);
    images.push({
      id,
      brandName: brand.brandName,
      sourcePlatform: "Meta",
      imageUrl,
      localImagePath,
      originalAdUrl: ad.adSnapshotUrl,
      collectedAt: ad.crawledAt,
    });
  }

  return images.slice(0, limit);
}

export async function collectImagesForBrands(brands: MvpBrand[], limitPerBrand = 20) {
  const status: CollectionStatus = {
    totalBrands: brands.length,
    completedBrands: 0,
    collectedImages: 0,
    failedBrands: 0,
    failures: [],
  };
  const images: CollectedAdImage[] = [];

  for (const brand of brands) {
    try {
      const brandImages = await collectMetaImagesForBrand(brand, limitPerBrand);
      images.push(...brandImages);
      status.completedBrands += 1;
      status.collectedImages += brandImages.length;
    } catch (error) {
      status.failedBrands += 1;
      status.failures.push({
        brandName: brand.brandName,
        error: error instanceof Error ? error.message : "이미지 수집 실패",
      });
    }
  }

  return { status, images };
}
