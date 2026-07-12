import { NextResponse } from "next/server";
import { extractProductInfo } from "../../../lib/mvp/productExtractor";
import { addGenerated, readImages } from "../../../lib/mvp/store";
import { GeneratedAdImage } from "../../../lib/mvp/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const websiteUrl = String(body.websiteUrl ?? "").trim();
    const referenceImageId = body.referenceImageId ? String(body.referenceImageId) : undefined;

    if (!websiteUrl) {
      return NextResponse.json({ ok: false, error: "웹사이트 URL이 필요합니다." }, { status: 400 });
    }

    const [product, images] = await Promise.all([extractProductInfo(websiteUrl), readImages()]);
    const reference = referenceImageId
      ? images.find((image) => image.id === referenceImageId)
      : images[0];
    const payload = {
      product,
      referenceImage: reference?.localImagePath || reference?.imageUrl,
      generatedAt: new Date().toISOString(),
    };
    const dataUrl = `data:application/json;base64,${Buffer.from(JSON.stringify(payload)).toString("base64")}`;
    const item: GeneratedAdImage = {
      id: `gen-${Date.now()}`,
      sourceWebsiteUrl: websiteUrl,
      productName: product.productName,
      price: product.price,
      description: product.description,
      referenceImageId,
      dataUrl,
      createdAt: new Date().toISOString(),
    };
    await addGenerated(item);

    return NextResponse.json({ ok: true, generated: item, product, reference });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "광고 이미지 생성 준비 실패" },
      { status: 500 }
    );
  }
}
