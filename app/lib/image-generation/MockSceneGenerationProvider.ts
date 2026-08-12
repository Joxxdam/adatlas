import sharp from "sharp";
import type { SceneGenerationInput, SceneGenerationResult } from "../creative/types";
import type { SceneGenerationProvider } from "./SceneGenerationProvider";

function xml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function palette(input: SceneGenerationInput) {
  const hints = (input.colorHints || []).filter((color) => /^#[0-9a-f]{6}$/i.test(color));
  if (hints.length >= 3) return hints.slice(0, 4);
  if (input.profileId?.startsWith("personal-care")) return ["#061b24", "#0b90a8", "#34e7c1", "#d8fff8"];
  if (input.profileId?.startsWith("food-meat")) return ["#120d09", "#3b2014", "#b94a24", "#f1bf58"];
  if (input.profileId?.startsWith("agriculture")) return ["#284a2c", "#789447", "#e0ad48", "#fff4d2"];
  return ["#101b2c", "#174f8f", "#29a4a8", "#f4f7fb"];
}

function safeZoneRect(input: SceneGenerationInput) {
  const zone = input.productSafeZone;
  if (!zone) return { x: 610, y: 250, width: 500, height: 710 };
  const width = Math.round(1200 * zone.widthRatio);
  const height = Math.round(1200 * zone.heightRatio);
  const x = zone.position.includes("right") ? 1200 - width - 55 : Math.round((1200 - width) / 2);
  const y = zone.position.includes("lower") ? 1200 - height - 95 : Math.round((1200 - height) / 2);
  return { x, y, width, height };
}

export class MockSceneGenerationProvider implements SceneGenerationProvider {
  readonly id = "mock" as const;

  isConfigured() {
    return true;
  }

  supports() {
    return true;
  }

  async generateScene(input: SceneGenerationInput): Promise<SceneGenerationResult> {
    const colors = palette(input);
    const safe = safeZoneRect(input);
    const isCooling = input.profileId?.startsWith("personal-care");
    const isMeat = input.profileId?.startsWith("food-meat");
    const isFarm = input.profileId?.startsWith("agriculture");
    const contextual = isCooling
      ? `<path d="M-80 890 C180 680 340 960 570 720 S980 560 1320 760" fill="none" stroke="${xml(colors[2])}" stroke-opacity=".26" stroke-width="58"/>
         <circle cx="180" cy="790" r="150" fill="none" stroke="${xml(colors[3])}" stroke-opacity=".16" stroke-width="28"/>
         <circle cx="1060" cy="180" r="118" fill="${xml(colors[2])}" fill-opacity=".12"/>`
      : isMeat
        ? `<ellipse cx="300" cy="930" rx="420" ry="170" fill="#050403" opacity=".62"/>
           <path d="M0 900 C250 780 420 980 690 820 C910 690 1060 740 1200 650 V1200 H0 Z" fill="${xml(colors[1])}" opacity=".55"/>
           <circle cx="160" cy="980" r="54" fill="${xml(colors[3])}" opacity=".2"/>`
        : isFarm
          ? `<path d="M0 760 C240 650 410 720 610 650 C850 560 1020 620 1200 520 V1200 H0 Z" fill="${xml(colors[1])}" opacity=".64"/>
             <path d="M0 910 C260 790 510 900 740 770 C920 670 1080 710 1200 650 V1200 H0 Z" fill="${xml(colors[0])}" opacity=".72"/>
             <circle cx="1050" cy="160" r="130" fill="${xml(colors[3])}" opacity=".2"/>`
          : `<path d="M-80 970 C240 690 510 920 720 670 C900 470 1090 500 1280 310" fill="none" stroke="${xml(colors[2])}" stroke-opacity=".22" stroke-width="140"/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${xml(colors[0])}"/><stop offset=".56" stop-color="${xml(colors[1])}"/><stop offset="1" stop-color="${xml(colors[2])}"/></linearGradient>
        <radialGradient id="light" cx="72%" cy="36%" r="62%"><stop offset="0" stop-color="${xml(colors[3])}" stop-opacity=".36"/><stop offset="1" stop-color="${xml(colors[3])}" stop-opacity="0"/></radialGradient>
        <filter id="blur"><feGaussianBlur stdDeviation="24"/></filter>
      </defs>
      <rect width="1200" height="1200" fill="url(#bg)"/>
      <rect width="1200" height="1200" fill="url(#light)"/>
      ${contextual}
      <ellipse cx="${safe.x + safe.width / 2}" cy="${safe.y + safe.height * 0.88}" rx="${safe.width * 0.4}" ry="${Math.max(38, safe.height * 0.08)}" fill="#000" opacity=".2" filter="url(#blur)"/>
      <rect x="0" y="0" width="1200" height="320" fill="#000" opacity=".12"/>
    </svg>`;
    return {
      imageBuffer: await sharp(Buffer.from(svg)).png().toBuffer(),
      provider: this.id,
      fallback: true,
      warning: "AI 이미지 API를 사용할 수 없어 카테고리별 안전 배경을 사용했습니다.",
      metadata: { profileId: input.profileId, requestedCanvas: "1200x1200" },
    };
  }

  async generateReferenceImage(input: SceneGenerationInput): Promise<SceneGenerationResult> {
    return this.generateScene(input);
  }
}
