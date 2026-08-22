import { VIDEO_CONCEPT_ARCHETYPES, type VideoConceptArchetype } from "./types.ts";

type ArchetypedConcept = { conceptArchetype: VideoConceptArchetype };

export const REQUIRED_VIDEO_CONCEPT_ARCHETYPES = [...VIDEO_CONCEPT_ARCHETYPES];

function analyzeArchetypes(rows: ArchetypedConcept[]) {
  const counts = new Map<VideoConceptArchetype, number>();
  for (const row of rows)
    counts.set(row.conceptArchetype, (counts.get(row.conceptArchetype) || 0) + 1);
  const missing = REQUIRED_VIDEO_CONCEPT_ARCHETYPES.filter((archetype) => !counts.has(archetype));
  const duplicateIndexes = rows
    .map((row, index) => ({ row, index }))
    .filter(
      ({ row }, index, all) =>
        all.findIndex((item) => item.row.conceptArchetype === row.conceptArchetype) !== index
    )
    .map(({ index }) => index);
  return { counts, missing, duplicateIndexes };
}

export function hasExactVideoConceptArchetypes(rows: ArchetypedConcept[]) {
  const { counts, missing } = analyzeArchetypes(rows);
  return (
    rows.length === REQUIRED_VIDEO_CONCEPT_ARCHETYPES.length &&
    missing.length === 0 &&
    REQUIRED_VIDEO_CONCEPT_ARCHETYPES.every((archetype) => counts.get(archetype) === 1)
  );
}

export async function requestFourVideoConcepts<T extends ArchetypedConcept>(input: {
  requestBatch: () => Promise<T[]>;
  requestOne: (archetype: VideoConceptArchetype, correction: string) => Promise<T>;
  findInvalidArchetypes?: (rows: T[]) => VideoConceptArchetype[];
}) {
  let rows = await input.requestBatch();
  const archetypeState = analyzeArchetypes(rows);
  let invalidArchetypes = input.findInvalidArchetypes?.(rows) || [];
  let replacementArchetype: VideoConceptArchetype | undefined;
  let replacementIndex = -1;

  if (archetypeState.missing.length === 1 && archetypeState.duplicateIndexes.length === 1) {
    replacementArchetype = archetypeState.missing[0];
    replacementIndex = archetypeState.duplicateIndexes[0];
  } else if (hasExactVideoConceptArchetypes(rows) && invalidArchetypes.length === 1) {
    replacementArchetype = invalidArchetypes[0];
    replacementIndex = rows.findIndex((row) => row.conceptArchetype === replacementArchetype);
  }

  if (replacementArchetype && replacementIndex >= 0) {
    const replacement = await input.requestOne(
      replacementArchetype,
      "서버 검수에서 이 기획안 하나만 부적합했습니다. 다른 세 기획안과 첫 자막·중심 사건·화자·갈등·상품 등장·핵심 소구·결말·화면 스타일이 겹치지 않도록 이 유형만 다시 작성하세요."
    );
    rows = rows.map((row, index) => (index === replacementIndex ? replacement : row));
    invalidArchetypes = input.findInvalidArchetypes?.(rows) || [];
  }

  if (!hasExactVideoConceptArchetypes(rows) || invalidArchetypes.length) {
    throw new Error("CONCEPTS_NOT_DISTINCT");
  }
  return REQUIRED_VIDEO_CONCEPT_ARCHETYPES.map(
    (archetype) => rows.find((row) => row.conceptArchetype === archetype) as T
  );
}
