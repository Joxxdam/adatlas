import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

import { findBannedCreativePhrases, hasBannedCreativePhrase, repairBannedCreativeSentence } from "../app/lib/creative-generation/bannedCreativePhrases.ts";
import { resolveFastCreativeRuntime } from "../app/lib/creative-generation/fastCreativeRuntime.ts";
import { buildNativeFinalCreativePrompt } from "../app/lib/creative-generation/nativeCreativePrompt.ts";
import { optimizeNativeFinalImage } from "../app/lib/creative-generation/nativeCreativeStorage.server.ts";
import { buildCreativePlanFingerprint } from "../app/lib/creative-generation/creativePlanCache.server.ts";
import { performanceTemplateRegistry, selectPerformanceTemplates, unusedPerformanceTemplates } from "../app/lib/creative-generation/performanceTemplateRegistry.ts";
import { composeLocalPerformanceCreative, seededHandwritingStyle } from "../app/lib/creative-generation/localPerformanceCreativeComposer.server.ts";
import { creativeFontRegistry, verifyCreativeFontFiles } from "../app/lib/creative-generation/creativeFontRegistry.server.ts";

const product = { productName:"민트 샤워젤", category:"뷰티", price:"12,000원", advertiserName:"오리지널소스", brandName:"Original Source", discountInfo:"무료배송", mainBenefit:"민트 사용감", targetCustomer:"운동 후 상쾌한 샤워를 원하는 고객", landingUrl:"https://www.originalsource.co.kr/product/detail.html?product_no=65&utm_source=test", productImagePath:"/product.png" };
const facts = [
  { id:"price",key:"price",label:"판매가",value:"12,000원",verification:"source-backed",source:"landing-page",usableInCopy:true,numericTokens:["12,000원"],evidenceType:"price" },
  { id:"benefit",key:"benefit",label:"사용감",value:"민트 사용감",verification:"source-backed",source:"landing-page",usableInCopy:true,numericTokens:[],evidenceType:"usp" },
  { id:"offer",key:"promotion",label:"혜택",value:"무료배송",verification:"source-backed",source:"landing-page",usableInCopy:true,numericTokens:[],evidenceType:"offer" },
];
const truth = { productId:"p-1",product,facts,confirmedProductImage:{path:"/product.png",role:"product-packshot",verified:true,width:800,height:1200},imageAssets:[],referenceImages:[],imagePaths:["/product.png"],verifiedClaims:[],unverifiedClaims:[],allowedNumericTokens:["12,000원"],blockedClaimPatterns:[],completeness:90,createdAt:new Date(0).toISOString() };
const hooks = ["price-value","scarcity-urgency","feature-usp","sensory-experience","usage-occasion","problem-solution"].map((primaryTag,index)=>({ id:`h${index}`,hookCode:`H0${index+1}`,primaryTag,headline:`후킹 ${index+1}`,body:`설명 ${index+1}`,offer:index===0?"12,000원":"",cta:"상품 보기",factIds:["benefit"],creativeBrief:{sceneDescription:`장면 ${index+1}`},sceneIntent:`장면 ${index+1}` }));
const results = hooks.map((hookPlan,index)=>({ order:index+1,hookPlan,scenePlan:{sceneAsset:{scene:`장면 ${index+1}`}} }));

test("고속 모드는 동시 3장·자동 수정 최대 1회·그룹 QA off가 기본이다", () => {
  assert.deepEqual(resolveFastCreativeRuntime({}), { enabled:true,concurrency:3,autoRevisionLimit:1,groupQaEnabled:false,plannerReasoning:"medium",imageReasoning:"low",maxCreatives:6 });
  assert.equal(resolveFastCreativeRuntime({ADATLAS_CREATIVE_CONCURRENCY:"9"}).concurrency,3);
});

test("템플릿 레지스트리는 서로 다른 10개 광고 문법을 가진다", () => {
  assert.equal(performanceTemplateRegistry.length,10);
  assert.equal(new Set(performanceTemplateRegistry.map((item)=>item.id)).size,10);
  assert.equal(new Set(performanceTemplateRegistry.map((item)=>item.zones.join("|"))).size,10);
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
});

test("AI 프롬프트는 원본 상품·한글·가격을 생성하지 않고 글자 없는 장면만 요구한다", () => {
  const job={productTruth:truth,creativePlan:{categoryCreativeProfile:{category:"personal_care"}},results};
  const prompt=buildNativeFinalCreativePrompt(job,results[0],"/tmp/background.png");
  assert.match(prompt,/text-free square advertising scene plate/);
  assert.match(prompt,/No product package/);
  assert.match(prompt,/No letters, Korean text, English text, numbers, price/);
  assert.doesNotMatch(prompt,/12,000원|후킹 1|설명 1|상품 보기/);
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

test("원본 상품과 확정 한국어를 로컬 합성하고 1200 정사각 결과·합성 명세를 남긴다", { timeout:30_000 }, async () => {
  const actual=path.join(os.tmpdir(),`adatlas-composer-${Date.now()}`);
  await mkdir(actual,{recursive:true});
  const backgroundPath=path.join(actual,"background.png");
  const productPath=path.join(actual,"product.png");
  const outputPath=path.join(actual,"composed.png");
  await writeFile(backgroundPath,await sharp({create:{width:1024,height:1024,channels:3,background:{r:232,g:244,b:238}}}).png().toBuffer());
  await writeFile(productPath,await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="720"><rect x="50" y="10" width="260" height="700" rx="55" fill="#00a77a"/><rect x="82" y="250" width="196" height="190" fill="#fff"/><rect x="98" y="285" width="164" height="70" fill="#071b2a"/></svg>`)).png().toBuffer());
  const hookPlan={...hooks[0],headline:"운동 뒤, 민트로 씻을 시간",body:"땀 흘린 날 더 산뜻하게",offer:"12,000원",cta:"상품 보기",performanceTemplateId:"T09_PRODUCT_HERO"};
  const result={...results[0],id:"result-1",order:1,hookPlan};
  const job={id:"job-1",productTruth:truth,results:[result],creativePlan:{}};
  const composed=await composeLocalPerformanceCreative({job,result,template:performanceTemplateRegistry.find((item)=>item.id==="T09_PRODUCT_HERO"),backgroundPath,productImagePath:productPath,productTransparent:true,outputPath});
  const metadata=await sharp(await readFile(outputPath)).metadata();
  const manifest=JSON.parse(await readFile(`${outputPath}.composition.json`,"utf8"));
  assert.equal(metadata.width,1200); assert.equal(metadata.height,1200);
  assert.equal(composed.productComposed,true);
  assert.deepEqual(manifest.exactText,{headline:hookPlan.headline,body:hookPlan.body,offer:hookPlan.offer,cta:hookPlan.cta});
  assert.equal(manifest.productSource,productPath);
  assert.equal(manifest.productComposed,true);
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

test("native 실행은 이미지당 AI QA와 자동 Meta 문구 생성 없이 단일 배경 호출 후 로컬 합성한다", async () => {
  const source=await readFile(new URL("../app/lib/creative-generation/nativeResultGeneration.server.ts",import.meta.url),"utf8");
  assert.match(source,/provider\.generate/);
  assert.match(source,/composeLocalPerformanceCreative/);
  assert.match(source,/action === "copy-update"/);
  assert.doesNotMatch(source,/provider\.validate\(/);
  assert.doesNotMatch(source,/provider\.validateGroup\(/);
  assert.doesNotMatch(source,/ensureProductAdCopy/);
  assert.match(source,/attempt<=runtime\.autoRevisionLimit/);
});

test("사용자 수정 피드백은 교체 가능한 repository와 기본 STRONG 강도로 분리된다", async () => {
  const source=await readFile(new URL("../app/lib/creative-generation/creativePreferenceRepository.server.ts",import.meta.url),"utf8");
  assert.match(source,/interface CreativePreferenceRepository/);
  assert.match(source,/expressionStrength:\s*"STRONG"/);
  assert.match(source,/approved-after-copy-edit/);
  assert.match(source,/never-reuse/);
});

test("문구 수정은 provider 생성 분기 전에 기존 배경을 요구하고 로컬 합성만 재실행한다", async () => {
  const source=await readFile(new URL("../app/lib/creative-generation/nativeResultGeneration.server.ts",import.meta.url),"utf8");
  const copyIndex=source.indexOf('action === "copy-update"');
  const providerIndex=source.indexOf("createCreativeGenerationProvider",copyIndex);
  assert.ok(copyIndex>0&&providerIndex>copyIndex);
  assert.match(source,/shouldGenerateBackground = action !== "copy-update"/);
});

test("로컬 공급자는 영구 H 스레드를 저장하지 않고 reasoning low 설정의 일회성 thread를 쓴다", async () => {
  const source=await readFile(new URL("../app/lib/creative-generation/providers/CodexLocalCreativeProvider.server.ts",import.meta.url),"utf8");
  assert.match(source,/this\.codex\.startThread/);
  assert.match(source,/runtime\.imageReasoning/);
  assert.doesNotMatch(source,/resumeThread|saveAdvertiserThread|codexProductThreadKey/);
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

test("UI는 3장 병렬·개별 문구 적용·개별 재생성·완성 즉시 표시 흐름을 제공한다", async () => {
  const source=await readFile(new URL("../app/components/features/creative-generation/SixCreativeGenerator.tsx",import.meta.url),"utf8");
  assert.match(source,/concurrency: 3/);
  assert.match(source,/문구만 적용/);
  assert.match(source,/이 콘텐츠 다시 만들기/);
  assert.match(source,/다른 콘셉트 더 보기/);
  assert.match(source,/완성된 카드부터 바로 보여드립니다/);
});
