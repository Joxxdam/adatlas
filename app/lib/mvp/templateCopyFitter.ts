import type {
  CopySlotKey,
  GeneratedAdCopy,
  GeneratedAdCopyVariant,
  TemplateCopyLimits,
  TemplateFittedCopy,
} from "./types";

export const DEFAULT_TEMPLATE_COPY_LIMIT_CHARS: Record<CopySlotKey, number> = {
  headline: 14,
  bodyCopy: 32,
  highlightCopy: 24,
  bottomBarCopy: 28,
  cta: 8,
  price: 12,
};

const slotKeys: CopySlotKey[] = [
  "headline",
  "bodyCopy",
  "highlightCopy",
  "bottomBarCopy",
  "cta",
  "price",
];

export function visibleTemplateCopyLength(value: string) {
  return [
    ...String(value || "")
      .replace(/\s+/g, "")
      .trim(),
  ].length;
}

export function maxCharsForCopySlot(copyLimits: TemplateCopyLimits | undefined, slot: CopySlotKey) {
  return copyLimits?.[slot]?.maxChars || DEFAULT_TEMPLATE_COPY_LIMIT_CHARS[slot];
}

function compactCta(value: string) {
  if (/구성|세트|상품/.test(value)) return "구성보기";
  if (/혜택|할인|특가/.test(value)) return "혜택보기";
  if (/장바구니|담/.test(value)) return "담기";
  return "보기";
}

function isBadFittedCopy(value: string, slot: CopySlotKey) {
  const normalized = String(value || "")
    .replace(/\s+/g, "")
    .trim();
  if (!normalized && slot !== "price") return true;
  if (
    slot === "headline" &&
    (/^\d+$/.test(normalized) ||
      /^[\d,]+(?:원|만원|천원)?$/.test(normalized) ||
      normalized.length < 4)
  )
    return true;
  return /소비자|심리|반영|제시|자극|유도|레퍼런스|패턴|분석|구조|구매욕구|클릭욕구|상품이미지|고급스러운상품|대폭인하|인하된점|욕구를자극|부각시켜|강조합니다/.test(
    normalized
  );
}

function slotFallback(slot: CopySlotKey, value: string) {
  if (slot === "headline") {
    const price = String(value || "")
      .match(/[\d,]+\s*(?:원|만원|천원)?/)?.[0]
      ?.replace(/\s+/g, "");
    return price ? `${price}이면 볼만함` : "이건 좀 볼만함";
  }
  if (slot === "bodyCopy") return "부담 없이 준비하세요";
  if (slot === "highlightCopy") return "이 구성은 한번 볼만함";
  if (slot === "bottomBarCopy") return "구성 보고 판단하기";
  if (slot === "cta") return "구성보기";
  return value;
}

function shortenToLimit(value: string, maxChars: number, slot: CopySlotKey): string {
  const normalized = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (isBadFittedCopy(normalized, slot)) {
    const fallback = slotFallback(slot, normalized);
    return visibleTemplateCopyLength(fallback) <= maxChars
      ? fallback
      : shortenToLimit(fallback, maxChars, slot);
  }
  if (!normalized || visibleTemplateCopyLength(normalized) <= maxChars) return normalized;
  if (slot === "cta") return compactCta(normalized).slice(0, maxChars);

  const phrase = normalized
    .split(/[,.!?\n。！？]/)
    .map((part) => part.trim())
    .find((part) => part && visibleTemplateCopyLength(part) <= maxChars);
  if (phrase) return phrase;

  const words = normalized.split(/\s+/).filter(Boolean);
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (visibleTemplateCopyLength(candidate) > maxChars) break;
    current = candidate;
  }
  if (current) return current;

  let output = "";
  for (const char of normalized) {
    if (/\s/.test(char)) continue;
    if (visibleTemplateCopyLength(output + char) > Math.max(1, maxChars - 1)) break;
    output += char;
  }
  return output;
}

export function copyLimitCharSummary(
  copyLimits?: TemplateCopyLimits
): Partial<Record<CopySlotKey, number>> {
  return slotKeys.reduce<Partial<Record<CopySlotKey, number>>>((summary, slot) => {
    summary[slot] = maxCharsForCopySlot(copyLimits, slot);
    return summary;
  }, {});
}

export function getCopySlotOverflow(
  copy: Partial<GeneratedAdCopy | GeneratedAdCopyVariant>,
  copyLimits?: TemplateCopyLimits
) {
  return slotKeys.filter((slot) => {
    const value = String(copy[slot] || "");
    if (!value && slot !== "price") return true;
    return visibleTemplateCopyLength(value) > maxCharsForCopySlot(copyLimits, slot);
  });
}

export function hasCopyOverflow(
  copy: Partial<GeneratedAdCopy | GeneratedAdCopyVariant>,
  copyLimits?: TemplateCopyLimits
) {
  return getCopySlotOverflow(copy, copyLimits).length > 0;
}

export function fitCopyToTemplate(params: {
  copy: Partial<GeneratedAdCopy | GeneratedAdCopyVariant>;
  templateId: string;
  copyLimits?: TemplateCopyLimits;
}): TemplateFittedCopy {
  const fitted = {} as Record<CopySlotKey, string>;
  const slotFits = slotKeys.map((key) => {
    const originalText = String(params.copy[key] || "");
    const maxChars = maxCharsForCopySlot(params.copyLimits, key);
    const fittedText = shortenToLimit(originalText, maxChars, key);
    const currentChars = visibleTemplateCopyLength(fittedText);
    const originalChars = visibleTemplateCopyLength(originalText);
    const status: "ok" | "trimmed" | "too-long" | "empty" | "needs-review" =
      !fittedText && key !== "price"
        ? "empty"
        : originalChars > maxChars && currentChars <= maxChars
          ? "trimmed"
          : currentChars > maxChars
            ? "too-long"
            : "ok";

    fitted[key] = fittedText;
    return {
      key,
      originalText,
      fittedText,
      maxChars,
      currentChars,
      status,
      message: status === "trimmed" ? "템플릿 제한에 맞춰 문구를 줄였습니다." : undefined,
    };
  });

  return {
    headline: fitted.headline,
    bodyCopy: fitted.bodyCopy,
    highlightCopy: fitted.highlightCopy,
    bottomBarCopy: fitted.bottomBarCopy,
    cta: fitted.cta,
    price: fitted.price,
    templateId: params.templateId,
    slotFits,
    createdAt: new Date().toISOString(),
  };
}
