import sharp from "sharp";
import type { ProductIdentityEvaluation } from "./productIdentityEvaluator.ts";
import type {
  MasterSceneGenerationMode,
  MasterSceneSpec,
  ProductReferenceProfile,
  SceneQualityResult,
} from "./types.ts";

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

async function regionComplexity(buffer: Buffer, box: MasterSceneSpec["copySafeZone"]) {
  const x = Math.max(0, Math.min(1199, Math.round(box.x)));
  const y = Math.max(0, Math.min(1199, Math.round(box.y)));
  const width = Math.max(1, Math.min(1200 - x, Math.round(box.width)));
  const height = Math.max(1, Math.min(1200 - y, Math.round(box.height)));
  // Materialise the square canvas before extracting. Sharp may otherwise apply
  // extract against the source dimensions when the decoded reference is not
  // already 1200×1200, which raises `extract_area: bad extract area`.
  const normalized = await sharp(buffer)
    .resize(1200, 1200, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();
  const { data } = await sharp(normalized)
    .extract({ left: x, top: y, width, height })
    .resize(24, 24)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const average = data.reduce((total, value) => total + value, 0) / Math.max(1, data.length);
  const variance = data.reduce((total, value) => total + (value - average) ** 2, 0) / Math.max(1, data.length);
  return Math.sqrt(variance);
}

export async function evaluateMasterSceneCandidate(input: {
  buffer: Buffer;
  profile: ProductReferenceProfile;
  spec: MasterSceneSpec;
  generationMode: MasterSceneGenerationMode;
  identity: ProductIdentityEvaluation;
}): Promise<SceneQualityResult> {
  const metadata = await sharp(input.buffer).metadata();
  const failures = [...input.identity.findings];
  const square = Boolean(metadata.width && metadata.height) &&
    Math.abs((metadata.width || 0) / Math.max(1, metadata.height || 0) - 1) <= 0.04;
  if (!square) failures.push("1:1 광고 마스터 비율이 아님");
  if (!input.identity.productVisible) failures.push("상품이 명확하게 보이지 않음");
  if (input.identity.severeDistortion) failures.push("상품 형태가 비정상적으로 변형됨");
  if (input.identity.textArtifactDetected) failures.push("장면 안에 의미 없는 글자·숫자가 생성됨");
  if (input.identity.brandMismatch) failures.push("브랜드 또는 라벨이 다른 상품처럼 보임");
  if (input.identity.humanArtifactDetected) failures.push("손·얼굴·신체가 비정상적으로 생성됨");
  if (input.identity.groundingMismatch) failures.push("제품의 접촉면·그림자·조명·원근이 장면과 맞지 않음");
  const complexity = await regionComplexity(input.buffer, input.spec.copySafeZone);
  const copySafetyScore = clamp(100 - Math.max(0, complexity - 8) * 2.25);
  if (copySafetyScore < 55) failures.push("카피가 들어갈 여백의 시각적 복잡도가 높음");
  const productIdentityScore = clamp(input.identity.score);
  const productVisibilityScore = input.identity.productVisible ? 88 : 20;
  const protectedMode = [
    "ai-background-composite",
    "protected-product-composite",
    "real-photo-adaptation",
    "library-fallback",
  ].includes(input.generationMode);
  const groundingScore = input.identity.groundingMismatch
    ? 35
    : protectedMode
      ? 86
      : input.identity.method === "vision"
        ? 82
        : 68;
  const compositionScore = square ? 84 : 52;
  const categoryFitScore = input.profile.category ? 84 : 60;
  const attentionScore = input.generationMode === "ai-background-composite" ? 88 : protectedMode ? 78 : 86;
  const factSafetyScore = input.identity.textArtifactDetected || input.identity.brandMismatch ? 35 : 92;
  const score = clamp(
    productIdentityScore * 0.3 +
      productVisibilityScore * 0.15 +
      groundingScore * 0.15 +
      attentionScore * 0.1 +
      copySafetyScore * 0.1 +
      categoryFitScore * 0.1 +
      factSafetyScore * 0.1
  );
  const hardFailure =
    productIdentityScore < 55 ||
    !input.identity.productVisible ||
    input.identity.severeDistortion ||
    input.identity.brandMismatch ||
    input.identity.textArtifactDetected ||
    input.identity.humanArtifactDetected ||
    input.identity.groundingMismatch;
  const recommendation: SceneQualityResult["recommendation"] = hardFailure
    ? input.generationMode === "protected-product-composite"
      ? "manual-review"
      : productIdentityScore < 45 || input.identity.brandMismatch
        ? "use-protected-product-composite"
        : "retry"
    : productIdentityScore < 78 || copySafetyScore < 55
      ? input.generationMode === "protected-product-composite"
        ? "manual-review"
        : "retry"
      : score >= 78
        ? "approve"
        : "manual-review";
  return {
    score,
    productIdentityScore,
    compositionScore,
    groundingScore,
    copySafetyScore,
    factSafetyScore,
    productVisibilityScore,
    categoryFitScore,
    attentionScore,
    failures: Array.from(new Set(failures)).slice(0, 12),
    recommendation,
  };
}
