import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import {
  adjustColor,
  areColorsTooSimilar,
  chooseTextColor,
  colorDistance,
  hexToRgb,
  mixColors,
  rgbToHex,
  rgbToHsl,
} from "./colorUtils";
import { getCategoryFallbackPalette } from "./defaultPalettes";
import type { ExtractedPalette } from "./types";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const paletteCache = new Map<string, Promise<ExtractedPalette>>();

function isPrivateHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host.endsWith(".local")) return true;
  const match = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return false;
  const [, aRaw, bRaw] = match;
  const a = Number(aRaw);
  const b = Number(bRaw);
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

async function imageBuffer(source: string) {
  if (/^data:image\//i.test(source)) {
    const comma = source.indexOf(",");
    const buffer = Buffer.from(source.slice(comma + 1), "base64");
    if (buffer.length > MAX_IMAGE_BYTES) throw new Error("Image is too large");
    return buffer;
  }

  if (/^https?:\/\//i.test(source)) {
    const url = new URL(source);
    if (isPrivateHostname(url.hostname)) throw new Error("Private image URL is not allowed");
    const response = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
      headers: { Accept: "image/*" },
    });
    if (!response.ok) throw new Error(`Image fetch failed: ${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) throw new Error("URL did not return an image");
    const length = Number(response.headers.get("content-length") || 0);
    if (length > MAX_IMAGE_BYTES) throw new Error("Image is too large");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_IMAGE_BYTES) throw new Error("Image is too large");
    return buffer;
  }

  const publicRoot = path.resolve(process.cwd(), "public");
  const localPath = path.resolve(publicRoot, source.replace(/^\/+/, ""));
  if (!localPath.startsWith(publicRoot + path.sep)) throw new Error("Invalid local image path");
  const stat = await fs.stat(localPath);
  if (stat.size > MAX_IMAGE_BYTES) throw new Error("Image is too large");
  return fs.readFile(localPath);
}

type Candidate = { color: string; count: number; saturation: number; lightness: number };

async function representativeColors(buffer: Buffer): Promise<Candidate[]> {
  const { data, info } = await sharp(buffer)
    .rotate()
    .resize(72, 72, { fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bins = new Map<string, number>();

  for (let index = 0; index < data.length; index += info.channels) {
    const alpha = data[index + 3] ?? 255;
    if (alpha < 170) continue;
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max > 246 && min > 236) continue;
    if (max < 18) continue;
    const quantized = `${Math.round(r / 24) * 24},${Math.round(g / 24) * 24},${
      Math.round(b / 24) * 24
    }`;
    bins.set(quantized, (bins.get(quantized) || 0) + 1);
  }

  return [...bins.entries()]
    .map(([key, count]) => {
      const [r, g, b] = key.split(",").map(Number);
      const color = rgbToHex({ r, g, b });
      const hsl = rgbToHsl(hexToRgb(color));
      return { color, count, saturation: hsl.s, lightness: hsl.l };
    })
    .sort((a, b) => b.count * (1 + b.saturation / 180) - a.count * (1 + a.saturation / 180))
    .filter((candidate, index, values) =>
      values
        .slice(0, index)
        .every((previous) => colorDistance(previous.color, candidate.color) > 42)
    )
    .slice(0, 8);
}

function paletteFromCandidates(
  candidates: Candidate[],
  fallback: ExtractedPalette,
  source: string
): ExtractedPalette {
  if (candidates.length < 2) return { ...fallback, sourceImagePath: source, confidence: 0.4 };
  const primaryCandidate = candidates.find(
    (candidate) =>
      candidate.saturation >= 22 && candidate.lightness >= 18 && candidate.lightness <= 78
  );
  const primary = adjustColor(primaryCandidate?.color || candidates[0].color, {
    s: Math.max(34, primaryCandidate?.saturation || candidates[0].saturation),
    l: Math.min(62, Math.max(28, primaryCandidate?.lightness || candidates[0].lightness)),
  });
  const secondaryCandidate =
    candidates.find(
      (candidate) =>
        colorDistance(candidate.color, primary) > 90 &&
        candidate.lightness >= 12 &&
        candidate.lightness <= 80
    ) || candidates[1];
  const secondary = adjustColor(secondaryCandidate.color, {
    s: Math.max(24, secondaryCandidate.saturation),
    l: Math.min(58, Math.max(18, secondaryCandidate.lightness)),
  });
  const accentCandidate =
    [...candidates].sort(
      (a, b) =>
        b.saturation * (1 - Math.abs(b.lightness - 55) / 100) -
        a.saturation * (1 - Math.abs(a.lightness - 55) / 100)
    )[0] || primaryCandidate;
  let accent = adjustColor(accentCandidate?.color || primary, {
    s: Math.max(60, accentCandidate?.saturation || 60),
    l: Math.min(62, Math.max(42, accentCandidate?.lightness || 52)),
  });
  if (areColorsTooSimilar(primary, accent)) accent = fallback.accentColor;
  const background = mixColors(primary, "#ffffff", 0.91);
  const surface = mixColors(primary, "#ffffff", 0.96);
  const accentHue = rgbToHsl(hexToRgb(accent)).h;
  const highlight =
    accentHue >= 42 && accentHue <= 70
      ? adjustColor(accent, { s: 92, l: 68 })
      : fallback.highlightColor;

  return {
    primaryColor: primary,
    secondaryColor: secondary,
    accentColor: accent,
    backgroundColor: background,
    surfaceColor: surface,
    textDarkColor: chooseTextColor(background, "#171717", "#ffffff"),
    textLightColor: chooseTextColor(secondary, "#171717", "#ffffff"),
    mutedColor: mixColors(secondary, background, 0.62),
    highlightColor: highlight,
    dangerColor: fallback.dangerColor,
    sourceImagePath: source,
    confidence: Math.min(0.96, 0.58 + candidates.length * 0.045),
  };
}

export async function extractPaletteFromImage(
  sourceImagePath: string,
  category?: string
): Promise<ExtractedPalette> {
  const fallback = getCategoryFallbackPalette(category);
  const source = String(sourceImagePath || "").trim();
  if (!source) return fallback;
  const cacheKey = `${source}|${category || ""}`;
  const existing = paletteCache.get(cacheKey);
  if (existing) return existing;

  const pending = (async () => {
    try {
      const buffer = await imageBuffer(source);
      const candidates = await representativeColors(buffer);
      return paletteFromCandidates(candidates, fallback, source);
    } catch {
      return { ...fallback, sourceImagePath: source, confidence: 0.35 };
    }
  })();
  paletteCache.set(cacheKey, pending);
  if (paletteCache.size > 80) {
    const oldestKey = paletteCache.keys().next().value;
    if (oldestKey) paletteCache.delete(oldestKey);
  }
  return pending;
}
