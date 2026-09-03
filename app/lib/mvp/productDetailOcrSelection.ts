import type { ProductDetailOcrEvidenceRole, ProductImageCandidate } from "./types";

const evidencePatterns: Array<[ProductDetailOcrEvidenceRole, RegExp]> = [
  ["offer", /(?:가격|판매가|정가|할인가|특가|할인|쿠폰|혜택|프로모션|price|sale|discount|coupon)/iu],
  ["composition", /(?:구성|중량|용량|수량|개입|팩|봉|병|세트|옵션|인분|kg|\bg\b|ml|liter|volume|size)/iu],
  ["benefit", /(?:특징|장점|소구|맛|풍미|식감|육즙|부드|고소|신선|숙성|보습|쿨링|세정|benefit|feature|quality|taste)/iu],
  ["ingredient", /(?:원재료|원료|성분|함량|함유|원산지|산지|국내산|한우|ingredients?|origin|material)/iu],
  ["usage", /(?:조리|레시피|사용법|섭취|보관|활용|먹는법|굽|끓|볶|전자레인지|에어프라이어|recipe|how\s*to|usage|cook)/iu],
];

function normalizedUrl(value: string) {
  try {
    const parsed = new URL(value);
    for (const key of ["width", "height", "w", "h", "quality", "q", "format", "auto"]) parsed.searchParams.delete(key);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return value.replace(/[?#].*$/, "");
  }
}

export function inferProductDetailOcrEvidenceRoles(value: string): ProductDetailOcrEvidenceRole[] {
  const roles = evidencePatterns.filter(([, pattern]) => pattern.test(value)).map(([role]) => role);
  return roles.length ? roles : ["unknown"];
}

function candidateScore(candidate: ProductImageCandidate, index: number) {
  const context = `${candidate.url} ${candidate.alt || ""} ${candidate.reason || ""}`;
  let score = candidate.score - index * 0.05;
  if (candidate.evidenceScope === "product-detail" || candidate.type === "detail" || candidate.type === "content") score += 30;
  if (/(?:detail|contents?|editor|description|goods_info|상세|상품정보|제품정보)/iu.test(context)) score += 18;
  if (/(?:banner|event|coupon|review|후기|리뷰|logo|icon|qr|appstore|playstore|recommend|related)/iu.test(context)) score -= 40;
  if (candidate.width && candidate.height && Math.min(candidate.width, candidate.height) >= 360) score += 5;
  return score;
}

function evenlySpaced<T>(values: T[], count: number) {
  if (count <= 0 || !values.length) return [];
  if (values.length <= count) return values;
  if (count === 1) return [values[Math.floor(values.length / 2)]];
  const selected: T[] = [];
  const used = new Set<number>();
  for (let index = 0; index < count; index += 1) {
    const position = Math.round((index * (values.length - 1)) / (count - 1));
    if (!used.has(position)) {
      used.add(position);
      selected.push(values[position]);
    }
  }
  return selected;
}

/**
 * OCR 장수를 늘리지 않고 상세페이지 전반과 근거 유형을 골고루 읽습니다.
 * 구조화 대표 이미지는 썸네일 검증용으로 최대 1장만 허용해 수상 배너나
 * 패키지 정면이 OCR 8장을 독점하지 않게 합니다.
 */
export function selectProductDetailOcrCandidates(candidates: ProductImageCandidate[], limit = 8) {
  const max = Math.max(0, Math.min(12, Math.floor(limit)));
  if (!max) return [];
  const seen = new Set<string>();
  const ranked = candidates
    .map((candidate, index) => ({ candidate, score: candidateScore(candidate, index), index }))
    .filter(({ candidate, score }) => Boolean(candidate.url) && score >= 5)
    .sort((left, right) => right.score - left.score)
    .filter(({ candidate }) => {
      const key = normalizedUrl(candidate.url);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const selected: typeof ranked = [];
  const selectedUrls = new Set<string>();
  const add = (entry: (typeof ranked)[number] | undefined) => {
    if (!entry || selected.length >= max) return;
    const key = normalizedUrl(entry.candidate.url);
    if (selectedUrls.has(key)) return;
    selectedUrls.add(key);
    selected.push(entry);
  };

  const isStructuredMain = (candidate: ProductImageCandidate) => candidate.evidenceScope === "structured-main" || (!candidate.evidenceScope && candidate.type === "main");
  const isProductDetail = (candidate: ProductImageCandidate) => candidate.evidenceScope
    ? candidate.evidenceScope === "product-detail"
    : candidate.type === "detail" || candidate.type === "content";
  const detail = ranked
    .filter(({ candidate }) => isProductDetail(candidate))
    .sort((left, right) => (left.candidate.pageOrder ?? left.index) - (right.candidate.pageOrder ?? right.index));
  const semanticRoles: ProductDetailOcrEvidenceRole[] = ["offer", "composition", "benefit", "ingredient", "usage"];
  for (const role of semanticRoles) {
    add(
      detail.find(({ candidate }) =>
        (candidate.evidenceRoles?.length ? candidate.evidenceRoles : inferProductDetailOcrEvidenceRoles(`${candidate.alt || ""} ${candidate.reason || ""} ${candidate.url}`)).includes(role)
      )
    );
  }

  const structuredMain = ranked.find(({ candidate }) => isStructuredMain(candidate));
  add(structuredMain);

  const remainingDetail = detail.filter(({ candidate }) => !selectedUrls.has(normalizedUrl(candidate.url)));
  for (const entry of evenlySpaced(remainingDetail, max - selected.length)) add(entry);

  // 일반 갤러리는 상세 본문이 부족할 때만 보충합니다. 구조화 대표 이미지는
  // 위에서 선택한 한 장 외에는 OCR 슬롯을 추가로 차지하지 않습니다.
  for (const entry of ranked.filter(({ candidate }) => !isStructuredMain(candidate))) add(entry);
  return selected.slice(0, max).map(({ candidate }) => candidate);
}

export function resolveProductDetailOcrBudget(input: { hasCuratedResearch: boolean; htmlFactCount: number; candidateCount: number }) {
  if (input.hasCuratedResearch || input.candidateCount <= 0) return 0;
  if (input.htmlFactCount >= 8) return Math.min(4, input.candidateCount);
  if (input.htmlFactCount >= 5) return Math.min(6, input.candidateCount);
  return Math.min(8, input.candidateCount);
}
