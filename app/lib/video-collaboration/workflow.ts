import crypto from "node:crypto";
import { createBrandCode, createProductCode } from "../creative-assets/code.ts";
import type {
  ProductAnalysisSnapshot,
  VideoHookType,
  VideoProject,
  VideoProjectStatus,
} from "./types.ts";

export const VIDEO_STATUS_LABELS: Record<VideoProjectStatus, string> = {
  script_pending: "대본 생성 전",
  script_review: "대본 검토 중",
  production_requested: "제작 요청",
  in_production: "영상 제작 중",
  marketer_review: "마케터 검수",
  revision_requested: "수정 요청",
  approved: "최종 승인",
};

export const VIDEO_HOOK_LABELS: Record<VideoHookType, string> = {
  "problem-solution": "문제 해결형",
  "price-benefit": "가격·혜택형",
  "feature-usp": "핵심 USP형",
  "sensory-scene": "감각·장면형",
  curiosity: "궁금증형",
  "review-trust": "후기·신뢰형",
  "brand-message": "브랜드 메시지형",
};

export const VIDEO_FORMAT_LABELS = {
  "short-form": "숏폼",
  reels: "릴스",
  feed: "피드",
  other: "기타",
} as const;

export const VIDEO_OBJECTIVE_LABELS = {
  purchase: "구매 전환",
  interest: "관심 유도",
  "new-product": "신상품 소개",
  benefit: "혜택 안내",
} as const;

const transitions: Record<VideoProjectStatus, VideoProjectStatus[]> = {
  script_pending: ["script_review"],
  script_review: ["production_requested"],
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
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getFullYear()}${pad(value.getMonth() + 1)}${pad(value.getDate())}`;
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
  return /^VIDEO_[A-Z0-9_]{2,24}_[A-Z0-9_]{2,24}_(?:PROBLEM|BENEFIT|USP|SENSORY|CURIOSITY|REVIEW|BRAND)_\d{8}_\d{2}$/.test(
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
    status: project.status,
    selectedConceptId: project.selectedConceptId,
    deadline: project.deadline,
    hookType: selected?.hookType,
    materialCode: selected?.materialCode,
    latestVersionNumber: project.versions.at(-1)?.versionNumber,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

export function newHistoryId() {
  return crypto.randomUUID();
}
