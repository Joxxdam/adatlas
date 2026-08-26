import assert from "node:assert/strict";
import test from "node:test";

import {
  VIDEO_PLANNING_BLUEPRINTS,
  blueprintPrompt,
  getVideoPlanningBlueprint,
  selectVideoPlanningBlueprints,
} from "../app/lib/video-collaboration/videoPlanningBlueprints.ts";

const archetypes = ["parody", "real-review", "usp-focus", "secret-benefit"];

function analysis(overrides = {}) {
  return {
    productName: "민트 티트리 샤워젤 250ml",
    brandName: "Original Source",
    category: "생활·뷰티",
    productUrl: "https://example.com/product",
    price: "12,000원",
    originalPrice: "",
    discountInfo: "",
    coreUsps: ["민트와 티트리의 상쾌한 사용감"],
    keyFeatures: ["샤워 후 산뜻한 마무리"],
    targetCustomers: [],
    customerProblems: [],
    trustSignals: [],
    cautionPhrases: [],
    imageUrls: [],
    rawDescription: "",
    source: "existing-product-extractor",
    analyzedAt: "2026-08-24T00:00:00.000Z",
    ...overrides,
  };
}

test("11개 영상 분석은 재사용 가능한 블루프린트로 모두 등록된다", () => {
  assert.equal(VIDEO_PLANNING_BLUEPRINTS.length, 11);
  for (const blueprint of VIDEO_PLANNING_BLUEPRINTS) {
    assert.equal(blueprint.beats.length, 5);
    assert.ok(blueprint.duration > 0);
    assert.ok(blueprint.sceneCount > 0);
  }
});

test("뷰티 상품은 상품군 적합성을 유지하면서 후킹별 블루프린트를 다양화한다", () => {
  const selected = selectVideoPlanningBlueprints({ analysis: analysis(), archetypes });
  const ids = archetypes.map((archetype) => selected[archetype]?.primaryId);
  assert.ok(new Set(ids).size >= 3);
  for (const archetype of archetypes) {
    const primary = getVideoPlanningBlueprint(selected[archetype]?.primaryId);
    assert.ok(primary);
    assert.ok(primary.archetypes.includes(archetype));
  }
  assert.ok(
    archetypes.every(
      (archetype) =>
        getVideoPlanningBlueprint(selected[archetype]?.primaryId)?.sourceCategory === "beauty"
    )
  );
});

test("육류 상품은 육류·식품 전개를 우선하되 과일·농산물의 구조도 안전하게 전용할 수 있다", () => {
  const selected = selectVideoPlanningBlueprints({
    analysis: analysis({
      productName: "국내산 닭갈비 1kg",
      category: "식품",
      coreUsps: ["넓적다리살"],
    }),
    archetypes,
  });
  const categories = archetypes.map(
    (archetype) => getVideoPlanningBlueprint(selected[archetype]?.primaryId)?.sourceCategory
  );
  assert.ok(
    categories.every(
      (category) => category === "meat" || category === "food" || category === "produce"
    )
  );
  assert.ok(categories.includes("meat"));
});

test("블라인드 테스트는 가격 흥정 레퍼런스를 주 블루프린트로 선택하지 않는다", () => {
  const selected = selectVideoPlanningBlueprints({
    analysis: analysis({ productName: "국내산 선별 등심 1kg", category: "식품·육류", coreUsps: ["마블링과 식감을 비교할 수 있는 등심"] }),
    archetypes: ["parody"],
    parodyGenre: "blind-test",
  });
  const primary = getVideoPlanningBlueprint(selected.parody?.primaryId);
  assert.ok(primary);
  assert.equal(primary.sourceCategory, "meat");
  assert.doesNotMatch(primary.format, /협상|흥정/);
  assert.match(selected.parody.reason, /직접 일치하는 원본이 없어 가격 흥정 문법은 사용하지 않습니다/);
});

test("프롬프트는 주 레퍼런스와 보조 레퍼런스의 역할 및 복제 금지를 명시한다", () => {
  const selected = selectVideoPlanningBlueprints({ analysis: analysis(), archetypes: ["parody"] });
  const prompt = blueprintPrompt(selected.parody);
  assert.match(prompt, /주 레퍼런스/);
  assert.match(prompt, /보조 레퍼런스/);
  assert.match(prompt, /원문 자막·상품 사실·인물은 복제하지 않는다/);
});
