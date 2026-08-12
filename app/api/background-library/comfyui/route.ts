import { NextResponse } from "next/server";

import { checkComfyUi, createComfyPlan } from "../../../lib/background-library/comfyui.server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ ok: true, status: await checkComfyUi() });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { collectionId?: string; categoryId?: string; limit?: number; dryRun?: boolean };
    const result = await createComfyPlan({
      collectionId: String(body.collectionId || ""), categoryId: body.categoryId ? String(body.categoryId) : undefined,
      limit: Number(body.limit || 12), dryRun: body.dryRun !== false,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "ComfyUI 계획 생성에 실패했습니다." }, { status: 422 });
  }
}
