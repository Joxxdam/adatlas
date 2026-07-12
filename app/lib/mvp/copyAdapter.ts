import type {
  CopySlotKey,
  GeneratedAdCopy,
  GeneratedAdCopyVariant,
  TemplateCopyLimits,
} from "./types";

export const DEFAULT_COPY_LIMITS: Required<TemplateCopyLimits> = {
  headline: {
    maxChars: 16,
    maxLines: 2,
    minFontSize: 56,
    maxFontSize: 96,
    overflowStrategy: "shrink-wrap-ellipsis",
  },
  bodyCopy: {
    maxChars: 40,
    maxLines: 2,
    minFontSize: 28,
    maxFontSize: 44,
    overflowStrategy: "shrink-wrap-ellipsis",
  },
  highlightCopy: {
    maxChars: 26,
    maxLines: 2,
    minFontSize: 28,
    maxFontSize: 42,
    overflowStrategy: "shrink-wrap-ellipsis",
  },
  bottomBarCopy: {
    maxChars: 30,
    maxLines: 1,
    minFontSize: 24,
    maxFontSize: 38,
    overflowStrategy: "shrink-ellipsis",
  },
  cta: {
    maxChars: 10,
    maxLines: 1,
    minFontSize: 22,
    maxFontSize: 34,
    overflowStrategy: "shrink-ellipsis",
  },
  price: {
    maxChars: 12,
    maxLines: 1,
    minFontSize: 44,
    maxFontSize: 90,
    overflowStrategy: "shrink-ellipsis",
  },
};

const slotKeys: CopySlotKey[] = [
  "headline",
  "bodyCopy",
  "highlightCopy",
  "bottomBarCopy",
  "cta",
  "price",
];

function normalizeVariant(copy: GeneratedAdCopy | GeneratedAdCopyVariant): GeneratedAdCopyVariant {
  return {
    headline: copy.headline || "",
    bodyCopy: copy.bodyCopy || "",
    highlightCopy: copy.highlightCopy || "",
    bottomBarCopy: copy.bottomBarCopy || "",
    cta: copy.cta || "",
    price: copy.price || "",
  };
}

function mergedLimits(copyLimits?: TemplateCopyLimits): Required<TemplateCopyLimits> {
  return {
    headline: { ...DEFAULT_COPY_LIMITS.headline, ...copyLimits?.headline },
    bodyCopy: { ...DEFAULT_COPY_LIMITS.bodyCopy, ...copyLimits?.bodyCopy },
    highlightCopy: { ...DEFAULT_COPY_LIMITS.highlightCopy, ...copyLimits?.highlightCopy },
    bottomBarCopy: { ...DEFAULT_COPY_LIMITS.bottomBarCopy, ...copyLimits?.bottomBarCopy },
    cta: { ...DEFAULT_COPY_LIMITS.cta, ...copyLimits?.cta },
    price: { ...DEFAULT_COPY_LIMITS.price, ...copyLimits?.price },
  };
}

function visibleLength(value: string) {
  return value.replace(/\s+/g, "").length;
}

function fitsVariant(variant: GeneratedAdCopyVariant, limits: Required<TemplateCopyLimits>) {
  return slotKeys.every((slot) => {
    const value = variant[slot] || "";
    if (!value) return true;
    return visibleLength(value) <= limits[slot].maxChars;
  });
}

function trimParticles(value: string) {
  return value
    .replace(/\b(그리고|하지만|그래서|정말|진짜|바로|이번에)\b/g, "")
    .replace(/(이라니|입니다|합니다|해요|했어요|드립니다|드립니다\.?)$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function smartShorten(value: string, maxChars: number, slot: CopySlotKey) {
  const normalized = trimParticles(String(value || ""));
  if (visibleLength(normalized) <= maxChars) return normalized;

  if (slot === "cta") {
    if (/구성|세트|상품/.test(normalized)) return "구성보기";
    if (/혜택|할인/.test(normalized)) return "혜택보기";
    if (/장바구니/.test(normalized)) return "담아보기";
    return "보러가기";
  }

  const phrases = normalized
    .split(/[,.!?\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const firstPhrase = phrases.find((part) => visibleLength(part) <= maxChars);
  if (firstPhrase) return firstPhrase;

  const words = normalized.split(/\s+/).filter(Boolean);
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (visibleLength(candidate) > maxChars) break;
    current = candidate;
  }

  if (current) return current;

  let output = "";
  for (const char of normalized) {
    if (/\s/.test(char)) continue;
    if (visibleLength(output + char) > Math.max(1, maxChars - 2)) break;
    output += char;
  }
  return output ? `${output}...` : "";
}

function shortenVariant(variant: GeneratedAdCopyVariant, limits: Required<TemplateCopyLimits>) {
  const warnings: string[] = [];
  const fitted: GeneratedAdCopyVariant = { ...variant };

  for (const slot of slotKeys) {
    const value = fitted[slot] || "";
    if (!value || visibleLength(value) <= limits[slot].maxChars) continue;

    fitted[slot] = smartShorten(value, limits[slot].maxChars, slot);
    warnings.push(`${slot} copy was shortened for the selected template.`);
  }

  return { fitted, warnings };
}

export function adaptCopyToTemplate(params: {
  copy: GeneratedAdCopy;
  copyLimits?: TemplateCopyLimits;
  preferredVariant?: "short" | "medium" | "long";
}): {
  fittedCopy: GeneratedAdCopyVariant;
  selectedVariant: "short" | "medium" | "long" | "custom";
  warnings: string[];
} {
  const limits = mergedLimits(params.copyLimits);
  const fallbackMedium = normalizeVariant(params.copy);
  const variants = params.copy.copyVariants || {
    short: fallbackMedium,
    medium: fallbackMedium,
    long: fallbackMedium,
  };
  const order: Array<"short" | "medium" | "long"> = params.preferredVariant
    ? (
        [params.preferredVariant, "medium", "short", "long"] as Array<"short" | "medium" | "long">
      ).filter((value, index, array) => array.indexOf(value) === index)
    : ["long", "medium", "short"];

  for (const key of order) {
    const variant = normalizeVariant(variants[key] || fallbackMedium);
    if (fitsVariant(variant, limits)) {
      return { fittedCopy: variant, selectedVariant: key, warnings: [] };
    }
  }

  const base = normalizeVariant(variants.short || fallbackMedium);
  const { fitted, warnings } = shortenVariant(base, limits);
  return { fittedCopy: fitted, selectedVariant: "custom", warnings };
}
