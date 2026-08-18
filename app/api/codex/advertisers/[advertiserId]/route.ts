import { NextResponse } from "next/server";
import {
  deleteBrandMemory,
  getAdvertiserThread,
  readBrandMemory,
  resetAdvertiserThread,
  saveBrandMemory,
} from "../../../../lib/creative-generation/codexRegistry.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function advertiserId(value: string) {
  const decoded = decodeURIComponent(value);
  if (!/^[a-z0-9.-]{1,160}$/.test(decoded) || decoded.includes("..")) throw new Error("광고주 ID가 올바르지 않습니다.");
  return decoded;
}

export async function GET(_: Request, context: { params: Promise<{ advertiserId: string }> }) {
  try {
    const id = advertiserId((await context.params).advertiserId);
    return NextResponse.json({ ok: true, advertiserId: id, thread: await getAdvertiserThread(id), brandMemory: await readBrandMemory(id) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "광고주 기억 조회 실패" }, { status: 400 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ advertiserId: string }> }) {
  try {
    const id = advertiserId((await context.params).advertiserId);
    const body = await request.json() as { approvedDirections?: string[]; rejectedDirections?: string[]; feedback?: string[] };
    const brandMemory = await saveBrandMemory(id, {
      approvedDirections: Array.isArray(body.approvedDirections) ? body.approvedDirections : [],
      rejectedDirections: Array.isArray(body.rejectedDirections) ? body.rejectedDirections : [],
      feedback: Array.isArray(body.feedback) ? body.feedback : [],
    });
    return NextResponse.json({ ok: true, brandMemory });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "광고주 기억 수정 실패" }, { status: 400 });
  }
}

export async function POST(_: Request, context: { params: Promise<{ advertiserId: string }> }) {
  try {
    const id = advertiserId((await context.params).advertiserId);
    return NextResponse.json({ ok: true, thread: await resetAdvertiserThread(id), message: "다음 제작부터 업체 공통 기억만 사용해 새 Codex 스레드를 시작합니다." });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "스레드 초기화 실패" }, { status: 400 });
  }
}

export async function DELETE(_: Request, context: { params: Promise<{ advertiserId: string }> }) {
  try {
    const id = advertiserId((await context.params).advertiserId);
    await deleteBrandMemory(id);
    return NextResponse.json({ ok: true, message: "업체 공통 기억을 삭제했습니다. 상품 작업 기록은 변경하지 않았습니다." });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "광고주 기억 삭제 실패" }, { status: 400 });
  }
}
