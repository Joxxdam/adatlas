import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { crawlMetaAdLibrary } from "../../../lib/meta-crawler/crawlMetaAdLibrary";
import { mergeImages } from "../../../lib/mvp/store";
import { CollectedAdImage } from "../../../lib/mvp/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const collectedDir = path.join(process.cwd(), "public", "collected-images");
const collectedDataPath = path.join(process.cwd(), "data", "collected-ad-images.json");

function slug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function imageId(brandName: string, imageUrl: string) {
  return `${slug(brandName) || "brand"}-${Buffer.from(imageUrl).toString("base64url").slice(0, 24)}`;
}

function extensionFromContentType(contentType: string) {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  return "jpg";
}

async function downloadImage(imageUrl: string, id: string) {
  await fs.mkdir(collectedDir, { recursive: true });

  const response = await fetch(imageUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36",
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`이미지 다운로드 실패: HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    throw new Error(
      `이미지 다운로드 실패: 이미지 응답이 아닙니다 (${contentType || "content-type 없음"})`
    );
  }

  const ext = extensionFromContentType(contentType);
  const fileName = `${id}.${ext}`;
  const filePath = path.join(collectedDir, fileName);
  const buffer = Buffer.from(await response.arrayBuffer());

  if (buffer.length === 0) {
    throw new Error("이미지 다운로드 실패: 빈 파일입니다.");
  }

  await fs.writeFile(filePath, buffer);
  return `/collected-images/${fileName}`;
}

async function readCollectedImages() {
  await fs.mkdir(path.dirname(collectedDataPath), { recursive: true });

  try {
    const raw = await fs.readFile(collectedDataPath, "utf8");
    return JSON.parse(raw) as CollectedAdImage[];
  } catch {
    return [];
  }
}

async function mergeCollectedImages(items: CollectedAdImage[]) {
  try {
    const existing = await readCollectedImages();
    const byImageUrl = new Map(existing.map((item) => [item.imageUrl, item]));
    let added = 0;

    for (const item of items) {
      if (!byImageUrl.has(item.imageUrl)) {
        added += 1;
      }
      byImageUrl.set(item.imageUrl, { ...byImageUrl.get(item.imageUrl), ...item });
    }

    const next = [...byImageUrl.values()].sort((a, b) =>
      b.collectedAt.localeCompare(a.collectedAt)
    );
    await fs.writeFile(collectedDataPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");

    return { added, total: next.length, images: next };
  } catch (error) {
    throw new Error(
      `data JSON 저장 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const brandName = String(body.brandName ?? "").trim();
    const metaLibraryUrl = String(body.metaLibraryUrl ?? "").trim();
    const limit = 5;

    const result = await crawlMetaAdLibrary({ brandName, metaLibraryUrl, limit });
    const imageItems = result.ads
      .map((ad) => ({
        brandName: ad.brandName,
        imageUrl: ad.imageUrl || ad.videoThumbnailUrl || "",
        originalAdUrl: ad.adSnapshotUrl || ad.landingUrl || "",
        collectedAt: ad.crawledAt,
      }))
      .filter((item) => item.imageUrl);

    if (imageItems.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "이미지 후보 0개: Meta 페이지에서 저장 가능한 광고 이미지를 찾지 못했습니다.",
          warnings: result.warnings,
        },
        { status: 404 }
      );
    }

    const downloaded: CollectedAdImage[] = [];
    const failures: string[] = [];

    for (const item of imageItems.slice(0, limit)) {
      const id = imageId(item.brandName, item.imageUrl);

      try {
        const localImagePath = await downloadImage(item.imageUrl, id);
        downloaded.push({
          id,
          brandName: item.brandName,
          sourcePlatform: "Meta",
          imageUrl: item.imageUrl,
          localImagePath,
          originalAdUrl: item.originalAdUrl,
          collectedAt: item.collectedAt,
        });
      } catch (error) {
        failures.push(
          `${item.imageUrl}: ${error instanceof Error ? error.message : "이미지 다운로드 실패"}`
        );
      }
    }

    if (downloaded.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: `이미지 다운로드 실패: ${failures.join(" / ") || "다운로드 가능한 이미지가 없습니다."}`,
          warnings: result.warnings,
        },
        { status: 502 }
      );
    }

    const collected = await mergeCollectedImages(downloaded);
    await mergeImages(downloaded);

    return NextResponse.json({
      success: true,
      brandName: result.brandName,
      count: downloaded.length,
      added: collected.added,
      total: collected.total,
      items: downloaded,
      failures,
      warnings: result.warnings,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Meta Ad Library crawl failed.",
      },
      { status: 500 }
    );
  }
}
