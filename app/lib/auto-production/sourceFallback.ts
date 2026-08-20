export type CandidateSourceResult<T, S extends string> = {
  candidates: T[];
  source: S;
  warnings?: string[];
};

export async function runCandidateSourceFallback<T, S extends string>(
  attempts: Array<() => Promise<CandidateSourceResult<T, S>>>,
  emptySource: S
) {
  const warnings: string[] = [];
  for (let index = 0; index < attempts.length; index += 1) {
    try {
      const result = await attempts[index]();
      warnings.push(...(result.warnings || []));
      if (result.candidates.length) {
        return {
          ...result,
          fallbackUsed: index > 0,
          fallbackReason: index > 0 ? warnings.at(-1) : undefined,
          warnings,
        };
      }
      warnings.push("확인 가능한 광고 후보 상품이 없어 다음 데이터 소스를 확인했습니다.");
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : "후보 데이터 조회에 실패했습니다.");
    }
  }
  return {
    candidates: [] as T[],
    source: emptySource,
    fallbackUsed: attempts.length > 1,
    fallbackReason: warnings.at(-1),
    warnings,
  };
}
