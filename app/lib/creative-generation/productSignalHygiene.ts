/** 상세페이지 UI·고객 후기 문장을 검증된 상품 사실로 승격하지 않게 하는 공통 경계입니다. */
const customerOpinionOrUiPattern = /(?:별점|평점|리뷰|후기|작성자|신고|도움이\s*돼요|탭\s*메뉴|상세\s*정보|상품\s*문의|효과(?:가|는|도)?\s*(?:없|못)|시원함\s*조차\s*없|별로(?:예요|입니다|였)|실망|불만|최악|아쉽(?:네요|습니다|다)|재구매\s*(?:안|않))/i;

export function isUnsafeProductCreativeSignal(value: string | undefined) {
  return Boolean(value && customerOpinionOrUiPattern.test(value));
}

export function removeUnsafeProductCreativeSignals(values: Array<string | undefined>) {
  return values.map((value) => String(value || "").trim()).filter((value) => value && !isUnsafeProductCreativeSignal(value));
}
