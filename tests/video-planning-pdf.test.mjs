import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVideoPlanningPdfHtml,
  videoPlanningPdfFileName,
} from "../app/lib/video-collaboration/videoPlanningPdf.ts";

function fixture() {
  const concept = {
    id: "concept-1",
    title: "선물 / 장면: 기획안",
    openingHook: "첫 자막 <확인>",
    centralIncident: "선물 상자를 여는 사건",
    keyAppeal: "실제 상품 구성",
    speakerPointOfView: "구매자 시점",
    targetCallout: "선물 고르는 분들",
    coreTarget: "선물 구매자",
    cta: "구성을 확인하세요",
    materialCode: "VIDEO_TEST_01",
    revision: 2,
    narrativeStructure: "도입 - 확인 - CTA",
    productionCautions: ["가격은 게시 시점에 확인"],
    cuts: [
      {
        sceneName: "상자 개봉",
        startSecond: 0,
        endSecond: 1,
        caption: "이 구성, 잠깐 보세요",
        sceneDescription: "밝은 식탁에서 손이 상자를 열고 제품을 정면으로 보여준다.",
        cameraComposition: "상자 정면 클로즈업",
        motionDirection: "손이 뚜껑을 천천히 연다",
        transition: "제품 단면으로 매치컷",
        requiredSources: ["제품 원본", "상자 이미지"],
      },
    ],
  };
  const project = {
    projectName: "테스트 프로젝트",
    advertiserName: "테스트 광고주",
    duration: 30,
    productAnalysis: { productName: "찰진등심 1kg 박스" },
  };
  return { project, concept };
}

test("영상 기획 PDF HTML은 한글 자막·장면·촬영 정보를 안전하게 포함한다", () => {
  const { project, concept } = fixture();
  const html = buildVideoPlanningPdfHtml({ project, concept, fontDataBase64: "font-data" });
  assert.match(html, /자막과 영상 장면안/);
  assert.match(html, /이 구성, 잠깐 보세요/);
  assert.match(html, /상자 정면 클로즈업/);
  assert.match(html, /첫 자막 &lt;확인&gt;/);
  assert.doesNotMatch(html, /첫 자막 <확인>/);
});

test("PDF 파일명은 상품명과 기획안 제목을 유지하며 금지 문자를 제거한다", () => {
  const { project, concept } = fixture();
  assert.equal(
    videoPlanningPdfFileName(project, concept),
    "찰진등심 1kg 박스-선물 장면 기획안-자막-영상안.pdf"
  );
});
