export const ACTIVE_CREATIVE_JOB_STORAGE_KEY = "daywiz-active-creative-job-id";

export function activeCreativeProductJobStorageKey(productUrl: string) {
  return `${ACTIVE_CREATIVE_JOB_STORAGE_KEY}:${productUrl}`;
}

export function completedCreativeJobNoticeStorageKey(jobId: string) {
  return `daywiz-creative-job-completed-notified:${jobId}`;
}
