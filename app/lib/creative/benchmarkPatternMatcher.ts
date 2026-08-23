import { loadBenchmarkAnalysis } from "./benchmarkLoader.ts";

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

export function buildBenchmarkQualityContract() {
  const analysis = loadBenchmarkAnalysis();
  const patterns = analysis.globalPatterns;
  const thresholds = analysis.qualityThresholds;
  const readTime = typeof patterns.hookReadTimeSeconds === "number" ? patterns.hookReadTimeSeconds : 2;

  return [
    "Use the benchmark only as an abstract quality bar. Never reproduce any benchmark's exact layout, framing, copy, product, logo, badge, palette arrangement or brand identity.",
    `Make the current hook understandable in about ${readTime} seconds with one dominant visual idea.`,
    `Information order: ${stringList(patterns.informationOrder).join(" → ")}.`,
    `Composition principles: ${stringList(patterns.composition).join("; ")}.`,
    `Product treatment principles: ${stringList(patterns.productTreatment).join("; ")}.`,
    `Typography-planning principles: ${stringList(patterns.textTreatment).join("; ")}. Exact Korean typography is rendered by the application after image generation.`,
    `Category guidance: ${stringList(patterns.categoryDifferences).join("; ")}.`,
    `Quality bar: overall ${thresholds.minimumOverall ?? 78}+, product visibility ${thresholds.minimumProductVisibility ?? 78}+, readability ${thresholds.minimumTextReadability ?? 82}+, scene relevance ${thresholds.minimumSceneRelevance ?? 76}+, at most ${thresholds.maximumPrimaryFocalPoints ?? 2} primary focal points.`,
    "Translate these principles into a new composition built specifically for the current verified product, hook and customer situation.",
  ].filter((line) => !line.endsWith(": ."));
}

function normalizedCategory(value: string) {
  const text = value.toLowerCase();
  if (/바디|샤워|뷰티|화장|퍼스널/.test(text)) return "personal-care";
  if (/한우|육류|고기|축산|갈비|등심/.test(text)) return "food-meat";
  if (/농산|과일|채소|산지|수확/.test(text)) return "agriculture";
  if (/식품|선물/.test(text)) return "food-meat";
  return "generic";
}

export function matchBenchmarkPatterns(params: { category: string; archetypeId: string; limit?: number }) {
  const analysis = loadBenchmarkAnalysis();
  const category = normalizedCategory(params.category);
  const ranked = analysis.images
    .map((image) => {
      let score = 0;
      if (image.detectedArchetype === params.archetypeId) score += 50;
      if (image.category === category) score += 38;
      if (category === "agriculture" && image.detectedArchetype === "numeric-proof") score += 12;
      return { image, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.image.fileName.localeCompare(b.image.fileName));

  const patterns = ranked
    .slice(0, Math.max(1, Math.min(5, params.limit || 3)))
    .flatMap(({ image }) => image.reusablePatterns)
    .filter((pattern, index, values) => values.indexOf(pattern) === index);

  return patterns.length ? patterns : ["one dominant hook", "real product hero", "quiet text-safe zone", "grouped offer block"];
}
