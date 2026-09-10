import { NextResponse } from "next/server";
import { researchProductSupplementSeed } from "../../../../lib/mvp/productSupplementExploration.server";
import type { ProductSupplementAnalysis, ProductSupplementExplorationSeed } from "../../../../lib/mvp/types";
import type { ProductSupplementContext } from "../../../../lib/mvp/productSupplementAnalysis.server";

export const runtime = "nodejs";

function clean(value: unknown, max: number) {
  return String(value || "").replace(/\0/g, "").trim().slice(0, max);
}

function parseProduct(value: unknown): ProductSupplementContext {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const productName = clean(input.productName, 200);
  if (!productName) throw new Error("심층 조사할 상품 정보를 먼저 확인해 주세요.");
  return {
    productName,
    brandName: clean(input.brandName, 160),
    category: clean(input.category, 120),
    price: clean(input.price, 80),
    originalPrice: clean(input.originalPrice, 80),
    discountInfo: clean(input.discountInfo, 240),
    mainBenefit: clean(input.mainBenefit, 600),
    description: clean(input.description, 3_000),
    landingUrl: clean(input.landingUrl, 1_000),
  };
}

function parseAnalysis(value: unknown): ProductSupplementAnalysis {
  if (!value || typeof value !== "object") throw new Error("첨부자료 분석 결과를 확인할 수 없습니다.");
  const analysis = value as ProductSupplementAnalysis;
  if (!clean(analysis.overallSummary, 1_000) || !Array.isArray(analysis.files)) throw new Error("첨부자료를 다시 분석해 주세요.");
  return analysis;
}

function parseSeed(value: unknown): ProductSupplementExplorationSeed {
  if (!value || typeof value !== "object") throw new Error("심층 조사할 소재를 선택해 주세요.");
  return value as ProductSupplementExplorationSeed;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const result = await researchProductSupplementSeed({
      product: parseProduct(body.product),
      analysis: parseAnalysis(body.analysis),
      seed: parseSeed(body.seed),
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "선택한 소재의 심층 조사에 실패했습니다." },
      { status: 400 }
    );
  }
}
