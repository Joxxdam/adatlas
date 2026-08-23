import type { ContentNoteResolution, CreativeContentNote, CreativeContentNoteContext, CreativeNoteCompliance, ResolvedCreativeContentNote } from "./types.ts";
import { getHookCode } from "../creative-assets/code.ts";

const scopePriority: Record<CreativeContentNote["scope"], number> = {
  advertiser: 10,
  category: 20,
  product: 30,
  promotion: 40,
};

function normalized(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function activeAt(note: CreativeContentNote, at: Date) {
  if (!note.active) return false;
  if (note.startsAt && new Date(note.startsAt).getTime() > at.getTime()) return false;
  if (note.endsAt && new Date(note.endsAt).getTime() < at.getTime()) return false;
  return true;
}

function matchesScope(note: CreativeContentNote, context: CreativeContentNoteContext) {
  if (note.advertiserId !== context.advertiserId) return false;
  if (note.scope === "advertiser") return note.scopeId === context.advertiserId;
  if (note.scope === "category") return Boolean(context.categoryId && note.scopeId === context.categoryId);
  if (note.scope === "product") return Boolean(context.productId && note.scopeId === context.productId);
  return Boolean(context.promotionId && note.scopeId === context.promotionId);
}

export function resolveCreativeContentNotes(notes: CreativeContentNote[], context: CreativeContentNoteContext): ContentNoteResolution {
  const now = new Date(context.at || new Date().toISOString());
  const selected: ResolvedCreativeContentNote[] = notes
    .filter((note) => matchesScope(note, context) && activeAt(note, now))
    .map((note) => ({
      ...note,
      priority: scopePriority[note.scope] + (note.required || note.prohibited ? 100 : 0),
      appliedReason: `${note.scope} 범위의 활성 ${note.type} 참고사항`,
      conflictsWith: [],
    }))
    .sort((left, right) => right.priority - left.priority || left.createdAt.localeCompare(right.createdAt));

  const conflicts: ContentNoteResolution["conflicts"] = [];
  for (let leftIndex = 0; leftIndex < selected.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < selected.length; rightIndex += 1) {
      const left = selected[leftIndex];
      const right = selected[rightIndex];
      const sameText = normalized(left.content) === normalized(right.content);
      const requiredVsProhibited = sameText && (left.required || right.required) && (left.prohibited || right.prohibited);
      const oppositeHookRules = new Set([left.type, right.type]).size === 2 && [left.type, right.type].every((type) => type === "PREFERRED_HOOK" || type === "AVOIDED_HOOK") && getHookCode(left.content) !== "ETC" && getHookCode(left.content) === getHookCode(right.content);
      if (!requiredVsProhibited && !oppositeHookRules) continue;
      left.conflictsWith.push(right.id);
      right.conflictsWith.push(left.id);
      conflicts.push({
        noteIds: [left.id, right.id],
        message: oppositeHookRules ? `같은 후킹을 선호하면서 제외하도록 설정했습니다: ${left.content} / ${right.content}` : `필수 문구와 금지 문구가 충돌합니다: ${left.content}`,
        blocking: true,
      });
    }
  }

  return { notes: selected, conflicts, resolvedAt: now.toISOString() };
}

export function contentNotePromptContext(notes: ResolvedCreativeContentNote[]) {
  return notes.map((note) => ({
    id: note.id,
    type: note.type,
    instruction: note.content,
    required: note.required,
    prohibited: note.prohibited,
    priority: note.priority,
  }));
}

export function applyCreativeContentNotesToCopy(copy: { headline: string; body: string; proof: string; offer: string; cta: string }, notes: ResolvedCreativeContentNote[]) {
  const next = { ...copy };
  const repairs: string[] = [];
  const blockingConflicts = notes.some((note) => note.conflictsWith.length > 0 && (note.required || note.prohibited));
  if (blockingConflicts) {
    return {
      copy: next,
      compliance: {
        state: "blocked",
        appliedNoteIds: notes.map((note) => note.id),
        requiredMissing: [],
        prohibitedFound: [],
        repairs: ["필수·금지 참고사항 충돌로 자동 적용을 중단했습니다."],
        checkedAt: new Date().toISOString(),
      } satisfies CreativeNoteCompliance,
    };
  }

  const prohibited = notes.filter((note) => (note.prohibited && note.type !== "AVOIDED_HOOK") || note.type === "PROHIBITED_EXPRESSION");
  for (const note of prohibited) {
    const phrase = note.content.trim();
    if (!phrase) continue;
    for (const key of ["headline", "body", "proof", "offer", "cta"] as const) {
      if (next[key].toLowerCase().includes(phrase.toLowerCase())) {
        next[key] = next[key]
          .replace(new RegExp(escapeRegExp(phrase), "gi"), "")
          .replace(/\s{2,}/g, " ")
          .trim();
        repairs.push(`금지 표현 제거: ${phrase}`);
      }
    }
  }

  const required = notes.filter((note) => note.required || note.type === "MUST_INCLUDE");
  for (const note of required) {
    const phrase = note.content.trim();
    const combined = Object.values(next).join(" ").toLowerCase();
    if (phrase && !combined.includes(phrase.toLowerCase())) {
      next.body = [next.body, phrase].filter(Boolean).join(" · ");
      repairs.push(`필수 문구 추가: ${phrase}`);
    }
  }

  const verification = validateCreativeContentNotes(Object.values(next).join(" "), notes);
  return {
    copy: next,
    compliance: {
      ...verification,
      state: verification.requiredMissing.length || verification.prohibitedFound.length ? "blocked" : repairs.length ? "repaired" : "passed",
      repairs,
    } satisfies CreativeNoteCompliance,
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function validateCreativeContentNotes(text: string, notes: ResolvedCreativeContentNote[]): Omit<CreativeNoteCompliance, "state" | "repairs"> {
  const lower = text.toLowerCase();
  const requiredMissing = notes
    .filter((note) => note.required || note.type === "MUST_INCLUDE")
    .filter((note) => note.content.trim() && !lower.includes(note.content.trim().toLowerCase()))
    .map((note) => note.content);
  const prohibitedFound = notes
    .filter((note) => (note.prohibited && note.type !== "AVOIDED_HOOK") || note.type === "PROHIBITED_EXPRESSION")
    .filter((note) => note.content.trim() && lower.includes(note.content.trim().toLowerCase()))
    .map((note) => note.content);
  return {
    appliedNoteIds: notes.map((note) => note.id),
    requiredMissing,
    prohibitedFound,
    checkedAt: new Date().toISOString(),
  };
}
