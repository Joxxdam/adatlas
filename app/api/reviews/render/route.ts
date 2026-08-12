import { NextResponse } from "next/server";
import { clampReviewBox } from "../../../lib/mvp/reviewCreative";
import { renderReviewCreative } from "../../../lib/mvp/reviewCreativeRender.server";
import type {
  ReviewCreativeTemplate,
  ReviewPrivacyMaskStyle,
  ReviewPrivacyRegion,
} from "../../../lib/mvp/types";

export const runtime = "nodejs";

const templates = new Set<ReviewCreativeTemplate>([
  "reaction-comment",
  "real-review-focus",
  "review-collection",
  "before-after-usage",
]);
const maskStyles = new Set<ReviewPrivacyMaskStyle>(["blur", "mosaic", "solid"]);

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const requestedTemplate = String(body.template || "reaction-comment") as ReviewCreativeTemplate;
    const template = templates.has(requestedTemplate) ? requestedTemplate : "reaction-comment";
    const reviews = Array.isArray(body.reviews)
      ? body.reviews.slice(0, 3).map((review: Record<string, unknown>, reviewIndex: number) => {
          const masks = Array.isArray(review.privacyMasks)
            ? review.privacyMasks.slice(0, 30).map((mask: Record<string, unknown>, index: number) => {
                const requestedStyle = String(mask.maskStyle || "blur") as ReviewPrivacyMaskStyle;
                return {
                  id: String(mask.id || `mask-${reviewIndex}-${index}`),
                  role: "unknown" as const,
                  confidence: 1,
                  reason: String(mask.reason || "사용자 지정 가림 영역").slice(0, 200),
                  enabled: mask.enabled !== false,
                  maskStyle: maskStyles.has(requestedStyle) ? requestedStyle : "blur",
                  box: clampReviewBox((mask.box || {}) as ReviewPrivacyRegion["box"]),
                } satisfies ReviewPrivacyRegion;
              })
            : [];
          return {
            id: String(review.id || `review-${reviewIndex}`),
            imagePath: String(review.imagePath || "").trim(),
            crop: clampReviewBox((review.crop || {}) as ReviewPrivacyRegion["box"]),
            privacyMasks: masks,
            highlightBox: review.highlightBox
              ? clampReviewBox(review.highlightBox as ReviewPrivacyRegion["box"])
              : undefined,
          };
        })
      : [];
    if (!reviews.length || reviews.some((review: { imagePath: string }) => !review.imagePath)) {
      return NextResponse.json(
        { success: false, error: "렌더링할 후기 이미지를 선택해주세요." },
        { status: 400 }
      );
    }
    const result = await renderReviewCreative({
      template,
      headline: String(body.headline || "실제 사용 후기에서 나온 반응").slice(0, 120),
      reviews,
      productImagePath: String(body.productImagePath || "").trim() || undefined,
      backgroundImagePath: String(body.backgroundImagePath || "").trim() || undefined,
      accentColor: /^#[0-9a-f]{6}$/i.test(String(body.accentColor || ""))
        ? String(body.accentColor)
        : undefined,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "후기 광고 소재 렌더링에 실패했습니다.",
      },
      { status: 422 }
    );
  }
}
