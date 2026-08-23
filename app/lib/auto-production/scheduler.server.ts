import "server-only";
import { autoProductionAdvertiserRepository } from "./advertiserConfig.server";
import { recoverAutoProductionRuns, runAutoProductionForAdvertiser } from "./productionRunner.server";
import { autoProductionRepository } from "./productionRepository.server";
import { dueAdvertisers, seoulClock } from "./schedule";

const schedulerKey = Symbol.for("daywiz.auto-production.scheduler-v1");
const globalState = globalThis as typeof globalThis & { [schedulerKey]?: ReturnType<typeof setInterval> };
const activeRunStatuses = [
  "scheduled",
  "selecting-products",
  "analyzing-products",
  "generating-hooks",
  "queued",
  "generating-creatives",
] as const;

async function availableAdvertiserSlots(globalConcurrency: number) {
  const activeRuns = await autoProductionRepository.list({ statuses: [...activeRunStatuses], limit: 200 });
  const activeAdvertisers = new Set(activeRuns.map((run) => run.advertiserId));
  return {
    activeAdvertisers,
    available: Math.max(0, globalConcurrency - activeAdvertisers.size),
  };
}

export async function tickAutoProductionScheduler(now = new Date()) {
  const settings = await autoProductionAdvertiserRepository.settings();
  if (settings.paused) return [];
  const configs = await autoProductionAdvertiserRepository.list();
  const keys = await autoProductionRepository.runKeysForDate(seoulClock(now).date);
  const slots = await availableAdvertiserSlots(settings.globalConcurrency);
  const due = dueAdvertisers(configs, keys, now)
    .filter((config) => !slots.activeAdvertisers.has(config.advertiserId))
    .slice(0, slots.available);
  const runs = [];
  for (const config of due) {
    const result = await runAutoProductionForAdvertiser(config, { trigger: "scheduled", now });
    if (result.run) runs.push(result.run);
  }
  await recoverAutoProductionRuns();
  return runs;
}

export async function runAutoProductionNow(input: { advertiserId?: string; trigger?: "manual" | "cli"; force?: boolean; now?: Date }) {
  const settings = await autoProductionAdvertiserRepository.settings();
  if (settings.paused) throw new Error("전체 자동 제작이 일시정지되어 있습니다.");
  const configs = await autoProductionAdvertiserRepository.list();
  const active = configs.filter((config) => config.enabled && (!input.advertiserId || config.advertiserId === input.advertiserId));
  if (input.advertiserId && !active.length) throw new Error("실행할 활성 광고주 설정을 찾지 못했습니다.");
  const now = input.now || new Date();
  const due = input.trigger === "cli" && !input.force
    ? dueAdvertisers(active, await autoProductionRepository.runKeysForDate(seoulClock(now).date), now)
    : active;
  const slots = await availableAdvertiserSlots(settings.globalConcurrency);
  const selected = due
    .filter((config) => !slots.activeAdvertisers.has(config.advertiserId))
    .slice(0, slots.available);
  const runs = [];
  for (const config of selected) {
    const result = await runAutoProductionForAdvertiser(config, { trigger: input.trigger || "manual", now });
    if (result.run) runs.push({ ...result, run: result.run });
  }
  return runs;
}

export function ensureAutoProductionScheduler() {
  if (globalState[schedulerKey]) return false;
  void tickAutoProductionScheduler().catch(() => undefined);
  const interval = setInterval(() => void tickAutoProductionScheduler().catch(() => undefined), 60_000);
  interval.unref?.();
  globalState[schedulerKey] = interval;
  return true;
}
