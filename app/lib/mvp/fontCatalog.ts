export type FontCatalogRole = "impact" | "commerce" | "premium" | "ugc" | "body";

export type FontCatalogOption = {
  id: string;
  label: string;
  fontFamily: string;
  fontWeight?: number;
  localNames: string[];
  file?: string;
  bundled?: boolean;
  role?: FontCatalogRole;
  license?: "SIL Open Font License 1.1";
  sourceUrl?: string;
};

type FontOptions = Pick<FontCatalogOption, "fontWeight" | "file" | "bundled" | "role" | "license" | "sourceUrl">;

const sansFallback = '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

function font(id: string, label: string, localNames: string[], fallback = sansFallback, options: FontOptions = {}): FontCatalogOption {
  return {
    id,
    label,
    localNames,
    fontFamily: `${localNames.map((name) => `"${name}"`).join(", ")}, ${fallback}`,
    ...options,
  };
}

const googleFontsSource = (family: string) => `https://github.com/google/fonts/tree/main/ofl/${family}`;

export const bundledFontOptions: FontCatalogOption[] = [
  font("black-han-sans", "Black Han Sans · 강한 특가형", ["Black Han Sans"], sansFallback, {
    fontWeight: 900,
    file: "/fonts/BlackHanSans-Regular.ttf",
    bundled: true,
    role: "impact",
    license: "SIL Open Font License 1.1",
    sourceUrl: googleFontsSource("blackhansans"),
  }),
  font("do-hyeon", "Do Hyeon · 선명한 설명형", ["Do Hyeon"], sansFallback, {
    fontWeight: 400,
    file: "/fonts/DoHyeon-Regular.ttf",
    bundled: true,
    role: "commerce",
    license: "SIL Open Font License 1.1",
    sourceUrl: googleFontsSource("dohyeon"),
  }),
  font("gowun-batang-bold", "Gowun Batang · 고급 명조형", ["Gowun Batang"], '"Batang", serif', {
    fontWeight: 700,
    file: "/fonts/GowunBatang-Bold.ttf",
    bundled: true,
    role: "premium",
    license: "SIL Open Font License 1.1",
    sourceUrl: googleFontsSource("gowunbatang"),
  }),
  font("nanum-pen-script", "Nanum Pen Script · 후기 손글씨형", ["Nanum Pen Script"], sansFallback, {
    fontWeight: 400,
    file: "/fonts/NanumPenScript-Regular.ttf",
    bundled: true,
    role: "ugc",
    license: "SIL Open Font License 1.1",
    sourceUrl: googleFontsSource("nanumpenscript"),
  }),
  font("noto-sans-kr", "Noto Sans KR · 기본 본문형", ["Noto Sans KR"], sansFallback, {
    fontWeight: 700,
    file: "/fonts/NotoSansKR-Variable.ttf",
    bundled: true,
    role: "body",
    license: "SIL Open Font License 1.1",
    sourceUrl: googleFontsSource("notosanskr"),
  }),
];

export const systemFontOptions: FontCatalogOption[] = [
  ...bundledFontOptions,
  font("cafe24-ohsquare", "Cafe24 Ohsquare · 로컬", ["Cafe24 Ohsquare OTF", "Cafe24 Ohsquare"]),
  font("cafe24-dangdanghae", "Cafe24 Dangdanghae · 로컬", ["Cafe24 Dangdanghae OTF", "Cafe24 Dangdanghae"]),
  font("cafe24-supermagic", "Cafe24 Supermagic · 로컬", ["Cafe24 Supermagic OTF", "Cafe24 Supermagic"]),
  font("cafe24-nyangi", "Cafe24 Nyangi · 로컬", ["Cafe24 Nyangi B", "Cafe24 Nyangi"]),
  font("cafe24-ssukssuk", "Cafe24 Ssukssuk · 로컬", ["Cafe24 Ssukssuk"]),
  font("cafe24-behappy", "Cafe24 Behappy · 로컬", ["Cafe24 Behappy"]),
  font("cafe24-pro-slim-max", "Cafe24 PRO Slim Max · 로컬", ["Cafe24 PRO Slim Max"]),
  font("gmarket-bold", "Gmarket Sans Bold · 로컬", ["Gmarket Sans TTF", "Gmarket Sans"], sansFallback, {
    fontWeight: 700,
  }),
  font("gmarket-medium", "Gmarket Sans Medium · 로컬", ["Gmarket Sans TTF", "Gmarket Sans"], sansFallback, {
    fontWeight: 500,
  }),
  font("gmarket-light", "Gmarket Sans Light · 로컬", ["Gmarket Sans TTF", "Gmarket Sans"], sansFallback, {
    fontWeight: 300,
  }),
  ...Array.from({ length: 9 }, (_, index) => font(`scdream-${index + 1}`, `S-Core Dream ${index + 1} · 로컬`, [`S-Core Dream ${index + 1}`, "S-Core Dream"], sansFallback, { fontWeight: (index + 1) * 100 })),
  font("malgun-bold", "맑은 고딕 Bold · 로컬", ["Malgun Gothic"], sansFallback, {
    fontWeight: 700,
  }),
  font("malgun", "맑은 고딕 · 로컬", ["Malgun Gothic"], sansFallback, {
    fontWeight: 400,
  }),
  font("noto-serif-kr", "Noto Serif KR · 로컬", ["Noto Serif KR"], '"Batang", serif', {
    fontWeight: 700,
  }),
  font("gulim", "굴림 · 로컬", ["Gulim"], "sans-serif", { fontWeight: 400 }),
];

export type TemplateFontAssignment = {
  headlineFontId: string;
  bodyFontId: string;
};

const defaultBodyFontId = "noto-sans-kr";

export const templateFontAssignments: Record<string, TemplateFontAssignment> = {
  "shock-headline-001": { headlineFontId: "black-han-sans", bodyFontId: defaultBodyFontId },
  "food-impact-hero-001": { headlineFontId: "black-han-sans", bodyFontId: defaultBodyFontId },
  "food-template-001": { headlineFontId: "black-han-sans", bodyFontId: defaultBodyFontId },
  "food-template-002": { headlineFontId: "black-han-sans", bodyFontId: defaultBodyFontId },
  "food-template-003": { headlineFontId: "gowun-batang-bold", bodyFontId: defaultBodyFontId },
  "food-template-004": { headlineFontId: "do-hyeon", bodyFontId: defaultBodyFontId },
  "food-template-005": { headlineFontId: "nanum-pen-script", bodyFontId: defaultBodyFontId },
  "camping-popularity-impact": { headlineFontId: "black-han-sans", bodyFontId: defaultBodyFontId },
  "circle-focus-review": { headlineFontId: "do-hyeon", bodyFontId: defaultBodyFontId },
  "black-repeat-product": { headlineFontId: "nanum-pen-script", bodyFontId: defaultBodyFontId },
  "sports-benefit-chip": { headlineFontId: "do-hyeon", bodyFontId: defaultBodyFontId },
  "before-after-split-review": { headlineFontId: "do-hyeon", bodyFontId: defaultBodyFontId },
  "bold-commerce-001": { headlineFontId: "black-han-sans", bodyFontId: defaultBodyFontId },
  "price-proof-002": { headlineFontId: "black-han-sans", bodyFontId: defaultBodyFontId },
  "home-shopping-max-010": { headlineFontId: "black-han-sans", bodyFontId: defaultBodyFontId },
  "premium-gift-006": { headlineFontId: "gowun-batang-bold", bodyFontId: defaultBodyFontId },
  "ugc-meme-005": { headlineFontId: "nanum-pen-script", bodyFontId: defaultBodyFontId },
  "auto-meat-impact-001": { headlineFontId: "black-han-sans", bodyFontId: defaultBodyFontId },
  "auto-produce-market-001": { headlineFontId: "gowun-batang-bold", bodyFontId: defaultBodyFontId },
  "auto-beauty-editorial-001": {
    headlineFontId: "gowun-batang-bold",
    bodyFontId: defaultBodyFontId,
  },
  "auto-beauty-proof-002": { headlineFontId: "do-hyeon", bodyFontId: defaultBodyFontId },
  "auto-body-solution-001": { headlineFontId: "black-han-sans", bodyFontId: defaultBodyFontId },
};

export function getFontOption(id: string): FontCatalogOption {
  return systemFontOptions.find((option) => option.id === id) || systemFontOptions[0];
}

export function resolveTemplateFontAssignment(templateId: string, headlinePresetId = "impact-korean-red"): { headline: FontCatalogOption; body: FontCatalogOption } {
  const fallbackHeadlineId = headlinePresetId.includes("premium") ? "gowun-batang-bold" : headlinePresetId.includes("ugc") ? "nanum-pen-script" : headlinePresetId.includes("commerce") ? "do-hyeon" : "black-han-sans";
  const assignment = templateFontAssignments[templateId] || {
    headlineFontId: fallbackHeadlineId,
    bodyFontId: defaultBodyFontId,
  };
  return {
    headline: getFontOption(assignment.headlineFontId),
    body: getFontOption(assignment.bodyFontId),
  };
}
