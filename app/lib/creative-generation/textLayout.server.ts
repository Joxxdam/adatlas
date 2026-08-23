import { getCreativeFontMetrics, measureWithFontMetrics } from "./fontMetrics.server.ts";
import type { DynamicTextBox, HookPlan, MasterCreativeDirection, PlacementBox, RenderPlan } from "./types.ts";

type RenderedSlot = RenderPlan["renderedSlots"][number];

function normalizeText(value: string) {
  return String(value || "")
    .replace(/\r/g, "")
    .trim();
}

function atomicParts(value: string) {
  return value.match(/-?\d[\d,.]*(?:\s?(?:%|°[cC]|℃|원|ml|mL|[lL]|g|kg|개|팩|병|점|명|회|배))?|[A-Za-z]+|[^\s]/gu) || [];
}

async function wrapLine(value: string, maxWidth: number, fontSize: number) {
  const metrics = await getCreativeFontMetrics();
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  const width = (text: string) => measureWithFontMetrics(metrics, text, fontSize);
  const appendAtomic = (word: string) => {
    for (const part of atomicParts(word)) {
      const candidate = current + part;
      if (current && width(candidate) > maxWidth) {
        lines.push(current);
        current = part;
      } else {
        current = candidate;
      }
    }
  };
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (width(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
      current = "";
    }
    if (width(word) <= maxWidth) current = word;
    else appendAtomic(word);
  }
  if (current) lines.push(current);
  return lines;
}

async function wrapText(value: string, maxWidth: number, fontSize: number) {
  const paragraphs = normalizeText(value).split("\n");
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    lines.push(...(await wrapLine(paragraph, maxWidth, fontSize)));
  }
  return lines;
}

function roleColor(role: DynamicTextBox["colorRole"] | DynamicTextBox["fillRole"], master: MasterCreativeDirection) {
  if (!role) return undefined;
  return master.palette[role];
}

function textBounds(box: DynamicTextBox, fontSize: number, lineHeight: number, lines: string[]) {
  const height = Math.max(fontSize, lines.length * lineHeight);
  return {
    x: box.x + box.padding,
    y: box.y + Math.max(box.padding, (box.height - height) / 2),
    width: Math.max(1, box.width - box.padding * 2),
    height,
  } satisfies PlacementBox;
}

export async function layoutTextSlot(params: { id: RenderedSlot["id"]; text: string; box: DynamicTextBox; master: MasterCreativeDirection; fixedFontSize?: number }) {
  const text = normalizeText(params.text);
  if (!text) return null;
  const fontSize = params.fixedFontSize || params.box.fontSize;
  const lineHeight = Math.round(fontSize * params.box.lineHeight);
  const availableWidth = Math.max(1, params.box.width - params.box.padding * 2);
  const availableHeight = Math.max(1, params.box.height - params.box.padding * 2);
  const lines = await wrapText(text, availableWidth, fontSize);
  const metrics = await getCreativeFontMetrics();
  const contentWidth = Math.max(...lines.map((line) => measureWithFontMetrics(metrics, line, fontSize)), 1);
  const shouldFitContainer = ["proof", "offer", "cta"].includes(params.id);
  const renderBox: DynamicTextBox = shouldFitContainer
    ? {
        ...params.box,
        width: Math.max(params.id === "cta" ? 210 : 140, Math.min(params.box.width, Math.ceil(contentWidth + params.box.padding * 2))),
      }
    : params.box;
  const overflow = lines.length > params.box.maxLines || lines.length * lineHeight > availableHeight;
  return {
    id: params.id,
    box: {
      x: renderBox.x,
      y: renderBox.y,
      width: renderBox.width,
      height: renderBox.height,
    },
    textBounds: textBounds(renderBox, fontSize, lineHeight, lines),
    text,
    lines,
    textColor: roleColor(params.box.colorRole, params.master) || "#ffffff",
    fillColor: params.box.container === "none" ? undefined : roleColor(params.box.fillRole || "background", params.master),
    fontSize,
    lineHeight,
    lineCount: lines.length,
    overflow,
  } satisfies RenderedSlot;
}

async function minimumSharedFontSize(values: string[], box: DynamicTextBox) {
  for (let fontSize = box.fontSize; fontSize >= box.minFontSize; fontSize -= 1) {
    const lineHeight = Math.round(fontSize * box.lineHeight);
    const availableWidth = Math.max(1, box.width - box.padding * 2);
    const availableHeight = Math.max(1, box.height - box.padding * 2);
    const layouts = await Promise.all(values.map((value) => wrapText(value, availableWidth, fontSize)));
    if (layouts.every((lines) => lines.length <= box.maxLines && lines.length * lineHeight <= availableHeight)) {
      return fontSize;
    }
  }
  return box.minFontSize;
}

export async function resolveSharedTypography(master: MasterCreativeDirection, hooks: HookPlan[]) {
  return {
    headline: await minimumSharedFontSize(
      hooks.map((hook) => hook.headline),
      master.headlineBox
    ),
    body: await minimumSharedFontSize(
      hooks.map((hook) => hook.body),
      master.subCopyBox
    ),
  };
}

export async function resolveRenderedSlots(params: {
  master: MasterCreativeDirection;
  hooks: HookPlan[];
  copy: {
    headline: string;
    body: string;
    proof: string;
    offer: string;
    cta: string;
  };
}) {
  // Older persisted jobs used a two-line/18-character headline contract even
  // when the physical box could safely hold three lines. Normalize those
  // constraints at render time so an already generated AI key visual can be
  // repaired without another paid image call.
  const master: MasterCreativeDirection = {
    ...params.master,
    headlineBox: {
      ...params.master.headlineBox,
      maxChars: Math.max(32, params.master.headlineBox.maxChars),
      maxLines: Math.max(3, params.master.headlineBox.maxLines),
    },
    subCopyBox: {
      ...params.master.subCopyBox,
      maxChars: Math.max(42, params.master.subCopyBox.maxChars),
      maxLines: Math.max(3, params.master.subCopyBox.maxLines),
    },
  };
  const sizes = await resolveSharedTypography(master, params.hooks);
  const candidates = [
    await layoutTextSlot({
      id: "headline",
      text: params.copy.headline,
      box: master.headlineBox,
      master,
      fixedFontSize: sizes.headline,
    }),
    await layoutTextSlot({
      id: "body",
      text: params.copy.body,
      box: master.subCopyBox,
      master,
      fixedFontSize: sizes.body,
    }),
    master.proofBox
      ? await layoutTextSlot({
          id: "proof",
          text: params.copy.proof,
          box: master.proofBox,
          master,
        })
      : null,
    master.offerBox
      ? await layoutTextSlot({
          id: "offer",
          text: params.copy.offer,
          box: master.offerBox,
          master,
        })
      : null,
    await layoutTextSlot({
      id: "cta",
      text: params.copy.cta,
      box: master.ctaBox,
      master,
    }),
  ];
  return candidates.filter((slot): slot is NonNullable<typeof slot> => Boolean(slot));
}
