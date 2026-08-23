export const bannedCreativePhrases = ["상세페이지가 내세운", "상세페이지 기준", "상세페이지에 따르면", "상세페이지에서 강조한", "상품페이지가 말하는", "분석 결과", "분석해보니", "확인된 사실", "확인된 정보", "확인된 원산지", "근거 기반", "확인된 판매가 기준", "확인된 가격 기준", "확인된 구성 기준", "검증된 근거", "제품 진실", "광고 가설", "후킹 가설", "USP", "랜딩페이지", "희소성 소구", "구매 판단을 도울 수 있다", "구매 검토를 앞당길 수 있다", "관심을 높일 수 있다", "자기 관련성이 높아진다", "기억될 수 있다", "소비자의 관심을 유도한다", "프리미엄의 기준", "특별한 선택", "새로운 경험", "당신을 위한", "놓칠 수 없는", "핵심 선택 이유", "고를 이유", "이 선택", "사용하는 순간", "새로운 사용 이유", "상품의 핵심", "브랜드 알아보기", "히어로 컷", "생활 컷", "광고 장면"] as const;

function normalized(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[\s·ㆍ,.;:!?~_\-–—'"`()\[\]{}]+/g, "")
    .replace(/(?:은|는|이|가|을|를|의|로|으로|에서|에|도|만|과|와)$/u, "");
}

const normalizedBans = bannedCreativePhrases.map((phrase) => ({ phrase, normalized: normalized(phrase) }));

const reportNarrationPatterns = [
  { phrase: "판매가 정보 낭독", pattern: /(?:판매가|가격)(?:는|은)?\s*\d[\d,.]*\s*원(?:입니다|이에요|이다|임)?/u },
  { phrase: "중량·판매가 정보 낭독", pattern: /\d[\d,.]*\s*(?:kg|g|개|팩|박스)[^.!?\n]{0,22}(?:판매가|가격)(?:는|은)?/iu },
  { phrase: "고객 반응 예측 보고", pattern: /(?:고객|소비자)에게\s*보여주면[^.!?\n]{0,38}(?:할 수 있다|높아진다|앞당길 수 있다)/u },
] as const;

export function findBannedCreativePhrases(value: string) {
  const target = normalized(value);
  const phraseMatches = normalizedBans.filter((entry) => target.includes(entry.normalized)).map((entry) => entry.phrase);
  const narrationMatches = reportNarrationPatterns.filter((entry) => entry.pattern.test(value.normalize("NFKC"))).map((entry) => entry.phrase);
  return [...new Set([...phraseMatches, ...narrationMatches])];
}

export function hasBannedCreativePhrase(value: string) {
  return findBannedCreativePhrases(value).length > 0;
}

export function repairBannedCreativeSentence(value: string) {
  const sentences = value.split(/(?<=[.!?。！？\n])/u);
  return sentences
    .map((sentence) => (hasBannedCreativePhrase(sentence) ? "" : sentence))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function assertCreativeCopyAllowed(value: string) {
  const matches = findBannedCreativePhrases(value);
  if (matches.length) throw new Error(`광고 문구에 내부 표현이 포함되어 있습니다: ${matches.join(", ")}`);
}

export function looksLikeGenericOrRepetitiveCopy(mainHook: string, subCopy: string) {
  const main = normalized(mainHook);
  const sub = normalized(subCopy);
  if (!main || !sub) return true;
  if (main === sub || main.includes(sub) || sub.includes(main)) return true;
  const mainTokens = new Set(
    mainHook
      .normalize("NFKC")
      .split(/[^가-힣A-Za-z0-9]+/u)
      .filter((token) => token.length >= 2)
  );
  const subTokens = new Set(
    subCopy
      .normalize("NFKC")
      .split(/[^가-힣A-Za-z0-9]+/u)
      .filter((token) => token.length >= 2)
  );
  const overlap = [...mainTokens].filter((token) => subTokens.has(token)).length;
  return mainTokens.size > 1 && overlap / Math.min(mainTokens.size, Math.max(1, subTokens.size)) >= 0.75;
}
