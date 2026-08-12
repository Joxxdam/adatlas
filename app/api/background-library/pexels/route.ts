import { NextResponse } from "next/server";

import {
  assertPexelsBulkAllowed,
  pexelsStatus,
  saveSelectedPexelsPhoto,
  searchPexels,
} from "../../../lib/background-library/pexels.server";
import type { PexelsSearchPhoto } from "../../../lib/background-library/catalogTypes";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!url.searchParams.get("query")) return NextResponse.json({ ok: true, status: pexelsStatus() });
  try {
    const result = await searchPexels({
      query: url.searchParams.get("query") || "",
      page: Number(url.searchParams.get("page") || 1),
      perPage: Number(url.searchParams.get("perPage") || 24),
    });
    return NextResponse.json({ ok: true, status: pexelsStatus(), ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, status: pexelsStatus(), error: error instanceof Error ? error.message : "Pexels 검색에 실패했습니다." }, { status: 422 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      action?: "save-selected" | "bulk-check";
      photo?: PexelsSearchPhoto;
      collectionId?: string;
      categoryId?: string;
      matchedQuery?: string;
      dryRun?: boolean;
      confirmedByUser?: boolean;
      permissionEvidence?: string;
    };
    if (body.action === "bulk-check") {
      assertPexelsBulkAllowed(body);
      return NextResponse.json({ ok: true, allowed: true });
    }
    if (body.action !== "save-selected" || !body.photo) return NextResponse.json({ ok: false, error: "선택한 Pexels 사진이 필요합니다." }, { status: 400 });
    const result = await saveSelectedPexelsPhoto({
      photo: body.photo, collectionId: String(body.collectionId || ""), categoryId: String(body.categoryId || ""),
      matchedQuery: String(body.matchedQuery || ""), dryRun: body.dryRun,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Pexels 사진 저장에 실패했습니다." }, { status: 422 });
  }
}
