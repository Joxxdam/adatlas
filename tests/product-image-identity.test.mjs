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
