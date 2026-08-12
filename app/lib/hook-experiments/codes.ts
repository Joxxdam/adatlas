import { createBrandCode } from "../creative-assets/code.ts";
import type { ExperimentHookCode, ExperimentObjective } from "./types.ts";

function compact(value: string, max: number) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, max);
}

export function normalizeOriginalProductNo(value: string) {
  const normalized = compact(value, 12);
  if (!normalized) throw new Error("원본 상품번호가 필요합니다.");
  return normalized;
}

export function roundCode(round: number) {
  if (!Number.isInteger(round) || round < 1 || round > 99)
    throw new Error("실험 회차는 1~99 사이여야 합니다.");
  return `T${String(round).padStart(2, "0")}`;
}

export function createExperimentCode(input: {
  brandCode: string;
  originalHostProductNo: string;
  objective: ExperimentObjective;
  testRound: number;
}) {
  return `EXP-${createBrandCode(input.brandCode)}-${normalizeOriginalProductNo(input.originalHostProductNo)}-${input.objective}-${roundCode(input.testRound)}`;
}

export function createExperimentAssetCode(input: {
  brandCode: string;
  originalHostProductNo: string;
  hookCode: ExperimentHookCode;
  generationRound: number;
  variant: string;
  version?: number;
}) {
  const variant = compact(input.variant, 3);
  if (!/^[A-Z][A-Z0-9]{0,2}$/.test(variant))
    throw new Error("소재 변형 코드는 A~Z로 시작해야 합니다.");
  const version = Math.max(1, Math.floor(input.version || 1));
  return `AT-${createBrandCode(input.brandCode)}-${normalizeOriginalProductNo(input.originalHostProductNo)}-${input.hookCode}-${roundCode(input.generationRound)}-${variant}${version > 1 ? `-V${String(version).padStart(2, "0")}` : ""}`;
}

export function createHookCategoryCode(input: {
  brandCode: string;
  originalHostProductNo: string;
  objective: ExperimentObjective;
  testRound: number;
  hookCode: ExperimentHookCode;
}) {
  return `AA_${createBrandCode(input.brandCode)}${normalizeOriginalProductNo(input.originalHostProductNo)}_${input.objective}_${roundCode(input.testRound)}_${input.hookCode}`;
}

export const experimentAssetCodeSource =
  "AT-[A-Z0-9]{3,5}-[A-Z0-9]{1,12}-(?:SEN|CUR|PRB|BRD|PRC|REV|USP|EMP|URG|VAL|EVT|RPT|CRT|BND|NEW|GRW|CTL)-T\\d{2}-[A-Z][A-Z0-9]{0,2}(?:-V\\d{2})?";

export function validateExperimentAssetCode(value: string) {
  return new RegExp(`^${experimentAssetCodeSource}$`).test(String(value || "").trim());
}
