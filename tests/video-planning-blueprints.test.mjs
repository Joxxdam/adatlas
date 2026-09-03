import assert from "node:assert/strict";
import test from "node:test";

import {
  VIDEO_PLANNING_BLUEPRINTS,
  blueprintPrompt,
  getVideoPlanningBlueprint,
  recommendAutomaticVideoDuration,
  selectVideoPlanningBlueprints,
} from "../app/lib/video-collaboration/videoPlanningBlueprints.ts";
import {
  CURATED_VIDEO_REFERENCES,
  getCuratedVideoReference,
} from "../app/lib/video-collaboration/curatedVideoReferences.ts";
import { buildCurrentProductSelfIntroductionHook } from "../app/lib/video-collaboration/videoPlanningHookFallback.ts";

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

test("22개 영상 분석은 617개 상세 장면 정본과 빠짐없이 연결된다", () => {
  assert.equal(VIDEO_PLANNING_BLUEPRINTS.length, 22);
  assert.equal(CURATED_VIDEO_REFERENCES.length, 22);
  assert.equal(
    CURATED_VIDEO_REFERENCES.reduce((total, reference) => total + reference.scenes.length, 0),
    617
  );
  for (const blueprint of VIDEO_PLANNING_BLUEPRINTS) {
    assert.equal(blueprint.beats.length, 5);
    assert.ok(blueprint.duration > 0);
    assert.ok(blueprint.sceneCount > 0);
    const source = getCuratedVideoReference(blueprint.sourceReferenceId);
    assert.ok(source, `${blueprint.id} 상세 정본 누락`);
    assert.equal(source.blueprintId, blueprint.id);
    assert.equal(source.sceneCount, blueprint.sceneCount);
    assert.equal(source.scenes.length, blueprint.sceneCount);
    for (const scene of source.scenes) {
      assert.ok(scene.timing);
      assert.ok(scene.captureTime);
      assert.ok(scene.caption || scene.scene);
      assert.ok(scene.role);
      assert.ok(scene.analysis);
      assert.ok(scene.capturePath);
    }
  }
});

test("오리지널소스영상1과 나중에 전달된 오리지널소스1은 서로 다른 상세 레퍼런스로 보존한다", () => {
  const clay = getCuratedVideoReference("original-source-video-01");
  const history = getCuratedVideoReference("original-source-history-problem-truth-bridge");
  assert.equal(clay?.sceneCount, 22);
  assert.equal(history?.sceneCount, 20);
  assert.match(clay?.structureAnalysis || "", /샤워→드라이→또 땀/);
  assert.match(history?.structureAnalysis || "", /중세 유럽의 악취 문제/);
});

test("같은 A/B family를 주·보조 블루프린트로 동시에 선택하지 않는다", () => {
  const selected = selectVideoPlanningBlueprints({ analysis: analysis(), archetypes: ["parody"] });
  const primary = getVideoPlanningBlueprint(selected.parody?.primaryId);
  const secondary = getVideoPlanningBlueprint(selected.parody?.secondaryId);
  assert.ok(primary);
  assert.ok(secondary);
  assert.notEqual(primary.familyId || primary.id, secondary.familyId || secondary.id);
});

test("자동 길이는 상품 근거 밀도와 업로드 영상 유무로 서버에서 결정한다", () => {
  assert.equal(recommendAutomaticVideoDuration({ analysis: analysis() }), 30);
  assert.equal(recommendAutomaticVideoDuration({ analysis: analysis(), hasVideoReference: true }), 45);
  assert.equal(
    recommendAutomaticVideoDuration({
      analysis: analysis({
        verifiedFacts: Array.from({ length: 12 }, (_, index) => ({
          id: `fact-${index}`,
          label: `근거 ${index}`,
          value: `값 ${index}`,
        })),
      }),
    }),
    45
  );
});

test("후킹 후보에는 ‘나 ~인데’ 상품 자기소개형이 항상 포함된다", () => {
  const hook = buildCurrentProductSelfIntroductionHook(
    analysis({
      productName: "민트 티트리 샤워젤 250ml",
      coreUsps: ["진짜 민트잎 7,927장"],
      verifiedNumbers: ["7,927장"],
    })
  );
  assert.equal(hook.hookType, "product-self-introduction");
  assert.match(hook.hook, /^나\s/u);
  assert.match(hook.hook, /인데!/u);
  assert.match(hook.hook, /7,927장/u);
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

test("시대·사회 세계관극은 오리지널소스 실제 20개 자막·장면 레퍼런스를 직접 전달한다", () => {
  const selected = selectVideoPlanningBlueprints({
    analysis: analysis(),
    archetypes: ["parody"],
    parodyGenre: "historical-world-parody",
  });
  const primary = getVideoPlanningBlueprint(selected.parody?.primaryId);
  const prompt = blueprintPrompt(selected.parody);
  assert.equal(primary?.id, "beauty-historical-world-truth-bridge");
  assert.match(selected.parody?.reason || "", /직접 참고할 수 있습니다/);
  assert.match(prompt, /sourceTranscriptAndScenes/);
  assert.match(prompt, /악취로 가득한 중세 유럽/);
  assert.match(prompt, /시칠리아 레몬 10개 분량의 리모넨과/);
  assert.match(prompt, /매일 아침 당신의 샤워실에서 경험해보세요/);
  assert.match(prompt, /원문보다 일반적인 표현으로 낮추지 않는다/);
});

test("고기영상6의 41개 생활 대화 자막을 요약하지 않고 직접 전달한다", () => {
  const prompt = blueprintPrompt({ primaryId: "meat-couple-wholesale-review", reason: "테스트", transferableRules: [] });
  assert.match(prompt, /meat-video-06-natural-dialogue|고기영상6/);
  assert.match(prompt, /우리 남편 이거 먹고/);
  assert.match(prompt, /온 집안에 퍼지는/);
  assert.match(prompt, /남편도 엄지척 올리는/);
  assert.match(prompt, /5단계나 범용 공식으로 축약하지 않는다/);
});

test("육류 생활 후기안에 배정되는 레퍼런스는 전체 장면 상세본을 가진다", () => {
  const selected = selectVideoPlanningBlueprints({
    analysis: analysis({ productName: "한우 안심 스테이크", category: "식품·육류" }),
    archetypes: ["real-review"],
  });
  const primary = getVideoPlanningBlueprint(selected["real-review"]?.primaryId);
  const reference = getCuratedVideoReference(primary?.sourceReferenceId);
  assert.equal(primary?.sourceCategory, "meat");
  assert.equal(reference?.scenes.length, primary?.sceneCount);
});

test("깔라만시4의 38개 비밀 발견 자막과 위험 주장 경계를 함께 전달한다", () => {
  const prompt = blueprintPrompt({ primaryId: "produce-friend-secret-process", reason: "테스트", transferableRules: [] });
  assert.match(prompt, /calamansi-video-04-secret-dialogue|깔라만시4/);
  assert.match(prompt, /물었더니 갑자기 목소리를 낮추면서/);
  assert.match(prompt, /물이나 탄산수에 섞으면/);
  assert.match(prompt, /열을 가해 영양이 파괴되는데/);
  assert.match(prompt, /검증되지 않은 주장은 sourceRiskNotes와 ProductTruth 경계에 따라 제거한다/);
});

test("과일 생활 후기안에 배정되는 레퍼런스도 전체 장면 상세본을 가진다", () => {
  const selected = selectVideoPlanningBlueprints({
    analysis: analysis({ productName: "깔라만시 원액", category: "과일·농산" }),
    archetypes: ["real-review"],
  });
  const primary = getVideoPlanningBlueprint(selected["real-review"]?.primaryId);
  const reference = getCuratedVideoReference(primary?.sourceReferenceId);
  assert.equal(primary?.sourceCategory, "produce");
  assert.equal(reference?.scenes.length, primary?.sceneCount);
});

test("참고영상2의 할인 실랑이를 32장면의 대사·반응·분석 순서 그대로 전달한다", () => {
  const prompt = blueprintPrompt({
    primaryId: "food-bargaining-parody",
    reason: "테스트",
    transferableRules: [],
  });
  assert.match(prompt, /아니 등심 100g에/);
  assert.match(prompt, /할인 더 안해주고 뭐해요\?!/);
  assert.match(prompt, /하, 또 시작이네/);
  assert.match(prompt, /광고주가 아닌 소비자가 가격을 깎는 구도로 거부감을 낮춘다/);
  assert.match(prompt, /상황극 갈등을 해소한다/);
  assert.match(prompt, /지금 당장 사세요!!!/);
});

test("프롬프트는 주 레퍼런스와 보조 레퍼런스의 역할 및 복제 금지를 명시한다", () => {
  const selected = selectVideoPlanningBlueprints({ analysis: analysis(), archetypes: ["parody"] });
  const prompt = blueprintPrompt(selected.parody);
  assert.match(prompt, /주 레퍼런스/);
  assert.match(prompt, /보조 레퍼런스/);
  assert.match(prompt, /원문 자막·상품 사실·인물은 복제하지 않/);
});
