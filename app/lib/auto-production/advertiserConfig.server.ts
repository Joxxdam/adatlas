import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { nextScheduledAt } from "./schedule";
import {
  AUTO_PRODUCTION_CREATIVES_PER_PRODUCT,
  AUTO_PRODUCTION_DEFAULT_SCHEDULE_TIME,
  AUTO_PRODUCTION_IMAGES_PER_MALL,
  AUTO_PRODUCTION_PRODUCTS_PER_MALL,
  minimumDailyImageCapacity,
} from "./policy";
import type { AutoProductionAdvertiserConfig, AutoProductionRole } from "./types";
import { autoProductionRoles } from "./types";

const seedFile = path.join(process.cwd(), "data", "auto-production", "advertiser-seed.json");
const runtimeDirectory = path.join(process.cwd(), "data", "auto-production", "runtime");
const configFile = path.join(runtimeDirectory, "advertisers.json");
const settingsFile = path.join(runtimeDirectory, "settings.json");
const globalKey = Symbol.for("daywiz.auto-production.config-lock");
const state = globalThis as typeof globalThis & { [globalKey]?: Promise<unknown> };

export type AutoProductionGlobalSettings = {
  paused: boolean;
  maxImagesPerDay: number;
  globalConcurrency: number;
  updatedAt: string;
};

const defaultSettings: AutoProductionGlobalSettings = {
  paused: false,
  maxImagesPerDay: AUTO_PRODUCTION_IMAGES_PER_MALL * 3,
  globalConcurrency: 2,
  updatedAt: new Date(0).toISOString(),
};

function safeId(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9가-힣_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return normalized || `advertiser-${randomUUID().slice(0, 8)}`;
}

function textList(value: unknown, max = 80) {
  return Array.isArray(value)
    ? Array.from(new Set(value.map((item) => String(item || "").trim()).filter(Boolean))).slice(0, max)
    : [];
}

function numeric(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
}

export function normalizeAdvertiserConfig(
  input: Partial<AutoProductionAdvertiserConfig> & Pick<AutoProductionAdvertiserConfig, "advertiserName">,
  current?: AutoProductionAdvertiserConfig,
  now = new Date()
): AutoProductionAdvertiserConfig {
  const createdAt = current?.createdAt || now.toISOString();
  const scheduleTime = /^\d{2}:\d{2}$/.test(input.scheduleTime || "")
    ? input.scheduleTime!
    : current?.scheduleTime || AUTO_PRODUCTION_DEFAULT_SCHEDULE_TIME;
  const scheduleDays = (Array.isArray(input.scheduleDays) ? input.scheduleDays : current?.scheduleDays || [0, 1, 2, 3, 4, 5, 6])
    .map(Number)
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  const priorities = (Array.isArray(input.selectionPriorities) ? input.selectionPriorities : current?.selectionPriorities || autoProductionRoles)
    .filter((role): role is AutoProductionRole => autoProductionRoles.includes(role as AutoProductionRole));
  const base: AutoProductionAdvertiserConfig = {
    advertiserId: safeId(input.advertiserId || current?.advertiserId || input.advertiserName),
    advertiserName: String(input.advertiserName || current?.advertiserName || "").trim().slice(0, 100),
    aliases: textList(input.aliases ?? current?.aliases),
    enabled: input.enabled ?? current?.enabled ?? true,
    timezone: "Asia/Seoul",
    scheduleTime,
    scheduleDays: scheduleDays.length ? Array.from(new Set(scheduleDays)) : [0, 1, 2, 3, 4, 5, 6],
    productsPerRun: AUTO_PRODUCTION_PRODUCTS_PER_MALL,
    creativesPerProduct: AUTO_PRODUCTION_CREATIVES_PER_PRODUCT,
    fullHookTestForNewProducts: false,
    productCooldownDays: numeric(input.productCooldownDays ?? current?.productCooldownDays, 7, 0, 90),
    productFamilyCooldownDays: numeric(input.productFamilyCooldownDays ?? current?.productFamilyCooldownDays, 14, 0, 180),
    hookCooldownDays: 0,
    maxImagesPerRun: AUTO_PRODUCTION_IMAGES_PER_MALL,
    dataSource: input.dataSource || current?.dataSource || "auto",
    bigQueryBrandMatch: String(input.bigQueryBrandMatch ?? current?.bigQueryBrandMatch ?? input.advertiserName).trim().slice(0, 120),
    siteUrl: String(input.siteUrl ?? current?.siteUrl ?? "").trim().slice(0, 1000),
    excludedProductIds: textList(input.excludedProductIds ?? current?.excludedProductIds),
    excludedCategories: textList(input.excludedCategories ?? current?.excludedCategories),
    requiredProductIds: textList(input.requiredProductIds ?? current?.requiredProductIds),
    adminProductUrls: textList(input.adminProductUrls ?? current?.adminProductUrls),
    productVisibilityMode: input.productVisibilityMode || current?.productVisibilityMode || "site-visible-only",
    selectionPriorities: priorities.length ? Array.from(new Set(priorities)) : [...autoProductionRoles],
    adObjective: input.adObjective || current?.adObjective || "purchase",
    explorationRatio: 0,
    lastRunAt: input.lastRunAt ?? current?.lastRunAt ?? null,
    nextRunAt: "",
    createdAt,
    updatedAt: now.toISOString(),
  };
  if (!base.advertiserName) throw new Error("광고주명이 필요합니다.");
  return { ...base, nextRunAt: nextScheduledAt(base, now) };
}

async function atomicWrite(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporary, file);
}

async function serialize<T>(work: () => Promise<T>) {
  const previous = state[globalKey] || Promise.resolve();
  const next = previous.then(work, work);
  state[globalKey] = next.catch(() => undefined);
  return next;
}

async function readConfigs() {
  let source = configFile;
  try {
    await fs.access(source);
  } catch {
    source = seedFile;
  }
  const parsed = JSON.parse(await fs.readFile(source, "utf8")) as AutoProductionAdvertiserConfig[];
  return parsed.map((config) => normalizeAdvertiserConfig(config, config));
}

export const autoProductionAdvertiserRepository = {
  async list() {
    return readConfigs();
  },
  async get(advertiserId: string) {
    return (await readConfigs()).find((config) => config.advertiserId === advertiserId) || null;
  },
  async create(input: Partial<AutoProductionAdvertiserConfig> & Pick<AutoProductionAdvertiserConfig, "advertiserName">) {
    return serialize(async () => {
      const configs = await readConfigs();
      const config = normalizeAdvertiserConfig(input);
      if (configs.some((item) => item.advertiserId === config.advertiserId)) throw new Error("이미 등록된 광고주 ID입니다.");
      await atomicWrite(configFile, [...configs, config]);
      return config;
    });
  },
  async update(advertiserId: string, input: Partial<AutoProductionAdvertiserConfig>) {
    return serialize(async () => {
      const configs = await readConfigs();
      const index = configs.findIndex((item) => item.advertiserId === advertiserId);
      if (index < 0) throw new Error("광고주 설정을 찾지 못했습니다.");
      const updated = normalizeAdvertiserConfig({ ...configs[index], ...input, advertiserId, advertiserName: input.advertiserName || configs[index].advertiserName }, configs[index]);
      configs[index] = updated;
      await atomicWrite(configFile, configs);
      return updated;
    });
  },
  async remove(advertiserId: string) {
    return serialize(async () => {
      const configs = await readConfigs();
      const filtered = configs.filter((item) => item.advertiserId !== advertiserId);
      if (filtered.length === configs.length) return false;
      await atomicWrite(configFile, filtered);
      return true;
    });
  },
  async settings(): Promise<AutoProductionGlobalSettings> {
    let stored: Partial<AutoProductionGlobalSettings> = {};
    try {
      stored = JSON.parse(await fs.readFile(settingsFile, "utf8")) as Partial<AutoProductionGlobalSettings>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const configs = await readConfigs();
    const requiredCapacity = minimumDailyImageCapacity(configs);
    return {
      ...defaultSettings,
      ...stored,
      maxImagesPerDay: Math.max(
        requiredCapacity,
        numeric(stored.maxImagesPerDay, defaultSettings.maxImagesPerDay, 1, 240)
      ),
    };
  },
  async updateSettings(input: Partial<AutoProductionGlobalSettings>) {
    return serialize(async () => {
      const current = await this.settings();
      const next = {
        paused: input.paused ?? current.paused,
        maxImagesPerDay: Math.max(
          minimumDailyImageCapacity(await readConfigs()),
          numeric(input.maxImagesPerDay ?? current.maxImagesPerDay, defaultSettings.maxImagesPerDay, 1, 240)
        ),
        globalConcurrency: numeric(input.globalConcurrency ?? current.globalConcurrency, 2, 1, 2),
        updatedAt: new Date().toISOString(),
      };
      await atomicWrite(settingsFile, next);
      return next;
    });
  },
};
