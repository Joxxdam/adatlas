import type {
  VideoConcept,
  VideoCut,
  VideoDuration,
  VideoProject,
  VideoSceneReferenceImage,
} from "./types.ts";

function cleanText(value: unknown, max = 5000) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, max);
}

function normalizeReferenceImage(value: Partial<VideoSceneReferenceImage>) {
  return {
    id: cleanText(value.id, 120),
    source: value.source === "external" ? "external" : "upload",
    filePath: cleanText(value.filePath, 2400),
    name: cleanText(value.name, 240) || "참고 이미지",
    mimeType: cleanText(value.mimeType, 120),
    size: Number.isFinite(value.size) ? Math.max(0, Number(value.size)) : 0,
    description: cleanText(value.description, 500),
    required: Boolean(value.required),
    createdAt: cleanText(value.createdAt, 80) || new Date().toISOString(),
  } satisfies VideoSceneReferenceImage;
}

export function normalizeVideoCut(cut: Partial<VideoCut>, index: number): VideoCut {
  const cutNumber = index + 1;
  return {
    id: cleanText(cut.id, 120) || `legacy-cut-${cutNumber}`,
    cutNumber,
    sceneName: cleanText(cut.sceneName, 160) || `장면 ${cutNumber}`,
    startSecond: Number.isFinite(cut.startSecond) ? Number(cut.startSecond) : 0,
    endSecond: Number.isFinite(cut.endSecond) ? Number(cut.endSecond) : 0,
    sceneDescription: cleanText(cut.sceneDescription, 5000),
    caption: cleanText(cut.caption, 2000),
    narration: cleanText(cut.narration, 3000),
    requiredSources: Array.isArray(cut.requiredSources)
      ? cut.requiredSources
          .map((item) => cleanText(item, 500))
          .filter(Boolean)
          .slice(0, 20)
      : [],
    referenceImages: Array.isArray(cut.referenceImages)
      ? cut.referenceImages
          .map((item) => normalizeReferenceImage(item))
          .filter((item) => item.id && item.filePath)
          .slice(0, 2)
      : [],
    productionMemo: cleanText(cut.productionMemo, 3000),
  };
}

export function resequenceVideoCuts(cuts: VideoCut[], duration: VideoDuration): VideoCut[] {
  const count = Math.max(1, cuts.length);
  return cuts.map((cut, index) => {
    const startSecond = Number(((duration * index) / count).toFixed(2));
    const endSecond =
      index === count - 1 ? duration : Number(((duration * (index + 1)) / count).toFixed(2));
    return {
      ...normalizeVideoCut(cut, index),
      cutNumber: index + 1,
      sceneName:
        !cut.sceneName || /^장면\s*\d+$/u.test(cut.sceneName.trim())
          ? `장면 ${index + 1}`
          : cut.sceneName.trim(),
      startSecond,
      endSecond,
    };
  });
}

export function preserveSceneReferences(next: VideoConcept, previous?: VideoConcept) {
  if (!previous) return next;
  return {
    ...next,
    cuts: next.cuts.map((cut, index) => {
      const before = previous.cuts.find((item) => item.id === cut.id) || previous.cuts[index];
      return {
        ...normalizeVideoCut(cut, index),
        referenceImages: before?.referenceImages || [],
        productionMemo: before?.productionMemo || "",
        sceneName: before?.sceneName || cut.sceneName || `장면 ${index + 1}`,
      };
    }),
  };
}

export function getProjectScript(project: VideoProject) {
  return (
    project.finalScript ||
    project.concepts.find((concept) => concept.id === project.selectedConceptId) ||
    project.concepts[0] ||
    null
  );
}

export function videoScriptClipboard(
  project: VideoProject,
  mode: "all" | "captions" | "scenes" = "all"
) {
  const script = getProjectScript(project);
  if (!script) return "";
  const rows = script.cuts.map((cut) => {
    if (mode === "captions")
      return `${cut.sceneName || `장면 ${cut.cutNumber}`}\n자막: ${cut.caption}`;
    if (mode === "scenes")
      return `${cut.sceneName || `장면 ${cut.cutNumber}`}\n영상 장면: ${cut.sceneDescription}`;
    return [
      cut.sceneName || `장면 ${cut.cutNumber}`,
      `자막: ${cut.caption || "없음"}`,
      `영상 장면: ${cut.sceneDescription || "없음"}`,
      `예상 시간: ${cut.startSecond}-${cut.endSecond}초`,
      `내레이션: ${cut.narration || "없음"}`,
      `필요 소스: ${cut.requiredSources.join(", ") || "없음"}`,
      `추가 제작 메모: ${cut.productionMemo || "없음"}`,
    ].join("\n");
  });
  return [
    `[${script.materialCode}] ${project.projectName}`,
    `${project.advertiserName} · ${project.productAnalysis.productName}`,
    "",
    ...rows.flatMap((row) => [row, ""]),
  ]
    .join("\n")
    .trim();
}
