import sharp from "sharp";
import { readCreativeRasterAsset } from "./assets.server.ts";
import type { CreativeImageAsset, CreativeImageRole, ProductTruth } from "./types.ts";

const compositableRoles = new Set<CreativeImageRole>(["product-cutout", "product-packshot", "product-lifestyle"]);

export function isCompositableImageRole(role: CreativeImageRole) {
  return compositableRoles.has(role);
}

function isPhysicalPackageLabelImage(truth: ProductTruth, asset: CreativeImageAsset) {
  if (asset.role !== "product-packshot") return false;
  const candidate = truth.product.sourceImageCandidates?.find((item) => item.imagePath === asset.path);
  const packageRepresentation = ["packaged-product", "product-package-group", "bundle-components", "multi-unit-set"].includes(candidate?.expectedRepresentationType || "");
  const packageObject = candidate?.detectedObjects?.some((object) => object.role === "package" && object.selected !== false);
  const packageSignals = [asset.reason, ...(asset.classificationSignals || []), candidate?.label, candidate?.analysisReason, truth.product.packageType]
    .filter(Boolean)
    .join(" ");
  return Boolean(packageRepresentation || packageObject || candidate?.expectedExtractionScope === "product-and-package" || /포장|패키지|라벨|용기|보틀|병|캔|파우치|봉지|트레이|박스|상자|package|label|bottle|can|pouch|tray|box/i.test(packageSignals));
}

async function inspectImage(truth: ProductTruth, asset: CreativeImageAsset) {
  const buffer = await readCreativeRasterAsset(asset.path);
  const { data, info } = await sharp(buffer)
    .rotate()
    .resize(160, 160, {
      fit: "inside",
      withoutEnlargement: true,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let transparentPixels = 0;
  let visiblePixels = 0;
  for (let offset = 3; offset < data.length; offset += info.channels) {
    if (data[offset] < 245) transparentPixels += 1;
    if (data[offset] >= 16) visiblePixels += 1;
  }
  const transparent = transparentPixels / Math.max(1, info.width * info.height) >= 0.025;
  const productFocusRatio = visiblePixels / Math.max(1, info.width * info.height);
  const metadata = await sharp(buffer).metadata();
  const aspectRatio = metadata.width && metadata.height ? Math.max(metadata.width / metadata.height, metadata.height / metadata.width) : 0;
  const longDetail = aspectRatio >= 3.2;
  const largeEnough = Boolean(metadata.width && metadata.height) && Math.min(metadata.width || 0, metadata.height || 0) >= 180;
  const physicalPackageLabel = Boolean(asset.hasText && isPhysicalPackageLabelImage(truth, asset));
  const confirmed = asset.validationStatus !== "needs-confirmation" && asset.validationStatus !== "excluded" && asset.verified && largeEnough && (!asset.hasText || physicalPackageLabel) && !longDetail;
  return {
    ...asset,
    role: longDetail ? ("detail-image" as const) : transparent && asset.role === "product-packshot" ? ("product-cutout" as const) : asset.role,
    transparent,
    width: metadata.width,
    height: metadata.height,
    productFocusRatio,
    verified: confirmed,
    validationStatus: confirmed ? "confirmed" : asset.validationStatus === "needs-confirmation" ? "needs-confirmation" : "excluded",
    reason: longDetail ? "지나치게 긴 상세페이지형 이미지 비율이 확인되어 상품 합성에서 제외" : Math.min(metadata.width || 0, metadata.height || 0) < 180 ? "상품 이미지 해상도가 너무 작아 합성에서 제외" : asset.hasText && !physicalPackageLabel ? "글자가 포함된 상세·광고 이미지는 상품 합성에서 제외" : physicalPackageLabel ? "실제 패키지 라벨을 상품 정체성 근거로 보존" : asset.reason,
    classificationSignals: [...(asset.classificationSignals || []), ...(longDetail ? ["상세페이지형 긴 이미지 비율"] : []), ...(transparent ? ["투명 배경"] : [])],
  } satisfies CreativeImageAsset;
}

export async function inspectProductTruthImages(truth: ProductTruth): Promise<ProductTruth> {
  const inspected = await Promise.all(
    truth.imageAssets.map(async (asset) => {
      if (!isCompositableImageRole(asset.role)) return asset;
      try {
        return await inspectImage(truth, asset);
      } catch {
        return {
          ...asset,
          verified: false,
          validationStatus: "excluded",
          reason: "상품 이미지 파일을 안전하게 읽거나 디코딩하지 못해 합성에서 제외",
        } satisfies CreativeImageAsset;
      }
    })
  );
  const productImages = inspected
    .filter((asset) => asset.verified && asset.validationStatus === "confirmed" && isCompositableImageRole(asset.role))
    .sort((left, right) => {
      const score = (asset: CreativeImageAsset) => (asset.role === "product-cutout" ? 300 : asset.role === "product-packshot" ? 200 : 100) + (asset.source === "known-product" ? 80 : asset.source === "user-confirmed" ? 60 : 0);
      return score(right) - score(left);
    });
  return {
    ...truth,
    imageAssets: inspected,
    referenceImages: inspected.filter((asset) => asset.role === "ad-reference"),
    imagePaths: productImages.map((asset) => asset.path),
    confirmedProductImage: productImages[0],
    needsConfirmationImages: inspected.filter((asset) => asset.validationStatus === "needs-confirmation"),
  };
}

export function assertProductImageReady(truth: ProductTruth) {
  if (!truth.confirmedProductImage || !truth.imagePaths.length) {
    const confirmationHint = truth.needsConfirmationImages?.length ? ` 확인이 필요한 이미지 ${truth.needsConfirmationImages.length}장을 상품 이미지 작업대에서 제품 단독 이미지로 확정하거나 새 누끼를 업로드해 주세요.` : " 상품 이미지 작업대에서 누끼 또는 제품 단독 이미지를 선택해 주세요.";
    throw new Error(`광고 합성에 사용할 실제 상품 이미지가 확인되지 않았습니다.${confirmationHint}`);
  }
  if (!isCompositableImageRole(truth.confirmedProductImage.role)) {
    throw new Error("참고 광고·리뷰·배경 이미지는 상품 합성 레이어로 사용할 수 없습니다.");
  }
}

/**
 * AI-native final ads do not need a transparent compositing layer. A real
 * product-page photo is enough because the model uses the complete image as
 * identity, usage and texture reference.
 */
export function assertNativeProductReferenceReady(truth: ProductTruth) {
  const usableReference = truth.imageAssets.some(
    (asset) =>
      Boolean(asset.path) &&
      asset.verified &&
      asset.validationStatus !== "excluded" &&
      ["product-packshot", "product-lifestyle", "detail-image"].includes(asset.role) &&
      asset.transparent !== true &&
      !/(?:^|[\\/_.-])(?:processed-products|product-cutouts?|remove-?bg|cutout|nukki|누끼)(?:[\\/_.-]|$)/iu.test(asset.path)
  );
  if (!usableReference) {
    throw new Error("AI 광고 제작에 사용할 상세페이지 원본 상품 이미지를 확인하지 못했습니다. 상품을 다시 분석하거나 위 원본 이미지에서 실제 상품 사진을 선택해 주세요.");
  }
}
