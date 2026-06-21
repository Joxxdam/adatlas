import { CollectedReference, CollectorSource } from "./types";

export function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} 환경변수가 필요합니다.`);
  }
  return value;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

export function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function stableId(source: CollectorSource, externalId: string) {
  return `${source}:${externalId}`;
}

export async function fetchJson(url: URL | string, init?: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = asRecord(body);
    const message = asString(error.message) || asString(asRecord(error.error).message) || `API 요청 실패: ${response.status}`;
    throw new Error(message);
  }

  return body;
}

export function withCollectedAt(item: Omit<CollectedReference, "collectedAt">): CollectedReference {
  return { ...item, collectedAt: new Date().toISOString() };
}
