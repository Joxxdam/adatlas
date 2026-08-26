import "server-only";
import { autoProductionAdvertiserRepository } from "./advertiserConfig.server";
import { recoverAutoProductionRuns, scheduleAutoProductionForAdvertiser, startScheduledAutoProductionRun } from "./productionRunner.server";
import { autoProductionRepository } from "./productionRepository.server";
import { dueAdvertisers, seoulClock } from "./schedule";
import { confirmedAutoProductionProductCount } from "./policy";

const legacySchedulerKeys = [Symbol.for("daywiz.auto-production.scheduler-v1"), Symbol.for("daywiz.auto-production.scheduler-v2-exact-window")];
const schedulerKey = Symbol.for("daywiz.auto-production.scheduler-v3-sequential-queue");
const globalState = globalThis as typeof globalThis & Record<symbol, ReturnType<typeof setInterval> | undefined>;
const processingRunStatuses = ["selecting-products", "analyzing-products", "generating-hooks", "queued", "generating-creatives"] as const;

function hasConfirmedProductPlan(config: Awaited<ReturnType<typeof autoProductionAdvertiserRepository.list>>[number]) {
  return confirmedAutoProductionProductCount(config) > 0;
}

export function retireLegacyAutoProductionSchedulers() {
  let retired = 0;
  for (const key of legacySchedulerKeys) {
    const interval = globalState[key];
    if (!interval) continue;
    clearInterval(interval);
    delete globalState[key];
    retired += 1;
  }
  return retired;
}

// 개발 서버 HMR로 이 모듈만 다시 평가되어도 구형 interval이 살아서 과거
// 4장 팩토리를 호출하지 못하도록 즉시 폐기한다.
retireLegacyAutoProductionSchedulers();

async function startNextScheduledRun(configs: Awaited<ReturnType<typeof autoProductionAdvertiserRepository.list>>, now: Date) {
  const processing = await autoProductionRepository.list({ statuses: [...processingRunStatuses], limit: 200 });
  // 예약 자동제작은 몰 단위로 하나씩 끝까지 처리한다. 이미지 생성 API와
  // 로컬 합성 자원을 서로 뺏지 않아 출근 전 결과의 안정성을 우선한다.
  if (processing.length) return null;
  const configOrder = new Map(configs.map((config, index) => [config.advertiserId, index]));
  const scheduled = await autoProductionRepository.list({ statuses: ["scheduled"], limit: 200 });
  const ordered = scheduled.sort((left, right) => {
    const byDate = left.businessDate.localeCompare(right.businessDate);
    if (byDate) return byDate;
    const byCreatedAt = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    if (byCreatedAt) return byCreatedAt;
    return (configOrder.get(left.advertiserId) ?? Number.MAX_SAFE_INTEGER) - (configOrder.get(right.advertiserId) ?? Number.MAX_SAFE_INTEGER);
  });
  const next = ordered.find((run) => configs.some((config) => config.advertiserId === run.advertiserId && config.enabled && hasConfirmedProductPlan(config)));
  const unrunnable = ordered.filter((run) => !configs.some((config) => config.advertiserId === run.advertiserId && config.enabled && hasConfirmedProductPlan(config)));
  for (const run of unrunnable) {
    const config = configs.find((item) => item.advertiserId === run.advertiserId);
    const reason = config?.enabled
      ? "예정 상품 URL이 확정되지 않아 자동제작을 건너뛰었습니다."
      : "예약 후 광고주 자동제작 설정이 비활성화되어 건너뛰었습니다.";
    await autoProductionRepository.update(run.id, (current) =>
      current.status === "scheduled"
        ? {
            ...current,
            status: "skipped",
            completedAt: now.toISOString(),
            warnings: [...current.warnings, reason].slice(-20),
          }
        : current
    );
  }
  if (!next) return null;
  const config = configs.find((item) => item.advertiserId === next.advertiserId && item.enabled && hasConfirmedProductPlan(item));
  if (!config) return null;
  return startScheduledAutoProductionRun(next.id, config, { now });
}

export async function tickAutoProductionScheduler(now = new Date()) {
  const settings = await autoProductionAdvertiserRepository.settings();
  if (settings.paused) return [];
  const configs = await autoProductionAdvertiserRepository.list();
  const keys = await autoProductionRepository.runKeysForDate(seoulClock(now).date);
  const due = dueAdvertisers(configs.filter(hasConfirmedProductPlan), keys, now);
  const runs = [];
  // 시간 창 안에서는 실행 슬롯과 무관하게 모든 몰의 예약 레코드를 먼저 만든다.
  // 이후 시간이 창을 지나도 이 대기열은 사라지지 않고 순차 실행된다.
  for (const config of due) {
    const result = await scheduleAutoProductionForAdvertiser(config, { trigger: "scheduled", now });
    if (result.run) runs.push(result.run);
  }
  await recoverAutoProductionRuns();
  const started = await startNextScheduledRun(configs, now);
  if (started?.run) runs.push(started.run);
  return runs;
}

export async function runAutoProductionNow(input: { advertiserId?: string; trigger?: "manual" | "cli"; force?: boolean; now?: Date }) {
  const settings = await autoProductionAdvertiserRepository.settings();
  if (settings.paused) throw new Error("전체 자동 제작이 일시정지되어 있습니다.");
  const configs = await autoProductionAdvertiserRepository.list();
  const active = configs.filter((config) => config.enabled && hasConfirmedProductPlan(config) && (!input.advertiserId || config.advertiserId === input.advertiserId));
  if (input.advertiserId && !active.length) throw new Error("실행할 활성 광고주 설정을 찾지 못했습니다.");
  if (!input.advertiserId && !active.length) throw new Error("예정 상품 URL을 확정한 활성 광고주가 없습니다.");
  const now = input.now || new Date();
  const due = input.trigger === "cli" && !input.force ? dueAdvertisers(active, await autoProductionRepository.runKeysForDate(seoulClock(now).date), now) : active;
  const runs = [];
  // 즉시 실행도 일부 몰만 잘라 실행하지 않는다. 선택된 몰을 모두 영속
  // 대기열에 넣고, 이미 처리 중인 몰이 없을 때 첫 몰부터 순차 시작한다.
  for (const config of due) {
    const result = await scheduleAutoProductionForAdvertiser(config, { trigger: input.trigger || "manual", now });
    if (result.run) runs.push({ ...result, run: result.run });
  }
  await recoverAutoProductionRuns();
  const started = await startNextScheduledRun(configs, now);
  if (started?.run) {
    const queued = runs.find((result) => result.run.id === started.run.id);
    if (queued) queued.run = started.run;
  }
  return runs;
}

export function ensureAutoProductionScheduler() {
  retireLegacyAutoProductionSchedulers();
  if (globalState[schedulerKey]) return false;
  void tickAutoProductionScheduler().catch(() => undefined);
  const interval = setInterval(() => void tickAutoProductionScheduler().catch(() => undefined), 60_000);
  interval.unref?.();
  globalState[schedulerKey] = interval;
  return true;
}
