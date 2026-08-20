import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { NextResponse } from "next/server";
import { buildAdCopyCsv } from "../../../../../lib/ad-copy/adCopyValidator";
import { verifyAutoProductionAccess } from "../../../../../lib/auto-production/access.server";
import { autoProductionRepository } from "../../../../../lib/auto-production/productionRepository.server";
import { publicAutoProductionError } from "../../../../../lib/auto-production/publicAutoProduction.server";
import { creativeGenerationJobStore } from "../../../../../lib/creative-generation/jobStore.server";
import { executionResults } from "../../../../../lib/creative-generation/jobRunnerPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeName(value: string) {
  return value.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "product";
}

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    verifyAutoProductionAccess(request);
    const { runId } = await context.params;
    const run = await autoProductionRepository.get(runId);
    if (!run) return NextResponse.json({ ok: false, error: "자동 제작 실행 기록을 찾지 못했습니다." }, { status: 404 });
    const zip = new JSZip();
    const rows: Array<{ productName: string; primaryText: string; adName?: string; utm?: string; assetCode?: string; hookId?: string }> = [];
    for (const task of run.tasks) {
      if (!task.generationJobId) continue;
      const job = await creativeGenerationJobStore.get(task.generationJobId);
      if (!job) continue;
      const folder = zip.folder(safeName(task.candidate.productName));
      for (const result of executionResults(job).filter((item) => ["success", "approved"].includes(item.status) && item.nativeCreative?.finalPath)) {
        try {
          const name = result.creativeAsset?.fileName || `${safeName(task.candidate.productName)}-${result.hookPlan.hookCode}.jpg`;
          folder?.file(name, await readFile(result.nativeCreative!.finalPath!));
        } catch { /* 완성 파일 하나가 사라져도 나머지 패키지는 유지합니다. */ }
      }
      if (job.adCopy?.primaryText && job.adCopy.status !== "needs-review") {
        const row = { productName: task.candidate.productName, primaryText: job.adCopy.primaryText, adName: job.adCopy.adName, utm: job.adCopy.utm, assetCode: job.adCopy.assetCode, hookId: job.adCopy.basedOnHookId };
        rows.push(row);
        folder?.file("meta-primary-text.txt", `${row.primaryText}\n\n광고명\n${row.adName || ""}\n\nUTM\n${row.utm || ""}\n\n소재코드\n${row.assetCode || ""}\n`);
        folder?.file("ad-setup.json", `${JSON.stringify(row, null, 2)}\n`);
      }
    }
    zip.file("meta-ad-settings.csv", buildAdCopyCsv(rows));
    zip.file("README.txt", "상품 폴더에는 검수 통과 이미지와 상품당 Meta 기본 문구 1개가 들어 있습니다. meta-ad-settings.csv는 UTF-8 BOM 형식입니다.\n");
    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
    return new NextResponse(new Uint8Array(buffer), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`auto-production-${run.businessDate}-${run.id}.zip`)}` } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: publicAutoProductionError(error, "자동 제작 패키지를 만들지 못했습니다.") }, { status: 400 });
  }
}
