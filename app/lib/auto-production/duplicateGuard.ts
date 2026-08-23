import type { AutoHookHypothesis, AutoProductionProductTask, AutoProductionRun } from "./types";
import { candidateIdentityKeys } from "./productIdentity.ts";

function normalize(value: string) {
  return value.toLowerCase().replace(/[^0-9a-z가-힣]+/g, "");
}

function shingles(value: string) {
  const normalized = normalize(value);
  if (normalized.length < 2) return new Set([normalized]);
  return new Set(Array.from({ length: normalized.length - 1 }, (_, index) => normalized.slice(index, index + 2)));
}

export function textSimilarity(left: string, right: string) {
  const a = shingles(left);
  const b = shingles(right);
  if (!a.size || !b.size) return 0;
  const overlap = [...a].filter((item) => b.has(item)).length;
  return overlap / new Set([...a, ...b]).size;
}

function withinDays(value: string | undefined, days: number, now: Date) {
  if (!value || days <= 0) return false;
  return now.getTime() - new Date(value).getTime() < days * 86_400_000;
}

export function recentTasks(runs: AutoProductionRun[], advertiserId: string, days: number, now = new Date()) {
  return runs.filter((run) => run.advertiserId === advertiserId && withinDays(run.createdAt, days, now)).flatMap((run) => run.tasks);
}

export function isProductRecentlyProduced(candidate: AutoProductionProductTask["candidate"], tasks: AutoProductionProductTask[]) {
  const currentKeys = new Set(candidateIdentityKeys(candidate));
  return tasks.some((task) => task.status === "completed" && (task.candidate.id === candidate.id || Boolean(candidate.externalId && task.candidate.externalId === candidate.externalId) || task.candidate.productUrl === candidate.productUrl || candidateIdentityKeys(task.candidate).some((key) => currentKeys.has(key))));
}

export function selectFreshHook(hypotheses: AutoHookHypothesis[], recent: AutoProductionProductTask[], options: { explorationRatio?: number; hasPerformanceLearning?: boolean; seed?: string } = {}) {
  const previous = recent.flatMap((task) => task.hookHypotheses.filter((hook) => hook.code === task.selectedHookCode));
  const scored = hypotheses.map((hook, index) => {
    const text = `${hook.mainHook} ${hook.messageHypothesis} ${hook.recommendedScene}`;
    const similarity = previous.reduce((highest, item) => Math.max(highest, textSimilarity(text, `${item.mainHook} ${item.messageHypothesis} ${item.recommendedScene}`)), 0);
    return { hook, similarity, index };
  });
  const eligible = scored.filter((item) => item.similarity < 0.72).sort((a, b) => a.index - b.index);
  const ratio = Math.max(0, Math.min(1, options.explorationRatio ?? 0.3));
  const seed = options.seed || hypotheses.map((item) => item.code).join("");
  const bucket = Array.from(seed).reduce((value, character) => (value * 31 + character.charCodeAt(0)) % 10_000, 7) / 10_000;
  const exploring = Boolean(options.hasPerformanceLearning && eligible.length > 1 && bucket < ratio);
  const fresh = eligible[exploring ? 1 : 0];
  return fresh
    ? {
        hook: fresh.hook,
        reason: exploring ? `성과 학습을 참고하되 새 메시지 탐색 비율 ${Math.round(ratio * 100)}%에 따라 중복이 적은 후킹을 선택했습니다.` : options.hasPerformanceLearning ? "기존 성과 학습과 상품 근거를 함께 반영한 상위 후킹을 선택했습니다." : previous.length ? "최근 메시지와 겹치지 않으면서 상품 근거가 강한 후킹을 선택했습니다." : "성과 이력이 없어 상품 근거가 가장 강한 탐색형 후킹을 선택했습니다.",
      }
    : null;
}

export function hasDuplicateRunKey(runs: AutoProductionRun[], runKey: string) {
  return runs.some((run) => run.runKey === runKey);
}
