import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FontRole } from "./performanceTemplateRegistry";

export type CreativeFontDefinition = {
  role: FontRole;
  family: string;
  file: string;
  license: string;
  fallbackRole?: FontRole;
};

const root = path.join(process.cwd(), "public", "fonts");

export const creativeFontRegistry: Record<FontRole, CreativeFontDefinition> = {
  HEAVY_GOTHIC: { role: "HEAVY_GOTHIC", family: "Black Han Sans", file: path.join(root, "BlackHanSans-Regular.ttf"), license: path.join(root, "licenses", "BlackHanSans-OFL.txt") },
  DISPLAY_BLACK: { role: "DISPLAY_BLACK", family: "Do Hyeon", file: path.join(root, "DoHyeon-Regular.ttf"), license: path.join(root, "licenses", "DoHyeon-OFL.txt") },
  ROUNDED_BOLD: { role: "ROUNDED_BOLD", family: "Noto Sans KR", file: path.join(root, "NotoSansKR-Variable.ttf"), license: path.join(root, "licenses", "NotoSansKR-OFL.txt") },
  HANDWRITTEN_MARKER: { role: "HANDWRITTEN_MARKER", family: "Nanum Pen Script", file: path.join(root, "NanumPenScript-Regular.ttf"), license: path.join(root, "licenses", "NanumPenScript-OFL.txt") },
  HANDWRITTEN_BRUSH: { role: "HANDWRITTEN_BRUSH", family: "Nanum Pen Script", file: path.join(root, "NanumPenScript-Regular.ttf"), license: path.join(root, "licenses", "NanumPenScript-OFL.txt"), fallbackRole: "HANDWRITTEN_MARKER" },
  CLEAN_EDITORIAL: { role: "CLEAN_EDITORIAL", family: "Gowun Batang", file: path.join(root, "GowunBatang-Bold.ttf"), license: path.join(root, "licenses", "GowunBatang-OFL.txt") },
};

const fontData = new Map<string, Promise<string>>();

export async function embeddedFontFace(role: FontRole) {
  const definition = creativeFontRegistry[role] || creativeFontRegistry.ROUNDED_BOLD;
  let pending = fontData.get(definition.file);
  if (!pending) {
    pending = readFile(definition.file).then((buffer) => buffer.toString("base64"));
    fontData.set(definition.file, pending);
  }
  const data = await pending;
  return `@font-face{font-family:'${definition.family}';src:url(data:font/ttf;base64,${data}) format('truetype');font-weight:100 900;}`;
}

export async function verifyCreativeFontFiles() {
  await Promise.all(Object.values(creativeFontRegistry).flatMap((font) => [readFile(font.file), readFile(font.license)]));
  return true;
}
