import { NextResponse } from "next/server";

import { extractCatalogZip, importBackgroundSources, type CatalogImportSource } from "../../../lib/background-library/importPipeline.server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const collectionId = String(form.get("collectionId") || "");
    const categoryId = String(form.get("categoryId") || "");
    const dryRun = form.get("dryRun") === "true";
    const upload = form.get("file");
    if (!(upload instanceof File) || upload.size <= 0 || upload.size > 250 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: "250MB 이하의 이미지 또는 ZIP 파일을 선택해주세요." }, { status: 400 });
    }
    const buffer = Buffer.from(await upload.arrayBuffer());
    let sources: CatalogImportSource[];
    if (/\.zip$/i.test(upload.name) || upload.type === "application/zip") {
      sources = await extractCatalogZip(buffer);
    } else {
      const license = JSON.parse(String(form.get("license") || "{}")) as CatalogImportSource["license"];
      sources = [{ name: upload.name, buffer, license }];
    }
    const result = await importBackgroundSources({ collectionId, categoryId, sources, sourceType: "local-import", dryRun });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "배경 가져오기에 실패했습니다." }, { status: 422 });
  }
}
