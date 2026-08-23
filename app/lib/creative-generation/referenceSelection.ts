export function pickUniqueRandomItems<T>(
  items: readonly T[],
  count: number,
  nextIndex: (maxExclusive: number) => number
) {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error("무작위 레퍼런스 선택 수가 올바르지 않습니다.");
  }
  if (items.length < count) {
    throw new Error(`고품질 광고 레퍼런스가 부족합니다. 필요 ${count}장, 등록 ${items.length}장`);
  }
  const pool = [...items];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const picked = Math.max(0, Math.min(index, Math.floor(nextIndex(index + 1))));
    [pool[index], pool[picked]] = [pool[picked], pool[index]];
  }
  return pool.slice(0, count);
}

/**
 * 상품군과 같은 레퍼런스를 먼저 무작위 선택하고, 해당 풀이 부족할 때만
 * 나머지 풀에서 보충한다. 두 풀을 따로 섞어 카테고리 우선순위가 우연히
 * 뒤집히지 않게 하며 최종 결과의 중복도 허용하지 않는다.
 */
export function pickCategoryPreferredItems<T extends { categoryGroup: string }>(
  items: readonly T[],
  count: number,
  categoryGroup: string,
  nextIndex: (maxExclusive: number) => number
) {
  const preferred = items.filter((item) => item.categoryGroup === categoryGroup);
  const fallback = items.filter((item) => item.categoryGroup !== categoryGroup);
  const preferredCount = Math.min(count, preferred.length);
  const selected = pickUniqueRandomItems(preferred, preferredCount, nextIndex);
  if (selected.length === count) return selected;
  return [
    ...selected,
    ...pickUniqueRandomItems(fallback, count - selected.length, nextIndex),
  ];
}
