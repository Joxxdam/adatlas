export type FontCatalogOption = {
  id: string;
  label: string;
  fontFamily: string;
  fontWeight?: number;
  localNames: string[];
};

function font(
  id: string,
  label: string,
  localNames: string[],
  fallback = '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif',
  fontWeight?: number
): FontCatalogOption {
  return {
    id,
    label,
    localNames,
    fontWeight,
    fontFamily: `${localNames.map((name) => `"${name}"`).join(", ")}, ${fallback}`,
  };
}

export const systemFontOptions: FontCatalogOption[] = [
  font("black-han-sans", "Black Han Sans", ["Black Han Sans"], undefined, 900),
  font("cafe24-ohsquare", "Cafe24 Ohsquare", ["Cafe24 Ohsquare OTF", "Cafe24 Ohsquare"]),
  font("cafe24-dangdanghae", "Cafe24 Dangdanghae", [
    "Cafe24 Dangdanghae OTF",
    "Cafe24 Dangdanghae",
  ]),
  font("cafe24-supermagic", "Cafe24 Supermagic", ["Cafe24 Supermagic OTF", "Cafe24 Supermagic"]),
  font("cafe24-nyangi", "Cafe24 Nyangi", ["Cafe24 Nyangi B", "Cafe24 Nyangi"]),
  font("cafe24-ssukssuk", "Cafe24 Ssukssuk", ["Cafe24 Ssukssuk"]),
  font("cafe24-behappy", "Cafe24 Behappy", ["Cafe24 Behappy"]),
  font("cafe24-pro-slim-max", "Cafe24 PRO Slim Max", ["Cafe24 PRO Slim Max"]),
  font("gmarket-bold", "Gmarket Sans Bold", ["Gmarket Sans TTF", "Gmarket Sans"], undefined, 700),
  font(
    "gmarket-medium",
    "Gmarket Sans Medium",
    ["Gmarket Sans TTF", "Gmarket Sans"],
    undefined,
    500
  ),
  font("gmarket-light", "Gmarket Sans Light", ["Gmarket Sans TTF", "Gmarket Sans"], undefined, 300),
  ...Array.from({ length: 9 }, (_, index) =>
    font(
      `scdream-${index + 1}`,
      `S-Core Dream ${index + 1}`,
      [`S-Core Dream ${index + 1}`, "S-Core Dream"],
      undefined,
      (index + 1) * 100
    )
  ),
  font("noto-sans-kr", "Noto Sans KR", ["Noto Sans KR"]),
  font("malgun-bold", "맑은 고딕 Bold", ["Malgun Gothic"], undefined, 700),
  font("malgun", "맑은 고딕", ["Malgun Gothic"], undefined, 400),
  font("noto-serif-kr", "Noto Serif KR", ["Noto Serif KR"], '"Batang", serif', 700),
  font("gulim", "굴림", ["Gulim"], "sans-serif", 400),
];

export function getFontOption(id: string): FontCatalogOption {
  return systemFontOptions.find((option) => option.id === id) || systemFontOptions[0];
}
