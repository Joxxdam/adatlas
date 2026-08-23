import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

import { findBannedCreativePhrases, hasBannedCreativePhrase, looksLikeGenericOrRepetitiveCopy, repairBannedCreativeSentence } from "../app/lib/creative-generation/bannedCreativePhrases.ts";
import { resolveFastCreativeRuntime } from "../app/lib/creative-generation/fastCreativeRuntime.ts";
import { createAsyncConcurrencyGate, resolveCodexCreativeParallelLimit } from "../app/lib/creative-generation/asyncConcurrencyGate.ts";
import { buildNativeFinalCreativePrompt, buildNativeStagePrompt, buildNativeValidationPrompt } from "../app/lib/creative-generation/nativeCreativePrompt.ts";
import { normalizeNativeCreativeValidation } from "../app/lib/creative-generation/nativeCreativeValidation.ts";
import { pickCompatibleRandomItems, pickUniqueRandomItems } from "../app/lib/creative-generation/referenceSelection.ts";
import { normalizeNativeReferenceCompatibility } from "../app/lib/creative-generation/referenceLibraryManagement.ts";
import { copyReferenceStructureLosslessly } from "../app/lib/creative-generation/referenceStructureCopy.server.ts";
import { optimizeNativeFinalImage, selectNativeReferenceSources } from "../app/lib/creative-generation/nativeCreativeStorage.server.ts";
import { buildCreativePlanFingerprint } from "../app/lib/creative-generation/creativePlanCache.server.ts";
import { performanceTemplateRegistry, selectPerformanceTemplates, unusedPerformanceTemplates } from "../app/lib/creative-generation/performanceTemplateRegistry.ts";
import { seededHandwritingStyle } from "../app/lib/creative-generation/localPerformanceCreativeComposer.server.ts";
import { creativeFontRegistry, verifyCreativeFontFiles } from "../app/lib/creative-generation/creativeFontRegistry.server.ts";
import { composeAdaptiveNativeCreative } from "../app/lib/creative-generation/adaptiveNativeCreativeComposer.server.ts";
import { validateAdaptiveNativeCreative } from "../app/lib/creative-generation/nativeLocalQa.server.ts";
import { buildAdaptiveLayoutPlan, referenceCreativeGrammars } from "../app/lib/creative-generation/referenceCreativeGrammar.ts";
import { normalizePlannerScoreValues, recomputeHookTotal, selectQualityDiverseHooks } from "../app/lib/creative-generation/hookQuality.ts";
import { cleanProductTitle } from "../app/lib/creative-generation/productTruth.ts";
import { hasOrphanedRunningResult, isServerRunnableGenerationJob, resumeGenerationJob } from "../app/lib/creative-generation/jobRunnerPolicy.ts";
import { resolveProductRenderingPolicy } from "../app/lib/creative-generation/productRenderingPolicy.ts";
import { isPaidImageGenerationEnabled } from "../app/lib/image-generation/SceneGenerationProvider.ts";
import { hasExplicitPaidApiAuthorization } from "../app/lib/creative-generation/types.ts";

const product = { productName:"민트 샤워젤", category:"뷰티", price:"12,000원", advertiserName:"오리지널소스", brandName:"Original Source", discountInfo:"무료배송", mainBenefit:"민트 사용감", targetCustomer:"운동 후 상쾌한 샤워를 원하는 고객", landingUrl:"https://www.originalsource.co.kr/product/detail.html?product_no=65&utm_source=test", productImagePath:"/product.png" };
const facts = [
  { id:"price",key:"price",label:"판매가",value:"12,000원",verification:"source-backed",source:"landing-page",usableInCopy:true,numericTokens:["12,000원"],evidenceType:"price" },
  { id:"benefit",key:"benefit",label:"사용감",value:"민트 사용감",verification:"source-backed",source:"landing-page",usableInCopy:true,numericTokens:[],evidenceType:"usp" },
  { id:"offer",key:"promotion",label:"혜택",value:"무료배송",verification:"source-backed",source:"landing-page",usableInCopy:true,numericTokens:[],evidenceType:"offer" },
];
const normalized = { rawProductTitle:product.productName,cleanProductName:product.productName,brandName:product.brandName,category:product.category,price:product.price,discountInfo:product.discountInfo,promotion:product.discountInfo,ingredients:["민트"],verifiedBenefits:[product.mainBenefit],uspCandidates:[product.mainBenefit],reviewEvidence:[],targetCustomer:product.targetCustomer,target:product.targetCustomer,usageOccasions:["운동 후"],useSituations:["운동 후"] };
const truth = { productId:"p-1",product,normalized,facts,confirmedProductImage:{path:"/product.png",role:"product-packshot",source:"detail-page",verified:true,width:800,height:1200,transparent:true,reason:"fixture"},imageAssets:[],referenceImages:[],imagePaths:["/product.png"],verifiedClaims:[],unverifiedClaims:[],allowedNumericTokens:["12,000원"],blockedClaimPatterns:[],completeness:90,createdAt:new Date(0).toISOString() };
const grammars = ["PRICE_VALUE","SEASON_URGENCY","FEATURE_EVIDENCE","SENSORY_PROOF","SITUATION_STORY","PROBLEM_RELIEF"];
const hooks = ["price-value","scarcity-urgency","feature-usp","sensory-experience","usage-occasion","problem-solution"].map((primaryTag,index)=>({ id:`h${index}`,blueprintId:"product-hero",hookType:primaryTag,title:`후킹 ${index+1}`,hookCode:`H0${index+1}`,primaryTag,headline:`후킹 ${index+1}`,body:`설명 ${index+1}`,proof:"",offer:index===0?"12,000원":"",cta:"상품 보기",audience:product.targetCustomer,factIds:["benefit"],numericTokens:[],hypothesis:`가설 ${index+1}`,confidence:"high",creativeGrammarId:grammars[index],creativeBrief:{sceneDescription:`장면 ${index+1}`,sceneType:`scene-${index+1}`,heroScene:`장면 ${index+1}`},sceneIntent:`장면 ${index+1}` }));
const results = hooks.map((hookPlan,index)=>({ id:`result-${index+1}`,order:index+1,blueprintId:"product-hero",blueprintLabel:"제품",status:"pending",hookPlan,attempts:0,scenePlan:{sceneAsset:{scene:`장면 ${index+1}`}} }));

test("서버 러너가 사라진 running 결과는 중단 작업으로 감지하고 pending으로 복구한다", () => {
  const runningResults=results.map((result,index)=>index===2?{...result,status:"running",startedAt:"2026-08-22T00:00:00.000Z"}:result);
  const job={
    status:"running",
    startedAt:"2026-08-22T00:00:00.000Z",
    updatedAt:"2026-08-22T00:01:00.000Z",
    results:runningResults,
  };

  assert.equal(hasOrphanedRunningResult(job,false),true);
  assert.equal(hasOrphanedRunningResult(job,true),false);

  const resumed=resumeGenerationJob(job,false,"2026-08-22T00:02:00.000Z");
  assert.equal(resumed.status,"running");
  assert.equal(resumed.results[2].status,"pending");
  assert.equal(resumed.results[2].startedAt,undefined);
});

test("대기 결과만 있는 작업은 유령 running 작업으로 오인하지 않는다", () => {
  const job={status:"running",updatedAt:"2026-08-22T00:01:00.000Z",results};
  assert.equal(hasOrphanedRunningResult(job,false),false);
});

test("새 상품군 우선 ZIP 레퍼런스 작업 버전은 서버 러너가 실행한다", () => {
  assert.equal(isServerRunnableGenerationJob({
    engine:"codex_local",
    version:"generation-job-v12-category-reference-edit",
    results,
  }),true);
});

test("개발 서버 핫리로드는 새 실행 콜백을 가진 v4 러너를 사용한다", async () => {
  const source=await readFile(new URL("../app/lib/creative-generation/jobRunner.server.ts",import.meta.url),"utf8");
  assert.match(source,/server-runner-v4-quality-throughput/);
  assert.match(source,/시작 전 v11 작업을 상품군 우선 ZIP 레퍼런스로 재배정/);
  assert.match(source,/resolveFastCreativeRuntime\(\)\.concurrency/);
});

test("고속 모드는 동시 3장·자동 수정 최대 1회·그룹 QA off가 기본이다", () => {
  assert.deepEqual(resolveFastCreativeRuntime({}), { enabled:true,concurrency:3,autoRevisionLimit:1,groupQaEnabled:false,plannerReasoning:"medium",imageReasoning:"low",maxCreatives:6 });
  assert.equal(resolveFastCreativeRuntime({ADATLAS_CREATIVE_CONCURRENCY:"9"}).concurrency,3);
});

test("한 상품은 3장씩 처리하되 여러 작업의 로컬 Codex 실행도 전역 3개를 넘지 않는다", async () => {
  assert.equal(resolveCodexCreativeParallelLimit({}),3);
  assert.equal(resolveCodexCreativeParallelLimit({ADATLAS_CODEX_MAX_PARALLEL_RUNS:"9"}),3);
  const gate=createAsyncConcurrencyGate(3);
  let active=0;
  let maximum=0;
  let release;
  const blocker=new Promise((resolve)=>{ release=resolve; });
  const tasks=Array.from({length:6},()=>gate.run(async()=>{
    active+=1;
    maximum=Math.max(maximum,active);
    await blocker;
    active-=1;
  }));
  await new Promise((resolve)=>setImmediate(resolve));
  assert.equal(maximum,3);
  assert.equal(gate.activeCount(),3);
  assert.equal(gate.pendingCount(),3);
  release();
  await Promise.all(tasks);
});

test("QA는 10점 척도를 100점으로 정규화하고 로컬 검증된 JPEG 때문에 재생성하지 않는다", () => {
  const validation=normalizeNativeCreativeValidation({
    hookAlignment:9,productIdentity:9,factualAccuracy:10,koreanTextAccuracy:10,
    readability:9,composition:9,diversity:8,commercialQuality:9,exportCompliance:0,
    productVisibility:9,humanNaturalness:9,categoryFit:9,foodAppetiteAppeal:9,
    sensoryExpression:9,mobileReadability:9,observedKoreanText:[],
    failures:["1200×1200 JPEG 및 800KB 이하인지 확인할 수 없습니다."],
    recommendation:"revise",checkedAt:new Date(0).toISOString(),
  },{category:"general",exportComplianceVerified:true});
  assert.equal(validation.productIdentity,90);
  assert.equal(validation.exportCompliance,100);
  assert.equal(validation.failures.length,0);
  assert.equal(validation.recommendation,"approve");
});

test("레퍼런스 교체형 QA는 별도 장면을 강요하지 않고 실제 JPEG 규격을 신뢰한다", () => {
  const prompt=buildNativeValidationPrompt({productTruth:truth},{hookPlan:hooks[0]});
  assert.doesNotMatch(prompt,/Intended scene:/);
  assert.match(prompt,/reference-driven replacement workflow/);
  assert.match(prompt,/exportCompliance to 100/);
});

test("키나 기존 이미지 플래그만으로 유료 이미지 생성이 열리지 않는다", () => {
  assert.equal(isPaidImageGenerationEnabled({
    OPENAI_API_KEY:"sk-test",
    ADATLAS_IMAGE_GENERATION_ENABLED:"true",
  }),false);
  assert.equal(isPaidImageGenerationEnabled({
    ADATLAS_PAID_API_EXPLICIT_ENABLED:"true",
    ADATLAS_IMAGE_GENERATION_ENABLED:"true",
  }),true);
});

test("native 유료 공급자는 작업별 과거 시점의 명시 승인만 인정한다", () => {
  assert.equal(hasExplicitPaidApiAuthorization(undefined),false);
  assert.equal(hasExplicitPaidApiAuthorization({explicitlySelected:true,provider:"openai_api",scope:"native-creative",acknowledgedAt:new Date(Date.now()+60_000).toISOString()}),false);
  assert.equal(hasExplicitPaidApiAuthorization({explicitlySelected:true,provider:"openai_api",scope:"native-creative",acknowledgedAt:new Date(Date.now()-1_000).toISOString()}),true);
});

test("레거시 템플릿 레지스트리는 과거 작업 호환용 10개를 유지한다", () => {
  assert.equal(performanceTemplateRegistry.length,10);
  assert.equal(new Set(performanceTemplateRegistry.map((item)=>item.id)).size,10);
  assert.equal(new Set(performanceTemplateRegistry.map((item)=>item.zones.join("|"))).size,10);
});

test("신규 native 광고 문법은 좌표 템플릿이 아닌 의미 규칙 10개다", () => {
  assert.equal(referenceCreativeGrammars.length,10);
  assert.equal(new Set(referenceCreativeGrammars.map((item)=>item.id)).size,10);
  assert.ok(referenceCreativeGrammars.every((item)=>item.hookPattern&&item.scenePattern&&item.typographyPattern));
  assert.ok(referenceCreativeGrammars.every((item)=>!("productBox" in item)));
});

test("상품 근거에 맞는 서로 다른 6개 문법을 자동 선택하고 나머지만 추가 제안한다", () => {
  const selected=selectPerformanceTemplates(truth,hooks,6);
  assert.equal(selected.length,6);
  assert.equal(new Set(selected.map((item)=>item.id)).size,6);
  assert.ok(selected.some((item)=>item.id==="T01_PRICE_SHOCK"));
  const unused=unusedPerformanceTemplates(selected.map((item)=>item.id),truth);
  assert.ok(unused.every((item)=>!selected.some((selectedItem)=>selectedItem.id===item.id)));
});

test("가격·혜택·후기·라인업 근거가 없으면 해당 문법을 선택하지 않는다", () => {
  const noSignals={...truth,product:{...product,price:"",discountInfo:"",mainBenefit:"",targetCustomer:""},facts:[]};
  const selected=selectPerformanceTemplates(noSignals,hooks,6).map((item)=>item.id);
  assert.ok(!selected.includes("T01_PRICE_SHOCK"));
  assert.ok(!selected.includes("T02_URGENT_OFFER"));
  assert.ok(!selected.includes("T07_SOCIAL_PROOF"));
  assert.ok(!selected.includes("T10_LINEUP_BENEFIT"));
});

test("금지 문구는 띄어쓰기·대소문자·조사 변형까지 탐지하고 문장 단위로 제거한다", () => {
  assert.equal(hasBannedCreativePhrase("상세 페이지 기준으로 보면"),true);
  assert.equal(hasBannedCreativePhrase("usp가 특별한 선택이에요"),true);
  assert.deepEqual(findBannedCreativePhrases("분석해 보니 놓칠 수 없는 상품"),["분석해보니","놓칠 수 없는"]);
  assert.equal(repairBannedCreativeSentence("분석 결과입니다. 운동 뒤 산뜻하게 씻어요!"),"운동 뒤 산뜻하게 씻어요!");
  assert.equal(hasBannedCreativePhrase("판매가는 49,800원입니다"),true);
  assert.equal(hasBannedCreativePhrase("1kg 박스 판매가는 49,800원"),true);
  assert.equal(hasBannedCreativePhrase("확인된 판매가 기준"),true);
  assert.equal(looksLikeGenericOrRepetitiveCopy("민트로 씻는 순간","민트로 씻는 순간"),true);
});

test("사용자에게 노출하는 정상 CTA는 내부 전략 문구로 차단하지 않는다", () => {
  assert.equal(hasBannedCreativePhrase("구매 조건 보기"),false);
  assert.equal(hasBannedCreativePhrase("상품 정보 보기"),false);
  assert.equal(hasBannedCreativePhrase("구성 보기"),false);
});

test("AI 프롬프트는 원본 상품·정확한 한글·검증된 가격을 포함한 완성 광고 전체를 요구한다", () => {
  const job={productTruth:truth,creativePlan:{categoryCreativeProfile:{category:"personal_care"}},results};
  const prompt=buildNativeFinalCreativePrompt(job,results[0],"/tmp/final.png");
  assert.match(prompt,/FINAL, COMPLETE, READY-TO-RUN Korean square performance advertisement/);
  assert.match(prompt,/This is NOT a background plate/);
  assert.match(prompt,/MAIN HOOK: 후킹 1/);
  assert.match(prompt,/SUB COPY: 설명 1/);
  assert.match(prompt,/OFFER: 12,000원/);
  assert.match(prompt,/CTA: 상품 보기/);
  assert.match(prompt,/No template renderer, SVG text layer, canvas text layer or post-render copy panel/);
  assert.match(prompt,/Identity-lock exception: the untouched original packaged-product raster is restored locally/);
  assert.doesNotMatch(prompt,/text-free square advertising scene plate|No product package/);
});

test("신규 v12는 구조를 생성하지 않고 상품·문구·치명 QA만 단계 편집한다", () => {
  const job={productTruth:truth,creativePlan:{categoryCreativeProfile:{category:"personal_care"}},results};
  const structure=buildNativeStagePrompt("structure-recreation",job,results[0],"/tmp/01-structure.png");
  const productReplacement=buildNativeStagePrompt("product-replacement",job,results[0],"/tmp/02-product.png");
  const copyReplacement=buildNativeStagePrompt("copy-replacement",job,results[0],"/tmp/03-copy.png");
  const qaRepair=buildNativeStagePrompt("qa-repair",job,results[0],"/tmp/04-qa.png","가격 표기를 다시 확인하세요.");

  assert.match(structure,/LEGACY STAGE 1/);
  assert.match(structure,/byte-for-byte/);
  assert.match(structure,/must never call image generation/);
  assert.doesNotMatch(structure,/neutral proxy product forms/);
  assert.match(productReplacement,/STAGE 2 OF 4/);
  assert.match(productReplacement,/authoritative product-page images/);
  assert.match(productReplacement,/PREPARE A CLEAN LANDING ZONE FOR THE ORIGINAL PRODUCT/);
  assert.match(productReplacement,/Do NOT draw, imitate, repaint or insert/);
  assert.match(productReplacement,/untouched original product raster/);
  assert.match(copyReplacement,/STAGE 3 OF 4/);
  assert.match(copyReplacement,/Change ONLY the source advertisement's copy/);
  assert.match(copyReplacement,/protected product visible in stage 2 as an identity guide/);
  assert.match(copyReplacement,/untouched original product raster is restored locally/);
  assert.match(copyReplacement,/메인 후킹: 후킹 1/);
  assert.match(copyReplacement,/가격·혜택: 12,000원/);
  assert.match(copyReplacement,/There will be no local text overlay/);
  assert.match(qaRepair,/STAGE 4 OF 4/);
  assert.match(qaRepair,/product count/);
  assert.match(qaRepair,/exact Korean copy/);
  assert.match(qaRepair,/가격 표기를 다시 확인하세요/);
});

test("육류는 원본 부위와 마블링을 근거로 장면 안에 자연스럽게 재생성한다", () => {
  const meatTruth={
    ...truth,
    product:{...truth.product,productName:"설록우 알등심 스테이크 1kg",category:"육류"},
    normalized:{...truth.normalized,cleanProductName:"설록우 알등심 스테이크 1kg",category:"육류"},
  };
  const meatJob={productTruth:meatTruth,creativePlan:{categoryCreativeProfile:{category:"food_meat"}},results};
  const productReplacement=buildNativeStagePrompt("product-replacement",meatJob,results[0],"/tmp/02-product.png");
  const validation=buildNativeValidationPrompt(meatJob,results[0]);
  assert.equal(resolveProductRenderingPolicy(meatJob),"natural-meat-reference");
  assert.match(productReplacement,/MEAT PRODUCT POLICY — NATURAL SCENE INTEGRATION/);
  assert.match(productReplacement,/marbling distribution/);
  assert.match(productReplacement,/never like a rectangular source photo or detached cutout/);
  assert.match(productReplacement,/different cut, grade, origin, quantity or package/);
  assert.match(productReplacement,/Change ONLY the source product instances/);
  assert.match(validation,/natural, appetizing, physically coherent food photography/);
});

test("화장품은 AI 편집 뒤에도 원본 래스터를 보호 합성해 패키지 훼손을 막는다", async () => {
  const beautyJob={productTruth:truth,creativePlan:{categoryCreativeProfile:{category:"personal_care"}},results};
  const prompt=buildNativeStagePrompt("copy-replacement",beautyJob,results[0],"/tmp/03-copy.png");
  const generationSource=await readFile(new URL("../app/lib/creative-generation/nativeResultGeneration.server.ts",import.meta.url),"utf8");
  const compositorSource=await readFile(new URL("../app/lib/creative-generation/protectedProductCompositor.server.ts",import.meta.url),"utf8");
  const identityCompositorSource=compositorSource.slice(compositorSource.indexOf("export async function createIdentityLockedProductComposite"));
  assert.equal(resolveProductRenderingPolicy(beautyJob),"identity-locked-packaged-product");
  assert.match(prompt,/ORIGINAL PRODUCT IDENTITY LOCK/);
  assert.match(prompt,/Never repaint, redraw, relabel, recolor, reshape or regenerate/);
  assert.match(generationSource,/03-copy-base\.png/);
  assert.match(generationSource,/02-product-base\.png/);
  assert.match(generationSource,/createIdentityLockedProductComposite/);
  assert.match(generationSource,/restoreIdentityLockedProduct\(repairedPath\)/);
  assert.match(identityCompositorSource,/fit: "contain"/);
  assert.match(identityCompositorSource,/contactShadow/);
  assert.doesNotMatch(identityCompositorSource,/\.modulate|\.sharpen|tint/);
});

test("음료·우유·캔·파우치·박스·건강기능식품도 화장품과 같은 원본 패키지 잠금을 쓴다", () => {
  for (const productName of ["딸기맛 우유 3병", "레몬 음료 캔", "깔라만시 파우치", "비타민 30정 박스", "유산균 건강기능식품"]) {
    const packagedJob={
      productTruth:{...truth,product:{...truth.product,productName,category:"식품"},normalized:{...truth.normalized,cleanProductName:productName,category:"식품",packageOrOption:productName}},
      creativePlan:{categoryCreativeProfile:{category:"food_packaged"}},results,
    };
    assert.equal(resolveProductRenderingPolicy(packagedJob),"identity-locked-packaged-product",productName);
  }
});

test("관리 화면의 실제 광고 레퍼런스를 세 상품군 선택 풀로 등록한다", async () => {
  const manifest=JSON.parse(await readFile(new URL("../data/native-creative-reference-library.json",import.meta.url),"utf8"));
  const categorySource=await readFile(new URL("../app/lib/creative-generation/referenceCreativeLibrary.server.ts",import.meta.url),"utf8");
  assert.ok(manifest.items.length>=6);
  assert.ok(new Set(manifest.items.map((item)=>item.layoutFamily)).size>=1);
  assert.ok(manifest.items.every((item)=>item.publicPath.startsWith("/creative-references/")));
  const categoryCounts=manifest.items.reduce((counts,item)=>({...counts,[item.categoryGroup]:(counts[item.categoryGroup]||0)+1}),{});
  assert.equal(Object.values(categoryCounts).reduce((sum,count)=>sum+count,0),manifest.items.length);
  assert.ok((categoryCounts.beauty||0)>=6);
  assert.ok((categoryCounts.food||0)>=6);
  assert.ok(manifest.items.every((item)=>["fashion","food","beauty"].includes(item.categoryGroup)));
  assert.ok(manifest.items.every((item)=>item.productForm&&item.compositionType&&item.productSlotCount&&item.productSlotShape&&item.photographyType&&item.textDensity&&item.compatibilityConfidence));
  assert.match(manifest.selectionPolicy,/패션·식품·화장품 세 그룹/);
  assert.match(manifest.selectionPolicy,/건강·웰니스와 퍼스널케어는 화장품에 포함/);
  assert.match(manifest.selectionPolicy,/상품 형태·구도·슬롯 호환 점수/);
  assert.match(manifest.selectionPolicy,/삭제된 항목은 즉시 선택 대상에서 제외/);
  assert.match(manifest.usagePolicy,/URL 상품과 ProductTruth 문구로 단계별 교체/);
  assert.match(categorySource,/category === "fashion"\) return "fashion"/);
  assert.match(categorySource,/return "beauty";/);
  assert.match(categorySource,/"health-wellness" \|\| value === "general"\) return "beauty"/);
  assert.match(categorySource,/buildProductReferenceCompatibilityProfile/);
  assert.match(categorySource,/pickCompatibleRandomItems/);
  assert.doesNotMatch(categorySource,/categorySafeItems|categoryGroup === "fashion"[\s\S]*categoryGroup === "beauty"/);
  assert.match(categorySource,/readNativeReferenceManifestSync/);
});

test("ZIP 전체 풀에서 무작위 6장을 중복 없이 선택한다", () => {
  const source=Array.from({length:113},(_,index)=>`reference-${index+1}`);
  const selected=pickUniqueRandomItems(source,6,()=>0);
  assert.equal(selected.length,6);
  assert.equal(new Set(selected).size,6);
  assert.ok(selected.every((item)=>source.includes(item)));
});

test("병 상품은 고기·타 카테고리를 제외한 호환 레퍼런스에서만 6장을 뽑는다", () => {
  const compatible=Array.from({length:8},(_,index)=>normalizeNativeReferenceCompatibility({
    id:`bottle-${index}`,publicPath:`/bottle-${index}.jpg`,sourceFile:`bottle-${index}.jpg`,layoutFamily:"price-offer",categoryGroup:"food",ordinal:200+index,
    productForm:"bottle",supportsPackagedProduct:true,supportsNaturalFood:false,compatibilityConfidence:"high",
  }));
  const meat=normalizeNativeReferenceCompatibility({id:"meat",publicPath:"/meat.jpg",sourceFile:"meat.jpg",layoutFamily:"price-offer",categoryGroup:"food",ordinal:11});
  const beauty=normalizeNativeReferenceCompatibility({id:"beauty",publicPath:"/beauty.jpg",sourceFile:"beauty.jpg",layoutFamily:"price-offer",categoryGroup:"beauty",ordinal:90});
  const selected=pickCompatibleRandomItems([...compatible,meat,beauty],6,{
    categoryGroup:"food",productForm:"bottle",productCount:1,packagedProduct:true,naturalFood:false,allowsHumanModel:false,
    compatibleCompositionTypes:["product-packshot","price-card","lifestyle-scene"],
  },()=>0);
  assert.equal(selected.length,6);
  assert.ok(selected.every((candidate)=>candidate.item.id.startsWith("bottle-")));
  assert.equal(new Set(selected.map((candidate)=>candidate.item.id)).size,6);
});

test("호환 레퍼런스가 부족하면 타 카테고리로 보충하지 않고 정확히 실패한다", () => {
  const onlyBeauty=Array.from({length:8},(_,index)=>normalizeNativeReferenceCompatibility({id:`beauty-${index}`,publicPath:`/beauty-${index}.jpg`,sourceFile:"beauty.jpg",layoutFamily:"price-offer",categoryGroup:"beauty",ordinal:80+index}));
  assert.throws(()=>pickCompatibleRandomItems(onlyBeauty,6,{
    categoryGroup:"food",productForm:"meat-cut",productCount:1,packagedProduct:false,naturalFood:true,allowsHumanModel:false,
    compatibleCompositionTypes:["natural-food-scene","price-card"],
  },()=>0),/호환되는 광고 레퍼런스가 부족합니다/);
});

test("01-structure는 원본 레퍼런스를 바이트와 SHA-256까지 동일하게 복사한다", async () => {
  const directory=await mkdtemp(path.join(os.tmpdir(),"adatlas-reference-copy-"));
  const source=path.join(directory,"source.jpg");
  const output=path.join(directory,"nested","01-structure.jpg");
  const bytes=Buffer.from("reference-raster-byte-fixture-한글");
  await writeFile(source,bytes);
  const copied=await copyReferenceStructureLosslessly(source,output);
  assert.equal(copied.sourceHash,copied.copiedHash);
  assert.equal(copied.bytes,bytes.length);
  assert.deepEqual(await readFile(output),bytes);
});

test("새 작업에 배정된 상품군 레퍼런스는 재생성에서도 다시 추첨하지 않는다", async () => {
  const createSource=await readFile(new URL("../app/lib/creative-generation/createNativeGenerationJob.server.ts",import.meta.url),"utf8");
  const generationSource=await readFile(new URL("../app/lib/creative-generation/nativeResultGeneration.server.ts",import.meta.url),"utf8");
  assert.match(createSource,/selectCategoryNativeAdReferences\(job, job\.results\.length\)/);
  assert.match(createSource,/adReference: selectedAdReferences\[index\]/);
  assert.match(generationSource,/initial\.nativeCreative\?\.adReference \|\| selectNativeAdReference/);
  assert.doesNotMatch(generationSource,/adReference && action !== "regenerate"/);
});

test("손글씨 효과는 같은 상품·후킹 seed에서 결정적이고 허용 범위 안이다", () => {
  const left=seededHandwritingStyle("p-1:H01:T04");
  const right=seededHandwritingStyle("p-1:H01:T04");
  assert.deepEqual(left,right);
  assert.ok(left.rotation>=-4&&left.rotation<=4);
  assert.ok(left.outline>=2&&left.outline<=5);
});

test("상업 이용 가능한 OFL 한글 폰트와 손글씨 fallback 파일이 모두 존재한다", async () => {
  assert.equal(await verifyCreativeFontFiles(),true);
  assert.match(creativeFontRegistry.HANDWRITTEN_MARKER.family,/Nanum Pen Script/);
  assert.equal(creativeFontRegistry.HANDWRITTEN_BRUSH.fallbackRole,"HANDWRITTEN_MARKER");
});

test("레거시 고급 합성기는 과거 작업 호환을 위해 1200 정사각 결과·로컬 QA를 유지한다", { timeout:30_000 }, async () => {
  const actual=path.join(os.tmpdir(),`adatlas-composer-${Date.now()}`);
  await mkdir(actual,{recursive:true});
  const backgroundPath=path.join(actual,"background.png");
  const productPath=path.join(actual,"product.png");
  const outputPath=path.join(actual,"composed.png");
  await writeFile(backgroundPath,await sharp({create:{width:1024,height:1024,channels:3,background:{r:232,g:244,b:238}}}).png().toBuffer());
  await writeFile(productPath,await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="720"><rect x="50" y="10" width="260" height="700" rx="55" fill="#00a77a"/><rect x="82" y="250" width="196" height="190" fill="#fff"/><rect x="98" y="285" width="164" height="70" fill="#071b2a"/></svg>`)).png().toBuffer());
  const hookPlan={...hooks[2],headline:"운동 뒤, 민트로 씻을 시간",body:"땀 흘린 날 더 산뜻하게",offer:"",cta:"상품 보기",creativeGrammarId:"FEATURE_EVIDENCE"};
  const result={...results[0],id:"result-1",order:1,hookPlan};
  const job={id:"job-1",productTruth:truth,results:[result],creativePlan:{}};
  const composed=await composeAdaptiveNativeCreative({job,result,backgroundPath,productImagePath:productPath,productTransparent:true,outputPath});
  const metadata=await sharp(await readFile(outputPath)).metadata();
  const manifest=JSON.parse(await readFile(`${outputPath}.composition.json`,"utf8"));
  assert.equal(metadata.width,1200); assert.equal(metadata.height,1200);
  assert.equal(composed.productComposed,true);
  assert.deepEqual(manifest.exactText,{headline:hookPlan.headline,body:hookPlan.body,price:"",cta:""});
  assert.equal(manifest.productSource,productPath);
  assert.equal(manifest.productComposed,true);
  assert.equal(manifest.headlineOverflow,false);
  assert.equal(manifest.bodyOverflow,false);
  assert.ok(manifest.minTextContrastRatio >= 4.5);
  const qa=await validateAdaptiveNativeCreative({job,result,file:outputPath,composition:composed});
  assert.notEqual(qa.recommendation,"approve");
  assert.ok(["manual-review","revise"].includes(qa.recommendation));
  assert.ok(!qa.failures.some((failure)=>/잘렸/.test(failure)));
  const overflowQa=await validateAdaptiveNativeCreative({
    job,
    result,
    file:outputPath,
    composition:{...composed,headlineOverflow:true},
  });
  assert.equal(overflowQa.recommendation,"revise");
  assert.ok(overflowQa.failures.some((failure)=>/잘렸/.test(failure)));
});

test("native 레퍼런스는 광고 픽셀·누끼를 제외하고 원본 상품 상세페이지 사진만 전달한다", () => {
  const pack={id:"pack",path:"/pack.jpg",role:"product-packshot",source:"product-page",verified:true,reason:"원본"};
  const lifestyle={id:"life",path:"/life.jpg",role:"product-lifestyle",source:"product-page",verified:true,reason:"사용 장면"};
  const detail={id:"detail",path:"/detail.jpg",role:"detail-image",source:"product-page",verified:true,reason:"상세"};
  const referenceA={id:"ref-a",path:"/ref-a.jpg",role:"ad-reference",source:"selected-reference",verified:true,reason:"스타일 참고"};
  const referenceB={...referenceA,id:"ref-b",path:"/ref-b.jpg"};
  const referenceC={...referenceA,id:"ref-c",path:"/ref-c.jpg"};
  const cutout={id:"cutout",path:"/processed-products/cutout.png",role:"product-cutout",source:"user-confirmed",verified:true,reason:"가공 이미지"};
  const job={productTruth:{...truth,imageAssets:[cutout,pack,lifestyle,detail],referenceImages:[referenceA,referenceB,referenceC]}};
  const selected=selectNativeReferenceSources(job);
  assert.deepEqual(selected.map((asset)=>asset.path),["/pack.jpg","/life.jpg","/detail.jpg"]);
  assert.equal(selected.filter((asset)=>asset.role==="ad-reference").length,0);
  assert.ok(!selected.some((asset)=>/processed-products/.test(asset.path)));
});

test("H01~H06은 상품별 회전된 서로 다른 동적 LayoutPlan을 만든다", () => {
  const plans=results.map((result)=>buildAdaptiveLayoutPlan({truth,result,groupResults:results}));
  assert.equal(plans.length,6);
  assert.equal(new Set(plans.map((plan)=>`${plan.sceneAnchor}|${plan.copyAnchor}|${plan.productAnchor}|${plan.textAlign}`)).size,6);
  assert.ok(plans.some((plan)=>plan.typographyRole==="handwritten") || plans.some((plan)=>plan.graphicMotif!=="none"));
});

test("검증된 가격·구성 근거가 없으면 가격 강조와 다중 상품을 만들지 않는다", () => {
  const noOffer={...truth,normalized:{...truth.normalized,price:"",composition:"",packageOrOption:""},product:{...product,price:"",discountInfo:""}};
  const priceResult={...results[0],hookPlan:{...results[0].hookPlan,creativeGrammarId:"PRICE_VALUE"}};
  const bundleResult={...results[1],hookPlan:{...results[1].hookPlan,creativeGrammarId:"BUNDLE_LINEUP"}};
  assert.equal(buildAdaptiveLayoutPlan({truth:noOffer,result:priceResult}).priceEmphasis,false);
  assert.equal(buildAdaptiveLayoutPlan({truth:noOffer,result:bundleResult}).productCount,1);
});

test("7~10 점수는 70~100으로 정규화하고 기존 0~100 점수는 다시 곱하지 않는다", () => {
  assert.deepEqual(normalizePlannerScoreValues({evidenceStrength:7,claimSafety:10}),{evidenceStrength:70,claimSafety:100});
  assert.deepEqual(normalizePlannerScoreValues({evidenceStrength:70,claimSafety:96}),{evidenceStrength:70,claimSafety:96});
  assert.equal(recomputeHookTotal({evidenceStrength:70,specificity:70,purchaseReasonStrength:70,distinctiveness:70,attentionPotential:70,visualizability:70,advertisingFit:70,claimSafety:100,categoryPrior:70,novelty:70}),73);
});

test("최종 6안은 coreClaim·sceneKey가 다르고 태그 4개 이상이며 가격형은 최대 2개다", () => {
  const score={evidenceStrength:90,specificity:88,purchaseReasonStrength:86,distinctiveness:84,attentionPotential:82,visualizability:90,advertisingFit:86,claimSafety:96,categoryPrior:80,novelty:82,total:88};
  const tags=["price-value","price-value","price-value","feature-usp","sensory-experience","usage-occasion","problem-solution","review-trust"];
  const candidates=tags.map((primaryTag,index)=>({
    id:`candidate-${index}`,primaryTag,secondaryTags:[],hypothesis:`가설 ${index}`,mainHook:`서로 다른 후킹 ${index}`,subCopy:`서로 다른 설명 ${index}`,coreClaim:`핵심 소구 ${index}`,sentenceStyle:["question","declaration","dialogue","contrast","sensory","urgency","proof"][index%7],customerReason:`이유 ${index}`,customerTension:`긴장 ${index}`,verifiedEvidence:[`근거 ${index}`],intendedReaction:`반응 ${index}`,visualConcept:`비주얼 ${index}`,prohibitedClaims:[],confidence:"high",generationSource:"fallback",selectionReason:"",evidenceSummary:`근거 ${index}`,evidence:[],factIds:["benefit"],sceneKey:`scene-${index}`,visualStory:`스토리 ${index}`,score:{...score,total:score.total-index},status:"candidate",creativeBrief:{},
  }));
  const selected=selectQualityDiverseHooks(candidates,6);
  assert.equal(selected.length,6);
  assert.ok(new Set(selected.map((item)=>item.primaryTag)).size>=4);
  assert.ok(selected.filter((item)=>item.primaryTag==="price-value").length<=2);
  assert.equal(new Set(selected.map((item)=>item.coreClaim)).size,6);
  assert.equal(new Set(selected.map((item)=>item.sceneKey)).size,6);
});

test("긴 프로모션 상품명에서 정체성은 유지하고 행사·가격 문구를 제거한다", () => {
  assert.equal(cleanProductTitle("[10일한정] 설록우 ★1++★ 등심 1kg 49,800원 무료배송", "설록우"),"1++ 등심 1kg");
  assert.doesNotMatch(cleanProductTitle("[사전예약/무료배송] 오리지널소스 민트 샤워젤 2+1", "오리지널소스"),/사전예약|무료배송|2\+1/);
});

test("계획 fingerprint는 추적 파라미터를 무시하고 사실 또는 이미지가 바뀌면 달라진다", () => {
  const first=buildCreativePlanFingerprint(truth);
  const same=buildCreativePlanFingerprint({...truth,product:{...product,landingUrl:"https://www.originalsource.co.kr/product/detail.html?product_no=65&utm_campaign=x"}});
  const changedFact=buildCreativePlanFingerprint({...truth,facts:[...facts,{...facts[0],id:"new",value:"13,000원"}]});
  const changedImage=buildCreativePlanFingerprint({...truth,confirmedProductImage:{...truth.confirmedProductImage,width:900}});
  assert.equal(first,same);
  assert.notEqual(first,changedFact);
  assert.notEqual(first,changedImage);
});

test("native 실행은 구조를 무손실 복사하고 상품·문구·치명 QA에만 AI를 사용한다", async () => {
  const source=await readFile(new URL("../app/lib/creative-generation/nativeResultGeneration.server.ts",import.meta.url),"utf8");
  assert.match(source,/provider\.generate/);
  assert.match(source,/provider\.validate\(/);
  assert.match(source,/referencePaths:generationReferences/);
  assert.match(source,/selectNativeAdReference/);
  assert.match(source,/copyReferenceStructureLosslessly/);
  assert.doesNotMatch(source,/runStage\("structure-recreation"/);
  assert.match(source,/runStage\("product-replacement"/);
  assert.match(source,/runStage\("copy-replacement"/);
  assert.match(source,/runStage\("qa-repair"/);
  assert.match(source,/stagePaths:/);
  assert.doesNotMatch(source,/selectGoldenReferences/);
  assert.doesNotMatch(source,/composeAdaptiveNativeCreative|validateAdaptiveNativeCreative|composeLocalPerformanceCreative|localValidation/);
  assert.match(source,/action === "copy-update"/);
  assert.doesNotMatch(source,/provider\.validateGroup\(/);
  assert.doesNotMatch(source,/ensureProductAdCopy/);
  assert.match(source,/hasCriticalNativeQaFailure/);
  assert.match(source,/Math\.min\(1,runtime\.autoRevisionLimit\)/);
  assert.match(source,/backgroundPath:undefined/);
  assert.match(source,/compositionMs = 0/);
  assert.match(source,/generationRequestKey:`native-ai-final:/);
});

test("사용자 수정 피드백은 교체 가능한 repository와 기본 STRONG 강도로 분리된다", async () => {
  const source=await readFile(new URL("../app/lib/creative-generation/creativePreferenceRepository.server.ts",import.meta.url),"utf8");
  assert.match(source,/interface CreativePreferenceRepository/);
  assert.match(source,/expressionStrength:\s*"STRONG"/);
  assert.match(source,/approved-after-copy-edit/);
  assert.match(source,/never-reuse/);
});

test("문구 수정도 기존 배경·후처리 합성을 재사용하지 않고 AI 완성 광고 전체를 다시 생성한다", async () => {
  const source=await readFile(new URL("../app/lib/creative-generation/nativeResultGeneration.server.ts",import.meta.url),"utf8");
  const copyIndex=source.indexOf('action === "copy-update"');
  const providerIndex=source.indexOf("createCreativeGenerationProvider",copyIndex);
  assert.ok(copyIndex>0&&providerIndex>copyIndex);
  assert.match(source,/else if \(action === "copy-update"\)/);
  assert.match(source,/copyPath = undefined/);
  assert.match(source,/runStage\("copy-replacement"/);
  assert.match(source,/if \(action === "revise"\)/);
  assert.match(source,/04-qa-repair-user/);
  assert.doesNotMatch(source,/backgroundPath\) throw|shouldGenerateBackground|composeAdaptiveNativeCreative/);
});

test("수동 제작과 아침 자동 제작은 동일한 native 생성 작업 팩토리를 사용한다", async () => {
  const manual=await readFile(new URL("../app/api/creative-generation/jobs/route.ts",import.meta.url),"utf8");
  const automatic=await readFile(new URL("../app/lib/auto-production/productionRunner.server.ts",import.meta.url),"utf8");
  assert.match(manual,/createNativeGenerationJob/);
  assert.match(automatic,/createNativeGenerationJob/);
  assert.match(automatic,/engine:\s*"codex_local"/);
  assert.doesNotMatch(automatic,/openai_api/);
});

test("로컬 공급자는 영구 H 스레드를 저장하지 않고 reasoning low 설정의 일회성 thread를 쓴다", async () => {
  const source=await readFile(new URL("../app/lib/creative-generation/providers/CodexLocalCreativeProvider.server.ts",import.meta.url),"utf8");
  assert.match(source,/this\.codex\.startThread/);
  assert.match(source,/runtime\.imageReasoning/);
  assert.doesNotMatch(source,/resumeThread|saveAdvertiserThread|codexProductThreadKey/);
});

test("기본 UI는 유료 엔진·동의 값을 보내지 않고 Codex 상태만 조회한다", async () => {
  const ui=await readFile(new URL("../app/components/features/creative-generation/SixCreativeGenerator.tsx",import.meta.url),"utf8");
  const statusRoute=await readFile(new URL("../app/api/codex/status/route.ts",import.meta.url),"utf8");
  assert.doesNotMatch(ui,/paidApiAuthorization|paidApiExplicitlySelected|engine\s*:/);
  assert.match(statusRoute,/const engine = "codex_local"/);
  assert.doesNotMatch(statusRoute,/searchParams|get\("engine"\)/);
});

test("Codex 자식 프로세스는 API 환경을 제거하고 ChatGPT 로그인만 인증으로 인정한다", async () => {
  const source=await readFile(new URL("../app/lib/creative-generation/codexLocalRuntime.server.ts",import.meta.url),"utf8");
  assert.match(source,/OPENAI_API_KEY/);
  assert.match(source,/OPENAI_BASE_URL/);
  assert.match(source,/logged in using chatgpt/i);
  assert.doesNotMatch(source,/\/logged in\/i\.test/);
});

test("직접 이미지 API 함수도 작업별 명시 승인 없이는 호출할 수 없다", async () => {
  const client=await readFile(new URL("../app/lib/mvp/openaiImageClient.ts",import.meta.url),"utf8");
  const nativePaid=await readFile(new URL("../app/lib/creative-generation/providers/OpenAIFinalCreativeProvider.server.ts",import.meta.url),"utf8");
  assert.match(client,/assertExplicitPaidImageAuthorization/);
  assert.match(client,/explicitPaidApiAuthorization/);
  assert.match(nativePaid,/explicitPaidApiAuthorization: this\.explicitPaidApiAuthorization/);
});

test("후킹 planner는 한 번의 일회성 thread와 medium 기본 reasoning을 사용한다", async () => {
  const source=await readFile(new URL("../app/lib/creative-generation/CodexLocalHookPlanner.server.ts",import.meta.url),"utf8");
  assert.match(source,/minItems: 12/);
  assert.match(source,/maxItems: 15/);
  assert.match(source,/runtime\.plannerReasoning/);
  assert.doesNotMatch(source,/resumeThread|saveAdvertiserThread|codexProductThreadKey/);
});

test("최종 내보내기는 1200x1200 JPEG 800KB 이하로만 저장한다", async () => {
  const actual=path.join(os.tmpdir(),`adatlas-fast-${Date.now()}`);
  await mkdir(actual,{recursive:true});
  const source=path.join(actual,"source.png"),target=path.join(actual,"final.jpg");
  await writeFile(source,await sharp({create:{width:1500,height:900,channels:3,background:{r:10,g:180,b:130}}}).png().toBuffer());
  const result=await optimizeNativeFinalImage(source,target);
  const metadata=await sharp(await readFile(target)).metadata();
  assert.equal(metadata.width,1200); assert.equal(metadata.height,1200); assert.equal(metadata.format,"jpeg"); assert.ok(result.bytes<800*1024);
});

test("UI는 한 번의 클릭 뒤 1~6 진행 상태·완성 즉시 표시·전체 ZIP 흐름을 제공한다", async () => {
  const source=await readFile(new URL("../app/components/features/creative-generation/SixCreativeGenerator.tsx",import.meta.url),"utf8");
  assert.match(source,/concurrency: 3/);
  assert.match(source,/수정 문구로 전체 광고 재생성/);
  assert.doesNotMatch(source,/문구만 적용|AI 재생성 없이/);
  assert.match(source,/이 콘텐츠 다시 만들기/);
  assert.match(source,/generation-job-v12-category-reference-edit/);
  assert.match(source,/reference-staged-edit/);
  assert.match(source,/generationStageProgress/);
  assert.match(source,/장째 광고를 제작 중입니다/);
  assert.match(source,/현재 진행/);
  assert.match(source,/simple-generation-steps/);
  assert.match(source,/완성된 광고는 한 장씩 바로 표시됩니다/);
  assert.match(source,/\.filter\(\(result\) => Boolean\(result\.imagePath\)\)/);
  assert.match(source,/완료 6\/6 · 다운로드 가능/);
  assert.match(source,/원본 구조 적용 중/);
  assert.match(source,/품질 확인 필요 · 다운로드 가능/);
  assert.match(source,/previousUrl === currentProductUrl/);
  assert.match(source,/진행 중인 광고 작업을 그대로 유지/);
  assert.doesNotMatch(source,/품질 확인이 필요합니다/);
  assert.match(source,/생성된 이미지 ZIP 다운로드/);
  assert.match(source,/6장 ZIP 다운로드/);
  assert.match(source,/allCreativesReady/);
  assert.doesNotMatch(source,/상품군 선택 레퍼런스/);
});
