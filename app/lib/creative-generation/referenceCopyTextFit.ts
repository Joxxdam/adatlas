import type { NativeAdReference } from "./referenceCreativeLibrary.server.ts";
import type { ReferenceCopyBlock, ReferenceCopyBlockRole } from "./types.ts";

function comparable(value: string) {
  return String(value || "").normalize("NFKC").replace(/[^0-9a-z가-힣]+/gi, "").toLowerCase();
}

function inferredRole(sourceLine: string, index: number): ReferenceCopyBlockRole {
  if (index === 0) return "headline";
  if (/구매|보기|확인|담기|신청|shop|buy/i.test(sourceLine)) return "cta";
  if (/\d[\d,.]*\s*(?:원|%|개|병|팩|세트|g|kg|ml|l)\b|할인|특가|증정/i.test(sourceLine)) return "offer";
  return "support";
}

function lineRegion(reference: NativeAdReference, sourceLine: string) {
  const signature = comparable(sourceLine);
  return reference.nativeCopy?.textRegions.find((region) =>
    region.lines.some((line) => comparable(line) === signature) || (signature && comparable(region.text).includes(signature))
  );
}

/** 단어 내부를 자르지 않고 목표 줄 수에 가장 고르게 배치합니다. */
export function splitCopyWithoutBreakingWords(text: string, lineCount: number) {
  const explicit = String(text || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (lineCount <= 1) return [explicit.join(" ")];
  if (explicit.length === lineCount) return explicit;
  const words = explicit.join(" ").split(/\s+/).filter(Boolean);
  if (!words.length) return Array.from({ length: lineCount }, () => "");
  if (words.length <= lineCount) return [...words, ...Array.from({ length: lineCount - words.length }, () => "")];
  const totalCharacters = words.reduce((sum, word) => sum + Array.from(word).length, 0);
  const target = totalCharacters / lineCount;
  const lines: string[] = [];
  let current: string[] = [];
  let currentLength = 0;
  words.forEach((word, index) => {
    const remainingWords = words.length - index;
    const remainingLines = lineCount - lines.length;
    const wordLength = Array.from(word).length;
    if (current.length && currentLength + wordLength > target && remainingWords >= remainingLines) {
      lines.push(current.join(" "));
      current = [];
      currentLength = 0;
    }
    current.push(word);
    currentLength += wordLength;
  });
  if (current.length) lines.push(current.join(" "));
  while (lines.length < lineCount) {
    const longestIndex = lines.reduce((best, line, index) => line.split(/\s+/).length > lines[best].split(/\s+/).length ? index : best, 0);
    const parts = lines[longestIndex].split(/\s+/);
    if (parts.length <= 1) {
      lines.push("");
      continue;
    }
    const splitAt = Math.ceil(parts.length / 2);
    lines.splice(longestIndex, 1, parts.slice(0, splitAt).join(" "), parts.slice(splitAt).join(" "));
  }
  while (lines.length > lineCount) {
    const tail = lines.pop() || "";
    lines[lines.length - 1] = `${lines.at(-1) || ""} ${tail}`.trim();
  }
  return lines;
}

export function fitReferenceCopyBlocks(input: { reference: NativeAdReference; copyBlocks: ReferenceCopyBlock[] }) {
  const sourceLines = input.reference.nativeCopy?.useForCopyAdaptation === false ? [] : input.reference.nativeCopy?.rawLines || [];
  if (!sourceLines.length) return { adaptedLines: input.copyBlocks.map((block) => block.text), budgetErrors: [] as string[] };
  const slots = sourceLines.map((sourceLine, index) => {
    const region = lineRegion(input.reference, sourceLine);
    return {
      index,
      role: region?.role || inferredRole(sourceLine, index),
      remove: region?.sourceType === "source-brand" || region?.replacePolicy === "remove",
      characterBudget: region?.characterBudget,
    };
  });
  const roleText = new Map<ReferenceCopyBlockRole, string>();
  for (const block of input.copyBlocks) roleText.set(block.role, [roleText.get(block.role), block.text].filter(Boolean).join("\n"));
  const fittedByIndex = new Map<number, string>();
  const activeRoles = [...new Set(slots.filter((slot) => !slot.remove).map((slot) => slot.role))];
  for (const role of activeRoles) {
    const matching = slots.filter((slot) => !slot.remove && slot.role === role);
    // 가격·CTA가 없는 상품에서 헤드라인을 해당 슬롯에 복제하면 같은 문구가
    // 이미지 안에 여러 번 반복된다. 모델이 비운 특수 슬롯은 그대로 지우고,
    // 일반 설명 슬롯만 인접한 본문 역할로 제한적으로 보완한다.
    const text = roleText.get(role) ||
      (["offer", "cta"].includes(role) ? "" : role === "support" ? roleText.get("other") || "" : role === "proof" || role === "badge" || role === "other" ? roleText.get("support") || "" : "");
    splitCopyWithoutBreakingWords(text, matching.length).forEach((line, index) => fittedByIndex.set(matching[index].index, line));
  }
  const adaptedLines = slots.map((slot) => slot.remove ? "" : fittedByIndex.get(slot.index) || "");
  const budgetErrors = slots.flatMap((slot) => {
    const budget = Number(slot.characterBudget);
    const line = adaptedLines[slot.index];
    if (!Number.isFinite(budget) || budget <= 0 || Array.from(line.replace(/\s/g, "")).length <= budget) return [];
    return [`${slot.index + 1}번째 textRegion의 characterBudget(${budget})을 초과했습니다. 문장을 자르지 말고 같은 의미의 짧은 구어체로 다시 써야 합니다.`];
  });
  return { adaptedLines, budgetErrors };
}
