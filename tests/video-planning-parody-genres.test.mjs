import assert from "node:assert/strict";
import test from "node:test";

import {
  VIDEO_PARODY_GENRE_OPTIONS,
  inferVideoParodyGenre,
  matchesVideoParodyGenre,
  selectVideoParodyGenre,
  videoParodyGenrePrompt,
} from "../app/lib/video-collaboration/videoParodyGenres.ts";

function analysis(overrides = {}) {
  return {
    productName: "국내산 선별 등심 1kg",
    brandName: "테스트푸드",
    category: "식품/정육",
    productUrl: "https://example.com/product",
    price: "49,800원",
    originalPrice: "79,800원",
    discountInfo: "할인",
    coreUsps: ["선별한 원육"],
    keyFeatures: ["식감과 마블링"],
    targetCustomers: [],
    customerProblems: [],
    trustSignals: [],
    cautionPhrases: [],
    imageUrls: [],
    rawDescription: "",
    source: "existing-product-extractor",
    analyzedAt: "2026-08-25T00:00:00.000Z",
    ...overrides,
  };
}

test("사건·상황극은 시대·사회 세계관극을 포함한 11개 세부 장르를 유지한다", () => {
  assert.equal(VIDEO_PARODY_GENRE_OPTIONS.length, 11);
  assert.equal(new Set(VIDEO_PARODY_GENRE_OPTIONS.map((option) => option.id)).size, 11);
  assert.ok(VIDEO_PARODY_GENRE_OPTIONS.some((option) => option.id === "historical-world-parody"));
  assert.ok(VIDEO_PARODY_GENRE_OPTIONS.some((option) => option.id === "courtroom"));
  assert.ok(VIDEO_PARODY_GENRE_OPTIONS.some((option) => option.id === "blind-test"));
});

test("시대·사회 세계관극은 창작 세계와 검증 상품 사실을 분리하도록 지시한다", () => {
  const prompt = videoParodyGenrePrompt("historical-world-parody", []);
  assert.match(prompt, /선택 장르: 시대·사회 세계관극/);
  assert.match(prompt, /창작할 수 있지만/);
  assert.match(prompt, /ProductTruth/);
  assert.equal(
    matchesVideoParodyGenre(
      "1990년대 월급날 식탁의 아버지가 고기 반찬을 기다리는 시대 상황극",
      "historical-world-parody",
    ),
    true,
  );
});

test("과거 법정 기획은 명시적 필드가 없어도 법정 장르로 인식한다", () => {
  assert.equal(
    inferVideoParodyGenre("판사가 상품을 증거물로 받고 마지막에 판결을 내리는 재판 상황극"),
    "courtroom",
  );
});

test("최근 사용 장르는 다음 자동 선택에서 강하게 제외한다", () => {
  const first = selectVideoParodyGenre({ analysis: analysis(), recentGenres: [] });
  const next = selectVideoParodyGenre({
    analysis: analysis(),
    recentGenres: [first.id, "courtroom", "price-negotiation"],
  });
  assert.notEqual(next.id, first.id);
  assert.notEqual(next.id, "courtroom");
});

test("선택 장르 프롬프트는 최근 장르와 법정 문법을 명시적으로 금지한다", () => {
  const prompt = videoParodyGenrePrompt("blind-test", ["courtroom", "news-report"]);
  assert.match(prompt, /선택 장르: 블라인드 테스트/);
  assert.match(prompt, /최근 사용으로 금지된 장르: 법정·청문회 · 뉴스 속보·현장 취재/);
  assert.match(prompt, /법정·재판·판사·판결/);
});

test("생성 결과가 선택된 장르와 다른 경우 서버가 판별할 수 있다", () => {
  assert.equal(
    matchesVideoParodyGenre("눈을 가리고 두 제품을 비교 시식한 뒤 정체를 공개한다", "blind-test"),
    true,
  );
  assert.equal(
    matchesVideoParodyGenre("판사가 증거를 확인하고 판결한다", "blind-test"),
    false,
  );
  assert.equal(
    matchesVideoParodyGenre(
      "두 등심이 대결하고 심사위원이 마블링 심사 기준으로 우승 제품을 고른다",
      "competition-judging",
    ),
    true,
  );
});
