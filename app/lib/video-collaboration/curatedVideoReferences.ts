import referenceLibrary from "../../../data/video-planning-references/library.json" with { type: "json" };

export type CuratedVideoReferenceScene = {
  number: number;
  timing: string;
  captureTime: string;
  caption: string;
  scene: string;
  role: string;
  analysis: string;
  capturePath: string;
};

export type CuratedVideoReference = {
  id: string;
  slug: string;
  blueprintId: string;
  title: string;
  sourceFile: string;
  sourceArtifact: string;
  format: string;
  duration: number;
  resolution: string;
  fixedHook?: string;
  sceneCount: number;
  structureAnalysis: string;
  similarityAnalysis?: string;
  relationshipNotes: string[];
  automationRules: string[];
  riskNotes: string[];
  sourceAnalysisPath: string;
  sourceScenesPath: string;
  scenes: CuratedVideoReferenceScene[];
};

/**
 * 사용자가 전달한 두 분석 ZIP의 관찰 데이터를 그대로 구조화한 정본입니다.
 * 21개 묶음의 597장면과 별도 오리지널소스1의 20장면을 합친 22개/617장면이며,
 * 요약 블루프린트는 이 원문 데이터를 대신할 수 없습니다.
 */
export const CURATED_VIDEO_REFERENCES: CuratedVideoReference[] = referenceLibrary;

export function getCuratedVideoReference(id?: string) {
  return CURATED_VIDEO_REFERENCES.find((reference) => reference.id === id);
}

export function curatedVideoReferencePrompt(id?: string) {
  const reference = getCuratedVideoReference(id);
  if (!reference) return undefined;
  return {
    id: reference.id,
    title: reference.title,
    sourceFile: reference.sourceFile,
    sourceArtifact: reference.sourceArtifact,
    format: reference.format,
    duration: reference.duration,
    resolution: reference.resolution,
    fixedHook: reference.fixedHook,
    sceneCount: reference.sceneCount,
    sourceStructureAnalysis: reference.structureAnalysis,
    sourceSimilarityAnalysis: reference.similarityAnalysis,
    sourceRelationshipNotes: reference.relationshipNotes,
    sourceAutomationRules: reference.automationRules,
    sourceRiskNotes: reference.riskNotes,
    sourceTranscriptAndScenes: reference.scenes,
    sourceAnalysisPath: reference.sourceAnalysisPath,
    sourceScenesPath: reference.sourceScenesPath,
    instruction:
      "이 레퍼런스를 5단계나 범용 공식으로 축약하지 않는다. sourceTranscriptAndScenes의 모든 장면을 번호 순서대로 읽고, 각 장면의 정확한 자막·화면·역할·분석과 정보 공개 시점, 인물 관계, 갈등의 누적, 첫 사건 회수를 각각 보존해 새 기획에 대응시킨다. 원문의 상품·가격·효능·인물·대사는 복제하지 않고 현재 ProductTruth로 치환하되, 원문보다 일반적인 표현으로 낮추지 않는다. 검증되지 않은 주장은 sourceRiskNotes와 ProductTruth 경계에 따라 제거한다.",
  };
}
