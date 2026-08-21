export const bannedCreativePhrases = [
  "상세페이지가 내세운",
  "상세페이지 기준",
  "상세페이지에 따르면",
  "상세페이지에서 강조한",
  "상품페이지가 말하는",
  "분석 결과",
  "분석해보니",
  "확인된 사실",
  "확인된 정보",
  "근거 기반",
  "제품 진실",
  "광고 가설",
  "후킹 가설",
  "USP",
  "랜딩페이지",
  "희소성 소구",
  "구매 판단을 도울 수 있다",
  "기억될 수 있다",
  "소비자의 관심을 유도한다",
  "프리미엄의 기준",
  "특별한 선택",
  "새로운 경험",
  "당신을 위한",
  "놓칠 수 없는",
] as const;

function normalized(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[\s·ㆍ,.;:!?~_\-–—'"`()\[\]{}]+/g, "")
    .replace(/(?:은|는|이|가|을|를|의|로|으로|에서|에|도|만|과|와)$/u, "");
}

const normalizedBans = bannedCreativePhrases.map((phrase) => ({ phrase, normalized: normalized(phrase) }));

export function findBannedCreativePhrases(value: string) {
  const target = normalized(value);
  return normalizedBans
    .filter((entry) => target.includes(entry.normalized))
    .map((entry) => entry.phrase);
}

export function hasBannedCreativePhrase(value: string) {
  return findBannedCreativePhrases(value).length > 0;
}

export function repairBannedCreativeSentence(value: string) {
  const sentences = value.split(/(?<=[.!?。！？\n])/u);
  return sentences
    .map((sentence) => hasBannedCreativePhrase(sentence) ? "" : sentence)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function assertCreativeCopyAllowed(value: string) {
  const matches = findBannedCreativePhrases(value);
  if (matches.length) throw new Error(`광고 문구에 내부 표현이 포함되어 있습니다: ${matches.join(", ")}`);
}

