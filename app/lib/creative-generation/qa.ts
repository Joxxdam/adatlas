import sharp from "sharp";
import { contrastRatio } from "../mvp/colorUtils.ts";
import { validateCopyAgainstTruth } from "./productTruth.ts";
import type { ProductTruth, QAFinding, QAResult, RenderPlan } from "./types";

export async function qaRenderedCreative(input: {
  buffer: Buffer;
  renderPlan: RenderPlan;
  truth: ProductTruth;
  textOverflow: boolean;
  minFontSize: number;
}) {
  const findings: QAFinding[] = [];
  let decoded = true;
  let metadata: { width?: number; height?: number; format?: string } = {};
  try {
    metadata = await sharp(input.buffer).metadata();
    await sharp(input.buffer).resize(16, 16).raw().toBuffer();
  } catch {
    decoded = false;
  }
  if (!decoded) {
    findings.push({ id: "decode", severity: "error", dimension: "technical", message: "최종 파일을 다시 열 수 없습니다.", repairable: true });
  }
  if (metadata.width !== 1200 || metadata.height !== 1200) {
    findings.push({ id: "size", severity: "error", dimension: "technical", message: "출력 크기가 1200×1200이 아닙니다.", repairable: true });
  }
  if (!['webp', 'jpeg'].includes(String(metadata.format || ''))) {
    findings.push({ id: "format", severity: "error", dimension: "technical", message: "출력 포맷은 WebP 또는 JPEG여야 합니다.", repairable: true });
  }
  if (input.buffer.length > input.renderPlan.maxFileSizeBytes) {
    findings.push({ id: "bytes", severity: "error", dimension: "technical", message: "파일 크기가 800KB를 초과했습니다.", repairable: true });
  }
  if (input.textOverflow) {
    findings.push({ id: "text-overflow", severity: "error", dimension: "text-overflow", message: "최소 글자 크기에서도 문구가 권장 슬롯을 초과합니다.", repairable: true });
  }
  if (input.minFontSize < 28) {
    findings.push({ id: "small-text", severity: "warning", dimension: "text-overflow", message: "일부 글자가 광고 집행 기준보다 작습니다.", repairable: true });
  }
  const factual = validateCopyAgainstTruth(
    Object.values(input.renderPlan.copy).filter((value) => typeof value === "string").join(" "),
    input.truth
  );
  if (!factual.valid) {
    findings.push({
      id: "factual-safety",
      severity: "error",
      dimension: "factual-safety",
      message: [
        factual.unauthorizedNumericTokens.length ? `미확인 수치: ${factual.unauthorizedNumericTokens.join(", ")}` : "",
        factual.blockedClaims.length ? `금지 표현: ${factual.blockedClaims.join(", ")}` : "",
      ].filter(Boolean).join(" · "),
      repairable: false,
    });
  }
  const contrast = contrastRatio(
    input.renderPlan.layout.colors.foreground,
    input.renderPlan.layout.colors.background
  );
  if (contrast < 4.5) {
    findings.push({ id: "contrast", severity: "warning", dimension: "contrast", message: `기본 글자 대비가 ${contrast.toFixed(1)}:1입니다.`, repairable: true });
  }
  const product = input.renderPlan.layout.placement.product;
  const productAreaRatio = Number(((product.width * product.height) / (1200 * 1200)).toFixed(3));
  if (productAreaRatio < 0.12) {
    findings.push({ id: "product-small", severity: "warning", dimension: "product-visibility", message: "상품 표시 면적이 작습니다.", repairable: true });
  }
  const score = Math.max(
    0,
    100 - findings.reduce((total, item) => total + (item.severity === "error" ? 22 : item.severity === "warning" ? 7 : 2), 0)
  );
  const result: QAResult = {
    passed: findings.every((item) => item.severity !== "error"),
    score,
    width: metadata.width || 0,
    height: metadata.height || 0,
    format: metadata.format || "unknown",
    fileSizeBytes: input.buffer.length,
    decoded,
    minFontSize: input.minFontSize,
    productAreaRatio,
    findings,
    checkedAt: new Date().toISOString(),
  };
  return result;
}
