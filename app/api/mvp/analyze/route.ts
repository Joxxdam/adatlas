import { NextResponse } from "next/server";
import { analyzeCollectedImage } from "../../../lib/mvp/analyzeImage";
import { readImages, saveImages } from "../../../lib/mvp/store";

export const runtime = "nodejs";

export async function POST() {
  const images = await readImages();
  const next = images.map((image) => ({
    ...image,
    analysis: image.analysis ?? analyzeCollectedImage(image),
  }));
  await saveImages(next);

  return NextResponse.json({
    ok: true,
    analyzed: next.filter((image) => image.analysis).length,
    images: next,
  });
}
