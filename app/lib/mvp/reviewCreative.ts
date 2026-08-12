import type {
  NormalizedImageBox,
  ReviewCreativeTemplate,
  ReviewImageRegion,
  ReviewPrivacyRegion,
  ReviewSourceCandidate,
  ReviewType,
} from "./types";

export const REVIEW_ANALYSIS_VERSION = "review-analysis-v2";
export const REVIEW_RENDER_VERSION = "review-render-v3";

const reviewContextPattern =
  /(review|reviews|reviewimg|review_img|photo[_-]?review|testimonial|comment|community|ugc|후기|리뷰|구매평|사용기|사용후기|고객평|댓글|반응|비포|애프터)/i;
const notReviewPattern =
  /(logo|icon|sprite|button|banner|coupon|delivery|detail[_-]?guide|size[_-]?guide|로고|아이콘|배송|쿠폰|이벤트|사이즈표)/i;
const authorPattern =
  /(?:^|\s)(?:작성자|아이디|닉네임|구매자|user|by)\s*[:：]?|\*{2,}|\([\d*.]{5,}\)|@[a-z0-9_.-]+/i;
const dateOrderPattern =
  /(?:20\d{2}[.\-/년]\s*\d{1,2}[.\-/월]\s*\d{1,2}|주문(?:번호)?|배송(?:지|정보)|결제(?:정보)?|order\s*#?\s*[a-z0-9-]+)/i;
const directPrivacyPattern =
  /(?:[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}|\b\d{2,3}[-.\s]\d{3,4}[-.\s]\d{4}\b|\b(?:\d{1,3}\.){3}\d{1,3}\b)/i;
const socialUiPattern = /(좋아요|댓글\s*\d*|공유|신고|도움이\s*돼요|likes?|comments?|share)/i;
const policyRiskPattern =
  /(완치|치료|약보다|의사가|질병|암|당뇨|고혈압|무조건|100%|절대|기적|즉시\s*제거|영구적|부작용\s*없)/i;

export function clampReviewBox(box: NormalizedImageBox): NormalizedImageBox {
  const x = Math.max(0, Math.min(0.98, Number(box.x) || 0));
  const y = Math.max(0, Math.min(0.98, Number(box.y) || 0));
  const width = Math.max(0.02, Math.min(1 - x, Number(box.width) || 1));
  const height = Math.max(0.02, Math.min(1 - y, Number(box.height) || 1));
  return { x, y, width, height };
}

export function reviewCandidateContextScore(input: {
  url?: string;
  alt?: string;
  context?: string;
  width?: number;
  height?: number;
}) {
  const source = `${input.url || ""} ${input.alt || ""} ${input.context || ""}`;
  let score = 0;
  if (reviewContextPattern.test(source)) score += 55;
  if (/(comment|community|댓글|반응|구매후기|포토후기)/i.test(source)) score += 16;
  if (/(before|after|비포|애프터|전후)/i.test(source)) score += 12;
  if (notReviewPattern.test(source)) score -= 70;
  const width = input.width || 0;
  const height = input.height || 0;
  if (width >= 480 && height >= 320) score += 8;
  if (width && height && Math.max(width, height) / Math.max(1, Math.min(width, height)) > 4)
    score -= 15;
  return score;
}

export function inferReviewType(input: {
  sourceContext?: string;
  ocrText?: string;
  textRegionCount?: number;
  faceCount?: number;
  width?: number;
  height?: number;
  manuallyUploaded?: boolean;
}): { type: ReviewType; confidence: number; reason: string } {
  const source = `${input.sourceContext || ""} ${input.ocrText || ""}`;
  const ocr = input.ocrText || "";
  const textCount = input.textRegionCount || 0;
  if (/(before|after|비포|애프터|사용\s*전|사용\s*후)/i.test(source)) {
    return { type: "before-after", confidence: 0.91, reason: "전후 비교 문맥이 확인됨" };
  }
  if (
    /(댓글|대댓글|조회\s*\d|게시글|좋아요|\([\d*.]{5,}\)|20\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2})/i.test(ocr) ||
    (/(community|comment|커뮤니티)/i.test(input.sourceContext || "") && textCount >= 2)
  ) {
    return { type: "community-reaction", confidence: 0.88, reason: "댓글·커뮤니티 UI 문맥이 확인됨" };
  }
  if (/(구매후기|상품후기|리뷰|평점|별점|구매자|도움이\s*돼요)/i.test(ocr) && textCount >= 2) {
    return { type: "review-card", confidence: 0.87, reason: "쇼핑몰 후기 카드 문맥이 확인됨" };
  }
  if (input.manuallyUploaded && textCount >= 4 && input.faceCount === 0) {
    return {
      type: "testimonial-graphic",
      confidence: 0.78,
      reason: "여러 후기 문장과 디자인 요소가 결합된 업로드 이미지",
    };
  }
  const hasNaturalReviewSentence =
    /(?:저는|나는|제가|우리|써보|먹어보|사용해|재구매|또\s*샀|만족|추천해|좋았|좋아요|놀랐|ㅋㅋ|ㅎㅎ|ㅠㅠ|네요|했어요|해요|합니다|했음|좋음|소리지름)/i.test(ocr);
  const directReviewSource = /(reviewimg|review[_-]?image|photo[_-]?review|후기[_-]?이미지)/i.test(
    input.sourceContext || ""
  );
  if (textCount >= 5 && (hasNaturalReviewSentence || directReviewSource)) {
    return {
      type: "review-text-screenshot",
      confidence: 0.76,
      reason: "텍스트 영역 비중이 높은 캡처",
    };
  }
  if (textCount >= 1 && hasNaturalReviewSentence) {
    return {
      type: "review-photo-with-text",
      confidence: 0.68,
      reason: "사진과 읽을 수 있는 문장이 함께 있음",
    };
  }
  if (directReviewSource) {
    return { type: "review-photo-only", confidence: 0.62, reason: "후기 영역의 사진 후보" };
  }
  return { type: "not-review", confidence: 0.72, reason: "후기 문맥이나 후기 텍스트가 부족함" };
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function sentenceCandidates(text: string) {
  return text
    .split(/\n+|(?<=[.!?。！？;；])\s+|\s{2,}/)
    .map(compactText)
    .filter((line) => line.length >= 5 && line.length <= 130)
    .filter((line) => !dateOrderPattern.test(line) && !directPrivacyPattern.test(line))
    .filter((line) => !/^(댓글|좋아요|공유|신고|작성일|옵션|별점)\s*\d*$/i.test(line));
}

export function selectKeyReviewSentence(text: string, productText = "") {
  const productTokens = productText
    .toLowerCase()
    .match(/[0-9a-z가-힣]{2,}/gi)
    ?.filter((token) => !/^(상품|제품|후기|리뷰|세트|구성)$/.test(token)) ?? [];
  const candidates = sentenceCandidates(text).map((sentence, index) => {
    let score = Math.max(0, 22 - Math.abs(34 - [...sentence].length) * 0.25) - index * 0.15;
    if (/[!?ㅋㅎ]|진짜|정말|대박|미쳤|놀랐|쓰자마자|먹자마자|닿자마자|바르자마자|받자마자|계속|재구매|시원|부드|맛있|편해|좋아|향|촉감|가성비/.test(sentence))
      score += 18;
    if (/쓰자마자|먹자마자|닿자마자|바르자마자|받자마자|사용\s*직후|한입\s*먹/.test(sentence))
      score += 12;
    if (/\d/.test(sentence)) score += 3;
    score += Math.min(2, productTokens.filter((token) => sentence.toLowerCase().includes(token)).length) * 2;
    if (socialUiPattern.test(sentence) || authorPattern.test(sentence)) score -= 12;
    if (policyRiskPattern.test(sentence)) score -= 15;
    return { sentence, score };
  });
  return candidates.sort((a, b) => b.score - a.score)[0]?.sentence || "";
}

function unionBoxes(boxes: NormalizedImageBox[], margin = 0.035): NormalizedImageBox {
  if (!boxes.length) return { x: 0, y: 0, width: 1, height: 1 };
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));
  return clampReviewBox({
    x: minX - margin,
    y: minY - margin,
    width: maxX - minX + margin * 2,
    height: maxY - minY + margin * 2,
  });
}

export function recommendReviewCrop(input: {
  type: ReviewType;
  textRegions: ReviewImageRegion[];
  keySentence: string;
  width: number;
  height: number;
}) {
  if (input.type === "before-after" || input.type === "review-photo-only") {
    return { crop: { x: 0, y: 0, width: 1, height: 1 }, confidence: 0.74 };
  }
  const key = compactText(input.keySentence).slice(0, 24);
  const matching = input.textRegions.filter((region) => {
    const text = compactText(region.text || "");
    return key && (text.includes(key) || key.includes(text.slice(0, 12)));
  });
  const relevant = matching.length
    ? input.textRegions.filter((region) => {
        const keyBox = unionBoxes(matching.map((item) => item.box), 0.08);
        const centerY = region.box.y + region.box.height / 2;
        return centerY >= keyBox.y - 0.12 && centerY <= keyBox.y + keyBox.height + 0.12;
      })
    : input.textRegions.filter(
        (region) => !dateOrderPattern.test(region.text || "") && !socialUiPattern.test(region.text || "")
      );
  if (!relevant.length) return { crop: { x: 0, y: 0, width: 1, height: 1 }, confidence: 0.25 };
  let crop = unionBoxes(relevant.map((region) => region.box), 0.055);
  const minHeight = Math.min(1, Math.max(0.28, crop.width * 0.34));
  if (crop.height < minHeight) {
    const grow = minHeight - crop.height;
    crop = clampReviewBox({ ...crop, y: crop.y - grow / 2, height: minHeight });
  }
  if (crop.width < 0.52) {
    const grow = 0.52 - crop.width;
    crop = clampReviewBox({ ...crop, x: crop.x - grow / 2, width: 0.52 });
  }
  return { crop, confidence: matching.length ? 0.86 : 0.63 };
}

export function detectPrivacyRegions(
  textRegions: ReviewImageRegion[],
  faceRegions: ReviewImageRegion[] = []
): ReviewPrivacyRegion[] {
  const textMasks = textRegions
    .filter((region) => {
      const text = region.text || "";
      return directPrivacyPattern.test(text) || authorPattern.test(text) || dateOrderPattern.test(text);
    })
    .map((region, index): ReviewPrivacyRegion => {
      const text = region.text || "";
      const reason = directPrivacyPattern.test(text)
        ? "연락처·계정 식별정보 가능성"
        : dateOrderPattern.test(text)
          ? "작성일·주문정보 가능성"
          : "작성자·아이디 가능성";
      return {
        ...region,
        id: `privacy-text-${index + 1}`,
        role: dateOrderPattern.test(text) ? "date-order" : "author",
        reason,
        enabled: true,
        maskStyle: "blur",
      };
    });
  const faceMasks = faceRegions.map(
    (region, index): ReviewPrivacyRegion => ({
      ...region,
      id: `privacy-face-${index + 1}`,
      role: "face",
      reason: "식별 가능한 얼굴",
      enabled: true,
      maskStyle: "mosaic",
    })
  );
  return [...textMasks, ...faceMasks].slice(0, 20);
}

export function reviewPolicyRiskScore(text: string) {
  const matches = text.match(new RegExp(policyRiskPattern.source, "gi"))?.length || 0;
  return Math.min(1, matches * 0.28);
}

export function scoreReviewCandidate(input: {
  width: number;
  height: number;
  ocrText: string;
  ocrConfidence: number;
  type: ReviewType;
  keySentence: string;
  productText: string;
  privacyCount: number;
  contextScore?: number;
}) {
  const minSide = Math.min(input.width, input.height);
  const ratio = Math.max(input.width, input.height) / Math.max(1, minSide);
  const imageQualityScore = Math.max(
    0,
    Math.min(1, minSide / 900 - Math.max(0, ratio - 2.8) * 0.12)
  );
  const productTokens =
    input.productText.toLowerCase().match(/[0-9a-z가-힣]{2,}/gi)?.slice(0, 24) ?? [];
  const hits = productTokens.filter((token) => input.ocrText.toLowerCase().includes(token)).length;
  const productRelevanceScore = Math.min(
    1,
    Math.max(0, (input.contextScore || 0) / 100 + hits * 0.09 + (input.type !== "not-review" ? 0.3 : 0))
  );
  const hookStrengthScore = input.keySentence
    ? Math.min(1, 0.35 + Math.min(0.35, input.keySentence.length / 90) + (/[!?ㅋㅎ]|진짜|정말|쓰자마자|재구매/.test(input.keySentence) ? 0.22 : 0))
    : 0;
  const specificityScore = input.keySentence
    ? Math.min(1, 0.3 + (/\d|향|맛|촉감|구성|사용|배송|가격|시원|부드/.test(input.keySentence) ? 0.45 : 0.15))
    : 0;
  const privacyRiskScore = Math.min(1, input.privacyCount * 0.16);
  const policyRiskScore = reviewPolicyRiskScore(input.ocrText);
  const overallReviewScore = Math.max(
    0,
    Math.min(
      1,
      imageQualityScore * 0.18 +
        input.ocrConfidence * 0.16 +
        productRelevanceScore * 0.24 +
        hookStrengthScore * 0.22 +
        specificityScore * 0.2 -
        policyRiskScore * 0.22
    )
  );
  return {
    imageQualityScore,
    productRelevanceScore,
    hookStrengthScore,
    specificityScore,
    privacyRiskScore,
    policyRiskScore,
    overallReviewScore,
  };
}

function normalizedOcrKey(value: string) {
  return value.replace(/[^0-9a-z가-힣]/gi, "").toLowerCase().slice(0, 180);
}

function perceptualHashDistance(left?: string, right?: string) {
  if (!left || !right || left.length !== right.length) return Number.POSITIVE_INFINITY;
  let count = 0;
  for (let index = 0; index < left.length; index += 1) {
    const xor = Number.parseInt(left[index], 16) ^ Number.parseInt(right[index], 16);
    count += ((xor >> 0) & 1) + ((xor >> 1) & 1) + ((xor >> 2) & 1) + ((xor >> 3) & 1);
  }
  return count;
}

function textSimilarity(left: string, right: string) {
  const leftKey = normalizedOcrKey(left);
  const rightKey = normalizedOcrKey(right);
  if (leftKey.length < 24 || rightKey.length < 24) return 0;
  const grams = (value: string) =>
    new Set(Array.from({ length: Math.max(0, value.length - 2) }, (_, index) => value.slice(index, index + 3)));
  const a = grams(leftKey);
  const b = grams(rightKey);
  const intersection = [...a].filter((value) => b.has(value)).length;
  return intersection / Math.max(1, new Set([...a, ...b]).size);
}

export function dedupeReviewCandidates(candidates: ReviewSourceCandidate[]) {
  const kept: ReviewSourceCandidate[] = [];
  for (const candidate of [...candidates].sort((a, b) => {
    const areaDiff = b.width * b.height - a.width * a.height;
    return areaDiff || b.overallReviewScore - a.overallReviewScore;
  })) {
    const urlKey = (candidate.originalUrl || candidate.imagePath)
      .replace(/([?&])(w|h|width|height|quality|q|resize)=[^&]*/gi, "$1")
      .replace(/[?&]+$/, "");
    const textKey = normalizedOcrKey(candidate.ocrText);
    const duplicate = kept.some((item) => {
      const itemUrlKey = (item.originalUrl || item.imagePath)
        .replace(/([?&])(w|h|width|height|quality|q|resize)=[^&]*/gi, "$1")
        .replace(/[?&]+$/, "");
      return (
        (candidate.contentHash && candidate.contentHash === item.contentHash) ||
        urlKey === itemUrlKey ||
        perceptualHashDistance(candidate.perceptualHash, item.perceptualHash) <= 5 ||
        (textKey.length >= 24 &&
          (textKey === normalizedOcrKey(item.ocrText) || textSimilarity(candidate.ocrText, item.ocrText) >= 0.9))
      );
    });
    if (!duplicate) kept.push(candidate);
  }
  return kept.sort((a, b) => b.overallReviewScore - a.overallReviewScore);
}

export function recommendReviewTemplate(
  candidates: ReviewSourceCandidate[],
  selectedIds: string[] = []
): ReviewCreativeTemplate {
  const selected = candidates.filter((candidate) =>
    selectedIds.length ? selectedIds.includes(candidate.id) : candidate.recommended
  );
  const pool = selected.length ? selected : candidates.slice(0, 1);
  if (pool.some((candidate) => candidate.reviewType === "before-after"))
    return "before-after-usage";
  if (pool.length >= 2) return "review-collection";
  if (
    pool[0]?.reviewType === "community-reaction" ||
    (pool[0]?.keySentence.length || 0) <= 48
  )
    return "reaction-comment";
  return "real-review-focus";
}

export function buildReviewHeadline(candidate?: ReviewSourceCandidate) {
  const sentence = compactText(candidate?.keySentence || "");
  if (!sentence) return "실제 사용 후기에 먼저 나온 반응";
  const trimmed = [...sentence].slice(0, 34).join("").replace(/[“”\"]+/g, "");
  if (/쓰자마자|먹자마자|받자마자|바르자마자|입자마자|닿자마자/.test(trimmed))
    return `사용 직후 나온 반응: ${trimmed}`;
  if (/재구매|또\s*샀|쟁여|계속/.test(trimmed)) return `다시 찾게 된 이유: ${trimmed}`;
  if (/가격|가성비|구성|전기세|할인/.test(trimmed)) return `구매 이유가 된 한마디: ${trimmed}`;
  return `후기에서 먼저 눈에 띈 반응: ${trimmed}`;
}

export function reviewTemplateLabel(template: ReviewCreativeTemplate) {
  return {
    "reaction-comment": "댓글 반응형",
    "real-review-focus": "실후기 집중형",
    "review-collection": "후기 모음형",
    "before-after-usage": "사용 장면·전후형",
  }[template];
}

export function reviewTypeLabel(type: ReviewType) {
  return {
    "review-text-screenshot": "텍스트 후기 캡처",
    "review-photo-with-text": "사진+문구 후기",
    "review-photo-only": "후기 사진",
    "community-reaction": "커뮤니티 반응",
    "before-after": "전후 비교",
    "review-card": "쇼핑몰 후기 카드",
    "testimonial-graphic": "후기 디자인 이미지",
    "not-review": "후기 아님",
  }[type];
}
