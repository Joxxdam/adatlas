import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

import { inspectCutoutQuality } from "../app/lib/mvp/cutoutQuality.ts";
import { removeBackgroundToPng } from "../app/lib/mvp/imageEffects.ts";
import { inferExpectedUnitCount, inferProductRepresentation, normalizeProductImageUrl, productCutoutCacheDescriptor } from "../app/lib/mvp/productImagePipeline.ts";
import { refineProductCutoutAlpha } from "../app/lib/mvp/productMaskPostprocess.ts";

async function pixel(buffer, x, y) {
  const image = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const index = (y * image.info.width + x) * 4;
  return Array.from(image.data.subarray(index, index + 4));
}

test("상품 문맥에서 단일·세트·비정형·포장·플레이팅·투명 유형을 구분한다", () => {
  assert.equal(inferProductRepresentation({ productName: "민트 티트리 샤워젤 250ml" }).type, "single-product");
  assert.equal(inferProductRepresentation({ productName: "샤워젤 5종 세트" }).type, "multi-unit-set");
  assert.equal(inferProductRepresentation({ productName: "부산 가야 밀면 특가 10인분", category: "식품/선물" }).type, "plated-product");
  assert.equal(inferProductRepresentation({ productName: "시원한 평양냉면 10인분", category: "식품" }).type, "plated-product");
  assert.notEqual(inferProductRepresentation({ productName: "샤워젤 4개 묶음 1+1" }).type, "multi-unit-set");
  assert.equal(inferProductRepresentation({ productName: "샤워젤 4개 세트" }).type, "multi-unit-set");
  assert.equal(inferProductRepresentation({ productName: "평양냉면 선물 세트", category: "식품" }).type, "multi-unit-set");
  assert.equal(inferProductRepresentation({ productName: "한우 등심 1kg 생고기" }).type, "irregular-product");
  assert.equal(inferProductRepresentation({ productName: "여름 한정 봉황 청사과 5kg" }).type, "irregular-product");
  assert.equal(inferProductRepresentation({ productName: "진공 포장 트레이 한우" }).type, "packaged-product");
  assert.equal(inferProductRepresentation({ productName: "접시에 플레이팅한 스테이크" }).type, "plated-product");
  assert.equal(inferProductRepresentation({ productName: "투명 유리 디스펜서" }).type, "transparent-or-reflective-product");
  assert.equal(inferExpectedUnitCount("250ml 2개 + 50ml 1개"), 3);
});

test("이미지 URL의 추적·리사이즈 변형은 동일 원본 키로 정규화한다", () => {
  const left = normalizeProductImageUrl("https://cdn.example.com/product/a.jpg?w=400&utm_source=meta&q=70");
  const right = normalizeProductImageUrl("https://cdn.example.com/product/a.jpg");
  assert.equal(left, right);
});

test("누끼 캐시는 상품 유형·추출 범위·객체 그룹·크롭을 구분한다", () => {
  const base = {
    contentHash: "same-source",
    provider: "removebg",
    representationType: "single-product",
    extractionScope: "single-item",
  };
  const first = productCutoutCacheDescriptor(base);
  assert.notEqual(first, productCutoutCacheDescriptor({ ...base, representationType: "multi-unit-set" }));
  assert.notEqual(first, productCutoutCacheDescriptor({ ...base, extractionScope: "sales-unit" }));
  assert.notEqual(first, productCutoutCacheDescriptor({ ...base, selectedObjectIds: ["object-2"] }));
  assert.notEqual(
    first,
    productCutoutCacheDescriptor({
      ...base,
      cropBox: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
    })
  );
});

test("흰 배경 단일 용기에서 흰 라벨을 지우지 않고 바깥 배경만 투명하게 만든다", async () => {
  const source = await sharp({
    create: { width: 300, height: 300, channels: 4, background: "#ffffff" },
  })
    .composite([
      {
        input: Buffer.from('<svg width="130" height="230"><rect width="130" height="230" rx="18" fill="#05a878"/><rect x="22" y="78" width="86" height="58" fill="white"/></svg>'),
        left: 85,
        top: 35,
      },
    ])
    .png()
    .toBuffer();
  const cutout = await removeBackgroundToPng(source, {
    representationType: "single-product",
    extractionScope: "single-item",
  });
  assert.ok((await pixel(cutout, 10, 10))[3] < 20, "corner background should be transparent");
  assert.ok((await pixel(cutout, 150, 142))[3] > 240, "white label must remain opaque");
  const quality = await inspectCutoutQuality(cutout, { representationType: "single-product" });
  assert.equal(quality.usable, true);
  assert.ok(quality.score >= 0.55);
});

test("다중 판매 세트는 떨어진 여러 객체와 사이의 투명 공간을 함께 유지한다", async () => {
  const source = await sharp({
    create: { width: 360, height: 260, channels: 4, background: "#f7f7f7" },
  })
    .composite([
      { input: Buffer.from('<svg width="90" height="150"><rect width="90" height="150" rx="12" fill="#bd2437"/></svg>'), left: 55, top: 55 },
      { input: Buffer.from('<svg width="90" height="150"><rect width="90" height="150" rx="12" fill="#8632c7"/></svg>'), left: 215, top: 55 },
    ])
    .png()
    .toBuffer();
  const initial = await removeBackgroundToPng(source, {
    representationType: "multi-unit-set",
    extractionScope: "sales-unit",
  });
  const cutout = await refineProductCutoutAlpha(initial, {
    representationType: "multi-unit-set",
    extractionScope: "sales-unit",
  });
  assert.ok((await pixel(cutout, 90, 120))[3] > 230, "left component should remain");
  assert.ok((await pixel(cutout, 260, 120))[3] > 230, "right component should remain");
  assert.ok((await pixel(cutout, 180, 120))[3] < 30, "space between components stays transparent");
  const quality = await inspectCutoutQuality(cutout, {
    representationType: "multi-unit-set",
    expectedUnitCount: 2,
  });
  assert.equal(quality.usable, true);
  assert.ok(quality.componentCount >= 2);
});

test("이미 투명한 PNG는 정상 알파 품질을 유지한다", async () => {
  const transparent = await sharp({
    create: { width: 240, height: 240, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: Buffer.from('<svg width="120" height="120"><circle cx="60" cy="60" r="54" fill="#f2831b"/></svg>'), left: 60, top: 60 }])
    .png()
    .toBuffer();
  const quality = await inspectCutoutQuality(transparent, {
    representationType: "already-transparent",
    extractionScope: "visible-all",
  });
  assert.equal(quality.usable, true);
  assert.ok(quality.transparencyRatio > 0.5);
});
