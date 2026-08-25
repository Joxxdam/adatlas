"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ACTIVE_CREATIVE_JOB_STORAGE_KEY, completedCreativeJobNoticeStorageKey } from "../../../lib/creative-generation/activeCreativeJob.client";
import type { GenerationJobSummary } from "../../../lib/creative-generation/types";
import styles from "./CreativeJobStatusIndicator.module.css";

type CompletedNotice = {
  jobId: string;
  productName: string;
  completedCount: number;
  totalCount: number;
};

export function CreativeJobStatusIndicator() {
  const [job, setJob] = useState<GenerationJobSummary | null | undefined>(undefined);
  const [completedNotice, setCompletedNotice] = useState<CompletedNotice | null>(null);
  const errors = useRef(0);
  const lastActiveJob = useRef<GenerationJobSummary | null>(null);

  useEffect(() => {
    let mounted = true;
    let timer: number | undefined;
    async function fetchSummary(jobId: string) {
      const response = await fetch(`/api/creative-generation/jobs/${encodeURIComponent(jobId)}?summary=1`, { cache: "no-store" });
      const payload = (await response.json()) as { summary?: GenerationJobSummary };
      if (!response.ok || !payload.summary) throw new Error("summary unavailable");
      return payload.summary;
    }

    async function announceCompletion(previous: GenerationJobSummary) {
      const noticeKey = completedCreativeJobNoticeStorageKey(previous.jobId);
      if (window.localStorage.getItem(noticeKey)) return;
      try {
        const finished = await fetchSummary(previous.jobId);
        if (!finished.totalCount || finished.generatedCount < finished.totalCount) {
          return;
        }
        const notice = {
          jobId: finished.jobId,
          productName: finished.productName,
          completedCount: finished.generatedCount,
          totalCount: finished.totalCount,
        };
        window.localStorage.setItem(noticeKey, new Date().toISOString());
        if (!mounted) return;
        setCompletedNotice(notice);
        if ("Notification" in window && window.Notification.permission === "granted") {
          new window.Notification("광고 제작이 완료됐습니다.", {
            body: `${notice.productName} · ${notice.completedCount}/${notice.totalCount}장 완성`,
          });
        }
      } catch {
        // 제작 결과 화면에서도 같은 저장 작업을 다시 확인할 수 있다.
      }
    }

    async function refresh() {
      try {
        const storedId = window.localStorage.getItem(ACTIVE_CREATIVE_JOB_STORAGE_KEY);
        const response = await fetch("/api/creative-generation/jobs/active", { cache: "no-store" });
        const payload = (await response.json()) as {
          activeJobs?: GenerationJobSummary[];
        };
        if (!response.ok) throw new Error("status unavailable");
        const activeJobs = payload.activeJobs || [];
        // 저장된 ID는 현재 실행 중인 작업일 때만 우선한다. 완료된 과거 작업은 다시 불러오지 않는다.
        // 저장 ID가 끝났다면 실제 서버 러너가 동작 중인 새 작업만 대신 표시해 오래된 대기 작업을 띄우지 않는다.
        const storedActive = storedId ? activeJobs.find((item) => item.jobId === storedId) : undefined;
        const next = activeJobs.find((item) => item.runnerActive && item.jobId === storedId) || activeJobs.find((item) => item.runnerActive) || storedActive;
        if (!mounted) return;
        errors.current = 0;
        if (next) {
          lastActiveJob.current = next;
          setJob(next);
          setCompletedNotice(null);
          window.localStorage.setItem(ACTIVE_CREATIVE_JOB_STORAGE_KEY, next.jobId);
        } else if (storedId) {
          try {
            const storedSummary = await fetchSummary(storedId);
            if (!mounted) return;
            if (["pending", "running"].includes(storedSummary.status) && storedSummary.generatedCount < storedSummary.totalCount) {
              lastActiveJob.current = storedSummary;
              setJob(storedSummary);
              setCompletedNotice(null);
              return;
            }
            const previous = lastActiveJob.current || storedSummary;
            lastActiveJob.current = null;
            setJob(null);
            window.localStorage.removeItem(ACTIVE_CREATIVE_JOB_STORAGE_KEY);
            void announceCompletion(previous);
          } catch {
            // 일시적인 조회 실패에는 복원 ID와 현재 표시를 유지한다.
          }
        } else {
          const previous = lastActiveJob.current;
          lastActiveJob.current = null;
          setJob(null);
          if (previous) void announceCompletion(previous);
        }
      } catch {
        errors.current += 1;
      }
    }

    async function poll() {
      await refresh();
      if (mounted) timer = window.setTimeout(poll, errors.current >= 3 ? 10_000 : 2_500);
    }

    void poll();
    return () => {
      mounted = false;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  if (!job && !completedNotice) return null;
  if (!job && completedNotice) {
    return (
      <aside className={`${styles.indicator} ${styles.completed}`} aria-live="assertive" role="alert">
        <button aria-label="광고 제작 완료 알림 닫기" className={styles.close} onClick={() => setCompletedNotice(null)} type="button">
          ×
        </button>
        <span className={styles.label}>광고 제작이 완료됐습니다</span>
        <strong>{completedNotice.productName}</strong>
        <small>
          완성 {completedNotice.completedCount}/{completedNotice.totalCount}장 · 결과를 확인하고 다운로드할 수 있습니다.
        </small>
        <Link className={styles.link} href={`/create-product?step=product&jobId=${encodeURIComponent(completedNotice.jobId)}#creative-results`}>
          완성 결과 확인
        </Link>
      </aside>
    );
  }
  if (!job) return null;
  const stalled = !job.runnerActive;
  return (
    <aside className={`${styles.indicator} ${stalled ? styles.stalled : ""}`} aria-live="polite" role="status">
      <span className={styles.label}>{stalled ? "광고 제작 재개 필요" : "광고 제작 백그라운드 진행 중"}</span>
      <strong>{job.productName}</strong>
      <small>{stalled ? `생성 ${job.generatedCount}/${job.totalCount}${job.failedCount ? ` · 실패 ${job.failedCount}` : ""} · 제작 화면에서 이어서 실행해 주세요.` : `${job.currentHookCode ? `${job.currentHookCode} 제작 중 · ` : ""}생성 ${job.generatedCount}/${job.totalCount}${job.failedCount ? ` · 실패 ${job.failedCount}` : ""}`}</small>
      <Link className={styles.link} href={`/create-product?step=product&jobId=${encodeURIComponent(job.jobId)}#creative-results`}>
        진행 상황 보기
      </Link>
    </aside>
  );
}
