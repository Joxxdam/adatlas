import "server-only";
import type { AutoProductionNotification, AutoProductionRun } from "./types";

export interface AutoProductionNotifier {
  notify(notification: AutoProductionNotification): Promise<void>;
}

export const siteNotificationProvider: AutoProductionNotifier = {
  async notify() {
    // 사이트 알림은 실행 기록에서 파생해 공통 사이드바에 표시한다.
  },
};

export function notificationForRuns(runs: AutoProductionRun[]): AutoProductionNotification | undefined {
  const active = runs.filter((run) => ["scheduled", "selecting-products", "analyzing-products", "generating-hooks", "queued", "generating-creatives"].includes(run.status));
  if (active.length) {
    const total = active.reduce((sum, run) => sum + run.expectedImages, 0);
    const completed = active.reduce((sum, run) => sum + run.completedImages, 0);
    return { level: "progress", message: `자동 제작 중 · ${completed}/${total}`, href: "/admin/auto-production" };
  }
  const latest = runs[0];
  if (!latest) return undefined;
  const completed = runs.reduce((sum, run) => sum + run.completedImages, 0);
  const failed = runs.reduce((sum, run) => sum + run.failedImages, 0);
  return failed
    ? { level: "warning", message: `광고 ${completed}장 완료 · ${failed}장 확인 필요`, href: "/admin/auto-production" }
    : { level: "success", message: `오늘의 광고 콘텐츠 ${completed}장이 완성됐어요.`, href: "/admin/auto-production" };
}
