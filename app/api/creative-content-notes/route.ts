import { NextResponse } from "next/server";
import { creativeContentNoteRepository } from "../../lib/creative-content-notes/repository.server";
import { creativeContentNoteScopes, creativeContentNoteTypes } from "../../lib/creative-content-notes/types";
import type { CreativeContentNote } from "../../lib/creative-content-notes/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const advertiserId = query.get("advertiserId")?.trim();
  if (!advertiserId) return NextResponse.json({ ok: false, error: "advertiserId가 필요합니다." }, { status: 400 });
  const productId = query.get("productId") || undefined;
  const categoryId = query.get("categoryId") || undefined;
  const promotionId = query.get("promotionId") || undefined;
  const resolution = await creativeContentNoteRepository.resolve({ advertiserId, productId, categoryId, promotionId });
  const allNotes = await creativeContentNoteRepository.list({ advertiserId });
  return NextResponse.json({ ok: true, notes: allNotes, resolution });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Partial<CreativeContentNote>;
  if (!body.advertiserId?.trim() || !body.scopeId?.trim() || !body.title?.trim() || !body.content?.trim()) return NextResponse.json({ ok: false, error: "광고주, 적용 범위, 제목, 내용을 모두 입력해 주세요." }, { status: 400 });
  if (!body.scope || !creativeContentNoteScopes.includes(body.scope)) return NextResponse.json({ ok: false, error: "지원하지 않는 적용 범위입니다." }, { status: 400 });
  if (!body.type || !creativeContentNoteTypes.includes(body.type)) return NextResponse.json({ ok: false, error: "지원하지 않는 참고사항 유형입니다." }, { status: 400 });
  const note = await creativeContentNoteRepository.create({
    advertiserId: body.advertiserId.trim(),
    scope: body.scope,
    scopeId: body.scopeId.trim(),
    type: body.type,
    title: body.title.trim().slice(0, 120),
    content: body.content.trim().slice(0, 1000),
    required: Boolean(body.required),
    prohibited: Boolean(body.prohibited),
    active: body.active !== false,
    startsAt: body.startsAt || null,
    endsAt: body.endsAt || null,
    source: body.source || "user",
  });
  return NextResponse.json({ ok: true, note }, { status: 201 });
}

export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Partial<CreativeContentNote> & { id?: string };
  if (!body.id) return NextResponse.json({ ok: false, error: "참고사항 ID가 필요합니다." }, { status: 400 });
  const note = await creativeContentNoteRepository.update(body.id, body);
  if (!note) return NextResponse.json({ ok: false, error: "참고사항을 찾지 못했습니다." }, { status: 404 });
  return NextResponse.json({ ok: true, note });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "참고사항 ID가 필요합니다." }, { status: 400 });
  const removed = await creativeContentNoteRepository.remove(id);
  return NextResponse.json({ ok: removed }, { status: removed ? 200 : 404 });
}
