"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./CodexSessionCleanupWorkspace.module.css";

type CodexSessionCleanupStatus = {
  retentionDays: number;
  trackedCount: number;
  activeCount: number;
  closedCount: number;
  dueCount: number;
  deletedCount: number;
  errorCount: number;
  codexSessionFileCount: number;
  codexSessionDiskBytes: number;
  lastCleanupAt?: string;
  lastCleanupDeletedCount: number;
  lastCleanupReclaimedBytes: number;
  totalReclaimedBytes: number;
  lastCleanupError?: string;
};

function fileSize(value = 0) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const amount = value / 1024 ** unitIndex;
  return `${amount >= 10 || unitIndex === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unitIndex]}`;
}

function localDateTime(value?: string) {
  if (!value) return "아직 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

async function requestStatus(method: "GET" | "POST" = "GET") {
  const response = await fetch("/api/admin/codex-sessions", { method, cache: "no-store" });
  const payload = (await response.json()) as { status?: CodexSessionCleanupStatus; cleanup?: { deletedCount: number; reclaimedBytes: number }; error?: string };
  if (!response.ok || !payload.status) throw new Error(payload.error || "Codex 세션 정보를 불러오지 못했습니다.");
  return payload;
}

export function CodexSessionCleanupWorkspace() {
  const [status, setStatus] = useState<CodexSessionCleanupStatus | null>(null);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const payload = await requestStatus();
      setStatus(payload.status || null);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Codex 세션 정보를 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function cleanupNow() {
    if (working) return;
    setWorking(true);
    setNotice("");
    setError("");
    try {
      const payload = await requestStatus("POST");
      setStatus(payload.status || null);
      const deletedCount = payload.cleanup?.deletedCount || 0;
      setNotice(deletedCount ? `${deletedCount}개 세션을 정리해 ${fileSize(payload.cleanup?.reclaimedBytes)}를 확보했습니다.` : "현재 정리할 만료 세션이 없습니다.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Codex 세션을 정리하지 못했습니다.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p>IMAGE PRODUCTION MANAGEMENT</p>
          <h1>Codex 세션 정리</h1>
          <span>이미지 제작이 끝난 Codex 세션만 관리합니다. 완성 이미지, 아카이브와 제작 작업은 삭제하지 않습니다.</span>
        </div>
        <button disabled={working} onClick={() => void cleanupNow()} type="button">
          {working ? "정리 확인 중…" : "지금 정리 확인"}
        </button>
      </header>

      {error ? <p className={styles.error}>{error}</p> : null}
      {notice ? <p className={styles.notice}>{notice}</p> : null}

      <section className={styles.policy}>
        <strong>자동 정리 정책</strong>
        <p>활성 세션은 건드리지 않고, 종료된 세션은 {status?.retentionDays ?? 2}일 뒤 자동 삭제합니다. 아카이브에서 이미지를 삭제하면 연결된 종료 세션은 즉시 정리합니다.</p>
      </section>

      <section className={styles.stats} aria-label="Codex 세션 정리 현황">
        <article>
          <span>추적 세션</span>
          <strong>{status?.trackedCount ?? 0}개</strong>
          <small>사용 중 {status?.activeCount ?? 0} · 보관 중 {status?.closedCount ?? 0}</small>
        </article>
        <article>
          <span>현재 정리 대상</span>
          <strong>{status?.dueCount ?? 0}개</strong>
          <small>종료 후 {status?.retentionDays ?? 2}일 경과 기준</small>
        </article>
        <article>
          <span>누적 확보 용량</span>
          <strong>{fileSize(status?.totalReclaimedBytes)}</strong>
          <small>삭제 완료 {status?.deletedCount ?? 0}개</small>
        </article>
        <article>
          <span>전체 Codex 로컬 세션</span>
          <strong>{fileSize(status?.codexSessionDiskBytes)}</strong>
          <small>{status?.codexSessionFileCount ?? 0}개 · 다른 Codex 작업 포함</small>
        </article>
      </section>

      <footer className={styles.footer}>
        <p>최근 점검: {localDateTime(status?.lastCleanupAt)} · 최근 삭제 {status?.lastCleanupDeletedCount ?? 0}개 · 최근 확보 {fileSize(status?.lastCleanupReclaimedBytes)}</p>
        <p>추적 기능 적용 이후 AdAtlas가 이미지 제작용으로 생성한 세션만 자동 정리합니다. 기존의 다른 Codex 대화는 자동 삭제하지 않습니다.</p>
        {status?.lastCleanupError || status?.errorCount ? <p className={styles.warning}>정리 확인 필요: {status?.lastCleanupError || `${status?.errorCount || 0}개 세션에서 오류가 기록되었습니다.`}</p> : null}
      </footer>
    </main>
  );
}
