import { ContentAnalysis, CrawledContent, WatchlistBrand } from "./types";

const hookKeywords = [
  "?",
  "왜",
  "혹시",
  "지금",
  "단독",
  "특가",
  "랭킹",
  "베스트",
  "BEST",
  "한정",
  "무료",
  "할인",
];
const ctaKeywords = [
  "보기",
  "구매",
  "확인",
  "받기",
  "신청",
  "예약",
  "만나",
  "shop",
  "buy",
  "learn",
  "discover",
];

function splitPhrases(text: string) {
  return text
    .replace(/\s+/g, " ")
    .split(/[\n.!?。]| - | \| /)
    .map((item) => item.trim())
    .filter((item) => item.length >= 4 && item.length <= 90);
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function scoreBySignals(text: string, signals: string[]) {
  const found = signals.filter((signal) =>
    text.toLowerCase().includes(signal.toLowerCase())
  ).length;
  return Math.min(98, 55 + found * 9 + Math.min(20, Math.round(text.length / 180)));
}

function detectFrames(text: string, hookPattern: string) {
  const source = `${text} ${hookPattern}`.toLowerCase();
  const frames = [];

  if (/(문제|고민|해결|solution|problem)/i.test(source)) frames.push("문제 해결");
  if (/(후기|리뷰|review|testimonial)/i.test(source)) frames.push("리뷰/후기");
  if (/(비교|vs|before|after|전후)/i.test(source)) frames.push("비교/전후");
  if (/(랭킹|best|top|리스트|가지)/i.test(source)) frames.push("리스트형");
  if (/(단독|한정|마감|오늘|지금)/i.test(source)) frames.push("희소성/긴급성");
  if (/(세일|특가|할인|쿠폰|price)/i.test(source)) frames.push("가격/할인");
  if (/(룩북|무드|라이프스타일|routine|daily)/i.test(source)) frames.push("라이프스타일");
  if (/(ugc|사용자|크리에이터|creator)/i.test(source)) frames.push("UGC");

  return frames.length ? unique(frames) : ["브랜드 스토리"];
}

function detectEmotion(text: string) {
  const emotions = [];
  if (/(신뢰|공식|검증|리뷰|후기|증명)/.test(text)) emotions.push("신뢰");
  if (/(한정|마감|오늘|지금|단독)/.test(text)) emotions.push("긴급");
  if (/(감도|무드|프리미엄|고급)/.test(text)) emotions.push("고급");
  if (/(편안|데일리|실용|기본)/.test(text)) emotions.push("실용");
  if (/(재미|챌린지|밈|트렌드)/.test(text)) emotions.push("재미");
  return emotions.length ? emotions : ["관심 유도"];
}

function extractHook(text: string, fallback: string) {
  const phrases = splitPhrases(text);
  return (
    phrases.find((phrase) => hookKeywords.some((keyword) => phrase.includes(keyword))) ??
    phrases[0] ??
    fallback
  );
}

function extractCta(text: string) {
  return unique(
    splitPhrases(text).filter((phrase) =>
      ctaKeywords.some((keyword) => phrase.toLowerCase().includes(keyword))
    )
  ).slice(0, 4);
}

function extractUsp(brand: WatchlistBrand, text: string) {
  const base = [brand.referenceStrength, brand.hookPattern, brand.category];
  const phrases = splitPhrases(text).filter((phrase) =>
    /(단독|무료|프리미엄|편안|빠른|공식|랭킹|후기|특가|고급|기능|효과)/.test(phrase)
  );
  return unique([...base, ...phrases]).slice(0, 6);
}

export function analyzeContent(brand: WatchlistBrand, content: CrawledContent): ContentAnalysis {
  const text = [
    content.title,
    content.description,
    content.text,
    brand.referenceStrength,
    brand.hookPattern,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 6000);
  const frames = detectFrames(text, brand.hookPattern);
  const hook = extractHook(text, brand.hookPattern || brand.referenceStrength);
  const usp = extractUsp(brand, text);
  const cta = extractCta(text);
  const analyzedAt = new Date().toISOString();
  const sourceKey = content.url ?? content.source;

  return {
    id: `${brand.id}:${content.source}:${Buffer.from(sourceKey).toString("base64url").slice(0, 24)}`,
    brandId: brand.id,
    brand: brand.brand,
    category: brand.category,
    priority: brand.priority,
    source: content.source,
    sourceUrl: content.url,
    mediaUrls: content.mediaUrls,
    hook,
    usp,
    cta: cta.length ? cta : ["상세 보기", "지금 확인"],
    frames,
    emotion: detectEmotion(text),
    contentType: frames.includes("가격/할인")
      ? "프로모션"
      : frames.includes("UGC")
        ? "UGC"
        : "브랜드 콘텐츠",
    copyScore: scoreBySignals(text, hookKeywords),
    uspScore: scoreBySignals(usp.join(" "), ["단독", "프리미엄", "효과", "고급", "편안", "공식"]),
    trendScore: scoreBySignals(text, [
      "트렌드",
      "랭킹",
      "베스트",
      "챌린지",
      "시즌",
      "여름",
      "겨울",
    ]),
    improvementSuggestions: [
      "첫 문장에 문제 상황이나 숫자 근거를 더 명확히 배치하세요.",
      "USP는 기능보다 고객이 얻는 변화 중심으로 다시 쓰면 전환성이 높아집니다.",
      "CTA는 하나의 행동으로 좁히고 기간/혜택 조건을 함께 제시하세요.",
    ],
    rawText: text,
    analyzedAt,
  };
}
