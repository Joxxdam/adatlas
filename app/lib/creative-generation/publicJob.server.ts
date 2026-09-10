import "server-only";
import type { GenerationJob, GenerationJobSummary, ManualGenerationQueueInfo } from "./types";
import { executionResults, failedGenerationResultStatuses, terminalGenerationResultStatuses } from "./jobRunnerPolicy";
import { nativeResultImageUrl } from "./nativeCreativeStorage.server";
import { DEFAULT_CODEX_GENERATION_PIPELINE } from "./codexDirectTest";

// Windows 경로의 `C:/` 형태를 찾는 패턴이 `https://`의 `s:/`까지 잡으면
// 정상 상품 URL 전체가 "로컬 파일"로 치환된다. 절대경로 시작 또는 명확한
// 문자열 경계에서만 로컬 경로로 판정해 웹 URL은 그대로 공개한다.
const localPathPattern = /(^|[\s"'(=,:]|file:\/\/)((?:\/(?:Users|home|private|tmp|var))(?:\/[^\s"']*)?|[A-Z]:[\\/][^\s"']*)/gim;
const localPathTestPattern = /^(?:(?:file:\/\/)?\/(?:Users|home|private|tmp|var)(?:[\\/]|$)|[A-Z]:[\\/])/i;
const secretPattern = /\b(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{12,})\b/gi;

function redactLocalPaths(value: string) {
  return value.replace(localPathPattern, (_match, prefix: string) => `${prefix}로컬 파일`);
}

export function toPublicGenerationError(error: unknown, fallback: string) {
  return redactLocalPaths(error instanceof Error ? error.message : fallback).replace(secretPattern, "[비공개 인증정보]").slice(0, 600);
}

export function toPublicGenerationJob(job: GenerationJob): GenerationJob {
  const safeWebPath = (value: string | undefined) => {
    const text = String(value || "").trim();
    if (!text || localPathTestPattern.test(text) || /(?:^|\/)\.data\//.test(text)) return "";
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
    confirmedProductImagePaths: (product.confirmedProductImagePaths || []).map(safeWebPath).filter(Boolean),
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
    confirmedProductImage:
      job.productTruth.confirmedProductImage && safeWebPath(job.productTruth.confirmedProductImage.path)
        ? {
            ...job.productTruth.confirmedProductImage,
            path: safeWebPath(job.productTruth.confirmedProductImage.path),
            reason: "제작 기준 상품",
          }
        : undefined,
    completeness: job.productTruth.completeness,
    createdAt: job.productTruth.createdAt,
  };
  const publicJob = {
    ...job,
    requestedBy: undefined,
    codexDirectTest: job.codexDirectTest
      ? {
          prompt: job.codexDirectTest.prompt,
          productImagePath: safeWebPath(job.codexDirectTest.productImagePath),
          supportingImagePath: safeWebPath(job.codexDirectTest.supportingImagePath) || undefined,
          packagingImagePath: safeWebPath(job.codexDirectTest.packagingImagePath) || undefined,
          siteVisualImagePaths: (job.codexDirectTest.siteVisualImagePaths || []).map(safeWebPath).filter(Boolean),
          additionalInstructions: job.codexDirectTest.additionalInstructions,
          serviceCreativeMode: job.codexDirectTest.serviceCreativeMode,
          serviceStoryWorkflowVersion: job.codexDirectTest.serviceStoryWorkflowVersion,
        }
      : undefined,
    paidApiAuthorization: undefined,
    adCopy: job.adCopy
      ? {
          id: job.adCopy.id,
          jobId: job.adCopy.jobId,
          advertiserId: job.adCopy.advertiserId,
          productId: job.adCopy.productId,
          creativeId: job.adCopy.creativeId,
          representativeResultId: job.adCopy.representativeResultId,
          basedOnHookId: job.adCopy.basedOnHookId,
          basedOnCreativeBriefId: job.adCopy.basedOnCreativeBriefId,
          primaryText: job.adCopy.status === "needs-review" ? undefined : job.adCopy.primaryText,
          adTitle: job.adCopy.status === "needs-review" ? undefined : job.adCopy.adTitle,
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
        }
      : undefined,
    productTruth: publicTruth,
    productReferenceProfile: job.productReferenceProfile
      ? {
          id: job.productReferenceProfile.id,
          productName: job.productReferenceProfile.productName,
          brandName: job.productReferenceProfile.brandName,
          category: job.productReferenceProfile.category,
          immutableFacts: {},
          visualIdentity: {
            silhouette: "",
            proportions: "",
            surfaceTexture: "",
            signatureDetails: [],
            mustPreserve: [],
            mustNotGenerate: [],
          },
          verifiedClaims: [],
          prohibitedClaims: [],
          referenceImages: job.productReferenceProfile.referenceImages
            .map((image) => ({
              id: image.id,
              url: safeWebPath(image.url),
              role: image.role,
              importance: image.importance,
              usableForGeneration: image.usableForGeneration,
              description: "상품 참조 이미지",
            }))
            .filter((image) => image.url),
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
          duplicatePairs: job.groupValidation.duplicatePairs.map((pair) => ({
            ...pair,
            reason: "유사 장면 감지",
          })),
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
    results: job.results.map((result) => {
      const publicReferenceCopyPlan = result.referenceAdaptedCopyPlan
        ? {
            ...result.referenceAdaptedCopyPlan,
            referenceRawCopy: "",
            referenceRawLines: [],
          }
        : undefined;
      const publicNativeCreative = result.nativeCreative
        ? {
            ...result.nativeCreative,
            adReference: result.nativeCreative.adReference
              ? {
                  ...result.nativeCreative.adReference,
                  path: "",
                  nativeCopy: undefined,
                }
              : undefined,
            originalPath: undefined,
            revisionPaths: [],
            finalPath: undefined,
            provenance: undefined,
            validation: result.nativeCreative.validation
              ? {
                  ...result.nativeCreative.validation,
                  observedKoreanText: [],
                  failures: [],
                }
              : undefined,
          }
        : undefined;
      return {
        ...result,
        referenceAdaptedCopyPlan: publicReferenceCopyPlan,
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
        qa: result.qa ? { ...result.qa, findings: [], autoRepairs: [] } : undefined,
        contentNoteCompliance: result.contentNoteCompliance
          ? {
              ...result.contentNoteCompliance,
              appliedNoteIds: [],
              requiredMissing: [],
              prohibitedFound: [],
              repairs: [],
            }
          : undefined,
        error: result.error ? "광고 생성 또는 품질 검수 결과를 확인해 주세요." : undefined,
        imagePath: result.nativeCreative?.finalPath ? nativeResultImageUrl(job.id, result.id) : result.imagePath,
        deliveryBranding: result.deliveryBranding
          ? {
              logoId: result.deliveryBranding.logoId,
              aiDisclosure: result.deliveryBranding.aiDisclosure,
              updatedAt: result.deliveryBranding.updatedAt,
            }
          : undefined,
        nativeCreative: publicNativeCreative,
      };
    }),
  };
  const serialized = redactLocalPaths(JSON.stringify(publicJob)).replace(secretPattern, "[비공개 인증정보]");
  return JSON.parse(serialized) as GenerationJob;
}

export function toGenerationJobSummary(job: GenerationJob, runnerActive: boolean, manualQueue?: ManualGenerationQueueInfo): GenerationJobSummary {
  const scopedResults = executionResults(job);
  return {
    jobId: job.id,
    advertiserId: job.advertiserId,
    advertiserName: job.advertiserName,
    productId: job.productTruth.productId,
    productName: job.productTruth.product.productName,
    productUrl: job.productTruth.product.landingUrl,
    sourceType: job.sourceType || "manual",
    pipeline: job.pipeline,
    totalCount: scopedResults.length,
    completedCount: scopedResults.filter((result) => terminalGenerationResultStatuses.has(result.status)).length,
    generatedCount: scopedResults.filter((result) => Boolean(result.imagePath)).length,
    successCount: scopedResults.filter((result) => result.status === "success" || result.status === "approved").length,
    failedCount: scopedResults.filter((result) => failedGenerationResultStatuses.has(result.status)).length,
    currentHookCode: (() => {
      const running = scopedResults.find((result) => result.status === "running");
      return running ? (job.pipeline === DEFAULT_CODEX_GENERATION_PIPELINE || job.copyPlanMode === "reference-adapted" ? `소재 ${String(running.order).padStart(2, "0")}` : running.hookPlan.hookCode) : undefined;
    })(),
    status: job.status,
    runnerActive,
    manualQueue,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
  };
}
