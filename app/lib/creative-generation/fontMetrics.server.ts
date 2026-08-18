import { promises as fs } from "node:fs";
import path from "node:path";

type FontMetrics = {
  unitsPerEm: number;
  advanceWidths: number[];
  glyphForCodePoint: (codePoint: number) => number;
};

let metricsPromise: Promise<FontMetrics> | null = null;

function tableDirectory(buffer: Buffer) {
  const count = buffer.readUInt16BE(4);
  const tables = new Map<string, { offset: number; length: number }>();
  for (let index = 0; index < count; index += 1) {
    const cursor = 12 + index * 16;
    const tag = buffer.toString("ascii", cursor, cursor + 4);
    tables.set(tag, {
      offset: buffer.readUInt32BE(cursor + 8),
      length: buffer.readUInt32BE(cursor + 12),
    });
  }
  return tables;
}

function cmapGlyphMapper(buffer: Buffer, cmapOffset: number) {
  const count = buffer.readUInt16BE(cmapOffset + 2);
  const candidates: Array<{ score: number; offset: number; format: number }> = [];
  for (let index = 0; index < count; index += 1) {
    const cursor = cmapOffset + 4 + index * 8;
    const platform = buffer.readUInt16BE(cursor);
    const encoding = buffer.readUInt16BE(cursor + 2);
    const offset = cmapOffset + buffer.readUInt32BE(cursor + 4);
    const format = buffer.readUInt16BE(offset);
    const score =
      format === 12 && platform === 3 && encoding === 10
        ? 100
        : format === 12
          ? 90
          : format === 4 && platform === 3
            ? 80
            : format === 4
              ? 70
              : 0;
    if (score) candidates.push({ score, offset, format });
  }
  const selected = candidates.sort((left, right) => right.score - left.score)[0];
  if (!selected) return () => 0;
  if (selected.format === 12) {
    const groupCount = buffer.readUInt32BE(selected.offset + 12);
    const groups = Array.from({ length: groupCount }, (_, index) => {
      const cursor = selected.offset + 16 + index * 12;
      return {
        start: buffer.readUInt32BE(cursor),
        end: buffer.readUInt32BE(cursor + 4),
        glyph: buffer.readUInt32BE(cursor + 8),
      };
    });
    return (codePoint: number) => {
      let low = 0;
      let high = groups.length - 1;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const group = groups[middle];
        if (codePoint < group.start) high = middle - 1;
        else if (codePoint > group.end) low = middle + 1;
        else return group.glyph + codePoint - group.start;
      }
      return 0;
    };
  }
  const segmentCount = buffer.readUInt16BE(selected.offset + 6) / 2;
  const endCodeOffset = selected.offset + 14;
  const startCodeOffset = endCodeOffset + segmentCount * 2 + 2;
  const idDeltaOffset = startCodeOffset + segmentCount * 2;
  const idRangeOffsetOffset = idDeltaOffset + segmentCount * 2;
  return (codePoint: number) => {
    if (codePoint > 0xffff) return 0;
    for (let index = 0; index < segmentCount; index += 1) {
      const end = buffer.readUInt16BE(endCodeOffset + index * 2);
      if (codePoint > end) continue;
      const start = buffer.readUInt16BE(startCodeOffset + index * 2);
      if (codePoint < start) return 0;
      const delta = buffer.readInt16BE(idDeltaOffset + index * 2);
      const rangeOffsetAddress = idRangeOffsetOffset + index * 2;
      const rangeOffset = buffer.readUInt16BE(rangeOffsetAddress);
      if (!rangeOffset) return (codePoint + delta) & 0xffff;
      const glyphAddress = rangeOffsetAddress + rangeOffset + (codePoint - start) * 2;
      if (glyphAddress + 2 > buffer.length) return 0;
      const glyph = buffer.readUInt16BE(glyphAddress);
      return glyph ? (glyph + delta) & 0xffff : 0;
    }
    return 0;
  };
}

async function loadFontMetrics(): Promise<FontMetrics> {
  const buffer = await fs.readFile(
    path.join(process.cwd(), "public", "fonts", "NotoSansKR-Variable.ttf")
  );
  const tables = tableDirectory(buffer);
  const head = tables.get("head");
  const hhea = tables.get("hhea");
  const hmtx = tables.get("hmtx");
  const maxp = tables.get("maxp");
  const cmap = tables.get("cmap");
  if (!head || !hhea || !hmtx || !maxp || !cmap) {
    throw new Error("한글 폰트의 측정 테이블을 읽지 못했습니다.");
  }
  const unitsPerEm = buffer.readUInt16BE(head.offset + 18);
  const metricCount = buffer.readUInt16BE(hhea.offset + 34);
  const glyphCount = buffer.readUInt16BE(maxp.offset + 4);
  const advanceWidths: number[] = [];
  let lastAdvance = unitsPerEm;
  for (let glyph = 0; glyph < glyphCount; glyph += 1) {
    if (glyph < metricCount) lastAdvance = buffer.readUInt16BE(hmtx.offset + glyph * 4);
    advanceWidths.push(lastAdvance);
  }
  return {
    unitsPerEm,
    advanceWidths,
    glyphForCodePoint: cmapGlyphMapper(buffer, cmap.offset),
  };
}

export async function getCreativeFontMetrics() {
  metricsPromise ||= loadFontMetrics();
  return metricsPromise;
}

export function measureWithFontMetrics(
  metrics: FontMetrics,
  text: string,
  fontSize: number,
  letterSpacing = 0
) {
  const codePoints = Array.from(text, (character) => character.codePointAt(0) || 0);
  const units = codePoints.reduce((total, codePoint) => {
    const glyph = metrics.glyphForCodePoint(codePoint);
    return total + (metrics.advanceWidths[glyph] || metrics.advanceWidths[0] || metrics.unitsPerEm);
  }, 0);
  return (units / metrics.unitsPerEm) * fontSize + Math.max(0, codePoints.length - 1) * letterSpacing;
}
