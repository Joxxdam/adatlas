import { NextResponse } from "next/server";
import { nativeReferenceLibraryRepository } from "../../../lib/creative-generation/nativeReferenceLibraryRepository.server";
import { startReferenceOcrRun } from "../../../lib/creative-generation/referenceOcrRunner.server";
import { nativeReferenceCompatibilityConfidences, nativeReferenceCompositionTypes, nativeReferenceCategoryGroups, nativeReferencePhotographyTypes, normalizeNativeReferenceFoodSubcategory, nativeReferenceProductForms, nativeReferenceSlotShapes, nativeReferenceTextDensities, normalizeNativeReferenceCategory, normalizeReferenceRawLines, type ManagedNativeReferenceItem, type ReferenceTextRegion } from "../../../lib/creative-generation/referenceLibraryManagement";

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

function reconcileManualRegions(regions: ReferenceTextRegion[] | undefined, rawLines: string[]) {
  const editable = (regions || []).filter((region) => region.sourceType !== "source-product-label" && region.sourceType !== "decorative");
  const visibleLines = rawLines.filter((line) => line.trim());
  const expectedCount = editable.reduce((count, region) => count + Math.max(1, region.lines.filter((line) => line.trim()).length), 0);
  if (!editable.length || expectedCount !== visibleLines.length) return { regions: regions || [], safe: false };
  let cursor = 0;
  const editableIds = new Set(editable.map((region) => region.id));
  const next = (regions || []).map((region) => {
    if (!editableIds.has(region.id)) return region;
    const lineCount = Math.max(1, region.lines.filter((line) => line.trim()).length);
    const lines = visibleLines.slice(cursor, cursor + lineCount);
    cursor += lineCount;
    return { ...region, text: lines.join("\n"), lines, confidence: 1, reviewRequired: false };
  });
  return { regions: next, safe: cursor === visibleLines.length };
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
    const ocrStatus = await startReferenceOcrRun({ ids: result.added.map((item) => item.id) });
    return NextResponse.json({ ok: true, added: result.added, nativeCopyAnalysis: { queuedCount: result.added.length }, ocrStatus, library: publicLibrary() }, { status: 202 });
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
    if (body.nativeCopyApproval !== undefined) {
      const target = nativeReferenceLibraryRepository.list().items.find((item) => item.id === id);
      if (!target) throw new Error("레퍼런스를 찾지 못했습니다.");
      const action = String(body.nativeCopyApproval);
      if (action === "approve") {
        if (!target.nativeCopy?.rawLines?.some((line) => line.trim())) throw new Error("승인할 원문 문구가 없습니다.");
        await nativeReferenceLibraryRepository.updateNativeCopy(id, {
          approvalStatus: "manually-approved",
          analysisStatus: "ready",
          approvedAt: new Date().toISOString(),
          analysisError: undefined,
          useForCopyAdaptation: true,
        });
      } else if (action === "reject") {
        await nativeReferenceLibraryRepository.updateNativeCopy(id, {
          approvalStatus: "rejected",
          analysisStatus: "needs-review",
          approvedAt: undefined,
          useForCopyAdaptation: false,
        });
      } else {
        throw new Error("지원하지 않는 분석 승인 작업입니다.");
      }
    } else if (body.nativeCopy !== undefined) {
      const rawText = String(body.nativeCopy.rawText || "").replace(/\r/g, "");
      const rawLines = normalizeReferenceRawLines(rawText.split("\n"));
      const target = nativeReferenceLibraryRepository.list().items.find((item) => item.id === id);
      if (!target) throw new Error("레퍼런스를 찾지 못했습니다.");
      const reconciled = reconcileManualRegions(target.nativeCopy?.textRegions, rawLines);
      const ready = Boolean(rawLines.some((line) => line.trim())) && reconciled.safe;
      await nativeReferenceLibraryRepository.updateNativeCopy(id, {
        ...body.nativeCopy,
        rawText: rawLines.join("\n"),
        rawLines,
        textRegions: reconciled.regions,
        confidence: ready ? 1 : target.nativeCopy?.confidence,
        ocrConfidence: target.nativeCopy?.ocrConfidence,
        analysisStatus: ready ? "ready" : "needs-review",
        approvalStatus: ready ? "manually-approved" : "needs-review",
        approvedAt: ready ? new Date().toISOString() : undefined,
        analysisError: ready ? undefined : "수정한 줄 수와 저장된 문구 영역이 달라 좌표 재분석이 필요합니다.",
        manuallyCorrected: true,
        extractionSource: "manual",
        useForCopyAdaptation: ready && body.nativeCopy.useForCopyAdaptation !== false,
      });
    } else {
      await nativeReferenceLibraryRepository.updateCompatibility(id, patch);
    }
    return NextResponse.json({ ok: true, library: publicLibrary() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "레퍼런스 호환 정보 수정에 실패했습니다." }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  try {
    assertTrustedMutation(request);
    const body = await request.json().catch(() => ({}));
    if (Array.isArray(body.ids)) {
      const ids: string[] = [...new Set<string>(body.ids.map((value: unknown) => String(value || "").trim()).filter((value: string) => Boolean(value)))].slice(0, 3);
      if (!ids.length) throw new Error("정밀 분석할 레퍼런스 ID가 필요합니다.");
      const nativeCopies = await Promise.all(ids.map((id) => nativeReferenceLibraryRepository.extractNativeCopy(id)));
      return NextResponse.json({ ok: true, nativeCopies, library: publicLibrary() });
    }
    const id = String(body.id || "").trim();
    if (!id) throw new Error("다시 분석할 레퍼런스 ID가 필요합니다.");
    const nativeCopy = await nativeReferenceLibraryRepository.extractNativeCopy(id, { force: true });
    return NextResponse.json({ ok: true, nativeCopy, library: publicLibrary() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "레퍼런스 문구 재분석에 실패했습니다." }, { status: 400 });
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
