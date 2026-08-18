import { NextResponse } from "next/server";
import { creativeGenerationJobStore } from "../../../lib/creative-generation/jobStore.server";
import { buildCreativePlan, buildExplorationCreativePlan, createGenerationJob, planAiScenes } from "../../../lib/creative-generation/planner";
import { buildProductTruth } from "../../../lib/creative-generation/productTruth";
import {
  assertNativeProductReferenceReady,
  inspectProductTruthImages,
} from "../../../lib/creative-generation/productImages.server";
import { generateHookMessages } from "../../../lib/creative-generation/hookMessages.server";
import { analyzeProductReferences } from "../../../lib/creative-generation/referenceAnalyzer.server";
import type { CreateGenerationJobInput } from "../../../lib/creative-generation/types";
import { createCreativeGenerationProvider } from "../../../lib/creative-generation/providers/providerFactory.server";
import { resolveAdvertiserIdentity } from "../../../lib/creative-generation/advertiserIdentity";
import { buildVisualDiversityMatrix, validateVisualDiversityMatrix } from "../../../lib/creative-generation/visualDiversity";
import { getAdvertiserThread } from "../../../lib/creative-generation/codexRegistry.server";
import { writeNativeManifest } from "../../../lib/creative-generation/nativeCreativeStorage.server";
import { defaultAdBrief } from "../../../lib/mvp/adBrief";
import type { AdBrief } from "../../../lib/mvp/types";
import { matchCategoryProfile } from "../../../lib/creative-generation/profiles";
import { readCategoryHookPrior } from "../../../lib/creative-generation/hookLearning.server";
import { enqueueGenerationJob } from "../../../lib/creative-generation/jobRunner.server";
import { localAccessError, verifyLocalGenerationAccess } from "../../../lib/creative-generation/localGenerationAccess.server";
import { toPublicGenerationError, toPublicGenerationJob } from "../../../lib/creative-generation/publicJob.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const objectives = new Set<AdBrief["adObjective"]>(["purchase", "signup", "awareness", "retargeting"]);
const approaches = new Set<AdBrief["creativeIntensity"]>(["brand", "balanced", "performance"]);

function resolveAdBrief(value: Partial<AdBrief> | undefined): AdBrief {
  return {
    ...defaultAdBrief,
    ...value,
    adObjective: value?.adObjective && objectives.has(value.adObjective) ? value.adObjective : defaultAdBrief.adObjective,
    creativeIntensity: value?.creativeIntensity && approaches.has(value.creativeIntensity) ? value.creativeIntensity : defaultAdBrief.creativeIntensity,
    mandatoryInfo: Array.isArray(value?.mandatoryInfo) ? value.mandatoryInfo.slice(0, 20) : [],
    prohibitedClaims: Array.isArray(value?.prohibitedClaims) ? value.prohibitedClaims.slice(0, 20) : [],
  };
}

const internalStrategyText = /(?:T0\d|주력\s*상품|우승\s*소재|판매[·ㆍ,\s-]*노출[·ㆍ,\s-]*구매\s*근거|기존\s*우수\s*소재|광고\s*가설|성과\s*학습|USP[·ㆍ,\s-]*가격[·ㆍ,\s-]*랜딩\s*조건\s*점검|랜딩\s*(?:조건|페이지)\s*(?:점검|확인)|내부\s*(?:전략|점검|검토))/i;

function conciseVerifiedBenefit(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  const cue = normalized.match(
    /(?:쿨링감|보습감|사용감|세정력|흡수력|지속력|휴대성|식감|향|구성)(?:으로|로|이|가|은|는)?[^,.!?]{0,34}/u
  )?.[0];
  return (cue || normalized.split(/[,\n]/)[0] || normalized).trim();
}

function sanitizeProductForCreative(product: CreateGenerationJobInput["product"]) {
  const cleanList = (values?: string[]) =>
    (values || []).map((value) => value.trim()).filter((value) => value && !internalStrategyText.test(value));
  const verifiedBenefits = cleanList(product.verifiedBenefits);
  const ingredients = cleanList(product.ingredients);
  const mainBenefit = internalStrategyText.test(product.mainBenefit || "")
    ? conciseVerifiedBenefit(verifiedBenefits[0] || ingredients[0] || "")
    : product.mainBenefit;
  return {
    ...product,
    productName: product.productName.replace(/\s*\(\d+\)\s*$/, "").trim(),
    mainBenefit,
    targetCustomer: internalStrategyText.test(product.targetCustomer || "") ? "" : product.targetCustomer,
    verifiedBenefits,
    ingredients,
  };
}

function isAutomaticCutoutPath(value: string) {
  return /\/(?:processed-products|product-cutouts)\//i.test(value);
}

export async function POST(request: Request) {
  const started = Date.now();
  try {
    verifyLocalGenerationAccess(request);
    const body = (await request.json().catch(() => ({}))) as Partial<CreateGenerationJobInput>;
    if (!body.product?.productName?.trim()) {
      return NextResponse.json({ ok: false, error: "먼저 상품정보를 불러와 주세요." }, { status: 400 });
    }
    const engine = body.engine === "openai_api" ? "openai_api" : "codex_local";
    const imageProvider = createCreativeGenerationProvider(engine);
    const providerStatus = await imageProvider.status();
    if (!providerStatus.available) {
      return NextResponse.json(
        {
          ok: false,
          error: `${providerStatus.detail} 다른 엔진이나 기존 배경으로 자동 전환하지 않습니다.`,
          providerStatus,
        },
        { status: 503 }
      );
    }
    const product = sanitizeProductForCreative(body.product);
    const requestedProductImagePaths = Array.isArray(body.productImagePaths)
      ? body.productImagePaths.slice(0, 12)
      : [];
    const requestedSelectedImages = Array.isArray(body.selectedAdImages)
      ? body.selectedAdImages.slice(0, 12)
      : [];
    const allProductReferencePaths = Array.from(
      new Set([
        ...requestedSelectedImages,
        ...requestedProductImagePaths,
        product.extractedMainImage,
        ...(product.productImagePaths || []),
        product.productImagePath,
        ...(product.extractedGalleryImages || []),
      ].map((value) => String(value || "").trim()).filter(Boolean))
    );
    const originalProductReferencePaths = allProductReferencePaths.filter(
      (path) => !isAutomaticCutoutPath(path)
    );
    const productReferencePaths = (
      originalProductReferencePaths.length ? originalProductReferencePaths : allProductReferencePaths
    ).slice(0, 12);
    const rawTruth = buildProductTruth({
      product,
      // 이 화면에서 사용자가 고른 이미지는 광고 레퍼런스가 아니라 현재
      // 상품의 상세페이지 원본이다. AI 전체 광고의 제품·사용 맥락 참조로 쓴다.
      productImagePaths: productReferencePaths,
      selectedAdImages: [],
      imageAssets: body.imageAssets || [],
      source: body.source === "landing-page" ? "landing-page" : "user-input",
    });
    const truth = await inspectProductTruthImages(rawTruth);
    assertNativeProductReferenceReady(truth);
    const adBrief = resolveAdBrief(body.adBrief);
    const paidImageGenerationEnabled = engine === "openai_api";
    const configuredConcurrency = Math.max(
      1,
      Math.min(3, Math.floor(Number(process.env.ADATLAS_CREATIVE_CONCURRENCY || body.concurrency || 2) || 2))
    );
    // Native-final MVP always creates six independent product-specific hypotheses.
    const mode = "concept-exploration" as const;
    if (mode === "concept-exploration") {
      const experimentObjective = adBrief.adObjective === "awareness"
        ? "AWR"
        : adBrief.adObjective === "signup"
          ? "TRF"
          : "SLS";
      const categoryPrior = await readCategoryHookPrior({
        categoryId: matchCategoryProfile(truth.product).id,
        objective: experimentObjective,
      });
      const creativePlan = buildExplorationCreativePlan(truth, {
        logoPath: body.logoPath,
        adBrief,
        categoryPrior,
        testCode: body.testCode,
      });
      const scenes = planAiScenes(creativePlan, paidImageGenerationEnabled);
      const productReferenceProfile = await analyzeProductReferences(truth);
      const configuredRetries = Number(
        process.env.ADATLAS_IMAGE_MAX_RETRIES || process.env.ADATLAS_CREATIVE_RETRIES || "2"
      );
      const job = createGenerationJob({
        truth,
        creativePlan,
        scenes,
        concurrency: configuredConcurrency,
        retryLimit: configuredRetries,
        paidImageGenerationEnabled,
        productReferenceProfile,
        planningMs: Date.now() - started,
      });
      const advertiser = resolveAdvertiserIdentity(product);
      job.engine = engine;
      job.paidApiUsed = engine === "openai_api";
      job.advertiserId = advertiser.id;
      job.advertiserName = advertiser.name;
      job.codexThreadId = (await getAdvertiserThread(advertiser.id))?.threadId;
      job.visualDiversityMatrix = buildVisualDiversityMatrix(job.results);
      const diversity = validateVisualDiversityMatrix(job.visualDiversityMatrix);
      if (!diversity.valid) throw new Error(diversity.errors.join(" "));
      job.version = "generation-job-v6-ai-native-final";
      await creativeGenerationJobStore.create(job);
      await writeNativeManifest(job);
      enqueueGenerationJob(job.id);
      return NextResponse.json({ ok: true, job: toPublicGenerationJob(job) }, { status: 202 });
    }
    const copyGeneration = await generateHookMessages(truth);
    const creativePlan = buildCreativePlan(truth, {
      logoPath: body.logoPath,
      adBrief,
      hypotheses: copyGeneration.hypotheses,
      copyGeneration: {
        provider: copyGeneration.provider,
        model: copyGeneration.model,
        repairAttempts: copyGeneration.repairAttempts,
        warnings: copyGeneration.warnings,
      },
      preserveMasterDesignId: body.preserveMasterDesignId,
      excludedMasterDesignIds: body.excludedMasterDesignIds,
      testCode: body.testCode,
    });
    const scenes = planAiScenes(creativePlan, paidImageGenerationEnabled);
    const productReferenceProfile = await analyzeProductReferences(truth);
    const job = createGenerationJob({
      truth,
      creativePlan,
      scenes,
      concurrency: configuredConcurrency,
      paidImageGenerationEnabled,
      productReferenceProfile,
      planningMs: Date.now() - started,
    });
    const advertiser = resolveAdvertiserIdentity(product);
    job.engine = engine;
    job.paidApiUsed = engine === "openai_api";
    job.advertiserId = advertiser.id;
    job.advertiserName = advertiser.name;
    job.codexThreadId = (await getAdvertiserThread(advertiser.id))?.threadId;
    job.visualDiversityMatrix = buildVisualDiversityMatrix(job.results);
    job.version = "generation-job-v6-ai-native-final";
    await creativeGenerationJobStore.create(job);
    await writeNativeManifest(job);
    enqueueGenerationJob(job.id);
    return NextResponse.json({ ok: true, job: toPublicGenerationJob(job) }, { status: 202 });
  } catch (error) {
    const message = toPublicGenerationError(error, "광고 생성 작업 계획에 실패했습니다.");
    const userInputError = /실제 상품 이미지|상품 합성|누끼|제품 단독 이미지/.test(message);
    const configurationError = /AI 광고 콘텐츠 생성 설정/.test(message);
    return NextResponse.json(
      { ok: false, error: message },
      { status: localAccessError(error) ? 403 : configurationError ? 503 : userInputError ? 400 : 500 }
    );
  }
}
