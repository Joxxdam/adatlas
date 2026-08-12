import { NextResponse } from "next/server";

import { recommendCatalogBackgrounds } from "../../../lib/background-library/catalogRecommendation";
import {
  catalogAssetUrl,
  catalogItemToLegacy,
  filterBackgroundCatalog,
  readBackgroundCatalogManifest,
  readBackgroundCollectionConfigs,
  summarizeBackgroundCatalog,
  updateBackgroundCatalogItem,
} from "../../../lib/background-library/catalogStore.server";
import type {
  BackgroundCatalogFilters,
  CatalogRecommendationInput,
} from "../../../lib/background-library/catalogTypes";

export const runtime = "nodejs";

function queryFilters(url: URL): BackgroundCatalogFilters {
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const pageSize = Math.max(1, Math.min(48, Number(url.searchParams.get("pageSize") || 24)));
  const value = (key: string) => url.searchParams.get(key) || undefined;
  return {
    collectionId: value("collection"), category: value("category"), scene: value("scene"),
    mood: value("mood"), color: value("color"), brightness: value("brightness") as BackgroundCatalogFilters["brightness"],
    people: value("people") as BackgroundCatalogFilters["people"], negativeSpace: value("negativeSpace"),
    indoorOutdoor: value("indoorOutdoor") as BackgroundCatalogFilters["indoorOutdoor"],
    licenseStatus: value("license") as BackgroundCatalogFilters["licenseStatus"],
    sourceType: value("source") as BackgroundCatalogFilters["sourceType"], search: value("search"),
    favorite: value("favorite") === "true", status: value("status") as BackgroundCatalogFilters["status"],
    sort: value("sort") as BackgroundCatalogFilters["sort"], page, pageSize,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = queryFilters(url);
  const [manifest, configs] = await Promise.all([
    readBackgroundCatalogManifest(), readBackgroundCollectionConfigs(),
  ]);
  const filtered = filterBackgroundCatalog(manifest.items, filters);
  const page = filters.page || 1;
  const pageSize = filters.pageSize || 24;
  const items = filtered.slice((page - 1) * pageSize, page * pageSize).map((item) => ({
    ...item,
    previewUrl: catalogAssetUrl(item.id, "processed"),
    thumbnailUrl: catalogAssetUrl(item.id, "thumbnail"),
    background: catalogItemToLegacy(item),
  }));
  return NextResponse.json({
    ok: true, items, page, pageSize, total: filtered.length,
    totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
    summary: await summarizeBackgroundCatalog(manifest.items), configs,
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as CatalogRecommendationInput;
    if (!body.product) return NextResponse.json({ ok: false, error: "상품 정보가 필요합니다." }, { status: 400 });
    const manifest = await readBackgroundCatalogManifest();
    const recommendations = await recommendCatalogBackgrounds(manifest.items, { ...body, limit: 12 });
    return NextResponse.json({
      ok: true,
      recommendations,
      summary: await summarizeBackgroundCatalog(manifest.items),
      configs: await readBackgroundCollectionConfigs(),
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "배경 추천에 실패했습니다." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { id?: string; changes?: Record<string, unknown> };
    const id = String(body.id || "");
    if (!/^bg-[a-z0-9-]+$/.test(id)) return NextResponse.json({ ok: false, error: "잘못된 배경 ID입니다." }, { status: 400 });
    const changes: Parameters<typeof updateBackgroundCatalogItem>[1] = {};
    if (["pending", "approved", "review", "rejected", "inactive"].includes(String(body.changes?.status))) {
      changes.status = body.changes?.status as typeof changes.status;
      if (changes.status === "approved") {
        changes.analysisStatus = "manually-reviewed";
        changes.analysisConfidence = 0.95;
        changes.textRisk = "low";
        changes.logoRisk = "low";
        changes.endorsementRisk = "low";
      }
    }
    if (typeof body.changes?.favorite === "boolean") changes.favorite = body.changes.favorite;
    if (typeof body.changes?.primaryCategory === "string" && /^[a-z0-9-]+$/.test(body.changes.primaryCategory)) changes.primaryCategory = body.changes.primaryCategory;
    if (Array.isArray(body.changes?.secondaryCategories)) changes.secondaryCategories = body.changes.secondaryCategories.map(String).filter((value) => /^[a-z0-9-]+$/.test(value)).slice(0, 12);
    if (Array.isArray(body.changes?.moodTags)) changes.moodTags = body.changes.moodTags.map(String).slice(0, 12);
    const item = await updateBackgroundCatalogItem(id, changes);
    return item ? NextResponse.json({ ok: true, item }) : NextResponse.json({ ok: false, error: "배경을 찾지 못했습니다." }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "배경 수정에 실패했습니다." }, { status: 500 });
  }
}
