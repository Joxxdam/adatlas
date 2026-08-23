import { NextResponse } from "next/server";
import { nativeReferenceLibraryRepository } from "../../../lib/creative-generation/nativeReferenceLibraryRepository.server";
import {
  nativeReferenceCategoryGroups,
  normalizeNativeReferenceCategory,
} from "../../../lib/creative-generation/referenceLibraryManagement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function assertTrustedMutation(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (origin && origin !== requestUrl.origin) throw new Error("다른 출처에서는 레퍼런스를 변경할 수 없습니다.");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new Error("신뢰할 수 없는 레퍼런스 변경 요청입니다.");
  }
}

function publicLibrary() {
  const manifest = nativeReferenceLibraryRepository.list();
  return {
    version: manifest.version,
    updatedAt: manifest.updatedAt || manifest.importedAt,
    items: manifest.items,
    counts: Object.fromEntries(nativeReferenceCategoryGroups.map((category) => [
      category,
      manifest.items.filter((item) => item.categoryGroup === category).length,
    ])),
  };
}

export async function GET() {
  try {
    return NextResponse.json({ ok: true, library: publicLibrary() });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "레퍼런스 목록을 불러오지 못했습니다." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const formData = await request.formData();
    const files = formData.getAll("files").filter((value): value is File => value instanceof File);
    const result = await nativeReferenceLibraryRepository.add(files);
    return NextResponse.json({ ok: true, added: result.added, library: publicLibrary() });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "레퍼런스 업로드에 실패했습니다." },
      { status: 400 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    assertTrustedMutation(request);
    const body = await request.json().catch(() => ({}));
    const id = String(body.id || "").trim();
    const categoryGroup = normalizeNativeReferenceCategory(body.categoryGroup);
    if (!id) throw new Error("수정할 레퍼런스 ID가 필요합니다.");
    await nativeReferenceLibraryRepository.updateCategory(id, categoryGroup);
    return NextResponse.json({ ok: true, library: publicLibrary() });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "카테고리 수정에 실패했습니다." },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    assertTrustedMutation(request);
    const body = await request.json().catch(() => ({}));
    const id = String(body.id || "").trim();
    if (!id) throw new Error("삭제할 레퍼런스 ID가 필요합니다.");
    const result = await nativeReferenceLibraryRepository.remove(id);
    return NextResponse.json({
      ok: true,
      removedId: result.removed.id,
      message: "삭제한 이미지는 제작 추첨 대상에서 즉시 제외했습니다.",
      library: publicLibrary(),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "레퍼런스 삭제에 실패했습니다." },
      { status: 400 }
    );
  }
}

