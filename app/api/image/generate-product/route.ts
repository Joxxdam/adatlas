import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { NextResponse } from "next/server";
import type { ProductInfoForPrompt } from "../../../lib/mvp/types";

export const runtime = "nodejs";

type Body = {
  productInfo?: Partial<ProductInfoForPrompt>;
  prompt?: string;
  styleHint?: string;
};

const outputDir = path.join(process.cwd(), "public", "generated-product-images");

function stripEmoji(value: string) {
  return value.replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu, "").replace(/\s{2,}/g, " ").trim();
}

function productPrompt(productInfo: Partial<ProductInfoForPrompt> = {}, prompt = "", styleHint = "") {
  const productName = productInfo.productName || "featured ecommerce product";
  const category = productInfo.category || "consumer product";
  const benefit = productInfo.mainBenefit || productInfo.extractedDescription || "";
  const price = [productInfo.price, productInfo.discountInfo].filter(Boolean).join(", ");

  return stripEmoji([
    prompt,
    `Create a clean product hero image for a Korean ecommerce performance ad.`,
    `Product: ${productName}.`,
    `Category: ${category}.`,
    benefit ? `Main selling point: ${benefit}.` : "",
    price ? `Commercial context: ${price}.` : "",
    styleHint ? `Style direction: ${styleHint}.` : "",
    "Square 1:1 composition, realistic product photography, appetizing and premium commercial lighting, product-focused, high contrast, usable as the main visual in an ad banner.",
    "No readable text, no letters, no numbers, no logo, no watermark, no emoji, no pictograms.",
    "Leave clean negative space for Korean headline overlay.",
  ].filter(Boolean).join(" "));
}

async function downloadImage(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Generated image download failed: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function POST(request: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { success: false, error: "OPENAI_API_KEY가 설정되어 있지 않습니다." },
        { status: 500 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as Body;
    const prompt = productPrompt(body.productInfo, body.prompt, body.styleHint);

    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
        prompt,
        size: "1024x1024",
        quality: "medium",
        n: 1,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI 이미지 생성 실패: HTTP ${response.status} ${await response.text()}`);
    }

    const result = await response.json();
    const firstImage = result.data?.[0] ?? {};
    const imageBuffer = firstImage.b64_json
      ? Buffer.from(firstImage.b64_json, "base64")
      : firstImage.url
        ? await downloadImage(firstImage.url)
        : null;

    if (!imageBuffer) {
      throw new Error("OpenAI 이미지 응답에서 이미지 데이터를 찾지 못했습니다.");
    }

    await fs.mkdir(outputDir, { recursive: true });
    const fileName = `gpt-product-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.png`;
    const filePath = path.join(outputDir, fileName);
    await fs.writeFile(filePath, imageBuffer);

    return NextResponse.json({
      success: true,
      imagePath: `/generated-product-images/${fileName}`,
      prompt,
      model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "이미지 생성 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
