import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

import { resolveCategoryCreativeProfile } from "../app/lib/creative-generation/categoryCreativeRouter.ts";
import { buildNativeFinalCreativePrompt, buildNativeGroupValidationPrompt } from "../app/lib/creative-generation/nativeCreativePrompt.ts";
import { optimizeNativeFinalImage, selectNativeReferenceSources } from "../app/lib/creative-generation/nativeCreativeStorage.server.ts";
import { passesNativeGroupValidation } from "../app/lib/creative-generation/nativeCreativeValidation.ts";
import { buildExplorationCreativePlan, createGenerationJob, planAiScenes } from "../app/lib/creative-generation/planner.ts";
import { buildProductTruth } from "../app/lib/creative-generation/productTruth.ts";
import { buildProductHookExploration } from "../app/lib/creative-generation/hookHypothesisEngine.ts";

const fixtures = JSON.parse(await readFile(new URL("./fixtures/creative-products.json", import.meta.url), "utf8"));
const fixture = (id) => fixtures.find((item) => item.id === id);

function truthFor(id) {
  const product = fixture(id).product;
  return buildProductTruth({
    product,
    productImagePaths: product.productImagePaths || [product.productImagePath],
    source: "landing-page",
  });
}

function nativeJobFor(id) {
  const truth = truthFor(id);
  const creativePlan = buildExplorationCreativePlan(truth);
  const scenes = planAiScenes(creativePlan, true);
  const job = createGenerationJob({ truth, creativePlan, scenes, planningMs: 1 });
  return { truth, creativePlan, job };
}

test("1. 육류 상품은 food_meat CreativeProfile을 선택한다", () => {
  const profile = resolveCategoryCreativeProfile(truthFor("kookdae-beef-set"));
  assert.equal(profile.category, "food_meat");
  assert.match(profile.reason, /카테고리|상품명|USP/);
});

test("2. 샤워젤은 personal_care CreativeProfile을 선택한다", () => {
  const profile = resolveCategoryCreativeProfile(truthFor("original-source-mint-shower-gel"));
  assert.equal(profile.category, "personal_care");
  assert.match(profile.recommendedScenes.join(" "), /물보라|얼음|거품|샤워/);
});

test("3. 식품과 퍼스널케어는 서로 다른 장면·상품 연출 문법을 사용한다", () => {
  const food = resolveCategoryCreativeProfile(truthFor("kookdae-beef-set"));
  const care = resolveCategoryCreativeProfile(truthFor("original-source-mint-shower-gel"));
  assert.notDeepEqual(food.preferredVisualArchetypes, care.preferredVisualArchetypes);
  assert.match(food.productPresentation.join(" "), /원육|마블링|팩 수량/);
  assert.match(care.productPresentation.join(" "), /패키지|라벨|제품색/);
});

test("3-1. 내부 광고 구성 후보가 부족해도 규칙 기반 후보로 채워 6장 제작 계획을 만든다", () => {
  const truth = truthFor("kookdae-beef-set");
  const exploration = buildProductHookExploration(truth);
  const plan = buildExplorationCreativePlan(truth, {
    exploration: { ...exploration, selected: exploration.selected.slice(0, 1) },
  });
  assert.equal(plan.hookPlans.length, 6);
  assert.deepEqual(
    plan.hookPlans.map((hook) => hook.hookCode),
    ["H01", "H02", "H03", "H04", "H05", "H06"]
  );
});

test("4. 상세페이지 근거가 없는 효능 수치는 생성 프롬프트에 노출하지 않는다", () => {
  const { job } = nativeJobFor("original-source-mint-shower-gel");
  job.productTruth = {
    ...job.productTruth,
    facts: [
      ...job.productTruth.facts,
      {
        id: "unsafe-claim",
        key: "unsafe-claim",
        label: "미확인 효능",
        value: "체취 감소 -72%",
        source: "manual",
        verification: "unverified",
        usableInCopy: true,
        evidenceType: "performance",
        numericTokens: ["-72%"],
      },
    ],
    unverifiedClaims: [...job.productTruth.unverifiedClaims, "체취 감소 -72%"],
  };
  const prompt = buildNativeFinalCreativePrompt(job, job.results[0], "/tmp/final.png");
  assert.doesNotMatch(prompt, /-72%/);
  assert.match(prompt, /확인되지 않은 효능·가격·구성·후기·수치/);
});

test("5. 후기 원문이 없으면 후기·댓글·평점을 생성하지 말라고 지시한다", () => {
  const { job } = nativeJobFor("original-source-mint-shower-gel");
  const prompt = buildNativeFinalCreativePrompt(job, job.results[0], "/tmp/final.png");
  assert.match(prompt, /실제 후기 근거 존재: 아니오/);
  assert.match(prompt, /후기 문장, 댓글, 닉네임, 별점, 댓글 수, 커뮤니티 캡처를 생성하지 말 것/);
  assert.ok(job.creativePlan.selectedHypotheses.every((item) => item.creativeBrief.visualArchetype !== "social-proof-ugc"));
});

test("6. 이미지 생성 참조는 원본 정면·라벨·구성·사용·질감 순으로 최대 5장이고 누끼를 제외한다", () => {
  const { job } = nativeJobFor("original-source-mint-shower-gel");
  const referenceImages = [
    ["front", "/source/front.jpg", "front-package", 90],
    ["label", "/source/label.jpg", "primary-product", 88],
    ["set", "/source/set.jpg", "option", 80],
    ["hand", "/source/hand.jpg", "usage", 80],
    ["texture", "/source/texture.jpg", "texture", 75],
    ["extra", "/source/extra.jpg", "ingredient", 70],
  ].map(([id, url, role, importance]) => ({ id, url, role, importance, usableForGeneration: true, description: role }));
  job.productReferenceProfile = { referenceImages };
  job.productTruth.imageAssets = [{ id: "cutout", path: "/processed-products/cutout.png", role: "product-cutout", source: "product-page", verified: true, reason: "legacy" }];
  job.productTruth.referenceImages = [];
  const selected = selectNativeReferenceSources(job);
  assert.equal(selected.length, 5);
  assert.ok(selected.some((item) => item.path === "/source/front.jpg"));
  assert.ok(selected.some((item) => item.path === "/source/label.jpg"));
  assert.ok(selected.every((item) => item.role !== "product-cutout" && !item.path.includes("processed-products")));
});

test("7. 사용 상황을 설명하는 후킹에는 장식이 아닌 humanRole이 생성된다", () => {
  const { creativePlan } = nativeJobFor("original-source-mint-shower-gel");
  const human = creativePlan.selectedHypotheses.find((item) => /human|action|problem|usage/.test(item.creativeBrief.visualArchetype));
  assert.ok(human);
  assert.doesNotMatch(human.creativeBrief.humanRole, /사람 없이/);
});

test("8. 최종 6장은 최소 4개의 visualArchetype을 사용한다", () => {
  for (const id of ["kookdae-beef-set", "original-source-mint-shower-gel"]) {
    const { creativePlan } = nativeJobFor(id);
    assert.equal(creativePlan.selectedHypotheses.length, 6);
    assert.ok(new Set(creativePlan.selectedHypotheses.map((item) => item.creativeBrief.visualArchetype)).size >= 4);
  }
});

test("9. 동일 배경·구도에 문구만 바뀐 그룹 검수는 통과하지 않는다", () => {
  const sameBackground = {
    sceneDiversity: 20,
    productPlacementDiversity: 25,
    cameraDiversity: 20,
    colorMoodDiversity: 30,
    messageSeparation: 80,
    hookSceneAlignment: 70,
    typographyDiversity: 20,
    visualArchetypeDiversity: 20,
    categoryFit: 80,
    duplicatePairs: [{ leftHookCode: "H01", rightHookCode: "H02", reason: "동일 배경과 배치" }],
    recommendation: "revise",
  };
  assert.equal(passesNativeGroupValidation(sameBackground), false);
  assert.match(buildNativeGroupValidationPrompt({ results: nativeJobFor("kookdae-beef-set").job.results }), /문구만 다르고 배경·제품 배치가 사실상 같으면 실패/);
});

test("10. 최종 파일은 1200×1200 JPEG이며 800KB 미만이다", async () => {
  const directory = path.join(os.tmpdir(), `adatlas-category-output-${Date.now()}`);
  await mkdir(directory, { recursive: true });
  const input = path.join(directory, "input.png");
  const output = path.join(directory, "AT-TEST-H01.jpg");
  await writeFile(
    input,
    await sharp({ create: { width: 1600, height: 1000, channels: 3, background: "#13a879" } })
      .png()
      .toBuffer()
  );
  const exported = await optimizeNativeFinalImage(input, output);
  const metadata = await sharp(await readFile(output)).metadata();
  assert.deepEqual([metadata.width, metadata.height, metadata.format], [1200, 1200, "jpeg"]);
  assert.ok(exported.bytes < 800 * 1024);
});

test("11. 골든 레퍼런스의 추상 스타일 특성은 다음 생성 프롬프트에 반영된다", () => {
  const { job } = nativeJobFor("original-source-mint-shower-gel");
  const memory = {
    advertiserId: "originalsource-co-kr",
    approvedDirections: [],
    rejectedDirections: [],
    feedback: [],
    updatedAt: new Date(0).toISOString(),
    goldenReferences: [
      {
        id: "g1",
        advertiserId: "originalsource-co-kr",
        category: "personal_care",
        productId: "old",
        imagePath: "/.data/golden.jpg",
        mainHook: "이전 광고 문구 그대로 복사",
        subCopy: "이전 서브 카피",
        visualArchetype: "sensory-immersion",
        approvedAt: new Date(0).toISOString(),
        approvalReason: "제품 비중이 좋음",
        reusableStyleTraits: ["강한 청록 대비", "제품이 화면의 40% 이상"],
      },
    ],
  };
  const prompt = buildNativeFinalCreativePrompt(job, job.results[0], "/tmp/final.png", undefined, memory);
  assert.match(prompt, /강한 청록 대비/);
  assert.match(prompt, /제품이 화면의 40% 이상/);
});

test("12. 골든 레퍼런스의 기존 메인·서브 문구는 새 프롬프트에 복사하지 않는다", () => {
  const { job } = nativeJobFor("original-source-mint-shower-gel");
  const memory = {
    advertiserId: "originalsource-co-kr",
    approvedDirections: [],
    rejectedDirections: [],
    feedback: [],
    updatedAt: new Date(0).toISOString(),
    goldenReferences: [
      {
        id: "g1",
        advertiserId: "originalsource-co-kr",
        category: "personal_care",
        productId: "old",
        imagePath: "/.data/golden.jpg",
        mainHook: "절대 재사용하면 안 되는 문구",
        subCopy: "과거 상품 전용 서브",
        visualArchetype: "product-hero",
        approvedAt: new Date(0).toISOString(),
        approvalReason: "상업적 위계",
        reusableStyleTraits: ["제품 중심"],
      },
    ],
  };
  const prompt = buildNativeFinalCreativePrompt(job, job.results[0], "/tmp/final.png", undefined, memory);
  assert.doesNotMatch(prompt, /절대 재사용하면 안 되는 문구|과거 상품 전용 서브/);
  assert.match(prompt, /메인\/서브 문구를 현재 광고에 쓰지 않는다/);
});

test("13. 비공개 프롬프트·골든 레퍼런스·내부 작업은 public 폴더에 저장하지 않는다", async () => {
  const [storage, registry, publicJob] = await Promise.all([readFile(new URL("../app/lib/creative-generation/nativeCreativeStorage.server.ts", import.meta.url), "utf8"), readFile(new URL("../app/lib/creative-generation/codexRegistry.server.ts", import.meta.url), "utf8"), readFile(new URL("../app/lib/creative-generation/publicJob.server.ts", import.meta.url), "utf8")]);
  assert.match(storage, /"\.data",\s*"generated/);
  assert.match(registry, /"\.data", "codex"/);
  assert.doesNotMatch(`${storage}\n${registry}`, /public[^\n]{0,80}golden-references/);
  assert.match(publicJob, /candidateHypotheses: undefined/);
  assert.match(publicJob, /nativeCreative: publicNativeCreative/);
  assert.match(publicJob, /referenceRawCopy: ""/);
  assert.match(publicJob, /nativeCopy: undefined/);
  assert.match(publicJob, /provenance: undefined/);
});
