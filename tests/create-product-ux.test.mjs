import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildProductCreationHref,
  normalizeProductCreationUrl,
} from "../app/lib/product-creation/handoffUrl.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("create-product keeps every existing candidate handoff", async () => {
  const page = await read("app/create-product/page.tsx");
  for (const handoff of [
    "buildProductCreationHandoff",
    "buildOpportunityProductCreationHandoff",
    "buildBigQueryProductCreationHandoff",
    "buildSiteCandidateProductCreationHandoff",
  ]) {
    assert.match(page, new RegExp(handoff));
  }
});

test("analysis handoff keeps the selected product URL independently of cached details", async () => {
  const productUrl = "https://shop.example.com/products/mint?option=250ml";
  const href = buildProductCreationHref({ siteCandidateId: "selection-123" }, productUrl);
  const parsed = new URL(href, "https://adatlas.local");
  assert.equal(parsed.pathname, "/create-product");
  assert.equal(parsed.searchParams.get("siteCandidateId"), "selection-123");
  assert.equal(parsed.searchParams.get("productUrl"), productUrl);
  assert.equal(normalizeProductCreationUrl("javascript:alert(1)"), "");

  const page = await read("app/create-product/page.tsx");
  const dashboard = await read("app/components/MvpDashboard.tsx");
  const selectionRoute = await read("app/api/ad-candidates/site/select/route.ts");
  const bigQueryWorkspace = await read(
    "app/components/bigquery/BigQueryCandidateWorkspace.tsx"
  );
  assert.match(page, /initialProductUrl/);
  assert.match(dashboard, /선택한 상품 URL을 자동으로 입력했습니다/);
  assert.match(selectionRoute, /selection\.candidate\.product\.productUrl/);
  assert.match(
    bigQueryWorkspace,
    /buildProductCreationHref\([\s\S]*dataCandidateId: candidate\.id[\s\S]*candidate\.productUrl/
  );
});

test("main navigation exposes only four beginner tasks and keeps auto production under management tools", async () => {
  const navigation = await read("app/components/AppFeatureNavigation.tsx");
  for (const label of ["광고 후보 찾기", "상품 선택", "AI 광고 만들기", "제작 결과 확인"]) {
    assert.match(navigation, new RegExp(label));
  }
  const mainBlock = navigation.slice(navigation.indexOf("const FEATURES"), navigation.indexOf("const AUXILIARY_FEATURES"));
  assert.doesNotMatch(mainBlock, /자동 콘텐츠 제작|auto-production/);
  assert.match(navigation, /\/admin\/auto-production/);
  assert.match(navigation, /자동 콘텐츠 제작/);
  assert.match(navigation, /광고주 기억/);
  assert.match(navigation, /골든 레퍼런스/);
  assert.match(navigation, /이미지 분석 레퍼런스/);
  assert.match(navigation, /영상 제작 협업/);
});

test("공통 화면은 데이위즈 로고와 AI 네이티브 4단계 제작 흐름을 안내한다", async () => {
  const navigation = await read("app/components/AppFeatureNavigation.tsx");
  const dashboard = await read("app/components/MvpDashboard.tsx");
  const creationSteps = await read("app/components/features/creative-generation/CreativeCreationSteps.tsx");
  const brand = await read("app/components/DaywizBrand.tsx");
  const logo = await read("public/daywiz-logo.svg");
  assert.match(navigation, /DaywizBrand/);
  for (const label of ["상품 확인", "광고 목표 선택", "후킹 6개 선정", "AI 광고 6장 완성"]) assert.match(creationSteps, new RegExp(label));
  assert.match(dashboard, /CreativeCreationSteps/);
  assert.match(dashboard, /legacyManualProductionToolsAvailable = false/);
  assert.match(brand, /\/daywiz-logo\.svg/);
  assert.match(logo, /DAYWIZ/);
  assert.doesNotMatch(navigation, />AdAtlas</);
});

test("create-product defaults to URL analysis and preserves admin entry points", async () => {
  const dashboard = await read("app/components/MvpDashboard.tsx");
  const productSummary = await read(
    "app/components/features/product-brief/ProductAnalysisSummary.tsx"
  );
  assert.match(dashboard, /상품 분석하기/);
  assert.match(productSummary, /이 상품으로 광고 만들기/);
  assert.match(dashboard, /카테고리 관리/);
  assert.match(dashboard, /이미지 수집/);
  assert.match(dashboard, /이미지 분석/);
  assert.match(dashboard, /생성 설정·상태/);
});

test("hook creatives are server-driven and deliver each completed card immediately", async () => {
  const generator = await read(
    "app/components/features/creative-generation/SixCreativeGenerator.tsx"
  );
  const assetActions = await read(
    "app/components/features/creative-assets/CreativeAssetActions.tsx"
  );
  assert.match(generator, /백그라운드에서 계속 제작됩니다/);
  assert.match(generator, /creative-generation\/jobs\/active/);
  assert.doesNotMatch(generator, /function runPending/);
  assert.doesNotMatch(generator, /workerCount/);
  assert.match(generator, /six-creative-grid/);
  assert.doesNotMatch(generator, /latest-creative-delivery/);
  assert.match(generator, /landingUrl=\{job\.productTruth\.product\.landingUrl\}/);
  assert.doesNotMatch(generator, /setEdits|initialEdit|문구 수정·제작 정보/);
  assert.match(generator, /AI에게 수정 요청/);
  for (const label of ["후킹", "소재코드", "권장 광고명", "UTM", "최종 랜딩 URL", "이미지 다운로드"]) {
    assert.match(assetActions, new RegExp(label));
  }
});

test("creative reasoning and vision defaults use GPT-5.6 Sol while image generation stays dedicated", async () => {
  const hookMessages = await read("app/lib/creative-generation/hookMessages.server.ts");
  const identity = await read("app/lib/creative-generation/productIdentityEvaluator.ts");
  const envExample = await read(".env.example");
  assert.match(hookMessages, /gpt-5\.6-sol/);
  assert.match(identity, /gpt-5\.6-sol/);
  assert.match(envExample, /OPENAI_TEXT_MODEL=gpt-5\.6-sol/);
  assert.match(envExample, /CREATIVE_COPY_MODEL=gpt-5\.6-sol/);
  assert.match(envExample, /OPENAI_VISION_MODEL=gpt-5\.6-sol/);
  assert.match(envExample, /ADATLAS_IMAGE_MODEL=gpt-image-1\.5/);
});

test("workspace exposes an accessible mobile drawer and single-column mobile results", async () => {
  const dashboard = await read("app/components/MvpDashboard.tsx");
  const css = await read("app/globals.css");
  assert.match(dashboard, /aria-controls="adatlas-workspace-navigation"/);
  assert.match(dashboard, /aria-expanded=\{mobileNavOpen\}/);
  assert.match(css, /@media \(max-width: 1024px\)/);
  assert.match(css, /\.mvp-shell-simplified \.mvp-sidebar\.open/);
  assert.match(css, /\.six-creative-grid \{ grid-template-columns: 1fr; \}/);
});
