export const ACTIVE_CREATIVE_JOB_STORAGE_KEY = "daywiz-active-creative-job-id";
export const ACTIVE_CREATIVE_JOB_CHANGED_EVENT = "daywiz-active-creative-job-changed";

export function setActiveCreativeJobId(jobId?: string) {
  if (typeof window === "undefined") return;
  const normalizedJobId = String(jobId || "").trim();
  const previousJobId = window.localStorage.getItem(ACTIVE_CREATIVE_JOB_STORAGE_KEY) || "";
  if (normalizedJobId) {
    window.localStorage.setItem(ACTIVE_CREATIVE_JOB_STORAGE_KEY, normalizedJobId);
  } else {
    window.localStorage.removeItem(ACTIVE_CREATIVE_JOB_STORAGE_KEY);
  }
  if (previousJobId === normalizedJobId) return;
  window.dispatchEvent(new CustomEvent(ACTIVE_CREATIVE_JOB_CHANGED_EVENT, {
    detail: { jobId: normalizedJobId || undefined },
  }));
}

export function activeCreativeProductJobStorageKey(productUrl: string) {
  return `${ACTIVE_CREATIVE_JOB_STORAGE_KEY}:${productUrl}`;
}

export function completedCreativeJobNoticeStorageKey(jobId: string) {
  return `daywiz-creative-job-completed-notified:${jobId}`;
}
