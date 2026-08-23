import crypto from "node:crypto";
import sharp from "sharp";
import { readCreativeRasterAsset } from "./assets.server.ts";
import { buildProductReferenceProfile } from "./productReferenceProfile.ts";
import type { CreativeImageAsset, ProductReferenceImage, ProductReferenceRole, ProductTruth } from "./types.ts";

const roleWeights: Record<ProductReferenceRole, number> = {
  "primary-product": 100,
  "front-package": 96,
  "side-package": 82,
  "back-package": 72,
  "product-detail": 78,
  texture: 68,
  lifestyle: 76,
  usage: 80,
  worn: 88,
  cooked: 88,
  ingredient: 56,
  "size-reference": 54,
  option: 62,
  "brand-logo": 50,
  unknown: 30,
};

function uniquePaths(truth: ProductTruth) {
  const values: Array<{ path: string; asset?: CreativeImageAsset }> = [];
  const seen = new Set<string>();
  const push = (value: string | undefined, asset?: CreativeImageAsset) => {
    const path = String(value || "").trim();
    if (!path || seen.has(path)) return;
    seen.add(path);
    values.push({ path, asset });
  };
  truth.imageAssets.forEach((asset) => push(asset.path, asset));
  (truth.product.productImagePaths || []).forEach((path) => push(path));
  (truth.product.extractedGalleryImages || []).forEach((path) => push(path));
  (truth.product.sourceImageCandidates || []).forEach((candidate) => push(candidate.imagePath));
  return values.slice(0, 24);
}

function roleFor(truth: ProductTruth, path: string, asset: CreativeImageAsset | undefined, index: number): ProductReferenceRole {
  const candidate = truth.product.sourceImageCandidates?.find((item) => item.imagePath === path);
  const text = `${path} ${candidate?.label || ""} ${candidate?.sourceType || ""}`.toLowerCase();
  const category = `${truth.product.category} ${truth.product.detectedProductType || ""}`.toLowerCase();
  if (asset?.role === "logo" || /(?:^|[-_/])(logo|brand)(?:[-_.\/]|$)/.test(text)) return "brand-logo";
  if (/side|측면/.test(text)) return "side-package";
  if (/back|후면/.test(text)) return "back-package";
  if (/texture|detail|close|질감|재질|디테일/.test(text)) return "texture";
  if (/ingredient|성분|원료/.test(text)) return "ingredient";
  if (/size|scale|크기|비교/.test(text)) return "size-reference";
  if (/option|color|옵션|컬러/.test(text)) return "option";
  if (/lifestyle|연출|lookbook/.test(text)) return "lifestyle";
  if (/usage|howto|사용|착용/.test(text)) return /패션|의류|fashion|dress/.test(category) ? "worn" : "usage";
  if (/조리|섭취|cooked|recipe|serving/.test(text) || (/육류|식품|농산/.test(category) && asset?.role === "product-lifestyle")) return "cooked";
  if (asset?.role === "product-lifestyle") return "lifestyle";
  if (asset?.role === "product-cutout" || asset?.role === "product-packshot") return index === 0 ? "primary-product" : "front-package";
  if (candidate?.type === "hero" || candidate?.sourceType === "open-graph" || index === 0) return "primary-product";
  if (candidate?.type === "detail" || asset?.role === "detail-image") return "product-detail";
  return "unknown";
}

async function analyzeOne(truth: ProductTruth, item: { path: string; asset?: CreativeImageAsset }, index: number): Promise<ProductReferenceImage> {
  const role = roleFor(truth, item.path, item.asset, index);
  const candidate = truth.product.sourceImageCandidates?.find((value) => value.imagePath === item.path);
  const watermarkRisk = /watermark|sample|preview|copyright/i.test(item.path);
  try {
    const buffer = await readCreativeRasterAsset(item.path);
    const metadata = await sharp(buffer).metadata();
    const width = metadata.width || 0;
    const height = metadata.height || 0;
    const tooSmall = Math.min(width, height) < 256;
    const tooLong = Math.max(width, height) / Math.max(1, Math.min(width, height)) > 4;
    const hasText = Boolean(item.asset?.hasText || candidate?.hasText);
    const contentHash = crypto.createHash("sha256").update(buffer).digest("hex");
    const packageIdentityRole = ["primary-product", "front-package", "side-package", "back-package"].includes(role);
    return {
      id: `reference-${contentHash.slice(0, 12)}`,
      url: item.path,
      role,
      importance: Math.max(0, roleWeights[role] - (tooSmall ? 45 : 0) - (tooLong ? 35 : 0) - (hasText ? 18 : 0) - (watermarkRisk ? 30 : 0)),
      width,
      height,
      // Package labels are identity evidence, not promotional text overlays.
      // Keep clear package views usable while still rejecting text-heavy
      // lifestyle/detail screenshots as native-generation references.
      usableForGeneration: !tooSmall && !tooLong && !watermarkRisk && (!hasText || packageIdentityRole),
      description: `${role} · ${width}×${height}${hasText ? " · 이미지 내 문구 확인 필요" : ""}`,
      contentHash,
      watermarkRisk,
      hasText,
    };
  } catch {
    const stable = crypto.createHash("sha256").update(item.path).digest("hex");
    return {
      id: `reference-${stable.slice(0, 12)}`,
      url: item.path,
      role,
      importance: Math.max(0, roleWeights[role] - 60),
      usableForGeneration: false,
      description: `${role} · 안전하게 다운로드하거나 디코딩하지 못함`,
      contentHash: stable,
      watermarkRisk,
      hasText: Boolean(item.asset?.hasText || candidate?.hasText),
    };
  }
}

export async function analyzeProductReferences(truth: ProductTruth) {
  const references = await Promise.all(uniquePaths(truth).map((item, index) => analyzeOne(truth, item, index)));
  const byHash = new Map<string, string>();
  const deduplicated = references.map((reference) => {
    const hash = reference.contentHash || reference.url;
    const duplicateOf = byHash.get(hash);
    if (!duplicateOf) byHash.set(hash, reference.id);
    return duplicateOf ? { ...reference, duplicateOf, usableForGeneration: false, importance: 0 } : reference;
  });
  deduplicated.sort((left, right) => right.importance - left.importance || left.id.localeCompare(right.id));
  return buildProductReferenceProfile(truth, deduplicated);
}
