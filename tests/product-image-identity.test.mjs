import assert from "node:assert/strict";
import test from "node:test";
import { evaluateProductImageIdentity, extractDeclaredProductIds, filterCurrentProductImages, isDifferentProductImage, stripDifferentProductLinkBlocks } from "../app/lib/mvp/productImageIdentity.ts";
import { buildProductTruth } from "../app/lib/creative-generation/productTruth.ts";

test("상품 URL과 다른 goodsNo 이미지가 추천상품으로 차단된다", () => {
  const productUrl = "https://shop.example.com/goods/view?goodsNo=1000017175";
  assert.deepEqual(extractDeclaredProductIds(productUrl), ["1000017175"]);
  assert.equal(isDifferentProductImage(productUrl, "https://cdn.example.com/goods/1000017175/main.jpg"), false);
  assert.equal(isDifferentProductImage(productUrl, "https://cdn.example.com/goods/1000099999/main.jpg"), true);
  assert.equal(evaluateProductImageIdentity(productUrl, "https://cdn.example.com/images/main_1200x1200.jpg").status, "unknown");
  assert.deepEqual(
    filterCurrentProductImages(productUrl, ["https://cdn.example.com/goods/1000017175/a.jpg", "https://cdn.example.com/goods/1000099999/b.jpg"], (value) => value),
    ["https://cdn.example.com/goods/1000017175/a.jpg"]
  );
});

test("클래스명이 바뀌어도 다른 goodsNo 추천상품 링크의 이미지와 문구를 함께 제거한다", () => {
  const productUrl = "https://m.foodingfactory.com/goods/goods_view.php?goodsNo=1000017175";
  const html = [
    '<a class="renamed-recommendation" href="/goods/goods_view.php?goodsNo=1000017141"><img src="/goods/1000017141.jpg">꽁치를 넣고 끓여 주세요</a>',
    '<a href="/goods/goods_view.php?goodsNo=1000017175"><img src="/goods/1000017175.jpg">뼈없는 순살감자탕</a>',
    "<section>현재 상품 공통 상세 설명</section>",
  ].join("");
  const scoped = stripDifferentProductLinkBlocks(productUrl, html);
  assert.doesNotMatch(scoped, /1000017141|꽁치/);
  assert.match(scoped, /1000017175|뼈없는 순살감자탕/);
  assert.match(scoped, /현재 상품 공통 상세 설명/);
});

test("href 없이 data-mgcode로 렌더링된 오늘의 추천상품 섹션도 수집 전에 통째로 제거한다", () => {
  const productUrl = "https://kookdae.co.kr/Goods/Detail/SME86870248";
  const html = [
    '<aside class="brand-right">',
    '<!--추천상품 1열 오른쪽-->',
    '<div class="brd-recommen"><h4>#오늘의 추천상품</h4>',
    '<div class="panel prod"><div onclick="goDetailForRecent(this)" data-mgcode="SME12186223"></div>',
    '<img src="https://cdn.example.com/recommend/galbi.jpg"><h4>추석물량 어린소 연한 소찜갈비 1.8kg</h4></div>',
    '</div><!--//추천상품 1열 오른쪽 END-->',
    '</aside>',
    '<main><h1>찰진등심 1kg박스</h1><img src="https://cdn.example.com/current/sirloin.jpg"></main>',
  ].join("");
  const scoped = stripDifferentProductLinkBlocks(productUrl, html);
  assert.doesNotMatch(scoped, /오늘의 추천상품|SME12186223|소찜갈비|galbi\.jpg/);
  assert.match(scoped, /찰진등심 1kg박스|sirloin\.jpg/);
});

test("상품번호가 없는 페이지도 추천상품 semantic section은 수집에서 제외한다", () => {
  const html = [
    '<section aria-label="recommended products"><h2>Recommended Products</h2><p>다른 상품</p></section>',
    '<main><p>현재 상품 설명</p></main>',
  ].join("");
  const scoped = stripDifferentProductLinkBlocks("https://shop.example.com/products/current", html);
  assert.doesNotMatch(scoped, /Recommended Products|다른 상품/);
  assert.match(scoped, /현재 상품 설명/);
});

test("대용량이거나 닫는 태그가 깨진 HTML도 추천영역 필터가 즉시 끝난다", { timeout: 2_000 }, () => {
  const productUrl = "https://kookdae.co.kr/Goods/Detail/SME86870248";
  const filler = '<section class="product-detail"><div>현재 상품 설명</div></section>'.repeat(24_000);
  const malformedRecommendation = '<section class="recommended-products"><h2>오늘의 추천상품</h2><div>다른 상품';
  const startedAt = performance.now();
  const scoped = stripDifferentProductLinkBlocks(productUrl, `${filler}${malformedRecommendation}`);
  const elapsed = performance.now() - startedAt;
  assert.match(scoped, /현재 상품 설명/);
  // 닫는 태그가 깨졌으면 안전하게 원문을 유지하되 정규식 backtracking으로
  // 서버 이벤트 루프를 점유해서는 안 됩니다.
  assert.match(scoped, /오늘의 추천상품/);
  assert.ok(elapsed < 1_500, `HTML 필터가 너무 오래 걸렸습니다: ${Math.round(elapsed)}ms`);
});

test("자동 갤러리는 confirmedProductImage가 되지 않고 대표·JSON-LD만 확정된다", () => {
  const truth = buildProductTruth({
    source: "landing-page",
    product: {
      productName: "테스트 사과 3kg",
      category: "식품/선물",
      price: "9,900원",
      discountInfo: "",
      mainBenefit: "아삭하고 달콤한 식감",
      targetCustomer: "가족 간식을 찾는 고객",
      landingUrl: "https://shop.example.com/goods/view?goodsNo=1000017175",
      productImagePath: "https://cdn.example.com/goods/1000017175/main.jpg",
      productImagePaths: ["https://cdn.example.com/goods/1000017175/main.jpg", "https://cdn.example.com/goods/1000017175/gallery.jpg"],
      confirmedProductImagePaths: ["https://cdn.example.com/goods/1000017175/main.jpg"],
      extractedMainImage: "https://cdn.example.com/goods/1000017175/main.jpg",
      extractedGalleryImages: ["https://cdn.example.com/goods/1000017175/gallery.jpg"],
      backgroundImagePath: "",
    },
  });
  assert.equal(truth.confirmedProductImage?.path, "https://cdn.example.com/goods/1000017175/main.jpg");
  const gallery = truth.imageAssets.find((asset) => asset.path.endsWith("gallery.jpg"));
  assert.equal(gallery?.verified, false);
  assert.notEqual(gallery?.source, "user-confirmed");
});

test("ProductTruth 경계에서도 다른 상품 번호 이미지와 미확정 대표 후보를 승격하지 않는다", () => {
  const truth = buildProductTruth({
    source: "landing-page",
    product: {
      productName: "테스트 사과 3kg",
      category: "식품/선물",
      price: "9,900원",
      discountInfo: "",
      mainBenefit: "아삭하고 달콤한 식감",
      targetCustomer: "가족 간식을 찾는 고객",
      landingUrl: "https://shop.example.com/goods/view?goodsNo=1000017175",
      productImagePath: "https://cdn.example.com/goods/1000017175/gallery.jpg",
      productImagePaths: ["https://cdn.example.com/goods/1000017175/gallery.jpg", "https://cdn.example.com/goods/1000099999/main.jpg"],
      confirmedProductImagePaths: [],
      extractedMainImage: "https://cdn.example.com/goods/1000017175/gallery.jpg",
      extractedGalleryImages: ["https://cdn.example.com/goods/1000099999/detail.jpg"],
      backgroundImagePath: "",
    },
  });
  assert.equal(truth.confirmedProductImage, undefined);
  assert.equal(truth.imageAssets.some((asset) => asset.path.includes("1000099999")), false);
  assert.equal(truth.imageAssets.find((asset) => asset.path.endsWith("gallery.jpg"))?.verified, false);
});
