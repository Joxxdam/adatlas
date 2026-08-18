"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { GenerationJob, GenerationJobSummary } from "../../../lib/creative-generation/types";

const storedJobKey = "daywiz-active-creative-job-id";

function summarize(job: GenerationJob, runnerActive: boolean): GenerationJobSummary {
  const completed = new Set(["success", "failed", "korean-review", "product-review", "approved", "excluded"]);
  return {
    jobId: job.id,
    advertiserId: job.advertiserId,
    advertiserName: job.advertiserName,
    productId: job.productTruth.productId,
    productName: job.productTruth.product.productName,
    productUrl: job.productTruth.product.landingUrl,
    totalCount: job.results.length,
    completedCount: job.results.filter((result) => completed.has(result.status)).length,
    successCount: job.results.filter((result) => result.status === "success" || result.status === "approved").length,
    failedCount: job.results.filter((result) => ["failed", "korean-review", "product-review"].includes(result.status)).length,
    currentHookCode: job.results.find((result) => result.status === "running")?.hookPlan.hookCode,
    status: job.status,
    runnerActive,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    completedResults: job.results.filter((result) => completed.has(result.status)),
    failedResults: job.results.filter((result) => ["failed", "korean-review", "product-review"].includes(result.status)),
  };
}

export function CreativeJobStatusIndicator() {
  const [job, setJob] = useState<GenerationJobSummary | null | undefined>(undefined);
  const errors = useRef(0);
  const activeJobId = job?.jobId;
  const activeJobStatus = job?.status;

  useEffect(() => {
    let mounted = true;
    async function refresh() {
      try {
        const storedId = window.localStorage.getItem(storedJobKey);
        const response = await fetch("/api/creative-generation/jobs/active", { cache: "no-store" });
        const payload = await response.json() as {
          activeJobs?: GenerationJobSummary[];
        };
        if (!response.ok) throw new Error("status unavailable");
        let next = storedId
          ? payload.activeJobs?.find((item) => item.jobId === storedId)
          : payload.activeJobs?.[0];
        if (!next && storedId) {
          const jobResponse = await fetch(`/api/creative-generation/jobs/${encodeURIComponent(storedId)}`, { cache: "no-store" });
          const jobPayload = await jobResponse.json() as { job?: GenerationJob; runnerActive?: boolean };
          if (jobResponse.ok && jobPayload.job) next = summarize(jobPayload.job, Boolean(jobPayload.runnerActive));
        }
        if (!mounted) return;
        errors.current = 0;
        setJob(next || null);
        if (next) window.localStorage.setItem(storedJobKey, next.jobId);
      } catch {
        errors.current += 1;
      }
    }

    void refresh();
    const shouldPoll = activeJobStatus === undefined || activeJobStatus === "pending" || activeJobStatus === "running";
    const interval = shouldPoll && errors.current < 3
      ? window.setInterval(() => {
          if (errors.current < 3) void refresh();
        }, 2500)
      : undefined;
    return () => {
      mounted = false;
      if (interval) window.clearInterval(interval);
    };
  }, [activeJobId, activeJobStatus]);

  if (!job) return null;
  const generating = job.status === "pending" || job.status === "running";
  const stalled = generating && !job.runnerActive;
  return (
    <div className={`creative-job-indicator ${stalled ? "stalled" : ""}`} role="status">
      <span>
        {stalled
          ? `AI 광고 재개 필요 · ${job.completedCount}/${job.totalCount}`
          : generating
            ? `AI 광고 생성 중 · ${job.completedCount}/${job.totalCount}`
            : job.status === "completed"
              ? `AI 광고 ${job.successCount}장 완성`
              : `AI 광고 결과 · 성공 ${job.successCount}장`}
      </span>
      <Link href={`/create-product?view=results&jobId=${encodeURIComponent(job.jobId)}#creative-results`}>
        {generating ? "진행 상황 보기" : "결과 확인"}
      </Link>
    </div>
  );
}
