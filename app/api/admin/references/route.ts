import { NextResponse } from "next/server";
import { nativeReferenceLibraryRepository } from "../../../lib/creative-generation/nativeReferenceLibraryRepository.server";
import { nativeAdReferenceFromManagedItem } from "../../../lib/creative-generation/referenceCreativeLibrary.server";
import { prewarmReferenceCopyProfiles } from "../../../lib/creative-generation/referenceAdaptedPlanning.server";
import { nativeReferenceCompatibilityConfidences, nativeReferenceCompositionTypes, nativeReferenceCategoryGroups, nativeReferencePhotographyTypes, normalizeNativeReferenceFoodSubcategory, nativeReferenceProductForms, nativeReferenceSlotShapes, nativeReferenceTextDensities, normalizeNativeReferenceCategory, type ManagedNativeReferenceItem } from "../../../lib/creative-generation/referenceLibraryManagement";

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
    counts: Object.fromEntries(nativeReferenceCategoryGroups.map((category) => [category, manifest.items.filter((item) => item.categoryGroup === category).length])),
    foodProduceCount: manifest.items.filter((item) => item.categoryGroup === "food" && item.foodSubcategory === "produce-agriculture").length,
  };
}

export async function GET() {
  try {
    return NextResponse.json({ ok: true, library: publicLibrary() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "레퍼런스 목록을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const formData = await request.formData();
    const files = formData.getAll("files").filter((value): value is File => value instanceof File);
    const result = await nativeReferenceLibraryRepository.add(files);
    const profileAnalysis = result.added.length
      ? await prewarmReferenceCopyProfiles(result.added.map(nativeAdReferenceFromManagedItem))
      : { analyzedCount: 0, fallbackCount: 0 };
    return NextResponse.json({ ok: true, added: result.added, profileAnalysis: { analyzedCount: profileAnalysis.analyzedCount, fallbackCount: profileAnalysis.fallbackCount }, library: publicLibrary() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "레퍼런스 업로드에 실패했습니다." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    assertTrustedMutation(request);
    const body = await request.json().catch(() => ({}));
    const id = String(body.id || "").trim();
    if (!id) throw new Error("수정할 레퍼런스 ID가 필요합니다.");
    const patch: Partial<ManagedNativeReferenceItem> = {};
    if (body.categoryGroup !== undefined) patch.categoryGroup = normalizeNativeReferenceCategory(body.categoryGroup);
    if (Object.prototype.hasOwnProperty.call(body, "foodSubcategory")) {
      patch.foodSubcategory = normalizeNativeReferenceFoodSubcategory(body.foodSubcategory);
    }
    if (nativeReferenceProductForms.includes(body.productForm)) patch.productForm = body.productForm;
    if (nativeReferenceCompositionTypes.includes(body.compositionType)) patch.compositionType = body.compositionType;
    if (nativeReferenceSlotShapes.includes(body.productSlotShape)) patch.productSlotShape = body.productSlotShape;
    if (nativeReferencePhotographyTypes.includes(body.photographyType)) patch.photographyType = body.photographyType;
    if (nativeReferenceTextDensities.includes(body.textDensity)) patch.textDensity = body.textDensity;
    if (nativeReferenceCompatibilityConfidences.includes(body.compatibilityConfidence)) patch.compatibilityConfidence = body.compatibilityConfidence;
    if (body.productSlotCount !== undefined) patch.productSlotCount = Math.max(1, Math.min(6, Math.round(Number(body.productSlotCount) || 1)));
    for (const key of ["supportsPackagedProduct", "supportsNaturalFood", "supportsHumanModel", "supportsMultipleProducts"] as const) {
      if (typeof body[key] === "boolean") patch[key] = body[key];
    }
    await nativeReferenceLibraryRepository.updateCompatibility(id, patch);
    return NextResponse.json({ ok: true, library: publicLibrary() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "레퍼런스 호환 정보 수정에 실패했습니다." }, { status: 400 });
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
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "레퍼런스 삭제에 실패했습니다." }, { status: 400 });
  }
}
