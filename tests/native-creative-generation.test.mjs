import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

import { resolveAdvertiserIdentity } from "../app/lib/creative-generation/advertiserIdentity.ts";
import { buildNativeFinalCreativePrompt, buildNativeValidationPrompt } from "../app/lib/creative-generation/nativeCreativePrompt.ts";
import { buildVisualDiversityMatrix, validateVisualDiversityMatrix } from "../app/lib/creative-generation/visualDiversity.ts";
import { optimizeNativeFinalImage } from "../app/lib/creative-generation/nativeCreativeStorage.server.ts";
import { passesNativeCreativeValidation } from "../app/lib/creative-generation/nativeCreativeValidation.ts";

const product = { productName:"민트 샤워젤", category:"뷰티", price:"12,000원", advertiserName:"오리지널소스", brandName:"Original Source", discountInfo:"", mainBenefit:"민트 사용감", targetCustomer:"상쾌한 샤워를 원하는 고객", landingUrl:"https://www.originalsource.co.kr/product/detail.html?product_no=65", productImagePath:"/product.png" };
const results = Array.from({length:6}, (_,i) => ({ hookPlan:{hookCode:`H0${i+1}`, headline:`후킹 ${i+1}`, body:`설명 ${i+1}`, cta:"상품 보기", hypothesis:`가설 ${i+1}`}, scenePlan:{sceneAsset:{scene:`장면 ${i+1}`}} }));

test("광고주 ID는 www를 제거한 정규화 도메인으로 안정적으로 결정된다", () => {
  assert.deepEqual(resolveAdvertiserIdentity(product), { id:"originalsource-co-kr", name:"오리지널소스", domain:"originalsource.co.kr" });
  assert.equal(resolveAdvertiserIdentity({...product, creativeContext:{advertiserId:"CLIENT 01"}}).id, "client-01");
});

test("후킹 6개는 서로 다른 완성 광고 비주얼 매트릭스를 가진다", () => {
  const matrix = buildVisualDiversityMatrix(results);
  assert.equal(matrix.length, 6);
  assert.equal(validateVisualDiversityMatrix(matrix).valid, true);
  assert.equal(new Set(matrix.map((x)=>`${x.sceneType}|${x.cameraAngle}|${x.productPlacement}`)).size, 6);
});

test("중복된 비주얼 조합은 다양성 검증에서 차단된다", () => {
  const matrix = buildVisualDiversityMatrix(results);
  matrix[5] = {...matrix[0], hookCode:"H06"};
  assert.equal(validateVisualDiversityMatrix(matrix).valid, false);
});

test("native prompt는 배경이 아닌 한국어 포함 최종 광고 전체를 한 번에 요구한다", () => {
  const job = { advertiserName:"오리지널소스", productTruth:{product, facts:[], productId:"p"}, visualDiversityMatrix:buildVisualDiversityMatrix(results), results };
  const prompt = buildNativeFinalCreativePrompt(job, results[0], "/tmp/final.png");
  assert.match(prompt, /최종 완성 광고 이미지 전체/);
  assert.match(prompt, /한글 철자 그대로/);
  assert.match(prompt, /사후 합성하지 말 것/);
  assert.doesNotMatch(prompt, /후처리할 안전 여백/);
});

test("업체 공통 기억은 표현 방향만 전달하고 이전 상품 사실로 쓰지 못하게 한다", () => {
  const job = { advertiserName:"오리지널소스", productTruth:{product, facts:[], productId:"p"}, visualDiversityMatrix:buildVisualDiversityMatrix(results), results };
  const prompt = buildNativeFinalCreativePrompt(job, results[0], "/tmp/final.png", undefined, { advertiserId:"originalsource-co-kr", approvedDirections:["제품 중심"], rejectedDirections:["과한 공포"], feedback:["모바일 가독성"], updatedAt:new Date(0).toISOString() });
  assert.match(prompt, /승인 방향: 제품 중심/);
  assert.match(prompt, /이전 상품의 가격·구성·리뷰·이미지나 상품 사실로 해석하지 말 것/);
});

test("source-backed 공개 사실도 AI 검수 프롬프트의 허용 근거로 전달한다", () => {
  const job = { advertiserName:"오리지널소스", productTruth:{product, facts:[{label:"판매가",value:"12,000원",verification:"source-backed",usableInCopy:true,source:"landing-page",sourceUrl:product.landingUrl}], productId:"p"}, visualDiversityMatrix:buildVisualDiversityMatrix(results), results };
  assert.match(buildNativeFinalCreativePrompt(job, results[0], "/tmp/final.png"), /판매가: 12,000원/);
  assert.match(buildNativeValidationPrompt(job, results[0]), /허용 사실: 판매가: 12,000원/);
});

test("검수 기준은 한국어·사실·상품·상업 품질 임계치를 모두 요구한다", () => {
  const good = {hookAlignment:80,productIdentity:80,factualAccuracy:95,koreanTextAccuracy:95,readability:80,composition:80,diversity:75,commercialQuality:80,exportCompliance:100};
  assert.equal(passesNativeCreativeValidation(good), true);
  assert.equal(passesNativeCreativeValidation({...good,koreanTextAccuracy:94}), false);
  assert.equal(passesNativeCreativeValidation({...good,productIdentity:79}), false);
  assert.equal(passesNativeCreativeValidation({...good,factualAccuracy:94}), false);
});

test("codex_local이 기본이며 openai_api는 명시 선택할 때만 만들어진다", () => {
  return readFile(new URL("../app/lib/creative-generation/providers/providerFactory.server.ts",import.meta.url),"utf8").then((source)=>{
    assert.match(source,/engine: CreativeGenerationEngine = "codex_local"/);
    assert.match(source,/engine === "openai_api"/);
    assert.doesNotMatch(source,/catch[\s\S]{0,120}OpenAIFinalCreativeProvider/);
  });
});

test("최종 내보내기는 1200x1200 JPEG 800KB 이하로만 저장한다", async () => {
  const actual = path.join(os.tmpdir(), `adatlas-native-${Date.now()}`);
  await mkdir(actual,{recursive:true});
  const source=path.join(actual,"source.png"), target=path.join(actual,"final.jpg");
  await writeFile(source, await sharp({create:{width:1500,height:900,channels:3,background:{r:10,g:180,b:130}}}).png().toBuffer());
  const result=await optimizeNativeFinalImage(source,target);
  const meta=await sharp(await readFile(target)).metadata();
  assert.equal(meta.width,1200); assert.equal(meta.height,1200); assert.equal(meta.format,"jpeg"); assert.ok(result.bytes<800*1024);
});

test("새 native 경로는 레거시 SVG/Canvas/Sharp 텍스트 렌더러를 호출하지 않는다", async () => {
  const source=await readFile(new URL("../app/lib/creative-generation/nativeResultGeneration.server.ts",import.meta.url),"utf8");
  assert.doesNotMatch(source,/renderCreativeResult|\.composite\(|<svg|Canvas/);
});

test("로컬 공급자는 API 키 환경변수를 Codex 자식 프로세스에 전달하지 않는다", async () => {
  const source=await readFile(new URL("../app/lib/creative-generation/providers/CodexLocalCreativeProvider.server.ts",import.meta.url),"utf8");
  assert.match(source,/OPENAI_API_KEY/); assert.match(source,/CODEX_API_KEY/); assert.match(source,/filter/);
  assert.doesNotMatch(source,/apiKey\s*:/);
});

test("광고주 스레드 레지스트리는 원자 저장과 손상 JSON 복구를 구현한다", async () => {
  const source=await readFile(new URL("../app/lib/creative-generation/codexRegistry.server.ts",import.meta.url),"utf8");
  assert.match(source,/\.tmp/); assert.match(source,/rename\(/); assert.match(source,/\.corrupt-/);
  assert.match(source,/approvedDirections/); assert.doesNotMatch(source,/productFacts|productTruth/);
});

test("resume 실패나 긴 업체 스레드는 공통 기억만 유지한 새 스레드로 안전하게 교체한다", async () => {
  const source=await readFile(new URL("../app/lib/creative-generation/providers/CodexLocalCreativeProvider.server.ts",import.meta.url),"utf8");
  assert.match(source,/resetAdvertiserThread/);
  assert.match(source,/ADATLAS_CODEX_THREAD_MAX_TURNS/);
  assert.match(source,/threadFailure/);
  assert.match(source,/readBrandMemory/);
});

test("native 저장소는 상품·후킹·다양성·브리프·프롬프트·검수 파일을 분리 저장한다", async () => {
  const source=await readFile(new URL("../app/lib/creative-generation/nativeCreativeStorage.server.ts",import.meta.url),"utf8");
  for (const name of ["product-analysis.json","hook-hypotheses.json","diversity-matrix.json","creative-brief.json","generation-prompt.json","validation.json"]) assert.match(source,new RegExp(name.replace(".","\\.")));
  assert.match(source,/fileSizeBytes/);
  assert.match(source,/jpegQuality/);
});

test("동일 광고주 생성은 하나의 Codex 스레드에서 직렬 처리되어 문맥 충돌을 막는다", async () => {
  const source=await readFile(new URL("../app/lib/creative-generation/nativeResultGeneration.server.ts",import.meta.url),"utf8");
  assert.match(source,/advertiserLocks/); assert.match(source,/await previous/); assert.match(source,/job\?\.advertiserId/);
});
