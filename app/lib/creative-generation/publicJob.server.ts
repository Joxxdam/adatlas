import "server-only";
import type { GenerationJob, GenerationJobSummary } from "./types";
import { executionResults } from "./jobRunnerPolicy";
import { nativeResultImageUrl } from "./nativeCreativeStorage.server";

const localPathPattern = /(?:\/Users|\/private|\/tmp|[A-Z]:\\)[^\s"']+/g;
const secretPattern = /\b(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{12,})\b/gi;

export function toPublicGenerationError(error: unknown, fallback: string) {
  return (error instanceof Error ? error.message : fallback)
    .replace(localPathPattern, "로컬 파일")
    .replace(secretPattern, "[비공개 인증정보]")
    .slice(0, 600);
}

export function toPublicGenerationJob(job: GenerationJob): GenerationJob {
  const safeWebPath = (value: string | undefined) => {
    const text = String(value || "").trim();
    if (!text || localPathPattern.test(text) || /(?:^|\/)\.data\//.test(text)) return "";
    localPathPattern.lastIndex = 0;
    return /^(?:https?:\/\/|\/)/.test(text) ? text : "";
  };
  const product = job.productTruth.product;
  const publicProduct = {
    productName: product.productName,
    category: product.category,
    price: product.price,
    originalPrice: product.originalPrice,
    oldPrice: product.oldPrice,
    advertiserName: product.advertiserName,
    brandName: product.brandName,
    discountInfo: product.discountInfo,
    mainBenefit: product.mainBenefit,
    targetCustomer: product.targetCustomer,
    landingUrl: product.landingUrl,
    productImagePath: safeWebPath(product.productImagePath),
    secondaryProductImagePath: safeWebPath(product.secondaryProductImagePath),
    productImagePaths: (product.productImagePaths || []).map(safeWebPath).filter(Boolean),
    backgroundImagePath: "",
    extractedMainImage: safeWebPath(product.extractedMainImage),
    extractedGalleryImages: (product.extractedGalleryImages || []).map(safeWebPath).filter(Boolean),
    productSubCategory: product.productSubCategory,
    detectedProductType: product.detectedProductType,
    targetAgeGroups: product.targetAgeGroups,
    productColors: product.productColors,
    brandColors: product.brandColors,
    ingredients: product.ingredients,
    verifiedBenefits: product.verifiedBenefits,
    packageType: product.packageType,
    imageType: product.imageType,
    modelIncluded: product.modelIncluded,
  };
  const publicTruth = {
    productId: job.productTruth.productId,
    product: publicProduct,
    facts: job.productTruth.facts
      .filter((fact) => fact.usableInCopy && fact.verification !== "unverified")
      .map((fact) => ({
        id: fact.id,
        key: "public-evidence",
        label: fact.label,
        value: fact.value,
        verification: fact.verification,
        source: "derived" as const,
        usableInCopy: true,
        numericTokens: [],
        evidenceType: fact.evidenceType,
      })),
    verifiedClaims: [],
    unverifiedClaims: [],
    allowedNumericTokens: [],
    blockedClaimPatterns: [],
    imagePaths: job.productTruth.imagePaths.map(safeWebPath).filter(Boolean),
    imageAssets: job.productTruth.imageAssets.map((asset) => ({ ...asset, path: safeWebPath(asset.path), reason: "상품 참조 이미지" })).filter((asset) => asset.path),
    referenceImages: job.productTruth.referenceImages.map((asset) => ({ ...asset, path: safeWebPath(asset.path), reason: "상품 참조 이미지" })).filter((asset) => asset.path),
    confirmedProductImage: job.productTruth.confirmedProductImage && safeWebPath(job.productTruth.confirmedProductImage.path)
      ? { ...job.productTruth.confirmedProductImage, path: safeWebPath(job.productTruth.confirmedProductImage.path), reason: "제작 기준 상품" }
      : undefined,
    completeness: job.productTruth.completeness,
    createdAt: job.productTruth.createdAt,
  };
  const publicJob = {
    ...job,
    paidApiAuthorization: undefined,
    adCopy: job.adCopy ? {
      id: job.adCopy.id,
      jobId: job.adCopy.jobId,
      advertiserId: job.adCopy.advertiserId,
      productId: job.adCopy.productId,
      creativeId: job.adCopy.creativeId,
      representativeResultId: job.adCopy.representativeResultId,
      basedOnHookId: job.adCopy.basedOnHookId,
      basedOnCreativeBriefId: job.adCopy.basedOnCreativeBriefId,
      primaryText: job.adCopy.status === "needs-review" ? undefined : job.adCopy.primaryText,
      assetCode: job.adCopy.assetCode,
      adName: job.adCopy.adName,
      utm: job.adCopy.utm,
      verifiedFacts: [],
      languageTraits: [],
      generatedAt: job.adCopy.generatedAt,
      updatedAt: job.adCopy.updatedAt,
      status: job.adCopy.status,
      revision: job.adCopy.revision,
      promptVersion: "",
      sourceFingerprint: "",
      approvedAt: job.adCopy.approvedAt,
    } : undefined,
    codexThreadId: undefined,
    productTruth: publicTruth,
    productReferenceProfile: job.productReferenceProfile
      ? {
          id: job.productReferenceProfile.id,
          productName: job.productReferenceProfile.productName,
          brandName: job.productReferenceProfile.brandName,
          category: job.productReferenceProfile.category,
          immutableFacts: {},
          visualIdentity: { silhouette: "", proportions: "", surfaceTexture: "", signatureDetails: [], mustPreserve: [], mustNotGenerate: [] },
          verifiedClaims: [],
          prohibitedClaims: [],
          referenceImages: job.productReferenceProfile.referenceImages.map((image) => ({
            id: image.id,
            url: safeWebPath(image.url),
            role: image.role,
            importance: image.importance,
            usableForGeneration: image.usableForGeneration,
            description: "상품 참조 이미지",
          })).filter((image) => image.url),
          referenceSufficiency: job.productReferenceProfile.referenceSufficiency,
          createdAt: job.productReferenceProfile.createdAt,
        }
      : undefined,
    masterScene: undefined,
    errors: [],
    recoveryLog: undefined,
    visualDiversityMatrix: undefined,
    groupValidation: job.groupValidation
      ? {
          ...job.groupValidation,
          duplicatePairs: job.groupValidation.duplicatePairs.map((pair) => ({ ...pair, reason: "유사 장면 감지" })),
          failures: [],
        }
      : undefined,
    creativePlan: {
      ...job.creativePlan,
      productTruth: publicTruth,
      brandProfile: {
        ...job.creativePlan.brandProfile,
        aliases: [],
        domains: [],
        categories: [],
        brandKeywords: [],
        toneOfVoice: [],
        preferredHookTypes: [],
        allowedClaimPatterns: [],
        blacklistedClaims: [],
        preferredSceneTypes: [],
        preferredBlueprints: [],
        logoAssets: [],
      },
      candidateHypotheses: undefined,
      selectedHypotheses: undefined,
      productInsightProfile: undefined,
      adBrief: undefined,
      experimentContext: undefined,
      copyGeneration: { ...job.creativePlan.copyGeneration, warnings: [] },
    },
    results: job.results.map((result) => ({
      ...result,
      scenePlan: {
        ...result.scenePlan,
        prompt: undefined,
        negativePrompt: undefined,
        sceneAsset: { ...result.scenePlan.sceneAsset, file: "" },
      },
      creativeDesign: undefined,
      masterScene: undefined,
      renderPlan: undefined,
      autoRepairs: [],
      qa: result.qa
        ? { ...result.qa, findings: [], autoRepairs: [] }
        : undefined,
      contentNoteCompliance: result.contentNoteCompliance
        ? { ...result.contentNoteCompliance, appliedNoteIds: [], requiredMissing: [], prohibitedFound: [], repairs: [] }
        : undefined,
      error: result.error ? "광고 생성 또는 품질 검수 결과를 확인해 주세요." : undefined,
      imagePath: result.nativeCreative?.finalPath ? nativeResultImageUrl(job.id, result.id) : result.imagePath,
      nativeCreative: result.nativeCreative
        ? {
            ...result.nativeCreative,
            originalPath: undefined,
            revisionPaths: [],
            finalPath: undefined,
            validation: result.nativeCreative.validation
              ? {
                  ...result.nativeCreative.validation,
                  observedKoreanText: [],
                  failures: [],
                }
              : undefined,
          }
        : undefined,
    })),
  };
  const serialized = JSON.stringify(publicJob).replace(localPathPattern, "로컬 파일").replace(secretPattern, "[비공개 인증정보]");
  return JSON.parse(serialized) as GenerationJob;
}

export function toGenerationJobSummary(job: GenerationJob, runnerActive: boolean): GenerationJobSummary {
  const publicJob = toPublicGenerationJob(job);
  const scopedResults = executionResults(publicJob);
  const completedStatuses = new Set(["success", "failed", "korean-review", "product-review", "quality-review", "group-review", "approved", "excluded"]);
  const failedStatuses = new Set(["failed", "korean-review", "product-review", "quality-review", "group-review"]);
  return {
    jobId: job.id,
    advertiserId: job.advertiserId,
    advertiserName: job.advertiserName,
    productId: job.productTruth.productId,
    productName: job.productTruth.product.productName,
    productUrl: job.productTruth.product.landingUrl,
    totalCount: scopedResults.length,
    completedCount: scopedResults.filter((result) => completedStatuses.has(result.status)).length,
    successCount: scopedResults.filter((result) => result.status === "success" || result.status === "approved").length,
    failedCount: scopedResults.filter((result) => failedStatuses.has(result.status)).length,
    currentHookCode: scopedResults.find((result) => result.status === "running")?.hookPlan.hookCode,
    status: job.status,
    runnerActive,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    completedResults: scopedResults.filter((result) => completedStatuses.has(result.status)),
    failedResults: scopedResults.filter((result) => failedStatuses.has(result.status)),
  };
}
