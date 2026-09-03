import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { extractNumericTokens } from "../creative-generation/productTruth.ts";
import {
  isDomesticOriginCreativeSignal,
  isAmbiguousMerchantCredentialCreativeSignal,
  isIncompleteOcrCopyFragment,
  isNonDomesticOriginCreativeSignal,
  isPackageLabelOcrCopyNoise,
  isProhibitedAdCopySignal,
  isPromotionalProductSignal,
} from "../creative-generation/productSignalHygiene.ts";
import { ocrRasterImage } from "./reviewImageAnalysis.server.ts";
import { selectProductDetailOcrCandidates } from "./productDetailOcrSelection.ts";
import type { ProductDetailImageOcrInsight, ProductImageCandidate } from "./types.ts";

const DETAIL_OCR_VERSION = "product-detail-ocr-v4-complete-ad-facts-only";
const CACHE_PATH = path.join(process.cwd(), ".data", "product-detail-ocr-cache.json");
const MAX_CONCURRENCY = 2;
let cacheWriteQueue = Promise.resolve();

type DetailOcrCacheRecord = {
  key: string;
  insight: ProductDetailImageOcrInsight;
  createdAt: string;
};

const operationalNoticePattern = /(?:배송|택배|출고|도착|파손|압상|눌림|멍(?:이|은|을)?\s*(?:생길|발생)|교환|환불|반품|취소|CS\s*처리|고객\s*센터|고객센터|문의|보상|수령|송장|도서\s*산간|제주\s*추가|출고\s*수량|주문(?:하신|량|수량)|옵션\s*\(?사이즈\)?|상위\s*사이즈|대체\s*출고|처리(?:는|가)?\s*어려|처리\s*불가)/iu;
const apologyOrCautionPattern = /(?:양해\s*(?:부탁|바랍니다|해주세요)|유의\s*(?:바랍니다|해주세요)|주의\s*(?:바랍니다|해주세요)|확인\s*(?:부탁|바랍니다|해주세요)|참고\s*(?:부탁|바랍니다|해주세요)|미리\s*알려|공지\s*(?:드립니다|사항)|어려운\s*점|불가(?:합니다|한\s*점)|책임지지|감안\s*(?:바랍니다|해주세요))/iu;
const sellerDisclosurePattern = /(?:판매원|판매자|제조원|공급원|공급자|유통\s*전문\s*판매원|책임\s*판매업자|수입원|소분원|사업자|대표자|통신\s*판매|고객\s*상담|전화\s*번호|소재지|주소\s*[:：])/iu;
const productConstraintPattern = /(?:못난이|흠과|흠집|상처|쭈글|외관(?:이|은|상)?\s*(?:고르지|균일하지)|모양(?:이|은)?\s*(?:고르지|균일하지)|크기\s*(?:편차|차이)|색상\s*(?:편차|차이)|혼합과|주스용|가공용|비정형|표면\s*반점|자연\s*흠집|상품\s*특성상[^.!?]{0,24}(?:교환|환불|외관|모양|크기))/iu;
const negativeExperiencePattern = /(?:맛(?:이)?\s*없|효과(?:가)?\s*없|별로|실망|불만|최악|아쉽|불편|문제|하자|불량|상했|썩은|냄새(?:가)?\s*나|거부감|품질(?:이)?\s*떨어|추천하지\s*않)/iu;
const usableFactPattern = /(?:국내산|국산|원산지|산지|품종|제철|수확|당도|고당도|과즙|맛|향|풍미|식감|아삭|쫄깃|쫀득|달콤|고소|부드|촉촉|신선|숙성|건조|반건조|냉장|냉동|원재료|원료|성분|함량|무첨가|선별|제조|공정|구성|중량|용량|대용량|개입|인분|섭취|조리|활용|곁들|함께\s*먹|간식|식사|다과|선물|캠핑|가족|아이|어른|보관|포장|\d[\d,.]*\s*(?:kg|g|ml|l|개|팩|봉|병|박스|원|%))/iu;

function normalizeLine(value: string) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[★◆■▶▷✅✔✓🔥🚨💥]+/gu, " ")
    .replace(/^[\s=~_\-·•※*]+|[\s=~_\-·•※*]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function signature(value: string) {
  return normalizeLine(value).replace(/[^0-9a-z가-힣]/gi, "").toLowerCase();
}

function productTokens(value: string) {
  return Array.from(value.normalize("NFKC").matchAll(/[0-9a-z가-힣]+/gi))
    .map((match) => match[0].toLowerCase())
    .filter((token) => token.length >= 2 && !/^(?:상품|제품|판매|가격|특가|대용량|추천|국내산|제철)$/.test(token));
}

function numericFactsAreVerified(value: string, authoritativeText: string) {
  const observed = extractNumericTokens(value);
  if (!observed.length) return true;
  const allowed = new Set(extractNumericTokens(authoritativeText));
  return observed.every((token) => allowed.has(token));
}

function relevantToProduct(value: string, authoritativeText: string) {
  if (usableFactPattern.test(value)) return true;
  const source = authoritativeText.toLowerCase();
  return productTokens(value).some((token) => source.includes(token));
}

export function classifyProductDetailOcrLines(input: { lines: string[]; authoritativeText: string }) {
  const copyFacts: string[] = [];
  const productConstraints: string[] = [];
  const identityOnlyLabels: string[] = [];
  const discardedNotices: string[] = [];
  const seen = new Set<string>();

  for (const rawLine of input.lines) {
    const value = normalizeLine(rawLine);
    const key = signature(value);
    if (!key || key.length < 4 || seen.has(key)) continue;
    seen.add(key);

    const operational = operationalNoticePattern.test(value);
    const prohibited =
      operational ||
      apologyOrCautionPattern.test(value) ||
      sellerDisclosurePattern.test(value) ||
      negativeExperiencePattern.test(value) ||
      isProhibitedAdCopySignal(value);
    if (prohibited) {
      discardedNotices.push(value);
      continue;
    }
    if (isIncompleteOcrCopyFragment(value)) {
      discardedNotices.push(value);
      continue;
    }
    if (isAmbiguousMerchantCredentialCreativeSignal(value)) {
      discardedNotices.push(value);
      continue;
    }
    if (productConstraintPattern.test(value)) {
      productConstraints.push(value);
      continue;
    }
    if (isPackageLabelOcrCopyNoise(value)) {
      identityOnlyLabels.push(value);
      continue;
    }
    if (isNonDomesticOriginCreativeSignal(value) || !numericFactsAreVerified(value, input.authoritativeText)) {
      discardedNotices.push(value);
      continue;
    }
    if (!relevantToProduct(value, input.authoritativeText)) continue;
    if (isPromotionalProductSignal(value) && !numericFactsAreVerified(value, input.authoritativeText)) {
      discardedNotices.push(value);
      continue;
    }
    // 여기서는 OCR 사실만 분류합니다. 실제 광고 사용 여부는 ProductTruth가
    // 상품군을 확인해 국내산 육류일 때만 허용합니다.
    if (/(?:원산지|산지|\S+산)/u.test(value) && !isDomesticOriginCreativeSignal(value)) {
      discardedNotices.push(value);
      continue;
    }
    copyFacts.push(value);
  }

  return {
    copyFacts: copyFacts.slice(0, 12),
    productConstraints: productConstraints.slice(0, 12),
    identityOnlyLabels: identityOnlyLabels.slice(0, 24),
    discardedNotices: discardedNotices.slice(0, 24),
  };
}

async function readCache() {
  try {
    const parsed = JSON.parse(await fs.readFile(CACHE_PATH, "utf8"));
    return Array.isArray(parsed) ? (parsed as DetailOcrCacheRecord[]) : [];
  } catch {
    return [] as DetailOcrCacheRecord[];
  }
}

function cacheKey(imageUrl: string, authoritativeText: string) {
  return createHash("sha256").update(`${DETAIL_OCR_VERSION}:${imageUrl}:${authoritativeText}`).digest("hex");
}

function saveCache(key: string, insight: ProductDetailImageOcrInsight) {
  cacheWriteQueue = cacheWriteQueue.then(async () => {
    const records = (await readCache()).filter((record) => record.key !== key).slice(-299);
    records.push({ key, insight, createdAt: new Date().toISOString() });
    await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
    const temporary = `${CACHE_PATH}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(records, null, 2), "utf8");
    await fs.rename(temporary, CACHE_PATH);
  });
  return cacheWriteQueue;
}

async function analyzeOne(candidate: ProductImageCandidate, authoritativeText: string) {
  const key = cacheKey(candidate.url, authoritativeText);
  const cached = (await readCache()).find((record) => record.key === key)?.insight;
  if (cached) return cached;

  const ocr = await ocrRasterImage(candidate.url, { localFirst: true });
  const classified = classifyProductDetailOcrLines({
    lines: ocr.lines.map((line) => line.text || ""),
    authoritativeText,
  });
  const insight: ProductDetailImageOcrInsight = {
    id: `detail-ocr-${ocr.contentHash.slice(0, 12)}`,
    imageUrl: candidate.url,
    contentHash: ocr.contentHash,
    ocrText: ocr.ocrText,
    ocrProvider: ocr.provider,
    ocrConfidence: ocr.ocrConfidence,
    ...classified,
    warnings: [ocr.warning, ocr.provider === "unavailable" ? "상세 이미지 OCR을 사용할 수 없어 이 이미지는 카피 근거에서 제외했습니다." : ""].filter(Boolean) as string[],
  };
  if (ocr.provider !== "unavailable") await saveCache(key, insight);
  return insight;
}

export async function analyzeProductDetailImageCandidates(input: {
  candidates: ProductImageCandidate[];
  productName: string;
  category?: string;
  price?: string;
  originalPrice?: string;
  discountInfo?: string;
  description?: string;
  verifiedBenefits?: string[];
  ingredients?: string[];
  maxCandidates?: number;
}) {
  const selected = selectProductDetailOcrCandidates(input.candidates, input.maxCandidates ?? 8);
  const authoritativeText = [
    input.productName,
    input.category,
    input.price,
    input.originalPrice,
    input.discountInfo,
    input.description,
    ...(input.verifiedBenefits || []),
    ...(input.ingredients || []),
  ]
    .filter(Boolean)
    .join(" · ");
  const results: ProductDetailImageOcrInsight[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, selected.length) }, async () => {
    while (cursor < selected.length) {
      const candidate = selected[cursor];
      cursor += 1;
      try {
        const insight = await analyzeOne(candidate, authoritativeText);
        if (insight.copyFacts.length || insight.productConstraints.length || insight.identityOnlyLabels?.length || insight.discardedNotices.length) results.push(insight);
      } catch {
        // 상세 이미지 한 장의 실패가 상품 분석과 나머지 이미지 OCR을 막지 않습니다.
      }
    }
  });
  await Promise.all(workers);
  return results;
}
