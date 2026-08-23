import "server-only";

import { BigQuery, type Query } from "@google-cloud/bigquery";
import { bigQueryAllowedDatasets, bigQueryConfig } from "./config.server";
import { assertReadOnlyBigQuery, BigQueryReadOnlyError } from "./readonlyGuard";
import type { BigQueryConnectionStatus, BigQueryErrorCode } from "./types";

type QueryParameters = Record<string, unknown>;

export type BigQueryReadResult<T> = {
  rows: T[];
  processedBytes: number;
  cacheHit: boolean;
};

export class BigQueryPublicError extends Error {
  constructor(
    readonly code: BigQueryErrorCode,
    message: string,
    readonly status = 500
  ) {
    super(message);
    this.name = "BigQueryPublicError";
  }
}

type BigQueryGlobal = typeof globalThis & {
  __adAtlasBigQueryClient?: BigQuery;
};

const globalBigQuery = globalThis as BigQueryGlobal;

function getClient() {
  if (!globalBigQuery.__adAtlasBigQueryClient) {
    globalBigQuery.__adAtlasBigQueryClient = new BigQuery({
      projectId: bigQueryConfig.projectId,
    });
  }
  return globalBigQuery.__adAtlasBigQueryClient;
}

function numericBytes(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function queryStatistics(metadata: unknown) {
  const statistics = (
    metadata as {
      statistics?: { query?: { totalBytesProcessed?: string; cacheHit?: boolean } };
    }
  )?.statistics?.query;
  return {
    processedBytes: numericBytes(statistics?.totalBytesProcessed),
    cacheHit: Boolean(statistics?.cacheHit),
  };
}

function plainRows<T>(rows: unknown[]) {
  return JSON.parse(JSON.stringify(rows)) as T[];
}

function publicError(error: unknown): BigQueryPublicError {
  if (error instanceof BigQueryPublicError) return error;
  if (error instanceof BigQueryReadOnlyError) {
    return new BigQueryPublicError("read-only-violation", error.message, 400);
  }
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (normalized.includes("maximum bytes billed") || normalized.includes("bytes billed limit")) {
    return new BigQueryPublicError("cost-limit", "예상 조회량이 안전 한도를 넘어 이 데이터는 조회하지 않았습니다.", 422);
  }
  if (normalized.includes("could not load the default credentials") || normalized.includes("authentication")) {
    return new BigQueryPublicError("auth-unavailable", "Google Application Default Credentials를 확인해 주세요.", 503);
  }
  if (normalized.includes("permission") || normalized.includes("access denied") || normalized.includes("403")) {
    return new BigQueryPublicError("permission-denied", "BigQuery 조회 권한을 확인해 주세요.", 403);
  }
  if (normalized.includes("not found") || normalized.includes("404")) {
    return new BigQueryPublicError("table-not-found", "조회 대상 테이블을 찾지 못했습니다.", 404);
  }
  if (normalized.includes("location")) {
    return new BigQueryPublicError("location-mismatch", "BigQuery 데이터 위치 설정을 확인해 주세요.", 422);
  }
  if (normalized.includes("timeout") || normalized.includes("deadline")) {
    return new BigQueryPublicError("query-timeout", "조회 시간이 제한을 초과했습니다. 기간이나 광고주를 좁혀 다시 시도해 주세요.", 504);
  }
  return new BigQueryPublicError("query-failed", "BigQuery 데이터를 조회하지 못했습니다.", 500);
}

function timeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timerPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BigQueryPublicError("query-timeout", "BigQuery 조회 시간이 제한을 초과했습니다.", 504)), timeoutMs);
  });
  return Promise.race([promise, timerPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export async function runReadOnlyBigQuery<T>(input: { queryName: string; sql: string; params: QueryParameters; maxResults?: number }): Promise<BigQueryReadResult<T>> {
  const startedAt = Date.now();
  try {
    assertReadOnlyBigQuery({ sql: input.sql, namedParameters: input.params });
    const client = getClient();
    const baseOptions: Query = {
      query: input.sql,
      params: input.params,
      location: bigQueryConfig.location,
      useLegacySql: false,
      useQueryCache: true,
    };
    const [dryRunJob] = await timeout(client.createQueryJob({ ...baseOptions, dryRun: true }), bigQueryConfig.queryTimeoutMs);
    const dryRun = queryStatistics(dryRunJob.metadata);
    if (dryRun.processedBytes > bigQueryConfig.maxBytesBilled) {
      throw new BigQueryPublicError("cost-limit", `예상 조회량이 안전 한도(${bigQueryConfig.maxBytesBilled.toLocaleString("ko-KR")} bytes)를 넘어 조회하지 않았습니다.`, 422);
    }

    const [rows, job] = await timeout(
      client.query({
        ...baseOptions,
        maximumBytesBilled: String(bigQueryConfig.maxBytesBilled),
        jobTimeoutMs: bigQueryConfig.queryTimeoutMs,
        maxResults: input.maxResults || 200,
      }),
      bigQueryConfig.queryTimeoutMs + 2_000
    );
    const execution = queryStatistics(job);
    const processedBytes = execution.processedBytes || dryRun.processedBytes;
    console.info("[bigquery:read]", {
      queryName: input.queryName,
      durationMs: Date.now() - startedAt,
      processedBytes,
      cacheHit: execution.cacheHit,
    });
    return {
      rows: plainRows<T>(rows),
      processedBytes,
      cacheHit: execution.cacheHit,
    };
  } catch (error) {
    const safeError = publicError(error);
    console.error("[bigquery:read:error]", {
      queryName: input.queryName,
      durationMs: Date.now() - startedAt,
      code: safeError.code,
      message: error instanceof Error ? error.message : "Unknown BigQuery error",
    });
    throw safeError;
  }
}

export async function getBigQueryConnectionStatus(): Promise<BigQueryConnectionStatus> {
  try {
    const [datasets] = await timeout(getClient().getDatasets({ maxResults: 100 }), bigQueryConfig.queryTimeoutMs);
    const allowed = new Set<string>(bigQueryAllowedDatasets);
    const available = datasets
      .map((dataset) => dataset.id || "")
      .filter((datasetId) => allowed.has(datasetId))
      .sort();
    return {
      connected: available.length > 0,
      projectId: bigQueryConfig.projectId,
      location: bigQueryConfig.location,
      readOnly: true,
      datasets: available,
      datasetCount: available.length,
      checkedAt: new Date().toISOString(),
      message: available.length ? "BigQuery 읽기 전용 연결이 정상입니다." : "허용된 데이터셋을 찾지 못했습니다.",
    };
  } catch (error) {
    const safeError = publicError(error);
    return {
      connected: false,
      projectId: bigQueryConfig.projectId,
      location: bigQueryConfig.location,
      readOnly: true,
      datasets: [],
      datasetCount: 0,
      checkedAt: new Date().toISOString(),
      errorCode: safeError.code,
      message: safeError.message,
    };
  }
}
