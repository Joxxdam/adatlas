export type CategoryDefinition = {
  id: string;
  name: string;
  keywords: string[];
};

export const defaultFashionCategories: CategoryDefinition[] = [
  { id: "fashion.tops", name: "상의", keywords: ["티셔츠", "티", "블라우스", "셔츠", "니트", "맨투맨", "후드", "탑", "베스트", "뷔스티에"] },
  { id: "fashion.cardigans", name: "가디건", keywords: ["가디건", "카디건"] },
  { id: "fashion.dresses", name: "원피스", keywords: ["원피스", "드레스"] },
  { id: "fashion.bottoms", name: "하의", keywords: ["스커트", "치마", "팬츠", "바지", "데님", "슬랙스", "레깅스"] },
  { id: "fashion.outerwear", name: "아우터", keywords: ["자켓", "재킷", "점퍼", "코트", "야상", "패딩", "바람막이"] },
  { id: "fashion.sets", name: "세트·코디", keywords: ["세트", "셋업", "코디", "투피스"] },
  { id: "fashion.shoes", name: "신발", keywords: ["슈즈", "구두", "부츠", "샌들", "슬리퍼", "스니커즈", "운동화"] },
  { id: "fashion.bags", name: "가방", keywords: ["가방", "백", "숄더", "토트", "크로스백", "파우치"] },
  { id: "fashion.accessories", name: "패션소품", keywords: ["머플러", "스카프", "목걸이", "귀걸이", "벨트", "모자", "양말"] },
];

export function normalizeProductCategory(productName: string, definitions = defaultFashionCategories) {
  const normalized = productName.normalize("NFKC").toLowerCase();
  const match = definitions.find((definition) => definition.keywords.some((keyword) => normalized.includes(keyword.toLowerCase())));
  return match || { id: "fashion.uncategorized", name: "미분류", keywords: [] };
}
