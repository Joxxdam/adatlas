import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeCafe24BundlePricingClaims, resolveCafe24RequiredBundlePricing } from "../app/lib/store-analysis/extractors/cafe24Pricing.ts";

const bundleHtml = `
  <div class="xans-product infoArea" data-price="12000" data-custom="60000">
    <strong id="span_product_price_text">12,000원</strong>
    <span id="span_product_price_custom">60,000원</span>
    <table><tr><th>금액범위</th><td><span>15%,51,000원</span></td></tr></table>
    <select product_type="product_option" required="true"><option>옵션</option></select>
  </div>
  <script>
    var option_stock_data = '{\"P00000ER00EW\":{\"option_price\":51000,\"is_mandatory\":\"T\"}}';
  </script>
`;

test("Cafe24 필수 5종 골라담기는 단품가가 아니라 옵션 총액과 계산 할인율을 사용한다", () => {
  assert.deepEqual(resolveCafe24RequiredBundlePricing(bundleHtml, "샤워젤 250ml 5종 골라담기팩"), {
    price: "51,000원",
    originalPrice: "60,000원",
    discountInfo: "15% 할인",
    source: "cafe24-required-bundle-option",
  });
});

test("일반 단품과 선택 옵션 가격이 여러 개인 상품은 임의로 가격을 덮어쓰지 않는다", () => {
  const singleProduct = bundleHtml.replace("5종 골라담기팩", "민트 샤워젤 250ml");
  assert.equal(resolveCafe24RequiredBundlePricing(singleProduct, "민트 샤워젤 250ml"), null);

  const ambiguous = bundleHtml
    .replace("<table><tr><th>금액범위</th><td><span>15%,51,000원</span></td></tr></table>", "")
    .replace('"option_price":51000', '"option_price":51000},{"option_price":54000');
  assert.equal(resolveCafe24RequiredBundlePricing(ambiguous, "샤워젤 250ml 5종 골라담기팩"), null);
});

test("필수 묶음 옵션의 과거 할인율은 확정된 현재 할인율로 정규화한다", () => {
  const pricing = resolveCafe24RequiredBundlePricing(bundleHtml, "샤워젤 250ml 5종 골라담기팩");
  assert.ok(pricing);
  assert.equal(
    normalizeCafe24BundlePricingClaims("대표 5가지 향을 한 번에, 18% 할인 풀 패키지 · 비건 100% 천연향료", pricing),
    "대표 5가지 향을 한 번에, 15% 할인 풀 패키지 · 비건 100% 천연향료",
  );
});

test("예약 자동제작의 사이트 분석도 수동 제작과 같은 Cafe24 묶음 가격 helper를 사용한다", async () => {
  const source = await readFile(new URL("../app/lib/store-analysis/productAnalyzer.ts", import.meta.url), "utf8");
  assert.match(source, /resolveCafe24RequiredBundlePricing\(html, name\)/);
  assert.match(source, /numberFromUnknown\(cafe24BundlePricing\?\.price\)/);
  assert.match(source, /numberFromUnknown\(cafe24BundlePricing\?\.originalPrice\)/);
  assert.match(source, /normalizeCafe24BundlePricingClaims\(rawDescription, cafe24BundlePricing\)/);
});
