import type { ReviewRawCandidate } from "./reviewImageAnalysis.server";
import { reviewCandidateContextScore } from "./reviewCreative";
import { absoluteUrl } from "./productHtmlSignals.server";
import { bestSrcsetImage, getTagAttribute, looksLikeUsableProductImage, normalizeImageUrlForDedup, textContextFromHtml } from "./productImageCandidateExtraction.server";

function collectReviewImageCandidates(html: string, baseUrl: string): ReviewRawCandidate[] {
  const candidates: Array<ReviewRawCandidate & { score: number; order: number }> = [];
  const seen = new Set<string>();
  const attrNames = ["data-original", "data-src", "data-lazy", "data-image", "data-url", "src"];

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const index = match.index ?? 0;
    const alt = getTagAttribute(tag, "alt") || getTagAttribute(tag, "title");
    const classContext = `${getTagAttribute(tag, "class")} ${getTagAttribute(tag, "id")}`;
    const nearbyText = textContextFromHtml(html.slice(Math.max(0, index - 1200), Math.min(html.length, index + 1200)));
    const context = `${classContext} ${alt} ${nearbyText}`;
    const urls = attrNames.map((name) => getTagAttribute(tag, name));
    const srcset = getTagAttribute(tag, "srcset") || getTagAttribute(tag, "data-srcset");
    if (srcset) urls.push(bestSrcsetImage(srcset, baseUrl));
    const width = Number(getTagAttribute(tag, "width")) || undefined;
    const height = Number(getTagAttribute(tag, "height")) || undefined;

    for (const value of urls) {
      const imageUrl = absoluteUrl(value, baseUrl);
      if (!imageUrl || !looksLikeUsableProductImage(imageUrl)) continue;
      const directReviewSignal = /(review|reviewimg|photo[_-]?review|testimonial|comment|community|후기|리뷰|댓글)/i.test(`${imageUrl} ${alt} ${classContext}`);
      if (!directReviewSignal) continue;
      const likelyProductGalleryPath = /\/(?:web\/)?product\/(?:big|small|medium|extra|tiny)|\/goods\/(?:big|small|detail|thumb)|\/item\/(?:big|small|thumb)/i.test(imageUrl);
      if (!directReviewSignal && likelyProductGalleryPath) continue;
      const score = reviewCandidateContextScore({ url: imageUrl, alt, context, width, height });
      if (score < 35) continue;
      const key = normalizeImageUrlForDedup(imageUrl);
      if (seen.has(key)) continue;
      seen.add(key);
      const sourceType = /(before|after|비포|애프터|전후)/i.test(`${imageUrl} ${context}`) ? "before-after" : /(community|comment|댓글|게시글|커뮤니티)/i.test(`${imageUrl} ${context}`) ? "community-capture" : /(detail|상세|testimonial)/i.test(context) ? "detail-testimonial" : "product-review";
      candidates.push({
        url: imageUrl,
        sourceType,
        sourceContext: context.slice(0, 700),
        alt,
        width,
        height,
        score,
        order: index,
      });
    }
  }

  return candidates
    .sort((a, b) => (a.score === b.score ? a.order - b.order : b.score - a.score))
    .slice(0, 10)
    .map((candidate) => ({
      url: candidate.url,
      sourceType: candidate.sourceType,
      sourceContext: candidate.sourceContext,
      alt: candidate.alt,
      width: candidate.width,
      height: candidate.height,
    }));
}


export { collectReviewImageCandidates };

