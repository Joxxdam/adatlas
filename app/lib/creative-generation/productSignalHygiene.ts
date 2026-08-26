/** 상세페이지 UI·고객 후기 문장을 검증된 상품 사실로 승격하지 않게 하는 공통 경계입니다. */
const customerOpinionOrUiPattern = /(?:별점|평점|리뷰|후기|작성자|신고|도움이\s*돼요|탭\s*메뉴|상세\s*정보|상품\s*문의|효과(?:가|는|도)?\s*(?:없|못)|시원함\s*조차\s*없|별로(?:예요|입니다|였)|실망|불만|최악|아쉽(?:네요|습니다|다)|재구매\s*(?:안|않))/i;

/**
 * 상품 상세의 본문 주변에서 함께 수집되기 쉬운 계정·공유·사업자·추천상품 UI입니다.
 * 이 문자열들은 페이지에 실제로 존재하더라도 현재 상품의 구매 이유가 아닙니다.
 */
const accountShareOrBusinessUiPattern = /(?:로그인|회원\s*가입|마이\s*페이지|친구\s*초대|초대\s*리워드|리워드\s*URL|카카오톡(?:으로)?\s*(?:공유|전송)|URL\s*(?:공유|복사)|공유\s*방법|포인트\s*(?:적립|지급)|휴대폰[^.!?·]{0,20}인증|인증\s*요청|제조사\s*[:：]|판매자\s*정보|사업자\s*(?:등록|번호)|통신판매|대표자\s*[:：]|고객\s*센터|개인정보|이용\s*약관|STEP\s*[.:]?\s*\d+)/i;

const recommendationUiPattern = /(?:같이\s*담으세요|함께\s*구매|추천\s*상품|관련\s*상품|최근\s*본\s*상품|다른\s*고객|뒤에서\s*훔쳐먹었다던|왕도매\s*가격판매)/i;

const generatedAudienceBoilerplatePattern = /(?:상품\s*상세페이지에서\s*확인된\s*정보를\s*비교하는\s*고객|상세페이지\s*정보를\s*확인하는\s*고객|상품\s*정보를\s*비교하는\s*고객)/i;

const postalAddressPattern = /(?:[가-힣]{2,12}(?:도|특별시|광역시)\s+)?[가-힣]{1,12}(?:시|군|구)\s+[가-힣0-9-]{1,16}(?:읍|면|동|로|길)\s+\d{1,5}(?:-\d{1,5})?/u;

// 후기 카드에서 본문과 함께 수집되는 작성 시각·작성자 꼬리표입니다. 날짜가
// 실제 상품 정보에 포함되는 경우도 있으므로 연도만으로 차단하지 않고, 후기
// UI에서 쓰는 날짜+시각 조합이나 문장 끝의 불완전한 메타데이터를 겨냥합니다.
const reviewMetadataPattern = /(?:20\d{2}\s*[-./년]\s*\d{1,2}\s*[-./월]\s*\d{1,2}(?:\s*일)?(?:\s*[T ]?\s*\d{1,2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?)?|(?:작성|등록|수정)\s*(?:일|일시|시간)\s*[:：]?\s*20\d{2}|(?:구매자|작성자|닉네임)\s*[:：])/iu;
const danglingReviewSuffixPattern = /(?:\(|\[)?\s*20\d{2}[^)\]]{0,30}(?:에|작성|등록)?\s*(?:\)|\])?\s*$/u;

export function isUnsafeProductCreativeSignal(value: string | undefined) {
  return Boolean(
    value &&
      (customerOpinionOrUiPattern.test(value) ||
        accountShareOrBusinessUiPattern.test(value) ||
        recommendationUiPattern.test(value) ||
        generatedAudienceBoilerplatePattern.test(value) ||
        postalAddressPattern.test(value) ||
        reviewMetadataPattern.test(value) ||
        danglingReviewSuffixPattern.test(value))
  );
}

export function removeUnsafeProductCreativeSignals(values: Array<string | undefined>) {
  return values.map((value) => String(value || "").trim()).filter((value) => value && !isUnsafeProductCreativeSignal(value));
}
