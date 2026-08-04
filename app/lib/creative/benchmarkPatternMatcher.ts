import { loadBenchmarkAnalysis } from "./benchmarkLoader";

function normalizedCategory(value: string) {
  const text = value.toLowerCase();
  if (/바디|샤워|뷰티|화장|퍼스널/.test(text)) return "personal-care";
  if (/한우|육류|고기|축산|갈비|등심/.test(text)) return "food-meat";
  if (/농산|과일|채소|산지|수확/.test(text)) return "agriculture";
  if (/식품|선물/.test(text)) return "food-meat";
  return "generic";
}

export function matchBenchmarkPatterns(params: {
  category: string;
  archetypeId: string;
  limit?: number;
}) {
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

  return patterns.length
    ? patterns
    : ["one dominant hook", "real product hero", "quiet text-safe zone", "grouped offer block"];
}
