import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildProductCreationHref, normalizeProductCreationUrl } from "../app/lib/product-creation/handoffUrl.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("create-product keeps every existing candidate handoff", async () => {
  const page = await read("app/create-product/page.tsx");
  for (const handoff of ["buildProductCreationHandoff", "buildOpportunityProductCreationHandoff", "buildBigQueryProductCreationHandoff", "buildSiteCandidateProductCreationHandoff"]) {
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
  const bigQueryWorkspace = await read("app/components/bigquery/BigQueryCandidateWorkspace.tsx");
  assert.match(page, /initialProductUrl/);
  assert.match(dashboard, /선택한 상품 URL을 자동으로 입력했습니다/);
  assert.match(selectionRoute, /selection\.candidate\.product\.productUrl/);
  assert.match(bigQueryWorkspace, /buildProductCreationHref\([\s\S]*dataCandidateId: candidate\.id[\s\S]*candidate\.productUrl/);
});

test("main navigation separates image creation, video planning, archive, and performance operations", async () => {
  const navigation = await read("app/components/AppFeatureNavigation.tsx");
  for (const label of ["광고 후보 찾기", "광고 제작", "영상 기획", "성과 확인"]) {
    assert.match(navigation, new RegExp(label));
  }
  const imageBlock = navigation.slice(navigation.indexOf("IMAGE_CONTENT_FEATURES"), navigation.indexOf("VIDEO_PLANNING_FEATURE"));
  assert.equal((imageBlock.match(/index: "0[12]"/g) || []).length, 2);
  assert.doesNotMatch(imageBlock, /영상 기획|video-planning|자동 콘텐츠 제작|auto-production/);
  assert.match(navigation, /IMAGE CONTENT/);
  assert.match(navigation, />이미지 콘텐츠</);
  assert.match(navigation, /VIDEO CONTENT/);
  assert.match(navigation, />영상 콘텐츠</);
  assert.match(navigation, /VIDEO_PLANNING_FEATURE/);
  assert.match(navigation, /ARCHIVE_FEATURE/);
  assert.match(navigation, /PERFORMANCE_FEATURE/);
  assert.match(navigation, /\/admin\/auto-production/);
  assert.match(navigation, /\/admin\/advertisers/);
  assert.match(navigation, /\/admin\/references/);
  assert.doesNotMatch(navigation, /상품 선택[\s\S]*IMAGE_CONTENT_FEATURES|AI 광고 만들기[\s\S]*IMAGE_CONTENT_FEATURES/);
});

test("성과 확인과 이미지 제작 관리 도구는 광고 제작 아래의 간결한 드롭다운으로 표시된다", async () => {
  const navigation = await read("app/components/AppFeatureNavigation.tsx");
  const home = await read("app/components/CreationModeSelector.tsx");
  const imageSection = navigation.slice(navigation.indexOf('<section className="feature-navigation-group feature-navigation-image"'), navigation.indexOf('<section className="feature-navigation-group feature-navigation-video"'));
  assert.match(imageSection, /IMAGE_CONTENT_FEATURES\.map[\s\S]*feature-navigation-performance-menu[\s\S]*성과 확인[\s\S]*이미지 제작 관리 도구/);
  assert.match(imageSection, /href=\{PERFORMANCE_FEATURE\.href\}[\s\S]*광고 성과 확인/);
  assert.doesNotMatch(imageSection, /⚙/);
  assert.equal((navigation.match(/feature-navigation-performance-link/g) || []).length, 0);
  assert.match(imageSection, /AuxiliaryFeatureNavigation/);
  assert.doesNotMatch(navigation.slice(navigation.indexOf("<AppFeatureNavigation activeFeature")), /mvp-management-tools/);
  assert.doesNotMatch(home, /AFTER CREATION|만든 광고를 확인하고 성과까지 이어보세요|ASSET LIBRARY|성과 확인하기|home-operation-section|mode-selector-note/);
  assert.match(home, /href="\/admin\/references\?tab=library"/);
  assert.match(home, /광고 제작 레퍼런스 관리/);
  assert.doesNotMatch(home, /href="\/image-analysis-references"/);
});

test("auto production manages orchestration and shows stored creative results directly", async () => {
  const workspace = await read("app/components/auto-production/AutoProductionWorkspace.tsx");
  const runner = await read("app/lib/auto-production/productionRunner.server.ts");
  assert.doesNotMatch(workspace, /ProductAdCopyPanel|ResultActions|next\/image/);
  assert.match(workspace, /최근 자동 제작 결과/);
  assert.match(workspace, /result\.imageUrl/);
  assert.match(workspace, /result\.downloadUrl/);
  assert.match(workspace, /\/create-product\?view=results/);
  assert.match(runner, /createNativeGenerationJob|runCreativeGenerationJob/);
});

test("공통 화면은 데이위즈 로고와 설정 없는 ZIP 레퍼런스 단계별 제작 흐름을 안내한다", async () => {
  const navigation = await read("app/components/AppFeatureNavigation.tsx");
  const dashboard = await read("app/components/MvpDashboard.tsx");
  const creationSteps = await read("app/components/features/creative-generation/CreativeCreationSteps.tsx");
  const brand = await read("app/components/DaywizBrand.tsx");
  const logo = await readFile(new URL("../public/daywiz-logo.png", import.meta.url));
  assert.match(navigation, /DaywizBrand/);
  for (const label of ["상품 확인", "상품군 레퍼런스 6장 선택", "상품·문구 단계별 교체"]) assert.match(creationSteps, new RegExp(label));
  assert.doesNotMatch(creationSteps, /광고 목표 선택/);
  const briefForm = await read("app/components/features/product-brief/ProductBriefForm.tsx");
  assert.match(briefForm, /URL 상품에 맞는 검증 문구 6개 준비/);
  assert.match(briefForm, /같은 상품군 ZIP 6장 → 상품만 교체 → 문구만 교체/);
  assert.doesNotMatch(briefForm, /제작 설정 변경|productionSettings|objectiveOptions/);
  assert.match(dashboard, /CreativeCreationSteps/);
  assert.match(dashboard, /legacyManualProductionToolsAvailable = false/);
  assert.match(brand, /\/daywiz-logo\.png/);
  assert.ok(logo.length > 0);
  assert.doesNotMatch(navigation, />AdAtlas</);
});

test("create-product defaults to URL analysis and preserves admin entry points", async () => {
  const dashboard = await read("app/components/MvpDashboard.tsx");
  const productSummary = await read("app/components/features/product-brief/ProductAnalysisSummary.tsx");
  assert.match(dashboard, /상품 분석하기/);
  assert.match(productSummary, /이 상품으로 광고 만들기/);
  assert.match(productSummary, /선택 완료 · 아래에서 제작 상태 확인/);
  assert.match(dashboard, /loaded=\{currentProductLoaded\}/);
  assert.match(dashboard, /selectedForGeneration=\{generationPlanConfirmed\}/);
  assert.doesNotMatch(dashboard, /loaded=\{currentProductLoaded && !generationPlanConfirmed\}/);
  assert.match(dashboard, /onUseProduct=\{\(\) => \{[\s\S]*setGenerationPlanConfirmed\(true\)/);
  assert.doesNotMatch(dashboard, /<ProductBriefForm/);
  assert.match(dashboard, /카테고리 관리/);
  assert.match(dashboard, /이미지 수집/);
  assert.match(dashboard, /이미지 분석/);
  assert.match(dashboard, /AppSidebar/);
});

test("reference creatives are server-driven and deliver each completed card immediately", async () => {
  const generator = await read("app/components/features/creative-generation/SixCreativeGenerator.tsx");
  const assetActions = await read("app/components/features/creative-assets/CreativeAssetActions.tsx");
  assert.match(generator, /백그라운드에서 계속 제작/);
  assert.match(generator, /creative-generation\/jobs\/active/);
  assert.doesNotMatch(generator, /function runPending/);
  assert.doesNotMatch(generator, /workerCount/);
  assert.match(generator, /six-creative-grid/);
  assert.match(generator, /visibleGeneratedResults/);
  assert.match(generator, /이미지가 만들어지는 즉시 표시되고 다운로드할 수 있습니다/);
  assert.match(generator, /다운로드 가능/);
  assert.match(generator, /Boolean\(result\.imagePath && result\.nativeCreative\?\.finalPath\)/);
  assert.doesNotMatch(generator, /이미지는 생성됐으며 품질 확인이 필요합니다/);
  assert.doesNotMatch(generator, /latest-creative-delivery/);
  assert.match(generator, /landingUrl=\{job\.productTruth\.product\.landingUrl\}/);
  assert.match(generator, /copyEdits|수정 문구로 전체 광고 재생성|문구 수정·제작 정보/);
  assert.match(generator, /수정 반영하기/);
  for (const label of ["후킹", "소재코드", "권장 광고명", "UTM", "최종 랜딩 URL", "이미지 다운로드"]) {
    assert.match(assetActions, new RegExp(label));
  }
});

test("같은 URL도 다시 분석하면 새 제작을 시작하고 진행 중 작업만 복원한다", async () => {
  const [dashboard, generator, jobStorage, activeRoute, downloadRoute, assetRoute] = await Promise.all([read("app/components/MvpDashboard.tsx"), read("app/components/features/creative-generation/SixCreativeGenerator.tsx"), read("app/lib/creative-generation/activeCreativeJob.client.ts"), read("app/api/creative-generation/jobs/active/route.ts"), read("app/api/creative-generation/jobs/[jobId]/results/[resultId]/download/route.ts"), read("app/api/creative-generation/jobs/[jobId]/results/[resultId]/asset/route.ts")]);

  assert.match(dashboard, /analyzedProductUrl=\{lastLoadedProductUrl\}/);
  assert.match(dashboard, /setProductAnalysisRevision\(\(current\) => current \+ 1\)/);
  assert.match(generator, /props\.analysisRevision/);
  assert.match(generator, /hasGenerationWorkRemaining/);
  assert.match(generator, /shouldPersistGenerationJob/);
  assert.match(generator, /activeCreativeProductJobStorageKey\(currentProductUrl\)/);
  assert.match(jobStorage, /daywiz-active-creative-job-id/);
  assert.match(generator, /상품 분석이 완료됐습니다\. 이 상품으로 새 광고 6장을 제작합니다/);
  assert.match(generator, /다운로드가 완료됐습니다\. 같은 상품 URL을 다시 분석하면 새 광고 6장을 제작합니다/);
  assert.match(generator, /jobs\/active\$\{query\}/);
  assert.match(generator, /jobs\/recent\?limit=10/);
  assert.match(activeRoute, /requestedProductUrl/);
  assert.match(activeRoute, /candidate\.productTruth\.product\.landingUrl/);
  assert.match(downloadRoute, /result\?\.imagePath/);
  assert.match(downloadRoute, /result\.nativeCreative\?\.finalPath/);
  assert.doesNotMatch(downloadRoute, /\["success","approved"\]\.includes\(result\.status\)/);
  assert.match(assetRoute, /result\.imagePath/);
  assert.match(assetRoute, /result\.nativeCreative\?\.finalPath/);
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
  assert.match(css, /\.six-creative-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr;/);
});
