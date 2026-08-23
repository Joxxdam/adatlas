import { NextResponse } from "next/server";
import { verifyAutoProductionAccess } from "../../../lib/auto-production/access.server";
import { autoProductionAdvertiserRepository } from "../../../lib/auto-production/advertiserConfig.server";
import { notificationForRuns } from "../../../lib/auto-production/notifications.server";
import { plannedImageCount } from "../../../lib/auto-production/productSelector";
import { autoProductionRepository } from "../../../lib/auto-production/productionRepository.server";
import { recoverAutoProductionRuns, syncAutoProductionRun } from "../../../lib/auto-production/productionRunner.server";
import { publicAutoProductionError } from "../../../lib/auto-production/publicAutoProduction.server";
import { seoulClock } from "../../../lib/auto-production/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    verifyAutoProductionAccess(request);
    await recoverAutoProductionRuns();
    const [advertisers, settings] = await Promise.all([autoProductionAdvertiserRepository.list(), autoProductionAdvertiserRepository.settings()]);
    const today = seoulClock().date;
    const runs = await autoProductionRepository.list({ businessDate: today, limit: 100 });
    const synced = [];
    for (const run of runs) {
      const packagePending = run.completedImages > 0 && run.packageStatus !== "ready";
      synced.push(["queued", "generating-creatives"].includes(run.status) || packagePending ? await syncAutoProductionRun(run.id) : run);
    }
    const validRuns = synced.filter((run): run is NonNullable<typeof run> => Boolean(run));
    const active = validRuns.filter((run) => ["scheduled", "selecting-products", "analyzing-products", "generating-hooks", "queued", "generating-creatives"].includes(run.status));
    const nextRunAt = advertisers.filter((config) => config.enabled && config.nextRunAt).map((config) => config.nextRunAt).sort()[0];
    const plannedImages = Math.min(settings.maxImagesPerDay, plannedImageCount(advertisers));
    return NextResponse.json({
      ok: true,
      status: {
        nextRunAt,
        activeAdvertiserCount: advertisers.filter((config) => config.enabled).length,
        plannedImageCount: plannedImages,
        selectedProductCount: validRuns.reduce((sum, run) => sum + run.tasks.length, 0),
        plannedProductCount: plannedImages,
        completedTodayCount: validRuns.reduce((sum, run) => sum + run.completedImages, 0),
        failedTodayCount: validRuns.reduce((sum, run) => sum + run.failedImages, 0),
        activeRunCount: active.length,
        maxImagesPerDay: settings.maxImagesPerDay,
        paused: settings.paused,
        notification: notificationForRuns(validRuns),
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: publicAutoProductionError(error, "자동 제작 상태를 확인하지 못했습니다.") }, { status: 403 });
  }
}
