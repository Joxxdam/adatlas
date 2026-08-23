import { NextResponse } from "next/server";
import { analyzeReviewImage } from "../../../lib/mvp/reviewImageAnalysis.server";
import type { ReviewSourceType } from "../../../lib/mvp/types";

export const runtime = "nodejs";

const requestWindows = new Map<string, { startedAt: number; count: number }>();
const allowedSourceTypes = new Set<ReviewSourceType>(["product-review", "detail-testimonial", "community-capture", "before-after", "upload"]);

function clientKey(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
}

function rateLimited(request: Request) {
  const key = clientKey(request);
  const now = Date.now();
  const current = requestWindows.get(key);
  if (!current || now - current.startedAt > 60_000) {
    requestWindows.set(key, { startedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > 12;
}

export async function POST(request: Request) {
  try {
    if (rateLimited(request)) {
      return NextResponse.json({ success: false, error: "후기 분석 요청이 너무 많습니다. 잠시 후 다시 시도해주세요." }, { status: 429 });
    }
    const body = await request.json().catch(() => ({}));
    const imagePath = String(body.imagePath || "").trim();
    if (!imagePath) {
      return NextResponse.json({ success: false, error: "분석할 후기 이미지를 선택해주세요." }, { status: 400 });
    }
    const requestedSourceType = String(body.sourceType || "upload") as ReviewSourceType;
    const candidate = await analyzeReviewImage({
      imagePath,
      originalUrl: /^https?:\/\//i.test(imagePath) ? imagePath : undefined,
      sourceType: allowedSourceTypes.has(requestedSourceType) ? requestedSourceType : "upload",
      sourceContext: String(body.sourceContext || "").slice(0, 1000),
      productName: String(body.productName || "").slice(0, 300),
      productDescription: String(body.productDescription || "").slice(0, 3000),
      manuallyUploaded: requestedSourceType === "upload",
    });
    return NextResponse.json({ success: true, candidate });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "후기 이미지 분석에 실패했습니다.",
      },
      { status: 422 }
    );
  }
}
