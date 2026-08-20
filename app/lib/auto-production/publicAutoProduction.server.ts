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
  const safe: AutoProductionRun = {
    ...run,
    tasks: run.tasks.map((task) => ({
      ...task,
      candidate: publicCandidate(task.candidate),
      adCopy: task.adCopy ? {
        ...task.adCopy,
        primaryText: task.adCopy.status === "needs-review" ? undefined : task.adCopy.primaryText,
        verifiedFacts: [],
        languageTraits: [],
        promptVersion: "",
        sourceFingerprint: "",
        qa: undefined,
        approvalReason: undefined,
        performanceData: undefined,
      } : undefined,
    })),
  };
  const serialized = JSON.stringify(safe)
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

function publicCandidate(candidate: AutoProductionRun["tasks"][number]["candidate"]) {
  const safeImages = (candidate.productInfo.productImagePaths || []).map(publicImagePath).filter(Boolean).slice(0, 5);
  return {
    ...candidate,
    imageUrl: publicImagePath(candidate.imageUrl),
    verifiedEvidence: [],
    recommendedHookDirections: candidate.recommendedHookDirections.slice(0, 8),
    selectionScore: 0,
    currentSales: null,
    previousSales: null,
    orders: null,
    revenue: null,
    impressions: null,
    views: null,
    conversionRate: null,
    reviewCount: null,
    rating: null,
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
      productImagePath: safeImages[0] || "",
      productImagePaths: safeImages,
      backgroundImagePath: "",
      extractedMainImage: safeImages[0] || "",
      extractedGalleryImages: safeImages.slice(1),
      verifiedBenefits: (candidate.productInfo.verifiedBenefits || []).slice(0, 12),
      ingredients: (candidate.productInfo.ingredients || []).slice(0, 12),
      sourceImageCandidates: [],
      creativeContext: candidate.productInfo.creativeContext ? {
        advertiserId: candidate.productInfo.creativeContext.advertiserId,
        productId: candidate.productInfo.creativeContext.productId,
        recommendedHookTypes: (candidate.productInfo.creativeContext.recommendedHookTypes || []).slice(0, 8),
        recommendedMessageAngles: (candidate.productInfo.creativeContext.recommendedMessageAngles || []).slice(0, 8),
        dataEvidence: [],
        dataSources: (candidate.productInfo.creativeContext.dataSources || []).slice(0, 8),
        analysisSource: candidate.productInfo.creativeContext.analysisSource,
      } : undefined,
    },
  };
}

export function toPublicAutoProductionPreview(preview: AutoProductionPreview): AutoProductionPreview {
  const safe: AutoProductionPreview = {
    ...preview,
    candidates: preview.candidates.map(publicCandidate),
  };
  return JSON.parse(JSON.stringify(safe).replace(localPathPattern, "로컬 파일").replace(secretPattern, "[비공개 인증정보]")) as AutoProductionPreview;
}
