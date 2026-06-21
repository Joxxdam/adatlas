import { NextResponse } from "next/server";
import { readGenerated, readImages } from "../../../lib/mvp/store";

export const runtime = "nodejs";

export async function GET() {
  const [images, generated] = await Promise.all([readImages(), readGenerated()]);
  return NextResponse.json({ images, generated });
}
