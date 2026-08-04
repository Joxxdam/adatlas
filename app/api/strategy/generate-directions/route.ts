import { NextResponse } from "next/server";

import { defaultAdBrief, productInfoToAdBrief } from "../../../lib/mvp/adBrief";
import { inferAdBriefContext } from "../../../lib/mvp/adBriefInference";
import { buildCreativeStrategies } from "../../../lib/mvp/creativeStrategy";
import { readAdImageLabels } from "../../../lib/mvp/labelStore";
import { labelsForReferenceMatches, matchReferences } from "../../../lib/mvp/referenceMatcher";
import { normalizeReferenceUsages } from "../../../lib/mvp/referenceUsage";
import type { AdBrief, AdImageLabel, ProductInfoForPrompt } from "../../../lib/mvp/types";

type Body = {
  productInfo?: Partial<ProductInfoForPrompt>;
  adBrief?: Partial<AdBrief>;
  batch?: number;
  referenceLabels?: AdImageLabel[];
};

function normalizeProduct(value?: Partial<ProductInfoForPrompt>): ProductInfoForPrompt {
  return {
    productName: String(value?.productName || "").trim(),
    category: String(value?.category || "기타").trim(),
    price: String(value?.price || "").trim(),
    originalPrice: String(value?.originalPrice || value?.oldPrice || "").trim(),
    oldPrice: String(value?.oldPrice || value?.originalPrice || "").trim(),
    discountInfo: String(value?.discountInfo || "").trim(),
    mainBenefit: String(value?.mainBenefit || value?.extractedDescription || "").trim(),
    targetCustomer: String(value?.targetCustomer || "").trim(),
    landingUrl: String(value?.landingUrl || "").trim(),
    productImagePath: String(value?.productImagePath || "").trim(),
    backgroundImagePath: String(value?.backgroundImagePath || "").trim(),
    extractedDescription: String(value?.extractedDescription || "").trim(),
  };
}

function mergeLabels(stored: AdImageLabel[], legacy: AdImageLabel[] = []) {
  const byId = new Map<string, AdImageLabel>();
  [...stored, ...legacy].forEach((label) => {
    if (label?.imageId) byId.set(label.imageId, label);
  });
  return Array.from(byId.values());
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Body;
    const product = normalizeProduct(body.productInfo);
    const brief = productInfoToAdBrief(product, {
      ...defaultAdBrief,
      ...(body.adBrief || {}),
      mandatoryInfo: body.adBrief?.mandatoryInfo || [],
      prohibitedClaims: body.adBrief?.prohibitedClaims || [],
    });
    const allLabels = mergeLabels(await readAdImageLabels(), body.referenceLabels);
    const referenceMatches = matchReferences({ product, brief, labels: allLabels, limit: 5 });
    const matchedLabels = labelsForReferenceMatches(allLabels, referenceMatches);
    const referenceUsages = normalizeReferenceUsages(matchedLabels, []);
    const inferredContext = inferAdBriefContext({ product, brief, references: matchedLabels });
    const strategies = buildCreativeStrategies({
      brief,
      references: matchedLabels,
      usages: referenceUsages,
      batch: Number.isFinite(body.batch) ? Number(body.batch) : 0,
    });

    return NextResponse.json({
      ok: true,
      strategies,
      inferredContext,
      referenceMatches,
      referenceLabels: matchedLabels,
      usedProductOnlyFallback: matchedLabels.length === 0,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "광고 전략 생성에 실패했습니다.",
      },
      { status: 500 }
    );
  }
}
