export type FastCreativeRuntimeConfig = {
  enabled: boolean;
  concurrency: number;
  autoRevisionLimit: number;
  groupQaEnabled: boolean;
  plannerReasoning: "low" | "medium" | "high";
  imageReasoning: "low" | "medium" | "high";
  maxCreatives: number;
};

function flag(value: string | undefined, fallback: boolean) {
  if (value == null || value.trim() === "") return fallback;
  return /^(?:1|true|yes|on)$/i.test(value.trim());
}

function bounded(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(parsed) ? Math.floor(parsed) : fallback));
}

function effort(value: string | undefined, fallback: FastCreativeRuntimeConfig["plannerReasoning"]) {
  return value === "low" || value === "medium" || value === "high" ? value : fallback;
}

export function resolveFastCreativeRuntime(env: NodeJS.ProcessEnv = process.env): FastCreativeRuntimeConfig {
  return {
    enabled: flag(env.ADATLAS_FAST_CREATIVE_MODE, true),
    concurrency: bounded(env.ADATLAS_CREATIVE_CONCURRENCY, 3, 1, 3),
    autoRevisionLimit: bounded(env.ADATLAS_AUTO_REVISION_LIMIT, 1, 0, 1),
    groupQaEnabled: flag(env.ADATLAS_BACKGROUND_GROUP_QA, false),
    plannerReasoning: effort(env.ADATLAS_CODEX_PLANNER_REASONING, "medium"),
    imageReasoning: effort(env.ADATLAS_CODEX_IMAGE_REASONING, "low"),
    maxCreatives: bounded(env.ADATLAS_MAX_CREATIVES_PER_PRODUCT, 6, 1, 6),
  };
}
