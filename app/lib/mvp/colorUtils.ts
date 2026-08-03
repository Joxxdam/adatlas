export type RgbColor = { r: number; g: number; b: number };
export type HslColor = { h: number; s: number; l: number };

function clamp(value: number, min = 0, max = 255) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeHex(value: string) {
  const raw = String(value || "")
    .trim()
    .replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(raw)) {
    return `#${raw
      .split("")
      .map((character) => character + character)
      .join("")
      .toLowerCase()}`;
  }
  return /^[0-9a-f]{6}$/i.test(raw) ? `#${raw.toLowerCase()}` : "#000000";
}

export function hexToRgb(value: string): RgbColor {
  const hex = normalizeHex(value).slice(1);
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

export function rgbToHex(color: RgbColor) {
  const channel = (value: number) => Math.round(clamp(value)).toString(16).padStart(2, "0");
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

export function rgbToHsl(color: RgbColor): HslColor {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;

  if (delta) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  const l = (max + min) / 2;
  const s = delta ? delta / (1 - Math.abs(2 * l - 1)) : 0;
  return { h, s: s * 100, l: l * 100 };
}

export function hslToRgb(color: HslColor): RgbColor {
  const h = ((color.h % 360) + 360) % 360;
  const s = clamp(color.s, 0, 100) / 100;
  const l = clamp(color.l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb: [number, number, number] = [0, 0, 0];

  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];

  return {
    r: (rgb[0] + m) * 255,
    g: (rgb[1] + m) * 255,
    b: (rgb[2] + m) * 255,
  };
}

export function adjustColor(
  value: string,
  adjustment: Partial<Pick<HslColor, "s" | "l">> & {
    saturationDelta?: number;
    lightnessDelta?: number;
  }
) {
  const hsl = rgbToHsl(hexToRgb(value));
  return rgbToHex(
    hslToRgb({
      h: hsl.h,
      s: adjustment.s ?? hsl.s + (adjustment.saturationDelta ?? 0),
      l: adjustment.l ?? hsl.l + (adjustment.lightnessDelta ?? 0),
    })
  );
}

export function relativeLuminance(value: string) {
  const rgb = hexToRgb(value);
  const linear = [rgb.r, rgb.g, rgb.b].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function contrastRatio(first: string, second: string) {
  const high = Math.max(relativeLuminance(first), relativeLuminance(second));
  const low = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (high + 0.05) / (low + 0.05);
}

export function chooseTextColor(background: string, dark = "#111111", light = "#ffffff") {
  return contrastRatio(background, dark) >= contrastRatio(background, light) ? dark : light;
}

export function ensureContrast(foreground: string, background: string, minimumRatio = 4.5) {
  if (contrastRatio(foreground, background) >= minimumRatio) return normalizeHex(foreground);
  const foregroundHsl = rgbToHsl(hexToRgb(foreground));
  const backgroundIsDark = relativeLuminance(background) < 0.45;

  for (let delta = 6; delta <= 60; delta += 6) {
    const candidate = rgbToHex(
      hslToRgb({
        ...foregroundHsl,
        l: backgroundIsDark ? foregroundHsl.l + delta : foregroundHsl.l - delta,
      })
    );
    if (contrastRatio(candidate, background) >= minimumRatio) return candidate;
  }

  return chooseTextColor(background);
}

export function colorDistance(first: string, second: string) {
  const a = hexToRgb(first);
  const b = hexToRgb(second);
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

export function areColorsTooSimilar(first: string, second: string, threshold = 52) {
  return colorDistance(first, second) < threshold;
}

export function mixColors(first: string, second: string, amount = 0.5) {
  const a = hexToRgb(first);
  const b = hexToRgb(second);
  const ratio = clamp(amount, 0, 1);
  return rgbToHex({
    r: a.r + (b.r - a.r) * ratio,
    g: a.g + (b.g - a.g) * ratio,
    b: a.b + (b.b - a.b) * ratio,
  });
}
