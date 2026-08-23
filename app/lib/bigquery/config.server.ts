import "server-only";

import { BIGQUERY_ALLOWED_PROJECT } from "./readonlyGuard";

const DEFAULT_MAX_BYTES_BILLED = 1_000_000_000;
const DEFAULT_QUERY_TIMEOUT_MS = 30_000;

function positiveInteger(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const projectId = process.env.BIGQUERY_PROJECT_ID?.trim() || BIGQUERY_ALLOWED_PROJECT;

if (projectId !== BIGQUERY_ALLOWED_PROJECT) {
  throw new Error(`BIGQUERY_PROJECT_ID는 허용된 프로젝트(${BIGQUERY_ALLOWED_PROJECT})와 일치해야 합니다.`);
}

export const bigQueryConfig = Object.freeze({
  projectId,
  location: process.env.BIGQUERY_LOCATION?.trim() || "US",
  maxBytesBilled: positiveInteger(process.env.BIGQUERY_MAX_BYTES_BILLED, DEFAULT_MAX_BYTES_BILLED),
  queryTimeoutMs: positiveInteger(process.env.BIGQUERY_QUERY_TIMEOUT_MS, DEFAULT_QUERY_TIMEOUT_MS),
});

export const bigQueryAllowedDatasets = ["DIM_MALL", "DIM_PDT", "FACT_MALL", "FACT_RANK", "FACT_REVIEWS", "FACT_REVIEW_RATE", "FACT_HOST24", "FACT_HOSTMK", "FACT_PRICE"] as const;
