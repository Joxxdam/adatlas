import type { GenerationJob, GenerationResult } from "../creative-generation/types.ts";
import { creativeAssetRepository } from "./repository.server.ts";
import { hookExperimentRepository } from "../hook-experiments/repository.server.ts";

export async function createAssetFromGenerationResult(input: {
  job: GenerationJob;
  result: GenerationResult;
  generatedImageUrl: string;
  generationRequestKey: string;
  copy: {
    headline: string;
    body: string;
    proof: string;
    offer: string;
  };
}) {
  const product = input.job.productTruth.product;
  const context = product.creativeContext;
  const experiment = input.job.creativePlan.experimentContext;
  const created = await creativeAssetRepository.create({
    brandId: input.job.creativePlan.brandProfile.id,
    brandName:
      input.job.creativePlan.brandProfile.name || product.brandName || product.advertiserName,
    productId: input.job.productTruth.productId,
    productName: product.productName,
    originalHostProductNo: experiment?.originalHostProductNo,
    advertiserId: context?.advertiserId,
    opportunityId: context?.opportunityId,
    analysisRunId: context?.analysisRunId,
    opportunityType: context?.opportunityType,
    recommendedHookType: context?.recommendedHookTypes?.[0],
    appliedContentNoteIds: context?.appliedContentNotes?.map((note) => note.id),
    reviewInsightIds: context?.reviewInsightIds,
    category: product.category,
    hookType: input.result.hookPlan.hookType,
    mainMessage: input.result.hookPlan.mainMessage,
    visualDirection: input.result.hookPlan.visualDirection,
    generationRound: experiment?.generationRound,
    variant: input.result.hookPlan.experimentVariant,
    experimentId: experiment?.experimentId,
    testCode: experiment ? undefined : input.job.creativePlan.testCode,
    hookVariantCode: experiment ? undefined : input.result.hookPlan.hookCode,
    advertisingHypothesis: `${input.result.hookPlan.title} · ${input.result.hookPlan.sceneIntent}`,
    headline: input.copy.headline,
    subCopy: input.copy.body,
    benefitCopy: [input.copy.proof, input.copy.offer].filter(Boolean).join(" · "),
    templateId: input.result.blueprintId,
    layoutType: input.result.blueprintId,
    backgroundType: input.result.scenePlan.sceneAsset.sourceType,
    backgroundId: input.result.scenePlan.sceneAsset.id,
    sourceProductImage: input.job.productTruth.imagePaths[0],
    generatedImageUrl: input.generatedImageUrl,
    objective: experiment ? undefined : input.job.creativePlan.adBrief?.adObjective || "purchase",
    parentAssetCode: input.result.creativeAsset?.assetCode,
    generationRequestKey: input.generationRequestKey,
  });
  if (experiment) {
    await hookExperimentRepository.attachAsset({
      experimentId: experiment.experimentId,
      generationResultId: input.result.id,
      assetId: created.asset.id,
      assetCode: created.asset.assetCode,
    });
  }
  return created;
}
