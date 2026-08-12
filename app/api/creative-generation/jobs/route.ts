import { NextResponse } from "next/server";
import { readBackgroundLibrary } from "../../../lib/background-library/store";
import { creativeGenerationJobStore } from "../../../lib/creative-generation/jobStore.server";
import { buildCreativePlan, createGenerationJob, planScenes } from "../../../lib/creative-generation/planner";
import { buildProductTruth } from "../../../lib/creative-generation/productTruth";
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
    const truth = buildProductTruth({
      product,
      productImagePaths: knownAsset
        ? [knownAsset.cutoutPath, ...requestedProductImagePaths.filter((path) => path !== knownAsset.cutoutPath)]
        : requestedProductImagePaths,
      selectedAdImages: knownAsset
        ? [knownAsset.cutoutPath, ...requestedSelectedImages.filter((path) => path !== knownAsset.cutoutPath)]
        : requestedSelectedImages,
      source: body.source === "landing-page" ? "landing-page" : "user-input",
    });
    if (!truth.imagePaths.length) {
      return NextResponse.json({ ok: false, error: "광고에 사용할 실제 상품 이미지가 없습니다." }, { status: 400 });
    }
    const adBrief = resolveAdBrief(body.adBrief);
    const creativePlan = buildCreativePlan(truth, { logoPath: body.logoPath, adBrief });
    const library = await readBackgroundLibrary();
    const paidImageGenerationEnabled = isPaidImageGenerationEnabled();
    const scenes = planScenes(creativePlan, library, paidImageGenerationEnabled);
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
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "광고 생성 작업 계획에 실패했습니다." },
      { status: 500 }
    );
  }
}
