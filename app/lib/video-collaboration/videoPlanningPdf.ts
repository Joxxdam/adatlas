import type { VideoConcept, VideoProject } from "./types.ts";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatTime(value: number) {
  return Number.isInteger(value)
    ? `${value}초`
    : `${value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}초`;
}

function text(value: unknown, fallback = "-") {
  const normalized = String(value ?? "").trim();
  return escapeHtml(normalized || fallback);
}

function list(values: string[] | undefined) {
  return values?.length ? values.map((value) => text(value)).join(" · ") : "-";
}

export function videoPlanningPdfFileName(project: VideoProject, concept: VideoConcept) {
  const base = `${project.productAnalysis.productName}-${concept.title}-자막-영상안`
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
  return `${base || "영상-기획안"}.pdf`;
}

export function buildVideoPlanningPdfHtml(input: {
  project: VideoProject;
  concept: VideoConcept;
  fontDataBase64: string;
}) {
  const { project, concept, fontDataBase64 } = input;
  const generatedAt = new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date());
  const cuts = concept.cuts
    .map(
      (cut, index) => `
        <article class="cut-card">
          <div class="cut-index">
            <strong>${String(index + 1).padStart(2, "0")}</strong>
            <span>${text(cut.sceneName, `장면 ${index + 1}`)}</span>
            <small>${formatTime(cut.startSecond)} - ${formatTime(cut.endSecond)}</small>
          </div>
          <div class="cut-content">
            <section class="caption-block">
              <b>화면 자막</b>
              <p>${text(cut.caption)}</p>
            </section>
            <section>
              <b>영상 장면</b>
              <p>${text(cut.sceneDescription)}</p>
            </section>
            <div class="production-grid">
              <div><b>화면·구도</b><p>${text(cut.cameraComposition)}</p></div>
              <div><b>움직임·연출</b><p>${text(cut.motionDirection)}</p></div>
              <div><b>전환</b><p>${text(cut.transition)}</p></div>
              <div><b>필요 소스</b><p>${list(cut.requiredSources)}</p></div>
            </div>
          </div>
        </article>`
    )
    .join("");

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <style>
    @font-face { font-family: "Noto Sans KR"; src: url(data:font/ttf;base64,${fontDataBase64}) format("truetype"); font-weight: 100 900; }
    @page { size: A4; margin: 14mm 13mm 17mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #14213a; background: #fff; font-family: "Noto Sans KR", sans-serif; font-size: 9.2pt; line-height: 1.55; word-break: keep-all; overflow-wrap: anywhere; }
    .cover { border-radius: 18px; padding: 24px; color: #fff; background: linear-gradient(135deg, #0e4f9d, #1679df 62%, #27a8e6); }
    .brand { margin: 0 0 28px; font-size: 9pt; font-weight: 900; letter-spacing: .12em; opacity: .86; }
    h1 { margin: 0; max-width: 90%; font-size: 24pt; line-height: 1.28; letter-spacing: -.04em; }
    .product { margin: 12px 0 0; font-size: 11pt; opacity: .92; }
    .cover-meta { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 20px; }
    .cover-meta span { border: 1px solid rgba(255,255,255,.28); border-radius: 999px; padding: 5px 9px; background: rgba(255,255,255,.11); font-size: 8pt; font-weight: 700; }
    .section { margin-top: 15px; }
    .section-title { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; color: #1268d5; font-size: 9pt; font-weight: 900; letter-spacing: .08em; }
    .summary { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .summary div { border: 1px solid #dbe6f2; border-radius: 11px; padding: 10px 12px; background: #f7faff; }
    .summary .wide { grid-column: 1 / -1; }
    b { display: block; margin-bottom: 3px; color: #54708f; font-size: 7.5pt; font-weight: 900; letter-spacing: .02em; }
    p { margin: 0; }
    .script-heading { display: flex; align-items: end; justify-content: space-between; gap: 12px; margin: 21px 0 9px; border-bottom: 2px solid #1a73d7; padding-bottom: 7px; }
    .script-heading h2 { margin: 0; font-size: 15pt; letter-spacing: -.03em; }
    .script-heading span { color: #60758f; font-size: 8pt; font-weight: 700; }
    .cut-card { display: grid; grid-template-columns: 29mm minmax(0, 1fr); break-inside: avoid; margin: 0 0 9px; border: 1px solid #dbe4ee; border-radius: 12px; overflow: hidden; }
    .cut-index { padding: 12px 10px; color: #fff; background: #173d68; }
    .cut-index strong { display: block; margin-bottom: 8px; font-size: 18pt; line-height: 1; }
    .cut-index span { display: block; font-size: 8.5pt; font-weight: 800; line-height: 1.35; }
    .cut-index small { display: block; margin-top: 9px; color: #c8ddf4; font-size: 7pt; }
    .cut-content { padding: 11px 13px 12px; }
    .cut-content > section + section { margin-top: 9px; border-top: 1px solid #e5ebf2; padding-top: 8px; }
    .caption-block { border-left: 4px solid #1f82e5; padding-left: 9px; }
    .caption-block p { color: #0f3157; font-size: 11pt; font-weight: 850; line-height: 1.45; }
    .production-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 10px; }
    .production-grid div { border-radius: 7px; padding: 7px 8px; background: #f5f8fc; }
    .production-grid p { color: #52657c; font-size: 7.5pt; line-height: 1.45; }
    .notes { break-inside: avoid; margin-top: 16px; border-radius: 11px; padding: 12px 14px; color: #684f1b; background: #fff7dd; }
    .notes ul { margin: 5px 0 0; padding-left: 18px; }
    .document-meta { margin-top: 16px; border-top: 1px solid #dfe7f0; padding-top: 8px; color: #8794a6; font-size: 7pt; }
  </style>
</head>
<body>
  <header class="cover">
    <p class="brand">DAYWIZ · VIDEO PLANNING</p>
    <h1>${text(concept.title)}</h1>
    <p class="product">${text(project.productAnalysis.productName)}</p>
    <div class="cover-meta">
      <span>${project.duration}초</span>
      <span>${text(project.advertiserName, "광고주 미지정")}</span>
      <span>소재코드 ${text(concept.materialCode)}</span>
      <span>기획안 v${concept.revision}</span>
    </div>
  </header>

  <section class="section">
    <p class="section-title">CONCEPT SUMMARY · 콘셉트 요약</p>
    <div class="summary">
      <div class="wide"><b>첫 자막</b><p>${text(concept.openingHook)}</p></div>
      <div><b>특정 인물</b><p>${text(concept.distinctiveCharacter || concept.speakerPointOfView || concept.speaker)}</p></div>
      <div><b>사회·시대 배경</b><p>${text(concept.socialWorld || concept.centralIncident)}</p></div>
      <div><b>핵심 사건</b><p>${text(concept.storyTrigger || concept.centralIncident || concept.narrativeStructure)}</p></div>
      <div><b>상품 사실 연결</b><p>${text(concept.truthBridge || concept.keyAppeal || concept.usp)}</p></div>
      <div><b>화자·시점</b><p>${text(concept.speakerPointOfView || concept.speaker)}</p></div>
      <div><b>타깃 호명</b><p>${text(concept.targetCallout || concept.coreTarget)}</p></div>
      <div class="wide"><b>연출·사실 경계</b><p>${text(concept.dramatizationBoundary, "인물과 상황은 광고용 연출이며 상품 주장은 확인된 사실만 사용합니다.")}</p></div>
      <div class="wide"><b>마무리 CTA</b><p>${text(concept.cta)}</p></div>
    </div>
  </section>

  <div class="script-heading">
    <h2>자막과 영상 장면안</h2>
    <span>총 ${concept.cuts.length}개 구간 · ${project.duration}초</span>
  </div>
  ${cuts}

  ${concept.productionCautions.length ? `<aside class="notes"><b>제작·검수 주의사항</b><ul>${concept.productionCautions.map((item) => `<li>${text(item)}</li>`).join("")}</ul></aside>` : ""}
  <footer class="document-meta">${text(project.projectName)} · ${generatedAt} PDF 생성</footer>
</body>
</html>`;
}
