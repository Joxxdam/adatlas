import type { ProductReviewAnalysis } from "./types";
import { cleanText, uniqueStrings } from "./htmlUtils";

const POSITIVE_KEYWORDS = [
  "부드러움",
  "부드럽",
  "맛있",
  "신선",
  "잡내 없",
  "양이 많",
  "넉넉",
  "가성비",
  "포장",
  "배송",
  "재구매",
  "만족",
  "편리",
  "고급",
  "촉촉",
  "향",
];

const NEGATIVE_KEYWORDS = [
  "질김",
  "질기",
  "잡내",
  "지방",
  "느끼",
  "작음",
  "적음",
  "비쌈",
  "아쉬",
  "파손",
  "누락",
  "늦",
  "불편",
  "건조",
];

const SITUATIONS: Array<[string, RegExp]> = [
  ["가족식사", /가족|아이|부모님|식구|저녁|반찬/],
  ["캠핑", /캠핑|바비큐|바베큐|여행|펜션/],
  ["선물", /선물|명절|부모님|지인/],
  ["운동·건강관리", /운동|단백질|식단|다이어트|건강/],
  ["재구매", /재구매|또\s*구매|다시\s*주문/],
];

function countMatches(texts: string[], keyword: string) {
  return texts.reduce((count, text) => count + (text.includes(keyword) ? 1 : 0), 0);
}

function displayKeyword(keyword: string) {
  if (keyword === "부드럽") return "부드러움";
  if (keyword === "맛있") return "맛";
  if (keyword === "잡내 없") return "잡내 없음";
  if (keyword === "양이 많") return "넉넉한 양";
  if (keyword === "질기" || keyword === "질김") return "질김";
  if (keyword === "비쌈") return "가격 부담";
  if (keyword === "아쉬") return "아쉬움";
  return keyword;
}

export function analyzeReviewTexts(params: {
  reviewTexts: string[];
  reviewCount?: number;
  averageRating?: number;
}): ProductReviewAnalysis | undefined {
  const texts = uniqueStrings(
    params.reviewTexts.map((text) => cleanText(text, 360)).filter((text) => text.length >= 8),
    80
  );
  if (!texts.length && params.reviewCount === undefined && params.averageRating === undefined) {
    return undefined;
  }
  const occurrenceThreshold = texts.length >= 3 ? 2 : 1;
  const positive = POSITIVE_KEYWORDS.map((keyword) => ({
    keyword,
    count: countMatches(texts, keyword),
  }))
    .filter((item) => item.count >= occurrenceThreshold)
    .sort((a, b) => b.count - a.count);
  const negative = NEGATIVE_KEYWORDS.map((keyword) => ({
    keyword,
    count: countMatches(texts, keyword),
  }))
    .filter((item) => item.count >= occurrenceThreshold)
    .sort((a, b) => b.count - a.count);
  const situations = SITUATIONS.map(([name, pattern]) => ({
    name,
    count: texts.filter((text) => pattern.test(text)).length,
  }))
    .filter((item) => item.count >= occurrenceThreshold)
    .sort((a, b) => b.count - a.count);
  const repeatedBenefits = positive
    .filter((item) => item.count >= 2)
    .map((item) => displayKeyword(item.keyword));
  const repeatedComplaints = negative
    .filter((item) => item.count >= 2)
    .map((item) => displayKeyword(item.keyword));
  const positiveKeywords = uniqueStrings(
    positive.map((item) => displayKeyword(item.keyword)),
    8
  );
  const negativeKeywords = uniqueStrings(
    negative.map((item) => displayKeyword(item.keyword)),
    8
  );
  const purchaseSituations = situations.map((item) => item.name);
  const copyUsableInsights = uniqueStrings(
    [
      ...repeatedBenefits.map((keyword) => `후기에서 '${keyword}' 장점이 반복 확인됨`),
      ...purchaseSituations.map((situation) => `'${situation}' 구매·사용 상황이 확인됨`),
    ],
    8
  );
  const sampleConfidence = Math.min(1, texts.length / 12);
  const countConfidence = params.reviewCount
    ? Math.min(1, Math.log10(params.reviewCount + 1) / 2)
    : 0;

  return {
    reviewCount: params.reviewCount,
    averageRating: params.averageRating,
    positiveKeywords,
    negativeKeywords,
    purchaseSituations,
    repeatedBenefits,
    repeatedComplaints,
    copyUsableInsights,
    sourceReviewCount: texts.length,
    confidence: Math.round(Math.max(sampleConfidence, countConfidence * 0.55) * 100) / 100,
  };
}
