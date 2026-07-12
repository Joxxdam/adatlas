import fs from "fs/promises";
import path from "path";

import type { CopyGuideContext } from "./types";

export type CopyGuideMatchInput = {
  brandName?: string;
  advertiserName?: string;
  productUrl?: string;
  category?: string;
  productName?: string;
  copyGuideId?: string;
};

export type LoadedCopyGuide = CopyGuideContext & {
  id: string;
  filePath: string;
};

type CopyGuideIndexItem = {
  id: string;
  brandName: string;
  aliases?: string[];
  categories?: string[];
  domains?: string[];
  filePath: string;
  priority?: number;
};

type CopyGuideIndex = {
  guides: CopyGuideIndexItem[];
  defaultGuideId?: string | null;
};

const ROOT = process.cwd();
const INDEX_PATH = path.join(ROOT, "data", "copy-guides", "index.json");
const MAX_GUIDE_CHARS = 12000;

function normalize(value?: string) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function includesNormalized(source: string | undefined, target: string | undefined) {
  const a = normalize(source);
  const b = normalize(target);
  return Boolean(a && b && (a.includes(b) || b.includes(a)));
}

function domainFromUrl(value?: string) {
  try {
    return value ? new URL(value).hostname.toLowerCase() : "";
  } catch {
    return "";
  }
}

function scoreGuide(guide: CopyGuideIndexItem, input: CopyGuideMatchInput) {
  const matchedBy: LoadedCopyGuide["matchedBy"] = [];
  let score = guide.priority || 0;
  let priorityRank = 0;
  const aliases = guide.aliases || [];
  const categories = guide.categories || [];
  const domains = guide.domains || [];
  const brand = input.brandName || "";
  const advertiser = input.advertiserName || "";
  const productName = input.productName || "";
  const category = input.category || "";
  const productDomain = domainFromUrl(input.productUrl);

  if (input.copyGuideId && input.copyGuideId === guide.id) {
    score += 1000;
    priorityRank = Math.max(priorityRank, 5);
    matchedBy.push("copyGuideId");
  }

  if (
    aliases.some((alias) => normalize(alias) === normalize(brand)) ||
    normalize(guide.brandName) === normalize(brand)
  ) {
    score += 500;
    priorityRank = Math.max(priorityRank, 4);
    matchedBy.push("brandName");
  }

  if (
    aliases.some((alias) => normalize(alias) === normalize(advertiser)) ||
    normalize(guide.brandName) === normalize(advertiser)
  ) {
    score += 500;
    priorityRank = Math.max(priorityRank, 4);
    matchedBy.push("advertiserName");
  }

  if (productDomain && domains.some((domain) => normalize(domain) === productDomain)) {
    score += 400;
    priorityRank = Math.max(priorityRank, 3);
    matchedBy.push("domain");
  }

  if (aliases.some((alias) => includesNormalized(productName, alias))) {
    score += 250;
    priorityRank = Math.max(priorityRank, 2);
    matchedBy.push("productName");
  }

  if (categories.some((candidate) => includesNormalized(category, candidate))) {
    score += 100;
    priorityRank = Math.max(priorityRank, 1);
    matchedBy.push("category");
  }

  return { score, priorityRank, matchedBy: Array.from(new Set(matchedBy)) };
}

async function readIndex(): Promise<CopyGuideIndex> {
  const raw = await fs.readFile(INDEX_PATH, "utf8");
  return JSON.parse(raw) as CopyGuideIndex;
}

function safeGuidePath(filePath: string) {
  const resolved = path.resolve(ROOT, filePath);
  const allowedRoot = path.resolve(ROOT, "data", "copy-guides");

  if (!resolved.startsWith(allowedRoot)) {
    throw new Error("Invalid copy guide path");
  }

  return resolved;
}

export async function loadCopyGuideForProduct(
  input: CopyGuideMatchInput
): Promise<LoadedCopyGuide | null> {
  try {
    const index = await readIndex();
    const matches = index.guides
      .map((guide) => ({ guide, ...scoreGuide(guide, input) }))
      .filter(
        (item) =>
          item.priorityRank >= 2 ||
          item.matchedBy.includes("copyGuideId") ||
          item.guide.id === index.defaultGuideId
      )
      .sort((a, b) => b.priorityRank - a.priorityRank || b.score - a.score);
    const selected = matches[0];

    if (!selected) return null;

    const fullPath = safeGuidePath(selected.guide.filePath);
    const content = (await fs.readFile(fullPath, "utf8")).slice(0, MAX_GUIDE_CHARS);

    return {
      id: selected.guide.id,
      guideId: selected.guide.id,
      brandName: selected.guide.brandName,
      filePath: selected.guide.filePath,
      content,
      matchedBy: selected.matchedBy,
    };
  } catch (error) {
    console.error("[copyGuideLoader] failed to load copy guide", error);
    return null;
  }
}
