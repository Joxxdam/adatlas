import { cleanProductTitle } from "./productTruth.ts";

const marketingPrefixPattern = /(?:\d+\s*일|숙성|미친\s*맛|맛집|특가|할인|한정|오늘|지금|추석|설날|명절|파격|역대급|추천|핫딜|무료\s*배송|품절\s*임박)/iu;

function compactFileStem(value: string) {
  return Array.from(
    String(value || "")
      .normalize("NFKC")
      .replace(/<[^>]*>/g, " ")
      .replace(/[\[【(]([^\]】)]{0,60})[\]】)]/gu, (_match, content: string) => (marketingPrefixPattern.test(content) ? " " : ` ${content} `))
      .replace(/[★☆*✅⚡🔥🚨💥]+/gu, " ")
      .replace(/[^\p{L}\p{N}]+/gu, "")
  )
    .slice(0, 64)
    .join("");
}

/**
 * 사람이 파일 목록에서 바로 알아볼 수 있도록 상품명만 남긴다.
 * 광고성 앞 문구가 하이픈으로 상품명과 분리된 경우에만 앞부분을 버려
 * 정상 상품명 안의 하이픈을 과도하게 제거하지 않는다.
 */
export function productDownloadStem(productName: string) {
  const normalized = cleanProductTitle(productName)
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
  const segments = normalized.split(/\s*[-–—|｜]\s*/u).filter(Boolean);
  const campaignBoundary = segments.findIndex((_segment, index) => index > 0 && marketingPrefixPattern.test(segments.slice(0, index).join(" ")));
  const core = campaignBoundary > 0 ? segments.slice(campaignBoundary).join(" ") : normalized;
  return compactFileStem(core) || "상품";
}

export function numberedProductImageFileName(productName: string, sequence: number, extension = "jpg") {
  const safeSequence = Number.isFinite(sequence) && sequence > 0 ? Math.floor(sequence) : 1;
  const safeExtension = String(extension || "jpg")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "") || "jpg";
  return `${productDownloadStem(productName)}_${safeSequence}.${safeExtension}`;
}

export function downloadSequenceFromCodes(codes: Array<string | undefined>, fallback = 1) {
  for (const code of codes) {
    const matched = String(code || "").match(/(?:^|[-_])(?:H|M)?0*(\d{1,3})(?=$|[-_.])/i) || String(code || "").match(/(?:H|M)0*(\d{1,3})/i);
    const sequence = Number(matched?.[1]);
    if (Number.isFinite(sequence) && sequence > 0) return sequence;
  }
  return fallback;
}
