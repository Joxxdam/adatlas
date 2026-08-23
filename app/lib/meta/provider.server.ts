import { createHmac } from "node:crypto";
import type { MetaOperation } from "./types.ts";

export type MetaProviderRequest = {
  operation: MetaOperation;
  method: "GET" | "POST";
  path: string;
  params?: Record<string, unknown>;
};

export interface MetaProvider {
  request<T>(request: MetaProviderRequest): Promise<T>;
}

export class MetaProviderError extends Error {
  readonly status?: number;
  readonly graphCode?: number;
  readonly transient: boolean;
  constructor(message: string, status?: number, graphCode?: number, transient = false) {
    super(message);
    this.name = "MetaProviderError";
    this.status = status;
    this.graphCode = graphCode;
    this.transient = transient;
  }
}

export class MockMetaProvider implements MetaProvider {
  calls: MetaProviderRequest[] = [];
  private responses: Partial<Record<MetaOperation, unknown>>;
  private failures: Partial<Record<MetaOperation, Error>>;
  constructor(responses: Partial<Record<MetaOperation, unknown>> = {}, failures: Partial<Record<MetaOperation, Error>> = {}) {
    this.responses = responses;
    this.failures = failures;
  }
  async request<T>(request: MetaProviderRequest): Promise<T> {
    this.calls.push(request);
    const failure = this.failures[request.operation];
    if (failure) throw failure;
    return (this.responses[request.operation] ?? {}) as T;
  }
}

export class GraphMetaProvider implements MetaProvider {
  private config: {
    graphApiVersion: string;
    systemUserAccessToken: string;
    appSecret?: string;
    timeoutMs: number;
  };
  constructor(config: { graphApiVersion: string; systemUserAccessToken: string; appSecret?: string; timeoutMs: number }) {
    this.config = config;
  }

  private async requestOnce<T>({ method, path, params = {} }: MetaProviderRequest): Promise<T> {
    if (!this.config.graphApiVersion || !this.config.systemUserAccessToken) throw new Error("Meta Graph API 버전과 시스템 사용자 토큰이 필요합니다.");
    const url = new URL(`https://graph.facebook.com/${this.config.graphApiVersion}/${path.replace(/^\//, "")}`);
    const bodyParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) bodyParams.set(key, typeof value === "string" ? value : JSON.stringify(value));
    }
    bodyParams.set("access_token", this.config.systemUserAccessToken);
    if (this.config.appSecret) {
      bodyParams.set("appsecret_proof", createHmac("sha256", this.config.appSecret).update(this.config.systemUserAccessToken).digest("hex"));
    }
    if (method === "GET") for (const [key, value] of bodyParams) url.searchParams.set(key, value);
    try {
      const response = await fetch(url, {
        method,
        body: method === "POST" ? bodyParams : undefined,
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
      const payload = (await response.json()) as T & {
        error?: { message?: string; code?: number; is_transient?: boolean };
      };
      if (!response.ok || payload.error) {
        throw new MetaProviderError(`Meta 요청 실패 (${response.status}): ${payload.error?.message || "요청 오류"}`, response.status, payload.error?.code, response.status >= 500 && Boolean(payload.error?.is_transient ?? true));
      }
      return payload;
    } catch (error) {
      if (error instanceof MetaProviderError) throw error;
      throw new MetaProviderError(error instanceof Error ? error.message : "Meta 네트워크 요청 실패", undefined, undefined, true);
    }
  }

  async request<T>(request: MetaProviderRequest): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.requestOnce<T>(request);
      } catch (error) {
        lastError = error;
        if (!(error instanceof MetaProviderError) || !error.transient || attempt === 3) {
          throw error;
        }
      }
    }
    throw lastError;
  }
}
