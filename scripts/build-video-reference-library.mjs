import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const sources = [
  { slug: "meat-video-01", id: "meat-video-01", blueprintId: "meat-real-review-secret-price" },
  { slug: "meat-video-03", id: "meat-video-03", blueprintId: "meat-wholesale-insider" },
  { slug: "meat-video-04", id: "meat-video-04", blueprintId: "meat-family-expert-usp" },
  { slug: "calamansi-video-01", id: "calamansi-video-01", blueprintId: "produce-direct-secret" },
  { slug: "calamansi-video-02", id: "calamansi-video-02", blueprintId: "produce-origin-documentary" },
  { slug: "calamansi-video-03", id: "calamansi-video-03", blueprintId: "produce-price-negotiation" },
  { slug: "original-source-video-01", id: "original-source-video-01", blueprintId: "beauty-clay-problem-loop" },
  { slug: "original-source-video-02", id: "original-source-video-02", blueprintId: "beauty-discovery-documentary" },
  { slug: "original-source-video-03", id: "original-source-video-03", blueprintId: "beauty-clay-benefit-cta" },
  { slug: "reference-video-01", id: "reference-video-01", blueprintId: "food-always-wholesale" },
  { slug: "reference-video-02", id: "reference-video-02", blueprintId: "food-bargaining-parody" },
  { slug: "meat-video-05", id: "meat-video-05", blueprintId: "meat-catalog-holiday-clearance" },
  { slug: "meat-video-06", id: "meat-video-06-natural-dialogue", blueprintId: "meat-couple-wholesale-review" },
  { slug: "meat-video-07", id: "meat-video-07", blueprintId: "meat-holiday-gift-comparison" },
  { slug: "meat-video-08", id: "meat-video-08", blueprintId: "meat-parents-gift-review" },
  { slug: "meat-video-09", id: "meat-video-09", blueprintId: "meat-child-meal-wholesale" },
  { slug: "calamansi-video-04", id: "calamansi-video-04-secret-dialogue", blueprintId: "produce-friend-secret-process" },
  { slug: "calamansi-video-05", id: "calamansi-video-05", blueprintId: "produce-reunion-transformation" },
  { slug: "calamansi-video-06", id: "calamansi-video-06", blueprintId: "produce-motion-graphic-compression" },
  { slug: "calamansi-video-07", id: "calamansi-video-07", blueprintId: "produce-morning-routine-compression" },
  { slug: "calamansi-video-08", id: "calamansi-video-08", blueprintId: "produce-long-negotiation-process" },
  {
    slug: "original-source-01",
    id: "original-source-history-problem-truth-bridge",
    blueprintId: "beauty-historical-world-truth-bridge",
    sourceArtifact: "오리지널소스1_장면별캡처_자막분석 (1).zip",
  },
];

const relationshipNotes = {
  "meat-video-06": "고기영상6·고기영상9: 핵심 조리·가격·도매가 본문은 같고 도입과 가족 후기만 다름",
  "meat-video-09": "고기영상6·고기영상9: 핵심 조리·가격·도매가 본문은 같고 도입과 가족 후기만 다름",
  "calamansi-video-04": "깔라만시4·깔라만시5: 핵심 USP·공정 본문은 같고 술자리 질문형/동창회 반전형 도입이 다름",
  "calamansi-video-05": "깔라만시4·깔라만시5: 핵심 USP·공정 본문은 같고 술자리 질문형/동창회 반전형 도입이 다름",
  "original-source-video-01": "오리지널소스영상1·오리지널소스영상3: 본문 구조는 같고 최종 혜택·CTA가 다름",
  "original-source-video-03": "오리지널소스영상1·오리지널소스영상3: 본문 구조는 같고 최종 혜택·CTA가 다름",
};

function section(markdown, heading) {
  const startToken = `## ${heading}`;
  const start = markdown.indexOf(startToken);
  if (start < 0) return "";
  const contentStart = markdown.indexOf("\n", start + startToken.length) + 1;
  const next = markdown.indexOf("\n## ", contentStart);
  return markdown.slice(contentStart, next < 0 ? markdown.length : next).trim();
}

function bulletValue(markdown, label) {
  const match = markdown.match(new RegExp(`^- ${label}:\\s*(.+)$`, "mu"));
  return match?.[1]?.replace(/^`|`$/gu, "").trim() || "";
}

function numberedItems(markdownSection) {
  return markdownSection
    .split(/\r?\n/u)
    .map((line) => line.match(/^\d+\.\s+(.+)$/u)?.[1]?.trim())
    .filter(Boolean);
}

function bulletItems(markdownSection) {
  return markdownSection
    .split(/\r?\n/u)
    .map((line) => line.match(/^-\s+(.+)$/u)?.[1]?.trim())
    .filter(Boolean);
}

function readScenes(csvPath, slug) {
  const workbook = XLSX.readFile(csvPath, { raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
  return rows.map((row) => {
    const number = Number(row["장면번호"]);
    if (!Number.isInteger(number) || number < 1) {
      throw new Error(`Invalid scene number in ${csvPath}`);
    }
    return {
      number,
      timing: String(row["대표구간"]).trim(),
      captureTime: String(row["대표캡처시각"]).trim(),
      caption: String(row["화면자막"]).trim(),
      scene: String(row["영상장면 설명"]).trim(),
      role: String(row["구성 역할"]).trim(),
      analysis: String(row["분석"]).trim(),
      capturePath: `/video-planning-references/${slug}/scene-${String(number).padStart(2, "0")}.jpg`,
    };
  });
}

function buildReference(source) {
  const sourceDirectory = path.join(workspace, "data/video-planning-references", source.slug);
  const analysisPath = path.join(sourceDirectory, "source-analysis.md");
  const csvPath = path.join(sourceDirectory, "source-scenes.csv");
  const markdown = fs.readFileSync(analysisPath, "utf8").replace(/^\uFEFF/u, "");
  const heading = markdown.match(/^#\s+(.+)$/mu)?.[1]?.trim() || source.slug;
  const duration = Number.parseFloat(bulletValue(markdown, "재생 시간").replace(/초$/u, ""));
  const expectedSceneCount = Number.parseInt(
    bulletValue(markdown, "분리한 자막·장면 구간").replace(/개$/u, ""),
    10
  );
  const automationSection =
    section(markdown, "이 영상에서 자동화에 가져갈 규칙") ||
    section(markdown, "애드아틀란티스에 적용할 레퍼런스 규칙") ||
    section(markdown, "애드아틀란티스에 가져갈 패턴");
  const scenes = readScenes(csvPath, source.slug);
  if (!Number.isFinite(duration) || scenes.length !== expectedSceneCount) {
    throw new Error(
      `${source.slug}: metadata=${expectedSceneCount}, csv=${scenes.length}, duration=${duration}`
    );
  }
  for (const scene of scenes) {
    const captureFile = path.join(
      workspace,
      "public",
      scene.capturePath.replace(/^\//u, "")
    );
    if (!fs.existsSync(captureFile)) throw new Error(`Missing capture: ${captureFile}`);
  }
  return {
    id: source.id,
    slug: source.slug,
    blueprintId: source.blueprintId,
    title: heading.replace(/\s+—\s+자막·영상 장면 상세 분석$/u, ""),
    sourceFile: bulletValue(markdown, "원본 파일"),
    sourceArtifact: source.sourceArtifact || "전체_영상레퍼런스_분석_21개 (1).zip",
    format: bulletValue(markdown, "분류"),
    duration,
    resolution: bulletValue(markdown, "화면 비율·해상도"),
    fixedHook: bulletValue(markdown, "전 구간 상단 고정 문구") || undefined,
    sceneCount: scenes.length,
    structureAnalysis: section(markdown, "전체 구조 분석"),
    similarityAnalysis: section(markdown, "유사 영상 비교") || undefined,
    relationshipNotes: relationshipNotes[source.slug]
      ? [relationshipNotes[source.slug]]
      : [],
    automationRules: numberedItems(automationSection),
    riskNotes: bulletItems(section(markdown, "사실 검증·표현 위험")),
    sourceAnalysisPath: `/data/video-planning-references/${source.slug}/source-analysis.md`,
    sourceScenesPath: `/data/video-planning-references/${source.slug}/source-scenes.csv`,
    scenes,
  };
}

const references = sources.map(buildReference);
const totalScenes = references.reduce((sum, reference) => sum + reference.scenes.length, 0);
if (references.length !== 22 || totalScenes !== 617) {
  throw new Error(`Expected 22 references / 617 scenes, got ${references.length} / ${totalScenes}`);
}

const outputPath = path.join(workspace, "data/video-planning-references/library.json");
fs.writeFileSync(outputPath, `${JSON.stringify(references, null, 2)}\n`);
process.stdout.write(`Wrote ${references.length} references and ${totalScenes} exact scenes to ${outputPath}\n`);
