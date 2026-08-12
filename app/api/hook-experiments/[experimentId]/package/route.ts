import { NextResponse } from "next/server";
import { HostingRegistrationPackageService } from "../../../../lib/hook-experiments/hostingPackage.server";
import { hookExperimentRepository } from "../../../../lib/hook-experiments/repository.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(
  _request: Request,
  context: { params: Promise<{ experimentId: string }> }
) {
  try {
    const { experimentId } = await context.params;
    const snapshot = await hookExperimentRepository.get(experimentId);
    if (!snapshot)
      return NextResponse.json({ ok: false, error: "실험을 찾지 못했습니다." }, { status: 404 });
    if (!snapshot.experimentAssets.some((asset) => asset.assetId)) {
      return NextResponse.json(
        { ok: false, error: "먼저 실험 소재를 한 장 이상 생성해 주세요." },
        { status: 409 }
      );
    }
    const output = await HostingRegistrationPackageService.build(snapshot);
    return new NextResponse(new Uint8Array(output.buffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${output.fileName}"`,
        "X-AdAtlas-Registration-Rows": String(output.rowCount),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "등록 패키지 생성 실패" },
      { status: 500 }
    );
  }
}
