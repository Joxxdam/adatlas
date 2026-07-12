export type TextFitResult = {
  lines: string[];
  fontSize: number;
  didShrink: boolean;
  didTruncate: boolean;
};

function charWidth(char: string, fontSize: number) {
  if (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(char)) return fontSize * 0.95;
  if (/[0-9]/.test(char)) return fontSize * 0.6;
  if (/[A-Z]/.test(char)) return fontSize * 0.64;
  if (/[a-z]/.test(char)) return fontSize * 0.55;
  if (/\s/.test(char)) return fontSize * 0.34;
  return fontSize * 0.58;
}

export function estimateTextWidth(text: string, fontSize: number, letterSpacing = 0) {
  let width = 0;
  for (const char of text) width += charWidth(char, fontSize);
  return width + Math.max(0, text.length - 1) * letterSpacing;
}

function splitLongToken(token: string, maxWidth: number, fontSize: number, letterSpacing: number) {
  const chunks: string[] = [];
  let current = "";

  for (const char of token) {
    const candidate = `${current}${char}`;
    if (!current || estimateTextWidth(candidate, fontSize, letterSpacing) <= maxWidth) {
      current = candidate;
    } else {
      chunks.push(current);
      current = char;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function wrapText(text: string, maxWidth: number, fontSize: number, letterSpacing: number) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [""];

  const tokens = normalized.includes(" ")
    ? normalized.split(" ").filter(Boolean)
    : splitLongToken(normalized, maxWidth, fontSize, letterSpacing);

  const lines: string[] = [];
  let current = "";

  for (const token of tokens) {
    const candidate = current ? `${current} ${token}` : token;
    if (estimateTextWidth(candidate, fontSize, letterSpacing) <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current) lines.push(current);

    if (estimateTextWidth(token, fontSize, letterSpacing) > maxWidth) {
      const chunks = splitLongToken(token, maxWidth, fontSize, letterSpacing);
      lines.push(...chunks.slice(0, -1));
      current = chunks.at(-1) || "";
    } else {
      current = token;
    }
  }

  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function truncateLines(
  lines: string[],
  maxLines: number,
  maxWidth: number,
  fontSize: number,
  letterSpacing: number
) {
  const next = lines.slice(0, Math.max(1, maxLines));
  let last = next[next.length - 1] || "";
  const ellipsis = "...";

  while (last && estimateTextWidth(`${last}${ellipsis}`, fontSize, letterSpacing) > maxWidth) {
    last = last.slice(0, -1).trimEnd();
  }

  next[next.length - 1] = last ? `${last}${ellipsis}` : ellipsis;
  return next;
}

export function fitTextToBox(params: {
  text: string;
  boxWidth: number;
  boxHeight: number;
  maxLines: number;
  minFontSize: number;
  maxFontSize: number;
  fontFamily?: string;
  fontWeight?: number | string;
  letterSpacing?: number;
  lineHeight?: number;
}): TextFitResult {
  const text = String(params.text || "")
    .replace(/\s+/g, " ")
    .trim();
  const letterSpacing = params.letterSpacing ?? 0;
  const lineHeight = params.lineHeight ?? 1.1;
  const maxLines = Math.max(1, params.maxLines);
  const minFontSize = Math.max(6, params.minFontSize);
  const maxFontSize = Math.max(minFontSize, params.maxFontSize);

  for (let fontSize = maxFontSize; fontSize >= minFontSize; fontSize -= 2) {
    const lines = wrapText(text, params.boxWidth, fontSize, letterSpacing);
    const fitsWidth = lines.every(
      (line) => estimateTextWidth(line, fontSize, letterSpacing) <= params.boxWidth
    );
    const fitsHeight = Math.min(lines.length, maxLines) * fontSize * lineHeight <= params.boxHeight;

    if (fitsWidth && lines.length <= maxLines && fitsHeight) {
      return {
        lines,
        fontSize,
        didShrink: fontSize < maxFontSize,
        didTruncate: false,
      };
    }
  }

  const lines = wrapText(text, params.boxWidth, minFontSize, letterSpacing);
  const didTruncate =
    lines.length > maxLines ||
    lines.some((line) => estimateTextWidth(line, minFontSize, letterSpacing) > params.boxWidth);

  return {
    lines: didTruncate
      ? truncateLines(lines, maxLines, params.boxWidth, minFontSize, letterSpacing)
      : lines.slice(0, maxLines),
    fontSize: minFontSize,
    didShrink: maxFontSize > minFontSize,
    didTruncate,
  };
}
