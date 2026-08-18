import analysis from "../../../data/creative-benchmarks/benchmark-analysis.json" with { type: "json" };
import type { BenchmarkAnalysis } from "./types.ts";

const fallback: BenchmarkAnalysis = {
  version: 1,
  sourceDirectory: "data/creative-benchmarks/desired-quality",
  images: [],
  globalPatterns: {
    composition: ["one dominant hook", "real product hero", "grouped offer block"],
    productTreatment: ["hero scale", "contact shadow", "scene-matched rim light"],
  },
  qualityThresholds: {
    minimumOverall: 78,
    minimumProductVisibility: 78,
    minimumTextReadability: 82,
  },
};

export function loadBenchmarkAnalysis(): BenchmarkAnalysis {
  const value = analysis as BenchmarkAnalysis;
  return value?.version && Array.isArray(value.images) ? value : fallback;
}
