import { hookMessageCodes, type GenerationJob, type GenerationResult } from "./types.ts";

function summarizedResult(job: GenerationJob, result: GenerationResult) {
  const factMap = new Map(job.productTruth.facts.map((fact) => [fact.id, fact]));
  return {
    order: result.order,
    hookCode: result.hookPlan.hookCode,
    hookType: result.hookPlan.hookType,
    primaryTag: result.hookPlan.primaryTag || result.hookPlan.hookType,
    secondaryTags: result.hookPlan.secondaryTags || [],
    hypothesis: result.hookPlan.hypothesis,
    confidence: result.hookPlan.confidence,
    evidenceSummary: result.hookPlan.evidenceSummary || "",
    specificityScore: result.hookPlan.specificityScore ?? null,
    naturalnessScore: result.hookPlan.naturalnessScore ?? null,
    validationStatus: result.hookPlan.validationStatus || "fallback",
    validationErrors: result.hookPlan.validationErrors || [],
    generationSource: result.hookPlan.generationSource || "fallback",
    repairCount: result.hookPlan.repairCount || 0,
    mainHook: result.hookPlan.headline,
    subCopy: result.hookPlan.body,
    customerReason: result.hookPlan.customerReason || "",
    selectionReason: result.hookPlan.selectionReason || "",
    score: result.hookPlan.score || null,
    creativeBrief: result.hookPlan.creativeBrief || null,
    creativeDesign: result.creativeDesign
      ? {
          id: result.creativeDesign.id,
          layoutFamily: result.creativeDesign.layoutFamily,
          categoryVariant: result.creativeDesign.categoryVariant,
          designFingerprint: result.creativeDesign.designFingerprint,
          backgroundAssetId: result.creativeDesign.backgroundAssetId,
        }
      : null,
    masterScene: result.masterScene
      ? {
          id: result.masterScene.id,
          generationMode: result.masterScene.generationMode,
          referenceImageIds: result.masterScene.referenceImageIds,
          productIdentityScore: result.masterScene.productIdentityScore,
          masterVisualDigest: result.masterScene.masterVisualDigest,
        }
      : null,
    facts: result.hookPlan.factIds.map((id) => factMap.get(id)).filter(Boolean),
    status: result.status,
    error: result.error || null,
    attempts: result.attempts,
    autoRepairs: result.autoRepairs || result.qa?.autoRepairs || [],
    asset: result.creativeAsset
      ? {
          assetCode: result.creativeAsset.assetCode,
          fileName: result.creativeAsset.fileName,
          recommendedAdName: result.creativeAsset.recommendedAdName,
          utmContent: result.creativeAsset.utmContent,
        }
      : null,
    output: result.imagePath || null,
    technicalQa: result.qa
      ? {
          passed: result.qa.technicalPassed,
          score: result.qa.technicalScore,
          width: result.qa.width,
          height: result.qa.height,
          format: result.qa.format,
          fileSizeBytes: result.qa.fileSizeBytes,
        }
      : null,
    creativeQa: result.qa
      ? {
          passed: result.qa.creativePassed,
          score: result.qa.creativeScore,
          productAreaRatio: result.qa.productAreaRatio,
          findings: result.qa.findings.filter(
            (finding) => !["technical", "text-overflow"].includes(finding.dimension)
          ),
          designLockVerified: result.qa.designLockVerified,
        }
      : null,
  };
}

export function buildGenerationSummary(job: GenerationJob) {
  const expectedCodes = hookMessageCodes;
  const presentCodes = new Set(job.results.map((result) => result.hookPlan.hookCode));
  const successCount = job.results.filter((result) => result.status === "success").length;
  const failedCount = job.results.filter((result) => result.status === "failed").length;
  return {
    schemaVersion: "hook-experiment-summary-v2",
    generatedAt: new Date().toISOString(),
    jobId: job.id,
    testCode: job.creativePlan.testCode,
    mode: job.creativePlan.mode || "exact-message-comparison",
    product: {
      id: job.productTruth.productId,
      name: job.productTruth.product.productName,
      category: job.productTruth.product.category,
      productImage: job.productTruth.confirmedProductImage || null,
      referenceImages: job.productTruth.referenceImages,
    },
    masterDesign: {
      id: job.creativePlan.masterDesign.id,
      layoutFamily: job.creativePlan.masterDesign.layoutFamily,
      categoryVariant: job.creativePlan.masterDesign.categoryVariant,
      designFingerprint: job.creativePlan.masterDesign.designFingerprint,
      backgroundAssetId: job.creativePlan.masterDesign.backgroundAssetId,
      backgroundPath: job.results[0]?.scenePlan.sceneAsset.file || null,
      productComposition: job.creativePlan.masterDesign.productComposition,
      palette: job.creativePlan.masterDesign.palette,
      typography: job.creativePlan.masterDesign.typography,
      fontPreset: job.creativePlan.masterDesign.fontPreset,
      overlay: job.creativePlan.masterDesign.overlay,
      fixedFacts: job.creativePlan.masterDesign.fixedFacts,
    },
    productReferenceProfile: job.productReferenceProfile
      ? {
          id: job.productReferenceProfile.id,
          referenceSufficiency: job.productReferenceProfile.referenceSufficiency,
          referenceImageIds: job.productReferenceProfile.referenceImages.map((image) => image.id),
        }
      : null,
    masterScene: job.masterScene
      ? {
          id: job.masterScene.id,
          designFingerprint: job.masterScene.sceneSpec.designFingerprint,
          generationMode: job.masterScene.generationMode,
          requestedGenerationMode: job.masterScene.requestedGenerationMode,
          referenceImageIds: job.masterScene.referenceImageIds,
          imageModel: job.masterScene.imageModel,
          generationPromptVersion: job.masterScene.generationPromptVersion,
          sceneQualityResult: job.masterScene.sceneQualityResult,
          productIdentityScore: job.masterScene.productIdentityScore,
          masterVisualDigest: job.masterScene.masterVisualDigest,
          reused: job.masterScene.reused,
          requiresProductReview: job.masterScene.requiresProductReview,
        }
      : null,
    copyGeneration: job.creativePlan.copyGeneration,
    productInsightProfile: job.creativePlan.productInsightProfile || null,
    candidateHypotheses: job.creativePlan.candidateHypotheses || [],
    selectedHypotheses: job.creativePlan.selectedHypotheses || [],
    expectedHookCodes: expectedCodes,
    missingHookCodes: expectedCodes.filter((code) => !presentCodes.has(code)),
    counts: {
      expected: expectedCodes.length,
      planned: job.results.length,
      success: successCount,
      failed: failedCount,
      pending: job.results.length - successCount - failedCount,
    },
    results: job.results.map((result) => summarizedResult(job, result)),
  };
}
