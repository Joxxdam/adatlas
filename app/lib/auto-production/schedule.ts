import type { AutoProductionAdvertiserConfig } from "./types";

const SEOUL_TIMEZONE = "Asia/Seoul";
// 예약 작업은 예약 시각을 놓친 뒤 하루 종일 보충 실행하지 않는다.
// 1분 tick의 드리프트와 짧은 서버 재시작만 허용하는 실행 창이다.
export const AUTO_PRODUCTION_SCHEDULE_WINDOW_MINUTES = 10;

export type SeoulClock = {
  date: string;
  hour: number;
  minute: number;
  weekday: number;
};

export function seoulClock(at = new Date()): SeoulClock {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SEOUL_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  const weekdays: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number(value("hour")),
    minute: Number(value("minute")),
    weekday: weekdays[value("weekday")] ?? at.getUTCDay(),
  };
}

export function scheduleMinutes(scheduleTime: string) {
  const match = scheduleTime.match(/^(\d{2}):(\d{2})$/);
  if (!match) return 0;
  return Math.min(23, Number(match[1])) * 60 + Math.min(59, Number(match[2]));
}

export function scheduledRunKey(config: Pick<AutoProductionAdvertiserConfig, "advertiserId" | "scheduleTime">, at = new Date()) {
  return `${seoulClock(at).date}:${config.advertiserId}:${config.scheduleTime}`;
}

export function isScheduleDue(config: Pick<AutoProductionAdvertiserConfig, "enabled" | "scheduleDays" | "scheduleTime">, at = new Date()) {
  if (!config.enabled) return false;
  const clock = seoulClock(at);
  if (!config.scheduleDays.includes(clock.weekday)) return false;
  const elapsed = clock.hour * 60 + clock.minute - scheduleMinutes(config.scheduleTime);
  return elapsed >= 0 && elapsed < AUTO_PRODUCTION_SCHEDULE_WINDOW_MINUTES;
}

function dateKeyAfter(date: string, days: number) {
  const base = new Date(`${date}T00:00:00+09:00`);
  base.setUTCDate(base.getUTCDate() + days);
  return seoulClock(base).date;
}

export function nextScheduledAt(config: Pick<AutoProductionAdvertiserConfig, "enabled" | "scheduleDays" | "scheduleTime">, at = new Date()) {
  if (!config.enabled) return "";
  const clock = seoulClock(at);
  const nowMinutes = clock.hour * 60 + clock.minute;
  for (let offset = 0; offset <= 7; offset += 1) {
    const date = dateKeyAfter(clock.date, offset);
    const weekday = (clock.weekday + offset) % 7;
    if (!config.scheduleDays.includes(weekday)) continue;
    if (offset === 0 && nowMinutes >= scheduleMinutes(config.scheduleTime)) continue;
    return new Date(`${date}T${config.scheduleTime}:00+09:00`).toISOString();
  }
  return "";
}

export function dueAdvertisers(configs: AutoProductionAdvertiserConfig[], existingRunKeys: ReadonlySet<string>, at = new Date()) {
  const businessDate = seoulClock(at).date;
  return configs.filter((config) => {
    if (!isScheduleDue(config, at)) return false;
    // 예약 시각을 바꿔도 같은 날짜·광고주의 작업을 다시 만들지 않습니다.
    // 예: 오늘 07:00 실행 후 00:00으로 바꿔도 오늘 작업을 중복 생성하지 않고 다음 날부터 적용합니다.
    const advertiserDayPrefix = `${businessDate}:${config.advertiserId}:`;
    return !Array.from(existingRunKeys).some((key) => key.startsWith(advertiserDayPrefix));
  });
}
