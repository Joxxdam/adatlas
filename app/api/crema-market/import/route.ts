import { NextResponse } from "next/server";
import { parseCremaMarketWorkbook } from "../../../lib/crema-market/fileParser.server";
import { normalizeWorkbookRows } from "../../../lib/crema-market/normalizer";
import { importAndAnalyzeCremaMarket } from "../../../lib/crema-market/syncService.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const advertiserId = String(form.get("advertiserId") || "").trim();
    const advertiserName = String(form.get("advertiserName") || "").trim();
    if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "CSV/XLSX 파일을 선택해 주세요." }, { status: 400 });
    if (!advertiserId || !advertiserName) return NextResponse.json({ ok: false, error: "광고주 ID와 이름을 입력해 주세요." }, { status: 400 });
    if (!/\.(csv|xlsx|xls)$/i.test(file.name)) return NextResponse.json({ ok: false, error: "CSV, XLSX, XLS 파일만 업로드할 수 있습니다." }, { status: 415 });
    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ ok: false, error: "업로드 파일은 10MB 이하여야 합니다." }, { status: 413 });
    const rows = parseCremaMarketWorkbook(Buffer.from(await file.arrayBuffer()), file.name);
    const payload = normalizeWorkbookRows({
      advertiserId,
      advertiserName,
      brandName: String(form.get("brandName") || advertiserName),
      domain: String(form.get("domain") || ""),
      ...rows,
      provider: "file_upload",
    });
    if (!payload.products.length || !payload.dailyMetrics.length) {
      return NextResponse.json({ ok: false, error: "연결 가능한 상품과 일별 지표가 없습니다. 상품코드와 날짜 열을 확인해 주세요.", warnings: payload.warnings }, { status: 422 });
    }
    const periodDays = [1, 7, 14, 28].includes(Number(form.get("periodDays"))) ? (Number(form.get("periodDays")) as 1 | 7 | 14 | 28) : 14;
    const result = await importAndAnalyzeCremaMarket({ payload, provider: "file_upload", periodDays });
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "파일을 분석하지 못했습니다." }, { status: 400 });
  }
}
