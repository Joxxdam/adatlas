import "server-only";
import type { AutoProductionPreview, AutoProductionRun } from "./types";

const localPathPattern = /(?:\/Users|\/private|\/tmp|[A-Z]:\\)[^\s"']+/g;
const secretPattern = /\b(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{12,})\b/gi;

export function publicAutoProductionError(error: unknown, fallback: string) {
  return (error instanceof Error ? error.message : fallback)
    .replace(localPathPattern, "로컬 파일")
    .replace(secretPattern, "[비공개 인증정보]")
    .slice(0, 600);
}

export function toPublicAutoProductionRun(run: AutoProductionRun): AutoProductionRun {
  const serialized = JSON.stringify(run)
    .replace(localPathPattern, "로컬 파일")
    .replace(secretPattern, "[비공개 인증정보]");
  return JSON.parse(serialized) as AutoProductionRun;
}

function publicImagePath(value: string | undefined) {
  if (!value) return "";
  localPathPattern.lastIndex = 0;
  const local = localPathPattern.test(value);
  localPathPattern.lastIndex = 0;
  return /^(?:https?:\/\/|\/[^/])/i.test(value) && !local ? value : "";
}

export function toPublicAutoProductionPreview(preview: AutoProductionPreview): AutoProductionPreview {
  const safe: AutoProductionPreview = {
    ...preview,
    candidates: preview.candidates.map((candidate) => ({
      ...candidate,
      verifiedEvidence: candidate.verifiedEvidence.slice(0, 8),
      recommendedHookDirections: candidate.recommendedHookDirections.slice(0, 8),
      productInfo: {
        productName: candidate.productInfo.productName,
        category: candidate.productInfo.category,
        price: candidate.productInfo.price,
        originalPrice: candidate.productInfo.originalPrice,
        discountInfo: candidate.productInfo.discountInfo,
        advertiserName: candidate.productInfo.advertiserName,
        brandName: candidate.productInfo.brandName,
        mainBenefit: candidate.productInfo.mainBenefit,
        targetCustomer: candidate.productInfo.targetCustomer,
        landingUrl: candidate.productInfo.landingUrl,
        productImagePath: publicImagePath(candidate.productInfo.productImagePath),
        productImagePaths: (candidate.productInfo.productImagePaths || []).map(publicImagePath).filter(Boolean).slice(0, 8),
        backgroundImagePath: "",
        extractedMainImage: publicImagePath(candidate.productInfo.extractedMainImage),
        extractedGalleryImages: (candidate.productInfo.extractedGalleryImages || []).map(publicImagePath).filter(Boolean).slice(0, 8),
        verifiedBenefits: (candidate.productInfo.verifiedBenefits || []).slice(0, 12),
        sourceImageCandidates: [],
      },
    })),
  };
  return JSON.parse(JSON.stringify(safe).replace(localPathPattern, "로컬 파일").replace(secretPattern, "[비공개 인증정보]")) as AutoProductionPreview;
}
