/** 상세페이지 UI·고객 후기 문장을 검증된 상품 사실로 승격하지 않게 하는 공통 경계입니다. */
const customerOpinionOrUiPattern = /(?:별점|평점|리뷰|후기|작성자|신고|도움이\s*돼요|탭\s*메뉴|상세\s*정보|상품\s*문의|효과(?:가|는|도)?\s*(?:없|못)|시원함\s*조차\s*없|별로(?:예요|입니다|였)|실망|불만|최악|아쉽(?:네요|습니다|다)|재구매\s*(?:안|않))/i;

/**
 * 상품 상세의 본문 주변에서 함께 수집되기 쉬운 계정·공유·사업자·추천상품 UI입니다.
 * 이 문자열들은 페이지에 실제로 존재하더라도 현재 상품의 구매 이유가 아닙니다.
 */
const accountShareOrBusinessUiPattern = /(?:로그인|회원\s*가입|마이\s*페이지|친구\s*초대|초대\s*리워드|리워드\s*URL|카카오톡(?:으로)?\s*(?:공유|전송)|URL\s*(?:공유|복사)|공유\s*방법|포인트\s*(?:적립|지급)|휴대폰[^.!?·]{0,20}인증|인증\s*요청|제조사\s*[:：]|판매자\s*정보|사업자\s*(?:등록|번호)|통신판매|대표자\s*[:：]|고객\s*센터|개인정보|이용\s*약관|STEP\s*[.:]?\s*\d+)/i;

const productOptionUiPattern = /(?:\[?\s*필수\s*\]?\s*)?(?:상품\s*)?옵션(?:을|을\s*먼저)?\s*(?:선택|확인)(?:해|하여)?\s*(?:주세요|주십시오)?|필수\s*옵션/iu;

// 상세페이지에서 성분·혜택 배열로 잘못 수집되는 짧은 고객 감상문입니다.
// 실제 reviewSources로 구조화된 후기는 별도 근거 경로를 사용합니다.
const unstructuredCustomerOpinionPattern = /(?:너무|정말|진짜|완전)[^.!?]{0,36}(?:좋아요|좋았어요|만족(?:해요|합니다)?|사고\s*싶어요|사보고\s*싶어요)|(?:다른|레몬|민트|코코넛|라임)[^.!?]{0,24}(?:향도|제품도)?\s*(?:사고|사보고)\s*싶어요/iu;

const recommendationUiPattern = /(?:같이\s*담으세요|함께\s*구매|추천\s*상품|관련\s*상품|최근\s*본\s*상품|다른\s*고객|뒤에서\s*훔쳐먹었다던|왕도매\s*가격판매)/i;

const generatedAudienceBoilerplatePattern = /(?:상품\s*상세페이지에서\s*확인된\s*정보를\s*비교하는\s*고객|상세페이지\s*정보를\s*확인하는\s*고객|상품\s*정보를\s*비교하는\s*고객)/i;

const postalAddressPattern = /(?:[가-힣]{2,12}(?:도|특별시|광역시)\s+)?[가-힣]{1,12}(?:시|군|구)\s+[가-힣0-9-]{1,16}(?:읍|면|동|로|길)\s+\d{1,5}(?:-\d{1,5})?/u;

// 후기 카드에서 본문과 함께 수집되는 작성 시각·작성자 꼬리표입니다. 날짜가
// 실제 상품 정보에 포함되는 경우도 있으므로 연도만으로 차단하지 않고, 후기
// UI에서 쓰는 날짜+시각 조합이나 문장 끝의 불완전한 메타데이터를 겨냥합니다.
const reviewMetadataPattern = /(?:20\d{2}\s*[-./년]\s*\d{1,2}\s*[-./월]\s*\d{1,2}(?:\s*일)?(?:\s*[T ]?\s*\d{1,2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?)?|(?:작성|등록|수정)\s*(?:일|일시|시간)\s*[:：]?\s*20\d{2}|(?:구매자|작성자|닉네임)\s*[:：])/iu;
const danglingReviewSuffixPattern = /(?:\(|\[)?\s*20\d{2}[^)\]]{0,30}(?:에|작성|등록)?\s*(?:\)|\])?\s*$/u;

// 출처가 있더라도 비교 대상·근거 없이 감각이 "다르다/좋다"고만 말하면
// 상품 사실보다는 빈 광고 수사에 가깝습니다. 삭제하지는 않되 헤드라인으로
// 승격하지 않도록 별도로 식별합니다.
const vagueStandaloneSensoryClaimPattern = /^(?:향|맛|풍미|식감|육질|품질|사용감)(?:부터)?(?:가|이|은|는)?\s*(?:다르(?:다|죠|네요)?|다릅니다|달라(?:요|집니다)?|좋(?:다|아요|습니다)?|뛰어나(?:요|다|습니다)?)\s*[.!?]*$/u;

/** 배송은 상품의 구매 조건이지만 광고 소재 문구로 사용하지 않는 운영 정책입니다. */
const shippingCreativeSignalPattern = /(?:무료\s*배송|배송비|배송\s*(?:안내|조건|혜택|무료|출발|도착|예정|지연|중|과정|중\s*흔들림)|당일\s*(?:배송|출고)|오늘\s*(?:출발|도착)|내일\s*도착|새벽\s*배송|로켓\s*배송|택배|출고\s*(?:예정|완료|수량|부족)|송장|수령|도서\s*산간|제주\s*추가|shipping|delivery|free\s*shipping)/iu;

// 상세페이지 공지에 존재하더라도 소비자에게 노출할 광고 문구로는 절대
// 사용하지 않는 운영·부정·양해·판매주체 정보입니다. 상품 상태를 과장하지
// 않기 위한 내부 제약은 별도로 보존하되 이 문장 자체는 카피에서 차단합니다.
const negativeCreativeSignalPattern = /(?:파손|압상|눌림|멍(?:이|은|을)?\s*(?:생길|발생)|흠집|상처|쭈글|외관(?:이|은|상)?\s*(?:고르지|균일하지)|불량|하자|맛(?:이)?\s*없|효과(?:가)?\s*없|별로|실망|불만|최악|아쉽|불편|문제|상했|썩은|거부감|품질(?:이)?\s*떨어)/iu;
const apologyOrNoticeCreativeSignalPattern = /(?:양해\s*(?:부탁|바랍니다|해주세요)|유의\s*(?:바랍니다|해주세요)|주의\s*(?:바랍니다|해주세요)|확인\s*(?:부탁|바랍니다|해주세요)|참고\s*(?:부탁|바랍니다|해주세요)|공지\s*(?:드립니다|사항)|처리(?:는|가)?\s*어려|처리\s*불가|교환|환불|반품|취소|CS\s*처리|고객\s*센터|고객센터|문의\s*(?:바랍니다|주세요)|책임지지)/iu;
const sellerDisclosureCreativeSignalPattern = /(?:판매원|판매자\s*정보|제조원|공급원|공급자|유통\s*전문\s*판매원|책임\s*판매업자|수입원|소분원|사업자\s*(?:등록|번호)|통신\s*판매|대표자\s*[:：]|고객\s*상담|전화\s*번호|소재지|주소\s*[:：])/iu;

// 가격·할인 토큰은 offer 사실로는 보존하지만 상품의 맛·식감·사용 이유인
// mainBenefit/USP로 승격하면 안 됩니다. 특히 판매가/정가만 적힌 한 줄이
// `확인된 상품 표현`이 되면 fallback 문구 전체가 가격으로 수렴합니다.
const priceOnlyCreativeSignalPattern = /^\s*[\[({]?\s*(?:정가|판매가|할인가|기존가|가격)?\s*[:：]?\s*\d[\d,.]*\s*원\s*(?:→|>|에서|부터|-)?\s*(?:\d[\d,.]*\s*원)?\s*[\])}]?\s*[!,.~]*\s*$/iu;
const promotionalProductSignalPattern = /(?:전국\s*)?최저가\s*도전|전국\s*최저가|하루\s*\d[\d,.]*\s*개\s*한정|\d{1,3}\s*%\s*(?:할인|OFF)?|\d[\d,.]*\s*원|초특가|한정\s*(?:특가|판매)|품절\s*임박|오늘만|지금만|쿠폰|증정/iu;

// 원산지는 실제 상품 동일성 확인용으로는 보존하되, 광고 문구에서는
// 국내산 육류일 때만 소구하는 운영 정책을 공통 경계로 둔다.
const domesticOriginCreativeSignalPattern = /(?:국내산|국산|대한민국산|한국산|제주산|(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)도?\s*산)/iu;
const explicitOriginCreativeSignalPattern = /(?:원산지|산지\s*[:：]|제조국|수입산|외국산)/iu;
const meatProductContextPattern = /(?:한우|소고기|쇠고기|우육|돼지고기|돈육|닭고기|계육|오리고기|양고기|육류|정육|갈비|등심|안심|채끝|삼겹살|목살|항정살|차돌박이|스테이크|불고기|수육|보쌈|meat|beef|pork|chicken)/iu;

export function isDomesticOriginCreativeSignal(value: string | undefined) {
  return Boolean(value && domesticOriginCreativeSignalPattern.test(value.normalize("NFKC")));
}

export function isNonDomesticOriginCreativeSignal(value: string | undefined) {
  if (!value) return false;
  const normalized = value.normalize("NFKC");
  const declaresOrigin = /(?:원산지|산지|제조국|수입산|외국산|(?:미국|호주|뉴질랜드|캐나다|터키|중국|일본|프랑스|이탈리아|스페인|독일|칠레|페루|브라질|베트남|태국|인도|인도네시아|필리핀|멕시코|아르헨티나|남아프리카|네덜란드|벨기에|덴마크|노르웨이|러시아|우크라이나|몽골|대만|말레이시아|이집트|그리스|포르투갈)\s*산)/iu.test(normalized);
  return declaresOrigin && !isDomesticOriginCreativeSignal(normalized);
}

export function isOriginCreativeSignal(value: string | undefined) {
  return Boolean(
    value &&
      (isDomesticOriginCreativeSignal(value) ||
        isNonDomesticOriginCreativeSignal(value) ||
        explicitOriginCreativeSignalPattern.test(value.normalize("NFKC")))
  );
}

export function isMeatProductContext(product: {
  productName?: string;
  category?: string;
  productSubCategory?: string;
  detectedProductType?: string;
  ingredients?: string[];
}) {
  const context = [product.productName, product.category, product.productSubCategory, product.detectedProductType, ...(product.ingredients || [])]
    .filter(Boolean)
    .join(" ")
    .normalize("NFKC");
  return meatProductContextPattern.test(context);
}

/** 상품명은 보존하되 비육류 광고에서 원산지 수식어만 제거합니다. */
export function removeOriginCreativePhrases(value: string | undefined) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/원산지\s*[:：]?\s*[가-힣A-Za-z]{2,16}산?/giu, " ")
    .replace(/(?:국내산|국산|대한민국산|한국산|제주산|호주산|미국산|뉴질랜드산|캐나다산|터키산|중국산|일본산|칠레산|페루산|베트남산|태국산)/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isShippingCreativeSignal(value: string | undefined) {
  return Boolean(value && shippingCreativeSignalPattern.test(value.normalize("NFKC")));
}

export function isNegativeCreativeSignal(value: string | undefined) {
  return Boolean(value && negativeCreativeSignalPattern.test(value.normalize("NFKC")));
}

export function isApologyOrNoticeCreativeSignal(value: string | undefined) {
  return Boolean(value && apologyOrNoticeCreativeSignalPattern.test(value.normalize("NFKC")));
}

export function isSellerDisclosureCreativeSignal(value: string | undefined) {
  return Boolean(value && sellerDisclosureCreativeSignalPattern.test(value.normalize("NFKC")));
}

export function isVagueStandaloneSensoryClaim(value: string | undefined) {
  return Boolean(value && vagueStandaloneSensoryClaimPattern.test(value.normalize("NFKC").replace(/\s+/g, " ").trim()));
}

export function isPriceOnlyCreativeSignal(value: string | undefined) {
  return Boolean(value && priceOnlyCreativeSignalPattern.test(value.normalize("NFKC")));
}

export function isMalformedProductSignal(value: string | undefined) {
  if (!value) return false;
  const normalized = value.normalize("NFKC");
  const pairs: Array<[string, string]> = [["[", "]"], ["(", ")"], ["{", "}"]];
  const truncatedUnitComparison = /박스\s*무게\s*포함[^/\n]{0,24}\d[\d,.]*\s*(?:kg|g|ml|l)\s*\/\s*1\s*$/iu.test(normalized);
  return /&#\d+;|�/u.test(normalized) || truncatedUnitComparison || pairs.some(([open, close]) =>
    normalized.split(open).length - 1 !== normalized.split(close).length - 1
  );
}

/** 프로모션 정보가 섞인 문장은 USP가 아니라 별도 offer 영역에서만 사용합니다. */
export function isPromotionalProductSignal(value: string | undefined) {
  return Boolean(value && promotionalProductSignalPattern.test(value.normalize("NFKC")));
}

export function isUnsafeProductCreativeSignal(value: string | undefined) {
  return Boolean(
    value &&
      (customerOpinionOrUiPattern.test(value) ||
        accountShareOrBusinessUiPattern.test(value) ||
        productOptionUiPattern.test(value) ||
        unstructuredCustomerOpinionPattern.test(value) ||
        recommendationUiPattern.test(value) ||
        generatedAudienceBoilerplatePattern.test(value) ||
        postalAddressPattern.test(value) ||
        reviewMetadataPattern.test(value) ||
        danglingReviewSuffixPattern.test(value))
  );
}

/** 모든 수동·자동 광고 문구 경로에서 동일하게 적용하는 최종 금지 경계입니다. */
export function isProhibitedAdCopySignal(value: string | undefined) {
  return Boolean(
    value &&
      (isUnsafeProductCreativeSignal(value) ||
        isShippingCreativeSignal(value) ||
        isNegativeCreativeSignal(value) ||
        isApologyOrNoticeCreativeSignal(value) ||
        isSellerDisclosureCreativeSignal(value))
  );
}

export function removeUnsafeProductCreativeSignals(values: Array<string | undefined>) {
  return values.map((value) => String(value || "").trim()).filter((value) => value && !isUnsafeProductCreativeSignal(value));
}
