import { NextResponse } from "next/server";
import { analyzeProductSupplementFiles, type ProductSupplementContext } from "../../../lib/mvp/productSupplementAnalysis.server";

export const runtime = "nodejs";

function clean(value: unknown, max: number) {
  return String(value || "").replace(/\0/g, "").trim().slice(0, max);
}

function productContext(value: FormDataEntryValue | null): ProductSupplementContext {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(typeof value === "string" ? value : "{}") as Record<string, unknown>;
  } catch {
    throw new Error("상품 분석 정보를 읽을 수 없습니다.");
  }
  const productName = clean(parsed.productName, 200);
  if (!productName) throw new Error("참고자료를 연결할 상품을 먼저 분석해 주세요.");
  return {
    productName,
    brandName: clean(parsed.brandName, 160),
    category: clean(parsed.category, 120),
    price: clean(parsed.price, 80),
    originalPrice: clean(parsed.originalPrice, 80),
    discountInfo: clean(parsed.discountInfo, 240),
    mainBenefit: clean(parsed.mainBenefit, 600),
    description: clean(parsed.description, 3_000),
    landingUrl: clean(parsed.landingUrl, 1_000),
  };
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const files = form.getAll("files").filter((value): value is File => value instanceof File);
    const uploads = await Promise.all(
      files.map(async (file) => ({
        name: file.name.slice(0, 180),
        type: file.type,
        size: file.size,
        buffer: Buffer.from(await file.arrayBuffer()),
      }))
    );
    const analysis = await analyzeProductSupplementFiles({
      product: productContext(form.get("product")),
      files: uploads,
    });
    return NextResponse.json({ ok: true, analysis });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "첨부자료 분석에 실패했습니다." },
      { status: 400 }
    );
  }
}
