import { NextResponse } from "next/server";
import { readAdImageLabels } from "../../../lib/mvp/labelStore";
import { readCollectedAdImages } from "../../../lib/mvp/collectedImageStore";
import { readGenerated } from "../../../lib/mvp/store";

export const runtime = "nodejs";

export async function GET() {
  const [images, generated, labels] = await Promise.all([
    readCollectedAdImages(),
    readGenerated(),
    readAdImageLabels(),
  ]);
  return NextResponse.json({ images, generated, labels });
}
