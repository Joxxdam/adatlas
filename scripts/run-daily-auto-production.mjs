#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";

async function readLocalEnvironment() {
  try {
    const text = await readFile(path.join(process.cwd(), ".env.local"), "utf8");
    return Object.fromEntries(text.split(/\r?\n/).map((line) => {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match) return null;
      const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
      return [match[1], value];
    }).filter(Boolean));
  } catch {
    return {};
  }
}

function argumentsFrom(argv) {
  const command = argv.find((value) => !value.startsWith("--")) || "run";
  const advertiser = argv.find((value) => value.startsWith("--advertiser="))?.slice("--advertiser=".length);
  return { command, advertiser, force: argv.includes("--force") };
}

function summarizeRun(item) {
  if (!item.run) return "이미 오늘 실행된 광고주입니다.";
  const run = item.run;
  return `${run.advertiserName}: ${run.status} · 상품 ${run.tasks.length}개 · 예상 ${run.expectedImages}장 · 실행 ID ${run.id}`;
}

const localEnvironment = await readLocalEnvironment();
const options = argumentsFrom(process.argv.slice(2));
const baseUrl = String(
  process.env.ADATLAS_AUTO_PRODUCTION_BASE_URL ||
  localEnvironment.ADATLAS_AUTO_PRODUCTION_BASE_URL ||
  "http://127.0.0.1:3000"
).replace(/\/$/, "");
const token = process.env.ADATLAS_AUTO_PRODUCTION_TOKEN || localEnvironment.ADATLAS_AUTO_PRODUCTION_TOKEN || "";

async function request(endpoint, init = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Origin: baseUrl,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { "x-adatlas-auto-production-token": token } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(300_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

try {
  if (options.command === "status") {
    const payload = await request("/api/auto-production/status");
    const status = payload.status;
    console.log(`자동 제작: ${status.paused ? "일시정지" : status.activeRunCount ? "실행 중" : "대기"}`);
    console.log(`다음 실행: ${status.nextRunAt || "미정"}`);
    console.log(`오늘 완료/실패: ${status.completedTodayCount}/${status.failedTodayCount}장`);
  } else if (options.command === "preview") {
    const payload = await request("/api/auto-production/preview", {
      method: "POST",
      body: JSON.stringify({ advertiserId: options.advertiser }),
    });
    for (const preview of payload.previews || []) {
      console.log(`${preview.advertiserName}: ${preview.source} · 예상 ${preview.expectedImages}장`);
      for (const candidate of preview.candidates || []) console.log(`  - ${candidate.productName}: ${candidate.recommendationReason}`);
      for (const warning of preview.warnings || []) console.warn(`  주의: ${warning}`);
    }
  } else if (options.command === "run") {
    const payload = await request("/api/auto-production/run", {
      method: "POST",
      body: JSON.stringify({ advertiserId: options.advertiser, trigger: "cli", force: options.force }),
    });
    for (const item of payload.results || []) console.log(summarizeRun(item));
    if (!(payload.results || []).length) console.log("현재 시각에 실행할 광고주가 없거나 오늘 이미 실행했습니다.");
    if (options.force) console.log("--force는 예약 시각을 기다리지 않고 실행하며, 같은 날짜·광고주의 중복 실행 방지는 유지합니다.");
  } else {
    throw new Error("사용법: run-daily-auto-production.mjs [run|preview|status] [--advertiser=ID] [--force]");
  }
} catch (error) {
  console.error(`자동 제작 CLI 실패: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
