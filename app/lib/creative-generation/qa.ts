import sharp from "sharp";
import { contrastRatio, rgbToHex } from "../mvp/colorUtils.ts";
import { intersectionArea } from "../mvp/geometry.ts";
import {
  bannedCliches,
  categoryContamination,
  messageSimilarity,
} from "./hookMessages.server.ts";
import { matchCategoryProfile } from "./profiles.ts";
import { validateCopyAgainstTruth } from "./productTruth.ts";
import { isCompositableImageRole } from "./productImages.server.ts";
import type {
  HookPlan,
  PlacementBox,
  ProductTruth,
  QAFinding,
  QAResult,
  RenderPlan,
} from "./types.ts";

function finding(
  id: string,
  severity: QAFinding["severity"],
  dimension: QAFinding["dimension"],
  message: string,
  repairable: boolean
) {
  return { id, severity, dimension, message, repairable } satisfies QAFinding;
}

function isTechnical(item: QAFinding) {
  return item.dimension === "technical" || item.dimension === "text-overflow";
}

function penalizedScore(findings: QAFinding[], group: "technical" | "creative") {
  const relevant = findings.filter((item) =>
    group === "technical" ? isTechnical(item) : !isTechnical(item)
  );
  return Math.max(
    0,
    100 -
      relevant.reduce(
        (total, item) =>
          total + (item.severity === "error" ? 32 : item.severity === "warning" ? 12 : 3),
        0
      )
  );
}

async function sampledContrast(
  surface: Buffer,
  box: PlacementBox,
  textColor: string,
  fillColor?: string
) {
  if (fillColor) return contrastRatio(textColor, fillColor);
  const left = Math.max(0, Math.floor(box.x));
  const top = Math.max(0, Math.floor(box.y));
  const width = Math.max(1, Math.min(1200 - left, Math.ceil(box.width)));
  const height = Math.max(1, Math.min(1200 - top, Math.ceil(box.height)));
  const { data, info } = await sharp(surface)
    .extract({ left, top, width, height })
    .resize(10, 10, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ratios: number[] = [];
  for (let offset = 0; offset < data.length; offset += info.channels) {
    ratios.push(
      contrastRatio(
        textColor,
        rgbToHex({ r: data[offset], g: data[offset + 1], b: data[offset + 2] })
      )
    );
  }
  ratios.sort((leftRatio, rightRatio) => leftRatio - rightRatio);
  return ratios[Math.floor(ratios.length * 0.2)] || 1;
}

export async function qaRenderedCreative(input: {
  buffer: Buffer;
  surfaceBeforeText: Buffer;
  renderPlan: RenderPlan;
  truth: ProductTruth;
  hookPlan: HookPlan;
  productPixelAreaRatio: number;
  productBounds: PlacementBox;
  logoRendered: boolean;
  autoRepairs?: string[];
  unsupportedVisualization?: boolean;
  emptyVisualElementCount?: number;
  expectedDesignFingerprint?: string;
  expectedMasterSceneId?: string;
  expectedMasterVisualDigest?: string;
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
    findings.push(
      finding("decode", "error", "technical", "최종 파일을 다시 열 수 없습니다.", true)
    );
  }
  if (metadata.width !== 1200 || metadata.height !== 1200) {
    findings.push(
      finding("size", "error", "technical", "출력 크기가 1200×1200이 아닙니다.", true)
    );
  }
  if (!["webp", "jpeg"].includes(String(metadata.format || ""))) {
    findings.push(
      finding("format", "error", "technical", "출력 포맷은 WebP 또는 JPEG여야 합니다.", true)
    );
  }
  if (input.buffer.length > input.renderPlan.maxFileSizeBytes) {
    findings.push(
      finding("bytes", "error", "technical", "파일 크기가 800KB를 초과했습니다.", true)
    );
  }

  const overflowing = input.renderPlan.renderedSlots.filter((slot) => slot.overflow);
  if (overflowing.length) {
    findings.push(
      finding(
        "text-overflow",
        "error",
        "text-overflow",
        `${overflowing.map((slot) => slot.id).join(", ")} 문구가 고정 슬롯을 초과합니다. 문구를 줄여 주세요.`,
        true
      )
    );
  }
  const minFontSize = Math.min(
    ...input.renderPlan.renderedSlots.map((slot) => slot.fontSize),
    999
  );
  if (minFontSize !== 999 && minFontSize < 28) {
    findings.push(
      finding(
        "small-text",
        "error",
        "text-overflow",
        "일부 글자가 광고 집행 최소 크기보다 작습니다.",
        true
      )
    );
  }

  const factual = validateCopyAgainstTruth(
    [
      input.renderPlan.copy.headline,
      input.renderPlan.copy.body,
      input.renderPlan.copy.proof,
      input.renderPlan.copy.offer,
      input.renderPlan.copy.cta,
    ].join(" "),
    input.truth
  );
  if (!factual.valid) {
    findings.push(
      finding(
        "factual-safety",
        "error",
        "factual-safety",
        [
          factual.unauthorizedNumericTokens.length
            ? `미확인 수치: ${factual.unauthorizedNumericTokens.join(", ")}`
            : "",
          factual.blockedClaims.length ? `금지 표현: ${factual.blockedClaims.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
        false
      )
    );
  }

  const categoryId = matchCategoryProfile(input.truth.product).id;
  const copyText = [
    input.renderPlan.copy.headline,
    input.renderPlan.copy.body,
    input.renderPlan.copy.proof,
    input.renderPlan.copy.offer,
  ].join(" ");
  const contamination = categoryContamination(categoryId, copyText);
  if (contamination) {
    findings.push(
      finding(
        "category-contamination",
        "error",
        "category-contamination",
        `상품 카테고리와 맞지 않는 표현이 포함되었습니다: ${contamination}`,
        false
      )
    );
  }
  const cliche = bannedCliches.find((phrase) => copyText.includes(phrase));
  if (cliche) {
    findings.push(
      finding(
        "copy-cliche",
        "error",
        "copy-quality",
        `금지된 상투 문구가 포함되었습니다: ${cliche}`,
        true
      )
    );
  }
  if (
    messageSimilarity(input.renderPlan.copy.headline, input.renderPlan.copy.body) >= 0.65
  ) {
    findings.push(
      finding(
        "copy-repetition",
        "error",
        "duplication",
        "메인 후킹과 서브 문구가 같은 의미를 반복합니다.",
        true
      )
    );
  }

  const invalidRoles = input.renderPlan.productImageAssets.filter(
    (asset) =>
      !asset.verified ||
      asset.validationStatus !== "confirmed" ||
      !isCompositableImageRole(asset.role)
  );
  if (!input.renderPlan.productImageAssets.length || invalidRoles.length) {
    findings.push(
      finding(
        "image-role",
        "error",
        "image-role",
        "상품 레이어에 실제 제품 누끼·팩샷이 아닌 이미지가 연결되었습니다.",
        false
      )
    );
  }

  if (input.productPixelAreaRatio < 0.055) {
    findings.push(
      finding(
        "product-too-small",
        "error",
        "product-visibility",
        `실제 상품 픽셀 면적이 ${(input.productPixelAreaRatio * 100).toFixed(1)}%로 너무 작습니다.`,
        true
      )
    );
  } else if (input.productPixelAreaRatio < 0.09) {
    findings.push(
      finding(
        "product-small",
        "warning",
        "product-visibility",
        `실제 상품 픽셀 면적이 ${(input.productPixelAreaRatio * 100).toFixed(1)}%입니다.`,
        true
      )
    );
  }
  if (
    input.renderPlan.generationMode !== "real-photo-adaptation" &&
    input.productBounds.width > 0 &&
    (input.productBounds.x <= 1 ||
      input.productBounds.y <= 1 ||
      input.productBounds.x + input.productBounds.width >= 1199 ||
      input.productBounds.y + input.productBounds.height >= 1199)
  ) {
    findings.push(
      finding(
        "product-crop",
        "error",
        "technical",
        "상품 픽셀이 캔버스 가장자리에서 잘릴 가능성이 있습니다.",
        true
      )
    );
  }

  const ctaCount = input.renderPlan.renderedSlots.filter((slot) => slot.id === "cta").length;
  if (ctaCount !== 1) {
    findings.push(
      finding(
        "cta-count",
        "error",
        "duplication",
        `CTA는 정확히 1개여야 하지만 ${ctaCount}개가 렌더링되었습니다.`,
        true
      )
    );
  }
  if (input.renderPlan.renderedSlots.some((slot) => !slot.text.trim())) {
    findings.push(
      finding(
        "empty-slot",
        "error",
        "empty-element",
        "문구가 없는 빈 박스가 렌더링되었습니다.",
        true
      )
    );
  }
  if (input.emptyVisualElementCount) {
    findings.push(
      finding(
        "empty-visual",
        "error",
        "empty-element",
        `내용 없는 시각 요소 ${input.emptyVisualElementCount}개가 확인되었습니다.`,
        true
      )
    );
  }
  if (input.unsupportedVisualization) {
    findings.push(
      finding(
        "unsupported-visualization",
        "error",
        "unsupported-visualization",
        "실제 근거 없이 그래프 또는 수치 시각화가 생성되었습니다.",
        false
      )
    );
  }

  const designLockVerified =
    !input.expectedDesignFingerprint ||
    input.renderPlan.designFingerprint === input.expectedDesignFingerprint;
  if (!designLockVerified) {
    findings.push(
      finding(
        "design-lock",
        "error",
        "layout-collision",
        "H01~H06 고정 디자인 지문과 현재 렌더 지문이 다릅니다.",
        false
      )
    );
  }
  const masterSceneLockVerified =
    (!input.expectedMasterSceneId || input.renderPlan.masterSceneId === input.expectedMasterSceneId) &&
    (!input.expectedMasterVisualDigest ||
      input.renderPlan.masterVisualDigest === input.expectedMasterVisualDigest);
  if (!masterSceneLockVerified) {
    findings.push(
      finding(
        "master-scene-lock",
        "error",
        "layout-collision",
        "H01~H06에 적용된 마스터 비주얼이 서로 다릅니다.",
        false
      )
    );
  }
  if (input.hookPlan.validationStatus === "invalid") {
    findings.push(
      finding(
        "hook-validation",
        "error",
        "copy-quality",
        `검증되지 않은 후킹 문구입니다: ${(input.hookPlan.validationErrors || []).join(" · ")}`,
        true
      )
    );
  }
  const usableFactIds = new Set(
    input.truth.facts.filter((fact) => fact.usableInCopy).map((fact) => fact.id)
  );
  if (
    !input.hookPlan.factIds.length ||
    input.hookPlan.factIds.some((factId) => !usableFactIds.has(factId))
  ) {
    findings.push(
      finding(
        "hook-evidence",
        "error",
        "copy-quality",
        "후킹 문구가 확인된 ProductTruth 근거와 연결되지 않았습니다.",
        false
      )
    );
  }
  if ((input.hookPlan.specificityScore ?? 100) < 40) {
    findings.push(
      finding(
        "hook-specificity",
        "warning",
        "copy-quality",
        `후킹 구체성 점수가 ${input.hookPlan.specificityScore}점으로 낮습니다.`,
        true
      )
    );
  }
  if ((input.hookPlan.naturalnessScore ?? 100) < 55) {
    findings.push(
      finding(
        "hook-naturalness",
        "error",
        "copy-quality",
        `후킹 자연스러움 점수가 ${input.hookPlan.naturalnessScore}점으로 낮습니다.`,
        true
      )
    );
  }

  for (const slot of input.renderPlan.renderedSlots) {
    const ratio = await sampledContrast(
      input.surfaceBeforeText,
      slot.textBounds,
      slot.textColor,
      slot.fillColor
    );
    if (ratio < 4.5) {
      findings.push(
        finding(
          `contrast-${slot.id}`,
          ratio < 3 ? "error" : "warning",
          "contrast",
          `${slot.id} 문구의 실제 배경 대비가 ${ratio.toFixed(1)}:1입니다.`,
          true
        )
      );
    }
    if (
      input.renderPlan.generationMode !== "real-photo-adaptation" &&
      ["headline", "body", "proof", "offer", "cta"].includes(slot.id) &&
      intersectionArea(slot.box, input.productBounds) > 0
    ) {
      findings.push(
        finding(
          `collision-${slot.id}`,
          "error",
          "layout-collision",
          `${slot.id} 영역과 실제 상품 픽셀이 겹칩니다.`,
          true
        )
      );
    }
  }
  for (let first = 0; first < input.renderPlan.renderedSlots.length; first += 1) {
    for (let second = first + 1; second < input.renderPlan.renderedSlots.length; second += 1) {
      const left = input.renderPlan.renderedSlots[first];
      const right = input.renderPlan.renderedSlots[second];
      if (intersectionArea(left.box, right.box) > 0) {
        findings.push(
          finding(
            `slot-collision-${left.id}-${right.id}`,
            "error",
            "layout-collision",
            `${left.id} 영역과 ${right.id} 영역이 겹칩니다.`,
            true
          )
        );
      }
    }
  }
  if (
    input.renderPlan.generationMode !== "real-photo-adaptation" &&
    input.logoRendered &&
    intersectionArea(input.renderPlan.layout.placement.logo, input.productBounds) > 0
  ) {
    findings.push(
      finding(
        "logo-product-collision",
        "warning",
        "logo",
        "로고와 실제 상품 픽셀이 겹칠 가능성이 있습니다.",
        true
      )
    );
  }

  const technicalScore = penalizedScore(findings, "technical");
  const creativeScore = penalizedScore(findings, "creative");
  const technicalPassed = findings.every(
    (item) => !isTechnical(item) || item.severity !== "error"
  );
  const creativePassed = findings.every(
    (item) => isTechnical(item) || item.severity !== "error"
  );
  const score = Math.round(technicalScore * 0.4 + creativeScore * 0.6);
  const result: QAResult = {
    passed: technicalPassed && creativePassed && score >= 85,
    score,
    technicalPassed,
    creativePassed,
    technicalScore,
    creativeScore,
    width: metadata.width || 0,
    height: metadata.height || 0,
    format: metadata.format || "unknown",
    fileSizeBytes: input.buffer.length,
    decoded,
    minFontSize: minFontSize === 999 ? input.renderPlan.layout.minFontSize : minFontSize,
    productAreaRatio: input.productPixelAreaRatio,
    findings,
    autoRepairs: [
      ...(input.autoRepairs || []),
      ...(input.renderPlan.fontAdjustments || []),
    ],
    designLockVerified,
    masterSceneLockVerified,
    checkedAt: new Date().toISOString(),
  };
  return result;
}
