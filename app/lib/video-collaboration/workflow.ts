import crypto from "node:crypto";
import { createBrandCode, createProductCode } from "../creative-assets/code.ts";
import type {
  ProductAnalysisSnapshot,
  VideoHookType,
  VideoProject,
  VideoProjectStatus,
} from "./types.ts";

export const VIDEO_STATUS_LABELS: Record<VideoProjectStatus, string> = {
  script_pending: "기획 중",
  script_review: "기획안 검토",
  concept_selected: "기획안 선택",
  production_requested: "제작 요청",
  in_production: "제작 중",
  marketer_review: "검수 요청",
  revision_requested: "수정 중",
  approved: "완료",
};

export const VIDEO_HOOK_LABELS: Record<VideoHookType, string> = {
  "problem-solution": "문제 해결형",
  "price-benefit": "가격·혜택형",
  "feature-usp": "핵심 USP형",
  "sensory-scene": "감각·장면형",
  curiosity: "궁금증형",
  "review-trust": "후기·신뢰형",
  "brand-message": "브랜드 메시지형",
  "loss-aversion": "손해 회피형",
  "unexpected-comparison": "예상 밖 비교형",
  "origin-material": "원산지·원물형",
  "before-after": "사용 전후형",
  "seasonal-situation": "계절·상황형",
  "myth-busting": "상식 뒤집기형",
  "user-monologue": "사용자 독백형",
};

export const VIDEO_FORMAT_LABELS = {
  "short-form": "숏폼",
  reels: "릴스",
  feed: "피드",
  other: "기타",
} as const;

export const VIDEO_OBJECTIVE_LABELS = {
  purchase: "구매 전환",
  "new-customer-hook": "신규 고객 후킹",
  retargeting: "리타겟팅",
  usp: "USP 강조",
  "review-ugc": "후기형 UGC",
  interest: "관심 유도",
  "new-product": "신상품 소개",
  benefit: "혜택 안내",
} as const;

const transitions: Record<VideoProjectStatus, VideoProjectStatus[]> = {
  script_pending: ["script_review"],
  script_review: ["concept_selected", "production_requested"],
  concept_selected: ["script_review", "production_requested"],
  production_requested: ["in_production"],
  in_production: ["marketer_review"],
  marketer_review: ["revision_requested", "approved"],
  revision_requested: ["marketer_review"],
  approved: [],
};

export function canTransitionVideoProject(from: VideoProjectStatus, to: VideoProjectStatus) {
  return from === to || transitions[from].includes(to);
}

export function assertVideoProjectTransition(from: VideoProjectStatus, to: VideoProjectStatus) {
  if (!canTransitionVideoProject(from, to)) {
    throw new Error(
      `${VIDEO_STATUS_LABELS[from]} 상태에서는 ${VIDEO_STATUS_LABELS[to]} 상태로 변경할 수 없습니다.`
    );
  }
}

const hookCode: Record<VideoHookType, string> = {
  "problem-solution": "PROBLEM",
  "price-benefit": "BENEFIT",
  "feature-usp": "USP",
  "sensory-scene": "SENSORY",
  curiosity: "CURIOSITY",
  "review-trust": "REVIEW",
  "brand-message": "BRAND",
  "loss-aversion": "LOSS",
  "unexpected-comparison": "COMPARE",
  "origin-material": "ORIGIN",
  "before-after": "CHANGE",
  "seasonal-situation": "SEASON",
  "myth-busting": "MYTH",
  "user-monologue": "MONOLOGUE",
};

function readableSegment(value: string, fallback: string) {
  const ascii = value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase()
    .slice(0, 24);
  return ascii || fallback;
}

function dateSegment(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}${byType.month}${byType.day}`;
}

export function createVideoMaterialCode(input: {
  advertiserName: string;
  productName: string;
  hookType: VideoHookType;
  existingCodes?: string[];
  createdAt?: Date;
}) {
  const brand = readableSegment(
    input.advertiserName,
    createBrandCode(input.advertiserName || "브랜드", input.advertiserName || "brand")
  );
  const product = readableSegment(
    input.productName,
    createProductCode(input.productName || "상품", input.productName || "product")
  );
  const base = `VIDEO_${brand}_${product}_${hookCode[input.hookType]}_${dateSegment(input.createdAt || new Date())}`;
  const occupied = new Set((input.existingCodes || []).map((value) => value.toUpperCase()));
  for (let index = 1; index <= 99; index += 1) {
    const candidate = `${base}_${String(index).padStart(2, "0")}`;
    if (!occupied.has(candidate)) return candidate;
  }
  throw new Error("중복되지 않는 영상 소재코드를 만들지 못했습니다.");
}

export function validateVideoMaterialCode(value: string) {
  return /^VIDEO_[A-Z0-9_]{2,24}_[A-Z0-9_]{2,24}_(?:PROBLEM|BENEFIT|USP|SENSORY|CURIOSITY|REVIEW|BRAND|LOSS|COMPARE|ORIGIN|CHANGE|SEASON|MYTH|MONOLOGUE)_\d{8}_\d{2}$/.test(
    value
  );
}

function compactUnique(values: unknown[], limit = 8) {
  const found: string[] = [];
  const keys = new Set<string>();
  for (const value of values) {
    const text = String(value || "")
      .replace(/\s+/g, " ")
      .trim();
    const key = text.replace(/[^0-9a-z가-힣]/gi, "").toLowerCase();
    if (!text || !key || keys.has(key)) continue;
    keys.add(key);
    found.push(text.slice(0, 180));
    if (found.length >= limit) break;
  }
  return found;
}

type ExistingProductExtraction = {
  productName?: string;
  brandName?: string;
  category?: string;
  price?: string;
  originalPrice?: string;
  discountInfo?: string;
  description?: string;
  extractedDescription?: string;
  verifiedBenefits?: string[];
  ingredients?: string[];
  galleryImages?: string[];
  detailImages?: string[];
  mainImage?: string;
  reviewSources?: Array<{ keySentence?: string; ocrText?: string }>;
};

export function buildVideoProductAnalysis(
  productUrl: string,
  product: ExistingProductExtraction,
  analyzedAt = new Date().toISOString()
): ProductAnalysisSnapshot {
  const description = String(product.extractedDescription || product.description || "").trim();
  const descriptionParts = description
    .split(/\s*[·•|]\s*|[.!?]\s+/)
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter((value) => value.length >= 4 && value.length <= 180);
  const verified = compactUnique(product.verifiedBenefits || [], 8);
  const ingredients = compactUnique(product.ingredients || [], 6);
  const trustSignals = compactUnique(
    (product.reviewSources || []).flatMap((review) => [review.keySentence, review.ocrText]),
    5
  );
  const features = compactUnique([...verified, ...ingredients, ...descriptionParts], 8);
  const verifiedNumbers = compactUnique(
    [product.price, product.originalPrice, product.discountInfo, ...verified, ...features].flatMap(
      (value) => String(value || "").match(/[^\s,;]*\d[\d,.]*[^\s,;]*/g) || []
    ),
    12
  );
  const facts = [
    ["상품명", product.productName, "상품 상세페이지"],
    ["브랜드", product.brandName, "상품 상세페이지"],
    ["가격", product.price, "상품 상세페이지"],
    ["할인·혜택", product.discountInfo, "상품 상세페이지"],
    ...verified.map((value) => ["확인된 혜택", value, "상품 상세페이지"]),
    ...ingredients.map((value) => ["성분·원재료", value, "상품 상세페이지"]),
    ...trustSignals.map((value) => ["공개 후기 문구", value, "공개 후기"]),
  ]
    .filter((item) => String(item[1] || "").trim())
    .map((item, index) => ({
      id: `fact-${index + 1}`,
      label: String(item[0]),
      value: String(item[1]).trim(),
      source: String(item[2]),
      bucket: "verified" as const,
    }));
  return {
    productName: String(product.productName || "").trim(),
    brandName: String(product.brandName || "").trim(),
    category: String(product.category || "").trim(),
    productUrl,
    price: String(product.price || "").trim(),
    originalPrice: String(product.originalPrice || "").trim(),
    discountInfo: String(product.discountInfo || "").trim(),
    coreUsps: compactUnique([...verified, ...ingredients, ...descriptionParts], 5),
    keyFeatures: features,
    targetCustomers: [],
    customerProblems: [],
    trustSignals,
    cautionPhrases: [
      "상세페이지에서 확인되지 않은 효능·수치·판매 성과를 추가하지 않습니다.",
      "가격과 혜택은 게시 시점에 다시 확인합니다.",
    ],
    imageUrls: compactUnique(
      [product.mainImage, ...(product.galleryImages || []), ...(product.detailImages || [])],
      16
    ),
    rawDescription: description.slice(0, 2400),
    ingredients,
    attributes: features,
    expectedChanges: [],
    verifiedNumbers,
    repeatedReviewPhrases: trustSignals,
    differentiators: verified,
    useSituations: [],
    visualizableElements: compactUnique([...ingredients, ...verified, ...features], 6),
    verifiedFacts: facts,
    productType: String(product.category || "").trim(),
    composition: compactUnique(verified.filter((value) => /구성|세트|입|개|팩|병|묶음/i.test(value)), 6),
    shippingConditions: compactUnique(
      [product.discountInfo, ...verified].filter((value) => /배송|출고|택배|도착/i.test(String(value || ""))),
      5
    ),
    manufacturingProcess: compactUnique(descriptionParts.filter((value) => /제조|생산|가공|착즙|숙성|수확|배합|공정/i.test(value)), 6),
    certifications: compactUnique(descriptionParts.filter((value) => /인증|검사|HACCP|비건|유기/i.test(value)), 6),
    actualBenefits: compactUnique([String(product.discountInfo || ""), ...verified].filter(Boolean), 8),
    adUsableFacts: facts,
    evidenceCoverage: facts.length >= 4 ? "sufficient" : "limited",
    inferredAngles: [],
    unsupportedClaims: [],
    source: "existing-product-extractor",
    analyzedAt,
  };
}

export function videoProjectSummary(project: VideoProject) {
  const selected =
    project.concepts.find((concept) => concept.id === project.selectedConceptId) ||
    project.finalScript;
  return {
    id: project.id,
    projectName: project.projectName,
    advertiserName: project.advertiserName,
    productName: project.productAnalysis.productName,
    productUrl: project.productUrl,
    marketerName: project.marketerName,
    designerName: project.designerName,
    duration: project.duration,
    status:
      project.status === "script_review" && project.selectedConceptId
        ? ("concept_selected" as const)
        : project.status,
    selectedConceptId: project.selectedConceptId,
    deadline: project.deadline,
    hookType: selected?.hookType,
    conceptFormat: project.conceptFormat || selected?.conceptFormat,
    materialCode: selected?.materialCode,
    latestVersionNumber: project.versions.at(-1)?.versionNumber,
    selectedConceptTitle: selected?.title,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

export function newHistoryId() {
  return crypto.randomUUID();
}
