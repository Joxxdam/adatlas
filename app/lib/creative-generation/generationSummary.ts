import { hookMessageCodes, type GenerationJob, type GenerationResult } from "./types.ts";

function summarizedResult(job: GenerationJob, result: GenerationResult) {
  const factMap = new Map(job.productTruth.facts.map((fact) => [fact.id, fact]));
  return {
    order: result.order,
    hookCode: result.hookPlan.hookCode,
    hookType: result.hookPlan.hookType,
    hypothesis: result.hookPlan.hypothesis,
    confidence: result.hookPlan.confidence,
    mainHook: result.hookPlan.headline,
    subCopy: result.hookPlan.body,
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
        }
      : null,
  };
}

export function buildGenerationSummary(job: GenerationJob) {
  const presentCodes = new Set(job.results.map((result) => result.hookPlan.hookCode));
  const successCount = job.results.filter((result) => result.status === "success").length;
  const failedCount = job.results.filter((result) => result.status === "failed").length;
  return {
    schemaVersion: "hook-experiment-summary-v1",
    generatedAt: new Date().toISOString(),
    jobId: job.id,
    testCode: job.creativePlan.testCode,
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
      backgroundAssetId: job.creativePlan.masterDesign.backgroundAssetId,
      backgroundPath: job.results[0]?.scenePlan.sceneAsset.file || null,
      productComposition: job.creativePlan.masterDesign.productComposition,
      palette: job.creativePlan.masterDesign.palette,
      typography: job.creativePlan.masterDesign.typography,
      fixedFacts: job.creativePlan.masterDesign.fixedFacts,
    },
    copyGeneration: job.creativePlan.copyGeneration,
    expectedHookCodes: hookMessageCodes,
    missingHookCodes: hookMessageCodes.filter((code) => !presentCodes.has(code)),
    counts: {
      expected: 8,
      planned: job.results.length,
      success: successCount,
      failed: failedCount,
      pending: job.results.length - successCount - failedCount,
    },
    results: job.results.map((result) => summarizedResult(job, result)),
  };
}

