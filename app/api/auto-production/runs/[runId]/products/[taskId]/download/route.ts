import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { verifyAutoProductionAccess } from "../../../../../../../lib/auto-production/access.server";
import { buildAutoProductionProductPackage } from "../../../../../../../lib/auto-production/package.server";
import { publicAutoProductionError } from "../../../../../../../lib/auto-production/publicAutoProduction.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ runId: string; taskId: string }> }) {
  try {
    verifyAutoProductionAccess(request);
    const { runId, taskId } = await context.params;
    const artifact = await buildAutoProductionProductPackage(runId, taskId);
    const buffer = await readFile(artifact.path);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(artifact.fileName)}`,
      },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: publicAutoProductionError(error, "상품별 자동 제작 ZIP을 만들지 못했습니다.") }, { status: 400 });
  }
}
