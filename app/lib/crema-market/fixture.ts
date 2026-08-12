import { isoDateShift } from "./aggregation.ts";
import { normalizeWorkbookRows } from "./normalizer.ts";

export const DEVELOPMENT_FIXTURE_ADVERTISER_ID = "dev-crema-market";

export function buildDevelopmentFixture(endDate = "2026-08-11") {
  const products = [
    ["P-001", "숨은 전환 민트 샤워젤", "뷰티", 15900, 80, "판매중", true, "2026-01-10"],
    ["P-002", "최근 상승 레몬 샤워젤", "뷰티", 16900, 60, "판매중", true, "2026-02-01"],
    ["P-003", "관심 높은 바디워시", "뷰티", 19900, 45, "판매중", true, "2025-12-01"],
    ["P-004", "후기 강한 코코넛 샤워젤", "뷰티", 17900, 30, "판매중", true, "2026-03-05"],
    ["P-005", "후기 점검 필요 샤워젤", "뷰티", 14900, 20, "판매중", true, "2026-03-05"],
    ["P-006", "신상품 티트리 바디젤", "뷰티", 18900, 100, "판매중", true, "2026-08-01"],
    ["P-007", "품절 샤워젤", "뷰티", 12900, 0, "품절", false, "2025-10-01"],
  ].map(([code, name, category, price, stock, status, display, createdAt]) => ({
    상품코드: code, 상품명: name, 카테고리: category, 판매가: price, 재고: stock,
    상품상태: status, 진열: display, 등록일: createdAt,
    상품URL: `https://example.com/products/${String(code).toLowerCase()}`,
    상품이미지: "/test-fixtures/creative/original-source-product.svg",
  }));
  const metrics: Record<string, unknown>[] = [];
  for (let offset = 27; offset >= 0; offset -= 1) {
    const date = isoDateShift(endDate, -offset);
    const recent = offset <= 13;
    const rows = [
      ["P-001", recent ? 14 : 12, recent ? 3 : 2, recent ? 2 : 1, recent ? 31800 : 15900, 4.7, 1],
      ["P-002", recent ? 55 : 30, recent ? 8 : 5, recent ? 4 : 1, recent ? 67600 : 16900, 4.4, 1],
      ["P-003", 180, 22, 2, 39800, 4.1, 0],
      ["P-004", 48, 9, 4, 71600, 4.8, 2],
      ["P-005", 42, 5, 1, 14900, 2.9, 1],
      ["P-006", recent ? 12 : 0, recent ? 2 : 0, recent ? 0 : 0, 0, 4.6, recent ? 1 : 0],
      ["P-007", 0, 0, 0, 0, null, 0],
    ];
    for (const [code, views, carts, orders, revenue, rating, reviews] of rows) {
      metrics.push({ 상품코드: code, 날짜: date, 조회수: views, 장바구니수: carts, 결제주문수: orders, 매출: revenue, 평균평점: rating, 리뷰수: reviews, 재구매주문수: code === "P-004" ? 1 : 0, 재고: products.find((product) => product.상품코드 === code)?.재고 });
    }
  }
  const reviews = [
    { 상품코드: "P-001", 후기주제: "상쾌한 사용감", 후기요약: "민트 사용감이 시원하다는 후기가 반복됩니다.", 긍부정: "긍정", 평균평점: 4.7, 후기수: 18 },
    { 상품코드: "P-004", 후기주제: "향과 보습", 후기요약: "향과 사용 후 느낌을 장점으로 꼽습니다.", 긍부정: "긍정", 평균평점: 4.8, 후기수: 42 },
    { 상품코드: "P-005", 후기주제: "향 호불호", 후기요약: "향이 기대와 다르다는 의견이 있습니다.", 긍부정: "부정", 평균평점: 2.9, 후기수: 11 },
    { 상품코드: "P-005", 후기주제: "용기 사용성", 후기요약: "용기 사용이 불편하다는 의견이 있습니다.", 긍부정: "부정", 평균평점: 2.8, 후기수: 7 },
  ];
  return normalizeWorkbookRows({
    advertiserId: DEVELOPMENT_FIXTURE_ADVERTISER_ID,
    advertiserName: "개발용 크리마켓 예시 광고주",
    brandName: "개발용 브랜드",
    domain: "example.com",
    productRows: products,
    metricRows: metrics,
    reviewRows: reviews,
    provider: "development_fixture",
    now: `${endDate}T12:00:00+09:00`,
  });
}
