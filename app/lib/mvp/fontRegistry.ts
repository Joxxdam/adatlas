export type FontRegistryEntry = {
  id: string;
  label: string;
  family: string;
  fallback: string;
  recommendedWeights: number[];
};

export const fontRegistry: Record<string, FontRegistryEntry> = {
  "korean-sans": {
    id: "korean-sans",
    label: "Korean Sans",
    family: "Pretendard",
    fallback: '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", Arial, sans-serif',
    recommendedWeights: [500, 700, 800, 900],
  },
  "korean-impact": {
    id: "korean-impact",
    label: "Korean Impact",
    family: '"Black Han Sans"',
    fallback: 'Pretendard, "Noto Sans KR", "Malgun Gothic", Arial, sans-serif',
    recommendedWeights: [800, 900],
  },
  "korean-serif": {
    id: "korean-serif",
    label: "Korean Serif",
    family: '"Noto Serif KR"',
    fallback: '"Nanum Myeongjo", "Malgun Gothic", serif',
    recommendedWeights: [500, 700, 800],
  },
};

export function fontFamilyForRegistryId(id = "korean-sans") {
  const font = fontRegistry[id] || fontRegistry["korean-sans"];
  return `${font.family}, ${font.fallback}`;
}
