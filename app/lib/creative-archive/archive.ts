import type { CreativeAsset } from "../creative-assets/types";
import type { GenerationJob, GenerationResult } from "../creative-generation/types";
import type { CreativeArchiveEntry, CreativeArchiveMetadata } from "./types";

const archivedResultStatuses = new Set(["success", "approved", "korean-review", "product-review", "quality-review", "group-review"]);

function publicImagePath(value: string | undefined) {
  const text = String(value || "").trim();
  return /^(?:https?:\/\/|\/)/.test(text) && !/(?:^|\/)\.data\//.test(text) ? text : "";
}

function deliveryBrandingSummary(value: GenerationResult["deliveryBranding"] | CreativeArchiveMetadata["deliveryBranding"]) {
  return value ? { logoId: value.logoId, aiDisclosure: value.aiDisclosure, updatedAt: value.updatedAt } : undefined;
}

function metadataFor(id: string, metadata: Record<string, CreativeArchiveMetadata>): Pick<CreativeArchiveEntry, "savedAsReference" | "tags" | "note"> {
  return {
    savedAsReference: metadata[id]?.savedAsReference || false,
    tags: metadata[id]?.tags || [],
    note: metadata[id]?.note || "",
  };
}

function deletedFromArchive(id: string, metadata: Record<string, CreativeArchiveMetadata>) {
  return Boolean(metadata[id]?.deletedAt);
}

function resultKey(jobId: string, resultId: string) {
  return `${jobId}:${resultId}`;
}

function registeredResultContext(jobs: GenerationJob[]) {
  const byAssetId = new Map<string, { job: GenerationJob; result: GenerationResult }>();
  const byAssetCode = new Map<string, { job: GenerationJob; result: GenerationResult }>();
  const byImagePath = new Map<string, { job: GenerationJob; result: GenerationResult }>();
  for (const job of jobs) {
    for (const result of job.results) {
      if (result.creativeAsset?.id) byAssetId.set(result.creativeAsset.id, { job, result });
      if (result.creativeAsset?.assetCode) byAssetCode.set(result.creativeAsset.assetCode, { job, result });
      if (result.imagePath) byImagePath.set(result.imagePath, { job, result });
    }
  }
  return { byAssetId, byAssetCode, byImagePath };
}

function resultUrls(job: GenerationJob, result: GenerationResult) {
  const base = `/api/creative-generation/jobs/${encodeURIComponent(job.id)}/results/${encodeURIComponent(result.id)}`;
  const nativeImage = result.nativeCreative?.finalPath ? `${base}/image` : "";
  const directImage = publicImagePath(result.imagePath);
  const version = result.deliveryBranding?.updatedAt ? `?branding=${encodeURIComponent(result.deliveryBranding.updatedAt)}` : "";
  return {
    imageUrl: nativeImage ? `${nativeImage}${version}` : directImage,
    downloadUrl: result.nativeCreative?.finalPath ? `${base}/download${version}` : directImage,
    resultUrl: `/create-product?view=results&jobId=${encodeURIComponent(job.id)}#creative-results`,
  };
}

export function buildCreativeArchiveEntries(input: { assets: CreativeAsset[]; jobs: GenerationJob[]; metadata?: Record<string, CreativeArchiveMetadata> }) {
  const metadata = input.metadata || {};
  const contexts = registeredResultContext(input.jobs);
  const entries: CreativeArchiveEntry[] = [];
  const registeredAssetIds = new Set<string>();
  const registeredCodes = new Set<string>();
  const registeredPaths = new Set<string>();

  for (const asset of input.assets) {
    const id = `asset:${asset.id}`;
    const context = contexts.byAssetId.get(asset.id) || contexts.byAssetCode.get(asset.assetCode) || contexts.byImagePath.get(asset.generatedImageUrl);
    const product = context?.job.productTruth.product;
    registeredAssetIds.add(asset.id);
    registeredCodes.add(asset.assetCode);
    registeredPaths.add(asset.generatedImageUrl);
    if (deletedFromArchive(id, metadata)) continue;
    const contextUrls = context ? resultUrls(context.job, context.result) : null;
    const storedBranding = metadata[id]?.deliveryBranding;
    const archiveImageBase = `/api/creative-archive/${encodeURIComponent(id)}/image`;
    const archiveBrandingVersion = storedBranding ? `?branding=${encodeURIComponent(storedBranding.updatedAt)}` : "";
    const contextHasNativeImage = Boolean(context?.result.nativeCreative?.finalPath);
    const imageUrl = contextHasNativeImage ? contextUrls?.imageUrl || asset.generatedImageUrl : storedBranding ? `${archiveImageBase}${archiveBrandingVersion}` : contextUrls?.imageUrl || asset.generatedImageUrl;
    const downloadUrl = contextHasNativeImage ? contextUrls?.downloadUrl || asset.generatedImageUrl : storedBranding ? `${archiveImageBase}${archiveBrandingVersion}&download=1` : contextUrls?.downloadUrl || asset.generatedImageUrl;
    const activeBranding = contextHasNativeImage ? context?.result.deliveryBranding : storedBranding;
    entries.push({
      id,
      source: "creative-asset",
      assetCode: asset.assetCode,
      advertiserId: asset.advertiserId || context?.job.advertiserId,
      advertiserName: context?.job.advertiserName || product?.advertiserName || asset.brandName || "광고주 미지정",
      brandName: asset.brandName || product?.brandName || "브랜드 미지정",
      productId: asset.productId || context?.job.productTruth.productId,
      productName: asset.productName,
      category: asset.category || product?.category || "기타",
      hookCode: asset.hookVariantCode || asset.hookCode,
      hookType: asset.hookType,
      headline: asset.headline || asset.mainMessage || "후킹 문구 미기록",
      subCopy: asset.subCopy || asset.benefitCopy || "",
      mainMessage: asset.mainMessage || "",
      visualDirection: asset.visualDirection || "",
      imageUrl,
      downloadUrl,
      fileName: asset.fileName,
      status: asset.status,
      qaScore: context?.result.qa?.score,
      jobId: context?.job.id,
      resultId: context?.result.id,
      resultUrl: context ? `/create-product?view=results&jobId=${encodeURIComponent(context.job.id)}#creative-results` : undefined,
      landingUrl: product?.landingUrl,
      utmContent: asset.utmContent,
      recommendedAdName: asset.recommendedAdName,
      templateId: asset.templateId || context?.result.hookPlan.performanceTemplateId,
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
      brandingEligible: Boolean(context?.result.nativeCreative?.finalPath || publicImagePath(asset.generatedImageUrl)),
      deliveryBranding: deliveryBrandingSummary(activeBranding),
      ...metadataFor(id, metadata),
    });
  }

  const seenResults = new Set<string>();
  for (const job of input.jobs) {
    const product = job.productTruth.product;
    for (const result of job.results) {
      const resultIdentity = resultKey(job.id, result.id);
      if (seenResults.has(resultIdentity) || !archivedResultStatuses.has(result.status)) continue;
      seenResults.add(resultIdentity);
      const urls = resultUrls(job, result);
      if (!urls.imageUrl) continue;
      if ((result.creativeAsset?.id && registeredAssetIds.has(result.creativeAsset.id)) || (result.creativeAsset?.assetCode && registeredCodes.has(result.creativeAsset.assetCode)) || (result.imagePath && registeredPaths.has(result.imagePath))) continue;

      const id = `result:${job.id}:${result.id}`;
      if (deletedFromArchive(id, metadata)) continue;
      const storedBranding = metadata[id]?.deliveryBranding;
      const archiveImageBase = `/api/creative-archive/${encodeURIComponent(id)}/image`;
      const archiveBrandingVersion = storedBranding ? `?branding=${encodeURIComponent(storedBranding.updatedAt)}` : "";
      const hasNativeImage = Boolean(result.nativeCreative?.finalPath);
      entries.push({
        id,
        source: "generation-result",
        assetCode: result.creativeAsset?.assetCode,
        advertiserId: job.advertiserId || product.creativeContext?.advertiserId,
        advertiserName: job.advertiserName || product.advertiserName || product.brandName || "광고주 미지정",
        brandName: product.brandName || product.advertiserName || "브랜드 미지정",
        productId: job.productTruth.productId,
        productName: product.productName,
        category: product.category || "기타",
        hookCode: result.hookPlan.hookCode || `H${String(result.order).padStart(2, "0")}`,
        hookType: result.hookPlan.hookType,
        headline: result.hookPlan.headline || result.hookPlan.mainMessage || result.hookPlan.title,
        subCopy: result.hookPlan.body || result.hookPlan.proof || "",
        mainMessage: result.hookPlan.mainMessage || result.hookPlan.hypothesis || "",
        visualDirection: result.hookPlan.visualDirection || result.hookPlan.sceneIntent || "",
        imageUrl: !hasNativeImage && storedBranding ? `${archiveImageBase}${archiveBrandingVersion}` : urls.imageUrl,
        downloadUrl: !hasNativeImage && storedBranding ? `${archiveImageBase}${archiveBrandingVersion}&download=1` : urls.downloadUrl,
        fileName: result.downloadName || `${job.productTruth.productId}-${result.hookPlan.hookCode || result.order}.jpg`,
        status: result.status,
        qaScore: result.qa?.score,
        jobId: job.id,
        resultId: result.id,
        resultUrl: urls.resultUrl,
        landingUrl: product.landingUrl,
        utmContent: result.creativeAsset?.utmContent,
        recommendedAdName: result.creativeAsset?.recommendedAdName,
        templateId: result.hookPlan.performanceTemplateId,
        createdAt: result.completedAt || result.startedAt || job.createdAt,
        updatedAt: result.completedAt || job.updatedAt,
        brandingEligible: Boolean(result.nativeCreative?.finalPath || publicImagePath(result.imagePath)),
        deliveryBranding: deliveryBrandingSummary(hasNativeImage ? result.deliveryBranding : storedBranding),
        ...metadataFor(id, metadata),
      });
    }
  }

  return entries.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
