export function safeDivide(numerator: number | null, denominator: number | null) {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  const value = numerator / denominator;
  return Number.isFinite(value) ? value : null;
}

export function safeChangeRate(current: number | null, previous: number | null) {
  if (current === null || previous === null || previous <= 0) return null;
  const value = (current - previous) / previous;
  return Number.isFinite(value) ? value : null;
}

export function sumNullable(values: Array<number | null>) {
  const present = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return present.length ? present.reduce((sum, value) => sum + value, 0) : null;
}

export function averageNullable(values: Array<number | null>) {
  const present = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
}

export function percentile(values: Array<number | null>, quantile: number) {
  const sorted = values.filter((value): value is number => value !== null && Number.isFinite(value)).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const position = Math.max(0, Math.min(1, quantile)) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.max(0, Math.min(100, value)) * 10) / 10;
}

export function smoothedConversionRate(params: { orders: number | null; views: number | null; categoryRate: number | null; priorStrength?: number }) {
  const { orders, views } = params;
  if (orders === null || views === null || views < 0) return null;
  const priorStrength = Math.max(0, params.priorStrength ?? 20);
  const categoryRate = params.categoryRate ?? 0;
  const denominator = views + priorStrength;
  if (denominator <= 0) return null;
  return (orders + categoryRate * priorStrength) / denominator;
}

export function weightedAvailableScore(factors: Array<{ value: number | null; weight: number }>) {
  const available = factors.filter((factor): factor is { value: number; weight: number } => factor.value !== null && Number.isFinite(factor.value) && factor.weight > 0);
  const totalWeight = available.reduce((sum, factor) => sum + factor.weight, 0);
  if (!totalWeight) return null;
  return clampScore(available.reduce((sum, factor) => sum + factor.value * factor.weight, 0) / totalWeight);
}
