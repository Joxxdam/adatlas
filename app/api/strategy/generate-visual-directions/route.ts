import { NextResponse } from "next/server";

import { defaultAdBrief, productInfoToAdBrief } from "../../../lib/mvp/adBrief";
import { readAdImageLabels } from "../../../lib/mvp/labelStore";
import { matchReferences } from "../../../lib/mvp/referenceMatcher";
import type { AdBrief, CreativeStrategy, GeneratedAdCopy, ProductInfoForPrompt } from "../../../lib/mvp/types";
import { matchAdvertiserProfile } from "../../../lib/creative/advertiserProfiles";
import { buildVisualDirections } from "../../../lib/creative/buildVisualDirection";
import { evaluateCreativeQuality } from "../../../lib/creative/creativeQualityEvaluator";

export const runtime = "nodejs";

type Body = {
  productInfo?: Partial<ProductInfoForPrompt>;
  adBrief?: Partial<AdBrief>;
  strategy?: CreativeStrategy | null;
  copy?: Partial<GeneratedAdCopy>;
  productImagePaths?: string[];
};

function normalizeProduct(value?: Partial<ProductInfoForPrompt>): ProductInfoForPrompt {
  return {
    productName: String(value?.productName || "").trim(),
    category: String(value?.category || "기타").trim(),
    price: String(value?.price || "").trim(),
    originalPrice: String(value?.originalPrice || value?.oldPrice || "").trim(),
    oldPrice: String(value?.oldPrice || value?.originalPrice || "").trim(),
    advertiserName: String(value?.advertiserName || "").trim(),
    brandName: String(value?.brandName || "").trim(),
    discountInfo: String(value?.discountInfo || "").trim(),
    mainBenefit: String(value?.mainBenefit || value?.extractedDescription || "").trim(),
    targetCustomer: String(value?.targetCustomer || "").trim(),
    landingUrl: String(value?.landingUrl || "").trim(),
    productImagePath: String(value?.productImagePath || "").trim(),
    secondaryProductImagePath: String(value?.secondaryProductImagePath || "").trim(),
    productImagePaths: (value?.productImagePaths || []).filter(Boolean),
    backgroundImagePath: String(value?.backgroundImagePath || "").trim(),
    extractedDescription: String(value?.extractedDescription || "").trim(),
    extractedMainImage: String(value?.extractedMainImage || "").trim(),
    extractedGalleryImages: (value?.extractedGalleryImages || []).filter(Boolean),
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Body;
    const product = normalizeProduct(body.productInfo);
    if (!product.productName && !product.category && !product.mainBenefit) {
      return NextResponse.json({ ok: false, error: "비주얼 방향을 만들 상품 정보가 필요합니다." }, { status: 400 });
    }
    const brief = productInfoToAdBrief(product, {
      ...defaultAdBrief,
      ...(body.adBrief || {}),
      mandatoryInfo: body.adBrief?.mandatoryInfo || [],
      prohibitedClaims: body.adBrief?.prohibitedClaims || [],
    });
    const labels = await readAdImageLabels().catch(() => []);
    const referenceMatches = matchReferences({ product, brief, labels, limit: 5 });
    const advertiserProfile = matchAdvertiserProfile(product);
    const directions = buildVisualDirections({
      product,
      brief,
      strategy: body.strategy,
      copy: body.copy,
      referenceMatches,
      advertiserProfile,
    });
    const imagePaths = (body.productImagePaths || product.productImagePaths || [product.productImagePath]).filter(Boolean);
    const qualityScores = Object.fromEntries(
      directions.map((direction) => [
        direction.id,
        evaluateCreativeQuality({
          direction,
          product,
          copy: body.copy,
          productImagePaths: imagePaths,
        }),
      ])
    );

    return NextResponse.json({
      ok: true,
      advertiserProfile: {
        id: advertiserProfile.id,
        name: advertiserProfile.name,
        visualKeywords: advertiserProfile.visualKeywords || [],
      },
      directions,
      qualityScores,
      referenceMatches,
      usedProductOnlyFallback: referenceMatches.length === 0,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "비주얼 방향 생성에 실패했습니다.",
      },
      { status: 500 }
    );
  }
}
