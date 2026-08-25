import { randomUUID } from "crypto";
import path from "path";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { deleteCategoryCreativeSource, listCategoryCreativeSources, saveCategoryCreativeSource } from "../../../lib/category-creatives/repository.server";
import type { CategoryCreativeSource } from "../../../lib/category-creatives/types";
import { assertInternalApiAccess, InternalApiAccessError } from "../../../lib/internal-api/access.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertInternalApiAccess(request);
    const url = new URL(request.url);
    const sources = await listCategoryCreativeSources({ advertiserId: url.searchParams.get("advertiserId") || undefined, categoryId: url.searchParams.get("categoryId") || undefined });
    return NextResponse.json({ ok: true, sources });
  } catch (error) {
    if (error instanceof InternalApiAccessError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    return NextResponse.json({ ok: false, error: "원본 이미지 목록을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    assertInternalApiAccess(request);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "이미지 파일을 선택해 주세요." }, { status: 400 });
    if (file.size > 15 * 1024 * 1024) return NextResponse.json({ ok: false, error: "이미지는 15MB 이하만 업로드할 수 있습니다." }, { status: 413 });
    const advertiserId = String(form.get("advertiserId") || "").trim();
    const advertiserName = String(form.get("advertiserName") || "").trim();
    const categoryId = String(form.get("categoryId") || "").trim();
    const categoryName = String(form.get("categoryName") || "").trim();
    const productName = String(form.get("productName") || path.parse(file.name).name).trim();
    if (!advertiserId || !advertiserName || !categoryId || !categoryName) return NextResponse.json({ ok: false, error: "광고주와 카테고리를 먼저 선택해 주세요." }, { status: 400 });
    const raw = Buffer.from(await file.arrayBuffer());
    const metadata = await sharp(raw, { failOn: "error", limitInputPixels: 40_000_000 }).metadata();
    if (!metadata.width || !metadata.height || !["jpeg", "png", "webp"].includes(metadata.format || "")) return NextResponse.json({ ok: false, error: "JPG, PNG, WEBP 이미지만 업로드할 수 있습니다." }, { status: 415 });
    const normalized = await sharp(raw, { failOn: "error", limitInputPixels: 40_000_000 }).rotate().resize({ width: 2200, height: 2200, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
    const id = `category-source-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const source: CategoryCreativeSource = {
      id,
      advertiserId,
      advertiserName: advertiserName.slice(0, 120),
      categoryId,
      categoryName: categoryName.slice(0, 80),
      productName: productName.slice(0, 160),
      originalFileName: path.basename(file.name).slice(0, 200),
      mimeType: "image/jpeg",
      fileName: `${id}.jpg`,
      sourceType: "upload",
      createdAt: new Date().toISOString(),
    };
    await saveCategoryCreativeSource(source, normalized);
    return NextResponse.json({ ok: true, source }, { status: 201 });
  } catch (error) {
    if (error instanceof InternalApiAccessError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "이미지 업로드에 실패했습니다." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    assertInternalApiAccess(request);
    const id = new URL(request.url).searchParams.get("id") || "";
    return NextResponse.json({ ok: await deleteCategoryCreativeSource(id) });
  } catch (error) {
    if (error instanceof InternalApiAccessError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    return NextResponse.json({ ok: false, error: "원본 이미지를 삭제하지 못했습니다." }, { status: 500 });
  }
}
