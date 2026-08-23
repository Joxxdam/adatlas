import { readFile } from "node:fs/promises";
import sharp from "sharp";
import type { GenerationJob, GenerationResult, NativeCreativeValidation, PlacementBox } from "./types.ts";

export const NATIVE_LOCAL_QA_VERSION = "native-local-qa-v2-structural";

function overlapRatio(a: PlacementBox, b: PlacementBox) {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return (width * height) / Math.max(1, Math.min(a.width * a.height, b.width * b.height));
}

function inBounds(box: PlacementBox) {
  return box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0 && box.x + box.width <= 1200 && box.y + box.height <= 1200;
}

export async function validateAdaptiveNativeCreative(input: {
  job: GenerationJob;
  result: GenerationResult;
  file: string;
  composition: {
    exactText: { headline: string; body: string; price: string; cta: string };
    productSource: string;
    productBounds: PlacementBox[];
    textBounds: PlacementBox[];
    minHeadlineFontSize: number;
    headlineLines: string[];
    bodyLines: string[];
    headlineOverflow: boolean;
    bodyOverflow: boolean;
    minTextContrastRatio: number;
  };
}): Promise<NativeCreativeValidation> {
  const buffer = await readFile(input.file);
  const metadata = await sharp(buffer).metadata();
  const failures: string[] = [];
  const exportOk = metadata.width === 1200 && metadata.height === 1200 && Boolean(metadata.format);
  if (!exportOk) failures.push("1200×1200 래스터 규격을 충족하지 않습니다.");
  if (!input.composition.productSource) failures.push("검증된 원본 상품 소스가 기록되지 않았습니다.");
  if (!input.composition.productBounds.length || input.composition.productBounds.some((box) => !inBounds(box))) failures.push("상품이 안전 영역을 벗어났습니다.");
  if (!input.composition.textBounds.length || input.composition.textBounds.some((box) => !inBounds(box))) failures.push("문구가 안전 영역을 벗어났습니다.");
  const collision = input.composition.textBounds.some((text) => input.composition.productBounds.some((product) => overlapRatio(text, product) > 0.18));
  if (collision) failures.push("상품과 핵심 문구가 과도하게 겹칩니다.");
  const expected = [input.result.hookPlan.headline, input.result.hookPlan.body, input.composition.exactText.price, input.composition.exactText.cta].filter(Boolean);
  const observed = Object.values(input.composition.exactText).filter(Boolean);
  const exactText = expected.every((value) => observed.includes(value));
  if (!exactText) failures.push("요청한 한국어 문구와 합성 기록이 일치하지 않습니다.");
  if (input.composition.minHeadlineFontSize < 52) failures.push("모바일용 헤드라인 글자 크기가 너무 작습니다.");
  if (input.composition.headlineLines.length > 2) failures.push("헤드라인이 두 줄을 초과합니다.");
  if (input.composition.headlineOverflow) failures.push("메인 후킹 문구가 합성 영역에서 잘렸습니다.");
  if (input.composition.bodyOverflow) failures.push("서브 문구가 합성 영역에서 잘렸습니다.");
  if (!Number.isFinite(input.composition.minTextContrastRatio) || input.composition.minTextContrastRatio < 4.5) failures.push("핵심 문구와 배경의 명도 대비가 부족합니다.");
  const structuralPass = failures.length === 0;
  const area = input.composition.productBounds.reduce((sum, box) => sum + box.width * box.height, 0) / (1200 * 1200);
  const visibility = Math.max(45, Math.min(98, Math.round(60 + area * 90)));
  return {
    hookAlignment: structuralPass ? 78 : 58,
    productIdentity: input.composition.productSource ? 94 : 0,
    factualAccuracy: exactText ? 96 : 40,
    koreanTextAccuracy: exactText ? 100 : 35,
    readability: input.composition.minHeadlineFontSize >= 52 && input.composition.headlineLines.length <= 2 && input.composition.minTextContrastRatio >= 4.5 ? 94 : 55,
    composition: collision ? 48 : structuralPass ? 86 : 62,
    diversity: 72,
    commercialQuality: structuralPass ? 78 : 52,
    exportCompliance: exportOk ? 100 : 0,
    productVisibility: visibility,
    humanNaturalness: 0,
    categoryFit: 70,
    foodAppetiteAppeal: input.job.productTruth.product.category.match(/food|식품|농산|축산|육류/i) ? 70 : 0,
    sensoryExpression: input.result.hookPlan.primaryTag === "sensory-experience" ? 74 : 62,
    mobileReadability: input.composition.minHeadlineFontSize >= 52 ? 94 : 50,
    observedKoreanText: observed,
    failures,
    // 사람·손·음식 질감의 자연스러움은 로컬 규격 검사로 확정하지 않는다.
    recommendation: structuralPass ? "manual-review" : "revise",
    checkedAt: new Date().toISOString(),
  };
}
