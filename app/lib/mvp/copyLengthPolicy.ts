export function normalizeBodyCopy(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export function bodyCopyLength(input: string): number {
  return [...input.trim()].length;
}

export function isBodyCopyTooLong(input: string, maxLength = 36): boolean {
  return bodyCopyLength(input) > maxLength;
}

export function normalizeCasualCopyToPolite(input: string): string {
  let text = normalizeBodyCopy(input);

  const replacements: Array<[RegExp, string]> = [
    [/쟁여둬/g, "쟁여두세요"],
    [/놓치지 마/g, "놓치지 마세요"],
    [/덤이야/g, "덤입니다"],
    [/먹어봐야 알지/g, "먹어보면 바로 아실 거예요"],
    [/즐기기 좋음/g, "즐기기 좋아요"],
    [/사야 함/g, "사야 해요"],
    [/추천함/g, "추천드려요"],
    [/해야 함/g, "해야 해요"],
    [/장바구니각/g, "장바구니에 담아보세요"],
    [/저장각/g, "저장해두세요"],
    [/확인각/g, "확인해보세요"],
    [/필수템/g, "필수템이에요"],
    [/가능$/g, "가능해요"],
    [/좋음$/g, "좋아요"],
    [/임$/g, "입니다"],
  ];

  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }

  return normalizeBodyCopy(text);
}

export function isLikelyInformalKoreanCopy(input: string): boolean {
  const text = input.trim();

  const informalPatterns = [
    /쟁여둬/,
    /놓치지 마/,
    /덤이야/,
    /먹어봐야 알지/,
    /즐기기 좋음/,
    /사야 함/,
    /추천함/,
    /좋음$/,
    /가능$/,
    /해야 함$/,
    /임$/,
    /각$/,
  ];

  return informalPatterns.some((pattern) => pattern.test(text));
}

export function validateBodyCopy(input: string): {
  ok: boolean;
  reasons: string[];
} {
  const normalized = normalizeBodyCopy(input);
  const reasons: string[] = [];

  if (!normalized) {
    reasons.push("bodyCopy is empty");
  }

  if (isBodyCopyTooLong(normalized)) {
    reasons.push("bodyCopy is too long");
  }

  if (isLikelyInformalKoreanCopy(normalized)) {
    reasons.push("bodyCopy may be informal");
  }

  if ((normalized.match(/[.!?。！？]/g) ?? []).length > 1) {
    reasons.push("bodyCopy has too many sentences");
  }

  return {
    ok: reasons.length === 0,
    reasons,
  };
}
