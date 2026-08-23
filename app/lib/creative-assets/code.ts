const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const BOILERPLATE_TOKENS = new Set(["brand", "product", "generic", "item", "asset"]);

export const hookCodeLabels = {
  SEN: "강한 감각·장면형",
  CUR: "궁금증형",
  PRC: "가격·혜택형",
  USP: "핵심 USP형",
  REV: "후기·신뢰형",
  PRB: "문제 해결형",
  EMP: "상황 공감형",
  BRD: "브랜드 메시지형",
  URG: "긴급성·한정형",
  VAL: "가성비형",
  EVT: "이벤트·프로모션형",
  RPT: "재구매형",
  CRT: "장바구니 리타겟팅형",
  BND: "세트 구성형",
  NEW: "신상품 탐색형",
  GRW: "성장세 활용형",
  CTL: "기존 소재 대조군",
  ETC: "기타",
} as const;

export type CreativeHookCode = keyof typeof hookCodeLabels;

const hookAliases: Array<[CreativeHookCode, string[]]> = [
  ["SEN", ["sensory", "sense", "감각", "장면"]],
  ["CUR", ["curiosity", "question", "궁금", "호기심"]],
  ["BRD", ["brand-story", "brand-message", "브랜드", "철학"]],
  ["URG", ["urgency", "limited", "deadline", "긴급", "한정", "마감"]],
  ["PRC", ["price", "discount", "benefit", "offer", "가격", "할인", "혜택"]],
  ["USP", ["usp", "feature", "product-hero", "proof-data", "핵심", "기능", "특징"]],
  ["REV", ["review", "testimonial", "social-proof", "ugc", "후기", "리뷰", "신뢰"]],
  ["PRB", ["problem", "solution", "comparison", "pain", "문제", "해결", "고민"]],
  ["EMP", ["empathy", "situation", "editorial-story", "lifestyle", "공감", "상황"]],
  ["VAL", ["value", "cost-effective", "가성비"]],
  ["EVT", ["event", "promotion", "promo", "이벤트", "프로모션"]],
  ["RPT", ["repeat", "repurchase", "routine", "재구매"]],
  ["CRT", ["cart", "retarget", "장바구니", "리타겟"]],
  ["BND", ["bundle", "set", "세트", "묶음"]],
  ["NEW", ["new-product", "launch", "신상품", "출시"]],
  ["GRW", ["growth", "rising", "성장", "상승"]],
  ["CTL", ["control", "baseline", "대조군", "기존소재"]],
];

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase();
}

function tokens(value: string) {
  return (
    String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.filter((token) => !BOILERPLATE_TOKENS.has(token)) || []
  );
}

function readableCode(value: string) {
  const parts = tokens(value);
  if (!parts.length) return "";
  const first = parts[0].toUpperCase();
  if (first.length >= 3 && first.length <= 5) return first;
  if (parts.length > 1) {
    const acronym = `${first.slice(0, 2)}${parts
      .slice(1)
      .map((part) => part[0])
      .join("")}`;
    if (acronym.length >= 3) return acronym.slice(0, 5).toUpperCase();
  }
  return first.slice(0, 5).padEnd(3, stableHash(value).slice(0, 3));
}

function createEntityCode(name: string, stableId: string | undefined, fallback: "BRD" | "PRD") {
  const idCode = readableCode(stableId || "");
  const nameCode = readableCode(name);
  const direct = idCode || nameCode;
  if (direct) return direct.slice(0, 5).padEnd(3, stableHash(`${stableId}|${name}`).slice(0, 3));
  const hash = stableHash(`${stableId || fallback}|${name || fallback}`);
  return `${fallback[0]}${hash}`.slice(0, 5).padEnd(3, "0");
}

export function createBrandCode(brandName: string, stableBrandId?: string) {
  return createEntityCode(brandName, stableBrandId, "BRD");
}

export function createProductCode(productName: string, stableProductId?: string) {
  return createEntityCode(productName, stableProductId, "PRD");
}

export function getHookCode(hookType: string): CreativeHookCode {
  const normalized = String(hookType || "")
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
  if ((Object.keys(hookCodeLabels) as string[]).includes(normalized.toUpperCase())) {
    return normalized.toUpperCase() as CreativeHookCode;
  }
  return hookAliases.find(([, aliases]) => aliases.some((alias) => normalized.includes(alias)))?.[0] || "ETC";
}

export function getHookLabel(hookTypeOrCode: string) {
  return hookCodeLabels[getHookCode(hookTypeOrCode)];
}

const uniqueSpace = CODE_ALPHABET.length ** 4;
const uniqueSeed = new Uint32Array(1);
globalThis.crypto.getRandomValues(uniqueSeed);
let uniqueCounter = uniqueSeed[0] % uniqueSpace;

function randomUnique() {
  uniqueCounter = (uniqueCounter + 1) % uniqueSpace;
  let value = uniqueCounter;
  let result = "";
  for (let index = 0; index < 4; index += 1) {
    result = CODE_ALPHABET[value % CODE_ALPHABET.length] + result;
    value = Math.floor(value / CODE_ALPHABET.length);
  }
  return result;
}

function compactDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getFullYear() % 100)}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

export function generateCreativeAssetCode(input: { brandCode: string; productCode: string; hookType?: string; hookCode?: CreativeHookCode; createdAt?: string | Date; unique?: string }) {
  const brandCode = createBrandCode(input.brandCode);
  const productCode = createProductCode(input.productCode);
  const hookCode = input.hookCode || getHookCode(input.hookType || "");
  const createdAt = input.createdAt instanceof Date ? input.createdAt : new Date(input.createdAt || Date.now());
  if (Number.isNaN(createdAt.getTime())) throw new Error("소재 생성 날짜가 올바르지 않습니다.");
  const unique = String(input.unique || randomUnique()).toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(unique)) throw new Error("소재 고유값은 영문 대문자와 숫자 4자리여야 합니다.");
  return `AT-${brandCode}-${productCode}-${hookCode}-${compactDate(createdAt)}-${unique}`;
}

export function createHookVariantAssetCode(input: { brandCode: string; productCode: string; testCode: string; hookVariantCode: string; version?: number }) {
  const brandCode = createBrandCode(input.brandCode);
  const productCode = createProductCode(input.productCode);
  const testCode = String(input.testCode || "").toUpperCase();
  const hookVariantCode = String(input.hookVariantCode || "").toUpperCase();
  if (!/^T\d{2}$/.test(testCode)) throw new Error("후킹 테스트 코드는 T01 형식이어야 합니다.");
  if (!/^H0[1-6]$/.test(hookVariantCode)) throw new Error("후킹 변형 코드는 H01~H06이어야 합니다.");
  const version = Math.max(1, Math.floor(input.version || 1));
  return `AT-${brandCode}-${productCode}-${testCode}-${hookVariantCode}${version > 1 ? `-V${String(version).padStart(2, "0")}` : ""}`;
}

export function createExplorationAssetCode(input: { brandCode: string; productCode: string; explorationCode?: string; hookVariantCode: string; conceptCode: string; version?: number }) {
  const brandCode = createBrandCode(input.brandCode);
  const productCode = createProductCode(input.productCode);
  const explorationCode = String(input.explorationCode || "E01").toUpperCase();
  const hookVariantCode = String(input.hookVariantCode || "").toUpperCase();
  const conceptCode = String(input.conceptCode || "").toUpperCase();
  if (!/^E\d{2}$/.test(explorationCode)) throw new Error("광고 탐색 코드는 E01 형식이어야 합니다.");
  if (!/^H0[1-6]$/.test(hookVariantCode)) throw new Error("탐색 후킹 코드는 H01~H06이어야 합니다.");
  if (!/^C\d{2}$/.test(conceptCode)) throw new Error("광고 콘셉트 코드는 C01 형식이어야 합니다.");
  const version = Math.max(1, Math.floor(input.version || 1));
  return `AT-${brandCode}-${productCode}-${explorationCode}-${hookVariantCode}-${conceptCode}${version > 1 ? `-V${String(version).padStart(2, "0")}` : ""}`;
}

const legacyHookCodeSource = Object.keys(hookCodeLabels).join("|");
const assetCodeSource = `AT-[A-Z0-9]{3,5}-[A-Z0-9]{3,5}-(?:${legacyHookCodeSource})-\\d{6}-[A-Z0-9]{4}`;
const experimentAssetCodeSource = `AT-[A-Z0-9]{3,5}-[A-Z0-9]{1,12}-(?:${legacyHookCodeSource.replace("|ETC", "")})-T\\d{2}-[A-Z][A-Z0-9]{0,2}(?:-V\\d{2})?`;
const hookVariantAssetCodeSource = `AT-[A-Z0-9]{3,5}-[A-Z0-9]{3,5}-T\\d{2}-H0[1-8](?:-V\\d{2})?`;
const explorationAssetCodeSource = `AT-[A-Z0-9]{3,5}-[A-Z0-9]{3,5}-E\\d{2}-H0[1-6]-C\\d{2}(?:-V\\d{2})?`;
export const creativeAssetCodePattern = new RegExp(`^(?:${assetCodeSource}|${experimentAssetCodeSource}|${hookVariantAssetCodeSource}|${explorationAssetCodeSource})$`);

function hasValidDate(assetCode: string) {
  const date = assetCode.split("-").at(-2);
  if (!date || !/^\d{6}$/.test(date)) return false;
  const year = 2000 + Number(date.slice(0, 2));
  const month = Number(date.slice(2, 4));
  const day = Number(date.slice(4, 6));
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
}

export function validateCreativeAssetCode(value: string) {
  const normalized = String(value || "").trim();
  if (new RegExp(`^${explorationAssetCodeSource}$`).test(normalized)) return true;
  if (new RegExp(`^${experimentAssetCodeSource}$`).test(normalized)) return true;
  if (new RegExp(`^${hookVariantAssetCodeSource}$`).test(normalized)) return true;
  return new RegExp(`^${assetCodeSource}$`).test(normalized) && hasValidDate(normalized);
}

export function extractCreativeAssetCode(value: string) {
  const candidates = Array.from(String(value || "").matchAll(new RegExp(`(?:^|[^A-Z0-9])(${explorationAssetCodeSource}|${hookVariantAssetCodeSource}|${experimentAssetCodeSource}|${assetCodeSource})(?![A-Z0-9])`, "g")), (match) => match[1]);
  return candidates.find((candidate) => validateCreativeAssetCode(candidate)) || null;
}

export function extensionFromImageUrl(imageUrl: string) {
  const pathname = String(imageUrl || "").split(/[?#]/)[0];
  const match = pathname.match(/\.(png|jpe?g|webp|avif)$/i);
  if (!match) return "png";
  return match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
}
