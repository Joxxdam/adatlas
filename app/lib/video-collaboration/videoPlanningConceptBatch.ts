import { VIDEO_CONCEPT_ARCHETYPES, type VideoConceptArchetype } from "./types.ts";

type ArchetypedConcept = { conceptArchetype: VideoConceptArchetype };

export const REQUIRED_VIDEO_CONCEPT_ARCHETYPES = [...VIDEO_CONCEPT_ARCHETYPES];

const MAX_TARGETED_REPAIR_ROUNDS = 2;
const DEFAULT_CONCEPT_CONCURRENCY = 2;

function uniqueArchetypes(values: VideoConceptArchetype[]) {
  return [...new Set(values)].filter((value) =>
    REQUIRED_VIDEO_CONCEPT_ARCHETYPES.includes(value)
  );
}

function canonicalizeRows<T extends ArchetypedConcept>(rows: T[]) {
  return REQUIRED_VIDEO_CONCEPT_ARCHETYPES.flatMap((archetype) => {
    const row = rows.find((item) => item.conceptArchetype === archetype);
    return row ? [row] : [];
  });
}

function missingArchetypes(rows: ArchetypedConcept[]) {
  const present = new Set(rows.map((row) => row.conceptArchetype));
  return REQUIRED_VIDEO_CONCEPT_ARCHETYPES.filter((archetype) => !present.has(archetype));
}

export class VideoConceptBatchValidationError<T extends ArchetypedConcept = ArchetypedConcept> extends Error {
  readonly invalidArchetypes: VideoConceptArchetype[];
  readonly missingArchetypes: VideoConceptArchetype[];
  readonly repairRounds: number;
  readonly preservedRows: T[];
  readonly requestFailures: Array<{
    archetype: VideoConceptArchetype;
    error: unknown;
  }>;

  constructor(input: {
    invalidArchetypes: VideoConceptArchetype[];
    missingArchetypes: VideoConceptArchetype[];
    repairRounds: number;
    preservedRows?: T[];
    requestFailures?: Array<{
      archetype: VideoConceptArchetype;
      error: unknown;
    }>;
  }) {
    super("CONCEPTS_NOT_DISTINCT");
    this.name = "VideoConceptBatchValidationError";
    this.invalidArchetypes = uniqueArchetypes(input.invalidArchetypes);
    this.missingArchetypes = uniqueArchetypes(input.missingArchetypes);
    this.repairRounds = input.repairRounds;
    this.preservedRows = input.preservedRows || [];
    this.requestFailures = input.requestFailures || [];
  }
}

async function mapSettledWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  task: (item: TInput, index: number) => Promise<TOutput>,
  onSettled?: (
    result: PromiseSettledResult<TOutput>,
    item: TInput,
    index: number
  ) => void | Promise<void>
) {
  const results: PromiseSettledResult<TOutput>[] = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(
    1,
    Math.min(items.length || 1, Math.floor(concurrency) || DEFAULT_CONCEPT_CONCURRENCY)
  );
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        let result: PromiseSettledResult<TOutput>;
        try {
          result = {
            status: "fulfilled",
            value: await task(items[index], index),
          };
        } catch (reason) {
          result = { status: "rejected", reason };
        }
        results[index] = result;
        await onSettled?.(result, items[index], index);
      }
    })
  );
  return results;
}

function analyzeArchetypes(rows: ArchetypedConcept[]) {
  const counts = new Map<VideoConceptArchetype, number>();
  for (const row of rows) counts.set(row.conceptArchetype, (counts.get(row.conceptArchetype) || 0) + 1);
  const missing = REQUIRED_VIDEO_CONCEPT_ARCHETYPES.filter((archetype) => !counts.has(archetype));
  const duplicateIndexes = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }, index, all) => all.findIndex((item) => item.row.conceptArchetype === row.conceptArchetype) !== index)
    .map(({ index }) => index);
  return { counts, missing, duplicateIndexes };
}

export function hasExactVideoConceptArchetypes(rows: ArchetypedConcept[]) {
  const { counts, missing } = analyzeArchetypes(rows);
  return rows.length === REQUIRED_VIDEO_CONCEPT_ARCHETYPES.length && missing.length === 0 && REQUIRED_VIDEO_CONCEPT_ARCHETYPES.every((archetype) => counts.get(archetype) === 1);
}

/**
 * Keeps valid concepts from the first batch and repairs only missing,
 * duplicated or validator-rejected archetypes. Repairs in one round run in
 * parallel so targeted quality correction does not become a serial timeout.
 */
export async function requestFourVideoConcepts<T extends ArchetypedConcept>(input: {
  requestBatch: () => Promise<T[]>;
  requestOne: (
    archetype: VideoConceptArchetype,
    correction: string,
    preservedRows: T[]
  ) => Promise<T>;
  findInvalidArchetypes?: (rows: T[]) => VideoConceptArchetype[];
  initialStrategy?: "batch" | "per-archetype";
  concurrency?: number;
  onProgress?: (state: {
    preservedRows: T[];
    unresolvedArchetypes: VideoConceptArchetype[];
    repairRounds: number;
  }) => void | Promise<void>;
}) {
  const concurrency = Math.max(
    1,
    Math.min(
      REQUIRED_VIDEO_CONCEPT_ARCHETYPES.length,
      Math.floor(input.concurrency || DEFAULT_CONCEPT_CONCURRENCY)
    )
  );
  const persistEachSettledConcept = input.initialStrategy === "per-archetype";
  const requestFailures = new Map<VideoConceptArchetype, unknown>();
  let rows: T[] = [];
  let invalidArchetypes: VideoConceptArchetype[] = [];
  let repairRounds = 0;
  let progressWrites = Promise.resolve();

  const currentState = () => {
    const missing = missingArchetypes(rows);
    const unresolved = uniqueArchetypes([...missing, ...invalidArchetypes]);
    const unresolvedSet = new Set(unresolved);
    return {
      missing,
      unresolved,
      preserved: rows.filter((row) => !unresolvedSet.has(row.conceptArchetype)),
    };
  };

  const reportProgress = () => {
    invalidArchetypes = uniqueArchetypes(input.findInvalidArchetypes?.(rows) || []);
    const state = currentState();
    const snapshot = {
      preservedRows: [...state.preserved],
      unresolvedArchetypes: [...state.unresolved],
      repairRounds,
    };
    // Concurrent requests can finish almost together. Serialize persistence
    // with immutable snapshots so an older one can never overwrite a newer one.
    progressWrites = progressWrites.then(async () => {
      await input.onProgress?.(snapshot);
    });
    return progressWrites.then(() => state);
  };

  if (input.initialStrategy === "per-archetype") {
    const initialArchetypes = [...REQUIRED_VIDEO_CONCEPT_ARCHETYPES];
    await mapSettledWithConcurrency(
      initialArchetypes,
      concurrency,
      (archetype) =>
        input.requestOne(
          archetype,
          `이 ${archetype} 유형의 최초 기획안을 작성합니다. 나머지 세 유형과 인물·세계·사건·상품 등장·핵심 소구·결말·화면 스타일이 겹치지 않도록 유형 고유의 문법을 선명하게 적용하세요.`,
          []
        ),
      async (result, requested) => {
        if (result.status === "fulfilled" && result.value.conceptArchetype === requested) {
          rows = canonicalizeRows([
            ...rows.filter((row) => row.conceptArchetype !== requested),
            result.value,
          ]);
          requestFailures.delete(requested);
        } else {
          requestFailures.set(
            requested,
            result.status === "rejected"
              ? result.reason
              : new Error(`요청한 ${requested} 유형과 다른 응답을 받았습니다.`)
          );
        }
        // A slow or failed sibling must not hide a concept that has already
        // passed the current quality gate.
        await reportProgress();
      }
    );
  } else {
    rows = canonicalizeRows(await input.requestBatch());
  }
  invalidArchetypes = uniqueArchetypes(input.findInvalidArchetypes?.(rows) || []);

  let state = currentState();
  if (persistEachSettledConcept) {
    await progressWrites;
  } else {
    await input.onProgress?.({
      preservedRows: [...state.preserved],
      unresolvedArchetypes: [...state.unresolved],
      repairRounds,
    });
  }

  while (
    state.unresolved.length > 0 &&
    repairRounds < MAX_TARGETED_REPAIR_ROUNDS
  ) {
    repairRounds += 1;
    const preservedSnapshot = [...state.preserved];
    const attemptedArchetypes = [...state.unresolved];
    const handleSettledRepair = async (
      result: PromiseSettledResult<T>,
      requested: VideoConceptArchetype
    ) => {
      if (result.status === "fulfilled" && result.value.conceptArchetype === requested) {
        rows = canonicalizeRows([
          ...rows.filter((row) => row.conceptArchetype !== requested),
          result.value,
        ]);
        requestFailures.delete(requested);
      } else {
        requestFailures.set(
          requested,
          result.status === "rejected"
            ? result.reason
            : new Error(`요청한 ${requested} 유형과 다른 응답을 받았습니다.`)
        );
      }
      if (persistEachSettledConcept) await reportProgress();
    };
    const settled = await mapSettledWithConcurrency(
      attemptedArchetypes,
      concurrency,
      (archetype) =>
        input.requestOne(
          archetype,
          `첫 응답에서 누락·중복되었거나 서버 검수에서 이 ${archetype} 기획안만 부적합했습니다. 검수를 통과한 다른 유형은 그대로 보존합니다. 다른 기획안과 첫 자막·특정 인물·관계·사회 또는 시대·중심 사건·갈등·상품 등장·핵심 소구·결말·화면 스타일이 겹치지 않도록 이 유형만 다시 작성하세요. 일반 사용자·일상 공간처럼 요약하지 말고 현재 상품에만 맞는 distinctiveCharacter, socialWorld, storyTrigger, truthBridge와 창작/상품사실 경계를 모두 구체적으로 작성하세요.`,
          preservedSnapshot
        ),
      persistEachSettledConcept ? handleSettledRepair : undefined
    );
    if (!persistEachSettledConcept) {
      for (let index = 0; index < settled.length; index += 1) {
        await handleSettledRepair(settled[index], attemptedArchetypes[index]);
      }
    }
    invalidArchetypes = uniqueArchetypes(input.findInvalidArchetypes?.(rows) || []);
    state = currentState();
    if (persistEachSettledConcept) {
      await progressWrites;
    } else {
      await input.onProgress?.({
        preservedRows: [...state.preserved],
        unresolvedArchetypes: [...state.unresolved],
        repairRounds,
      });
    }
  }

  const missing = state.missing;
  if (!hasExactVideoConceptArchetypes(rows) || invalidArchetypes.length) {
    throw new VideoConceptBatchValidationError({
      invalidArchetypes,
      missingArchetypes: missing,
      repairRounds,
      preservedRows: state.preserved,
      requestFailures: [...requestFailures.entries()]
        .filter(([archetype]) => state.unresolved.includes(archetype))
        .map(([archetype, error]) => ({ archetype, error })),
    });
  }
  return REQUIRED_VIDEO_CONCEPT_ARCHETYPES.map(
    (archetype) => rows.find((row) => row.conceptArchetype === archetype) as T
  );
}
