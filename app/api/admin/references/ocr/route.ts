import { NextResponse } from "next/server";
import { cancelReferenceOcrRun, getReferenceOcrStatus, startReferenceOcrRun } from "../../../../lib/creative-generation/referenceOcrRunner.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function assertTrustedMutation(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (origin && origin !== requestUrl.origin) throw new Error("다른 출처에서는 레퍼런스 OCR을 변경할 수 없습니다.");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") throw new Error("신뢰할 수 없는 OCR 요청입니다.");
}

export async function GET() {
  try {
    return NextResponse.json({ ok: true, ...(await getReferenceOcrStatus({ resume: true })) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "OCR 상태를 확인하지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const body = await request.json().catch(() => ({}));
    const ids = Array.isArray(body.ids) ? body.ids.map((value: unknown) => String(value || "").trim()).filter(Boolean) : undefined;
    const status = await startReferenceOcrRun({ ids, retryFailed: body.action === "retry-failed", force: body.action === "retry-failed" });
    return NextResponse.json({ ok: true, ...status }, { status: status.run?.status === "running" ? 202 : 200 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "OCR 실행을 시작하지 못했습니다." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    assertTrustedMutation(request);
    const body = await request.json().catch(() => ({}));
    if (body.action !== "cancel") throw new Error("cancel 액션이 필요합니다.");
    return NextResponse.json({ ok: true, ...(await cancelReferenceOcrRun()) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "OCR 실행을 중단하지 못했습니다." }, { status: 400 });
  }
}
