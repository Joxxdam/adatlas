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

export function resolveRuntimeTimeout(value: string | undefined, fallback: number, min = 10_000, max = 30 * 60 * 1000) {
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
    // 상품 중복·누끼·잘못된 상품·깨진 한글 같은 치명 오류는 검수만 하고
    // 그대로 저장하면 안 됩니다. 환경변수가 0이어도 치명 QA 보정 1회는 보장합니다.
    autoRevisionLimit: bounded(env.ADATLAS_AUTO_REVISION_LIMIT, 1, 1, 1),
    groupQaEnabled: flag(env.ADATLAS_BACKGROUND_GROUP_QA, false),
    plannerReasoning: effort(env.ADATLAS_CODEX_PLANNER_REASONING, "medium"),
    imageReasoning: effort(env.ADATLAS_CODEX_IMAGE_REASONING, "low"),
    maxCreatives: bounded(env.ADATLAS_MAX_CREATIVES_PER_PRODUCT, 6, 1, 6),
  };
}
