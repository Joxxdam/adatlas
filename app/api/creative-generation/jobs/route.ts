import { NextResponse } from "next/server";
import { readBackgroundLibrary } from "../../../lib/background-library/store";
import { creativeGenerationJobStore } from "../../../lib/creative-generation/jobStore.server";
import { buildCreativePlan, createGenerationJob, planScenes } from "../../../lib/creative-generation/planner";
import { buildProductTruth } from "../../../lib/creative-generation/productTruth";
import {
  assertProductImageReady,
  inspectProductTruthImages,
} from "../../../lib/creative-generation/productImages.server";
import { generateHookMessages } from "../../../lib/creative-generation/hookMessages.server";
import type { CreateGenerationJobInput } from "../../../lib/creative-generation/types";
import { isPaidImageGenerationEnabled } from "../../../lib/image-generation/SceneGenerationProvider";
import { defaultAdBrief } from "../../../lib/mvp/adBrief";
import type { AdBrief } from "../../../lib/mvp/types";
import { applyKnownProductAssets, matchKnownProductAsset } from "../../../lib/creative/knownProductAssets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function POST(request: Request) {
  const started = Date.now();
  try {
    const body = (await request.json().catch(() => ({}))) as Partial<CreateGenerationJobInput>;
    if (!body.product?.productName?.trim()) {
      return NextResponse.json({ ok: false, error: "먼저 상품정보를 불러와 주세요." }, { status: 400 });
    }
    const product = applyKnownProductAssets(body.product);
    const knownAsset = matchKnownProductAsset(product);
    const requestedProductImagePaths = Array.isArray(body.productImagePaths)
      ? body.productImagePaths.slice(0, 12)
      : [];
    const requestedSelectedImages = Array.isArray(body.selectedAdImages)
      ? body.selectedAdImages.slice(0, 12)
      : [];
    const rawTruth = buildProductTruth({
      product,
      productImagePaths: knownAsset
        ? [knownAsset.cutoutPath, ...requestedProductImagePaths.filter((path) => path !== knownAsset.cutoutPath)]
        : requestedProductImagePaths,
      // selectedAdImages are ad-reference assets only. A registered cutout is
      // already present in productImagePaths and must never be relabeled as a reference.
      selectedAdImages: requestedSelectedImages,
      imageAssets: [
        ...(knownAsset
          ? [
              {
                id: `known-product-${knownAsset.productId}`,
                path: knownAsset.cutoutPath,
                role: "product-cutout" as const,
                source: "known-product" as const,
                verified: true,
                transparent: true,
                reason: "등록된 상품 전용 누끼",
              },
            ]
          : []),
        ...(body.imageAssets || []),
      ],
      source: body.source === "landing-page" ? "landing-page" : "user-input",
    });
    const truth = await inspectProductTruthImages(rawTruth);
    assertProductImageReady(truth);
    const adBrief = resolveAdBrief(body.adBrief);
    const copyGeneration = await generateHookMessages(truth);
    const creativePlan = buildCreativePlan(truth, {
      logoPath: body.logoPath,
      adBrief,
      hypotheses: copyGeneration.hypotheses,
      copyGeneration: {
        provider: copyGeneration.provider,
        warnings: copyGeneration.warnings,
      },
      preserveMasterDesignId: body.preserveMasterDesignId,
      excludedMasterDesignIds: body.excludedMasterDesignIds,
      testCode: body.testCode,
    });
    const library = await readBackgroundLibrary();
    const paidImageGenerationEnabled = isPaidImageGenerationEnabled();
    const scenes = planScenes(creativePlan, library, paidImageGenerationEnabled, {
      preserveBackgroundAssetId: body.preserveBackgroundAssetId,
    });
    const job = createGenerationJob({
      truth,
      creativePlan,
      scenes,
      concurrency: body.concurrency,
      paidImageGenerationEnabled,
      planningMs: Date.now() - started,
    });
    await creativeGenerationJobStore.create(job);
    return NextResponse.json({ ok: true, job }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "광고 생성 작업 계획에 실패했습니다.";
    const userInputError = /실제 상품 이미지|상품 합성|누끼|제품 단독 이미지/.test(message);
    return NextResponse.json(
      { ok: false, error: message },
      { status: userInputError ? 400 : 500 }
    );
  }
}
