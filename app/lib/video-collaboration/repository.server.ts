import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { VIDEO_CONCEPT_FORMATS } from "./types.ts";
import type {
  CreateVideoProjectInput,
  ReviewComment,
  VideoCollaborationStore,
  VideoConcept,
  VideoProject,
  VideoProjectStatus,
  VideoVersion,
  VideoHookCandidate,
  VideoPipelineProgress,
  ProductLockedAsset,
  ReferenceVideoAnalysis,
  VideoGenerationFailure,
  VideoParodyGenre,
} from "./types.ts";
import { normalizeVideoCut } from "./script.ts";
import { validateConceptDiversity, validateDetailedPlanning } from "./planningValidation.ts";
import { inferVideoParodyGenre } from "./videoParodyGenres.ts";
import {
  assertVideoProjectTransition,
  createVideoMaterialCode,
  newHistoryId,
  validateVideoMaterialCode,
  videoProjectSummary,
} from "./workflow.ts";

function emptyStore(): VideoCollaborationStore {
  return { version: "video-collaboration-v2", projects: [] };
}

const globalVideoQueues = globalThis as typeof globalThis & {
  __adAtlasVideoProjectQueues?: Map<string, Promise<void>>;
};
const repositoryQueues =
  globalVideoQueues.__adAtlasVideoProjectQueues || new Map<string, Promise<void>>();
globalVideoQueues.__adAtlasVideoProjectQueues = repositoryQueues;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function clean(value: unknown, max = 4000) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function normalizeConcept(concept: VideoConcept): VideoConcept {
  const cuts = Array.isArray(concept.cuts)
    ? concept.cuts.map((cut, index) => normalizeVideoCut(cut, index))
    : [];
  const blueprintSelection = concept.blueprintSelection?.primaryId
    ? {
        primaryId: clean(concept.blueprintSelection.primaryId, 120),
        secondaryId: clean(concept.blueprintSelection.secondaryId, 120) || undefined,
        reason: clean(concept.blueprintSelection.reason, 600),
        transferableRules: Array.isArray(concept.blueprintSelection.transferableRules)
          ? concept.blueprintSelection.transferableRules
              .map((rule) => clean(rule, 400))
              .filter(Boolean)
              .slice(0, 8)
          : [],
      }
    : undefined;
  return {
    ...concept,
    cuts,
    detailStatus: concept.detailStatus || (cuts.length >= 15 ? "ready" : "not-generated"),
    evidenceIds: Array.isArray(concept.evidenceIds) ? concept.evidenceIds : [],
    supportingDevices: Array.isArray(concept.supportingDevices) ? concept.supportingDevices : [],
    blueprintSelection,
    parodyGenre:
      concept.conceptArchetype === "parody"
        ? inferVideoParodyGenre(concept)
        : undefined,
  };
}

function normalizeProject(project: VideoProject): VideoProject {
  const createdAt = clean(project.createdAt, 80) || new Date().toISOString();
  return {
    ...project,
    marketerName: clean(project.marketerName, 80) || "마케터",
    designerName: clean(project.designerName, 80) || "디자이너 미지정",
    additionalRequests: clean(project.additionalRequests, 5000),
    requiredContent: clean(project.requiredContent, 3000),
    excludedContent: clean(project.excludedContent, 3000),
    platform: project.platform || "meta",
    aspectRatio: "9:16",
    creativeStyle: project.creativeStyle || "auto",
    planningMode: project.planningMode || "legacy",
    durationMode: project.durationMode || "fixed",
    conceptFormat:
      project.conceptFormat && VIDEO_CONCEPT_FORMATS.includes(project.conceptFormat)
        ? project.conceptFormat
        : undefined,
    advancedTarget: clean(project.advancedTarget, 500),
    advancedTone: clean(project.advancedTone, 500),
    productionNotes: clean(project.productionNotes, 5000),
    deadline: clean(project.deadline, 40),
    concepts: Array.isArray(project.concepts)
      ? project.concepts.map((concept) => normalizeConcept(concept))
      : [],
    hookCandidates: Array.isArray(project.hookCandidates) ? project.hookCandidates : [],
    pipelineProgress: Array.isArray(project.pipelineProgress) ? project.pipelineProgress : [],
    referenceAnalyses: Array.isArray(project.referenceAnalyses) ? project.referenceAnalyses : [],
    finalScript: project.finalScript ? normalizeConcept(project.finalScript) : undefined,
    scriptRevisions: Array.isArray(project.scriptRevisions)
      ? project.scriptRevisions.map((revision) => ({
          ...revision,
          snapshot: normalizeConcept(revision.snapshot),
        }))
      : [],
    versions: Array.isArray(project.versions) ? project.versions : [],
    comments: Array.isArray(project.comments) ? project.comments : [],
    statusHistory: Array.isArray(project.statusHistory) ? project.statusHistory : [],
    designerAssignmentHistory: Array.isArray(project.designerAssignmentHistory)
      ? project.designerAssignmentHistory
      : [],
    milestones: project.milestones || {},
    scriptLastEditedBy: clean(project.scriptLastEditedBy, 80) || "시스템",
    createdAt,
    updatedAt: clean(project.updatedAt, 80) || createdAt,
  };
}

function uniqueMaterialCode(project: VideoProject, code: string, conceptId?: string) {
  if (!validateVideoMaterialCode(code)) throw new Error("영상 소재코드 형식이 올바르지 않습니다.");
  if (project.concepts.some((item) => item.id !== conceptId && item.materialCode === code)) {
    throw new Error("이 프로젝트에서 이미 사용 중인 소재코드입니다.");
  }
}

function conceptText(concept: VideoConcept) {
  return [
    concept.title,
    concept.coreTarget,
    concept.openingHook,
    concept.fullScript,
    concept.cta,
    ...concept.requiredSources,
    ...concept.cuts.flatMap((cut) => [
      cut.sceneDescription,
      cut.caption,
      cut.narration,
      ...cut.requiredSources,
    ]),
  ].join(" ");
}

function validateConceptForProject(project: VideoProject, concept: VideoConcept) {
  uniqueMaterialCode(project, concept.materialCode, concept.id);
  if (!clean(concept.title) || !clean(concept.openingHook) || !clean(concept.fullScript))
    throw new Error("기획안 제목, 첫 3초 후킹, 전체 대본을 모두 입력해 주세요.");
  if (!clean(concept.cta)) throw new Error("마지막 CTA를 입력해 주세요.");
  if (!Array.isArray(concept.cuts) || concept.cuts.length < 1 || concept.cuts.length > 40)
    throw new Error("장면 구성은 1개부터 40개까지 저장할 수 있습니다.");
  const ordered = [...concept.cuts].sort((left, right) => left.cutNumber - right.cutNumber);
  for (let index = 0; index < ordered.length; index += 1) {
    const cut = ordered[index];
    if (
      !Number.isFinite(cut.startSecond) ||
      !Number.isFinite(cut.endSecond) ||
      cut.startSecond < 0 ||
      cut.endSecond <= cut.startSecond ||
      cut.endSecond > project.duration
    ) {
      throw new Error(`컷 ${cut.cutNumber}의 시간 구간이 올바르지 않습니다.`);
    }
    if (index > 0 && cut.startSecond < ordered[index - 1].endSecond)
      throw new Error("컷 시간 구간이 서로 겹칩니다.");
    if (!clean(cut.sceneDescription) || !clean(cut.caption))
      throw new Error(`컷 ${cut.cutNumber}의 장면 설명과 자막을 입력해 주세요.`);
    if (!Array.isArray(cut.referenceImages) || cut.referenceImages.length > 2)
      throw new Error(`장면 ${cut.cutNumber}의 참고 이미지는 최대 2개까지 저장할 수 있습니다.`);
    for (const image of cut.referenceImages) {
      if (!clean(image.id, 120) || !clean(image.filePath, 2400))
        throw new Error(`장면 ${cut.cutNumber}의 참고 이미지 정보가 올바르지 않습니다.`);
      if (image.source === "external") {
        let referenceUrl: URL;
        try {
          referenceUrl = new URL(image.filePath);
        } catch {
          throw new Error(`장면 ${cut.cutNumber}의 외부 이미지 URL이 올바르지 않습니다.`);
        }
        if (!["http:", "https:"].includes(referenceUrl.protocol))
          throw new Error("외부 참고 이미지는 HTTP 또는 HTTPS URL만 지원합니다.");
      } else if (!image.filePath.startsWith("/video-collaboration/script-references/")) {
        throw new Error(`장면 ${cut.cutNumber}의 업로드 이미지 경로가 올바르지 않습니다.`);
      }
    }
  }
  if (ordered.at(-1)?.endSecond !== project.duration)
    throw new Error(`마지막 컷의 종료 시간을 ${project.duration}초로 맞춰 주세요.`);
  const text = conceptText(concept);
  const forbidden = project.brandGuideline.forbiddenPhrases.find(
    (phrase) => clean(phrase, 120) && text.includes(clean(phrase, 120))
  );
  if (forbidden) throw new Error(`금지 문구 “${forbidden}”을(를) 제거해 주세요.`);
}

export function createVideoProjectRepository(options: { dataDirectory?: string } = {}) {
  const dataDirectory =
    options.dataDirectory || path.join(process.cwd(), "data", "video-collaboration");
  const storePath = path.join(dataDirectory, "projects.json");
  if (!repositoryQueues.has(storePath)) repositoryQueues.set(storePath, Promise.resolve());

  async function readStore(): Promise<VideoCollaborationStore> {
    try {
      const parsed = JSON.parse(
        await fs.readFile(storePath, "utf8")
      ) as Partial<VideoCollaborationStore>;
      return {
        ...emptyStore(),
        projects: Array.isArray(parsed.projects)
          ? parsed.projects.map((project) => normalizeProject(project))
          : [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
      throw new Error("영상 협업 저장 데이터를 불러오지 못했습니다.");
    }
  }

  async function writeStore(store: VideoCollaborationStore) {
    await fs.mkdir(dataDirectory, { recursive: true });
    const temporary = `${storePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    await fs.rename(temporary, storePath);
  }

  function locked<T>(operation: (store: VideoCollaborationStore) => T | Promise<T>) {
    const queue = repositoryQueues.get(storePath) || Promise.resolve();
    const next = queue.then(async () => {
      const store = await readStore();
      const result = await operation(store);
      await writeStore(store);
      return result;
    });
    repositoryQueues.set(
      storePath,
      next.then(
        () => undefined,
        () => undefined
      )
    );
    return next;
  }

  function update(projectId: string, updater: (project: VideoProject) => void) {
    return locked((store) => {
      const index = store.projects.findIndex((item) => item.id === projectId);
      if (index < 0) throw new Error("영상 프로젝트를 찾지 못했습니다.");
      const project = clone(store.projects[index]);
      updater(project);
      project.updatedAt = new Date().toISOString();
      store.projects[index] = project;
      return clone(project);
    });
  }

  function transition(project: VideoProject, to: VideoProjectStatus, actor: string, note: string) {
    assertVideoProjectTransition(project.status, to);
    if (project.status === to) return;
    const from = project.status;
    project.status = to;
    project.statusHistory.push({
      id: newHistoryId(),
      from,
      to,
      actor: clean(actor, 80) || "사용자",
      note: clean(note, 500),
      changedAt: new Date().toISOString(),
    });
  }

  return {
    async list() {
      const store = await readStore();
      return [...store.projects]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map(videoProjectSummary);
    },

    async get(projectId: string) {
      const project = (await readStore()).projects.find((item) => item.id === projectId);
      return project ? clone(project) : null;
    },

    async recentParodyGenres(options: {
      excludeProjectId?: string;
      advertiserName?: string;
      limit?: number;
    } = {}) {
      const advertiser = clean(options.advertiserName, 120).toLowerCase();
      const store = await readStore();
      const projects = [...store.projects]
        .filter((project) => project.id !== options.excludeProjectId)
        .sort((left, right) => {
          const leftAdvertiser = advertiser && clean(left.advertiserName, 120).toLowerCase() === advertiser ? 1 : 0;
          const rightAdvertiser = advertiser && clean(right.advertiserName, 120).toLowerCase() === advertiser ? 1 : 0;
          return rightAdvertiser - leftAdvertiser || right.updatedAt.localeCompare(left.updatedAt);
        });
      const genres: VideoParodyGenre[] = [];
      for (const project of projects) {
        const parody = project.concepts.find((concept) => concept.conceptArchetype === "parody");
        const genre = parody ? inferVideoParodyGenre(parody) : undefined;
        if (genre) genres.push(genre);
        if (genres.length >= Math.max(1, Math.min(10, options.limit || 5))) break;
      }
      return genres;
    },

    async create(input: CreateVideoProjectInput) {
      validateCreateVideoProjectInput(input);
      return locked((store) => {
        const now = new Date().toISOString();
        const project: VideoProject = {
          id: `video-${crypto.randomUUID()}`,
          projectName: clean(input.projectName, 140),
          advertiserName: clean(input.advertiserName, 120),
          productUrl: clean(input.productUrl, 2000),
          marketerName: clean(input.marketerName, 80) || "마케터",
          designerName: clean(input.designerName, 80),
          duration: input.duration,
          format: input.format,
          objective: input.objective,
          platform: input.platform || "meta",
          aspectRatio: "9:16",
          creativeStyle: input.creativeStyle || "auto",
          planningMode: input.planningMode || "legacy",
          durationMode: input.durationMode || "fixed",
          conceptFormat: input.conceptFormat,
          advancedTarget: clean(input.advancedTarget, 500),
          advancedTone: clean(input.advancedTone, 500),
          additionalRequests: clean(input.additionalRequests, 5000),
          requiredContent: clean(input.requiredContent, 3000),
          excludedContent: clean(input.excludedContent, 3000),
          productionNotes: "",
          deadline: clean(input.deadline, 40),
          referenceAssets: clone(input.referenceAssets || []),
          productOriginalAsset: input.productOriginalAsset
            ? clone(input.productOriginalAsset)
            : undefined,
          productLockedAsset: undefined,
          referenceAnalyses: [],
          productAnalysis: clone(input.productAnalysis),
          brandGuideline: clone(input.brandGuideline),
          status: "script_pending",
          concepts: [],
          hookCandidates: [],
          pipelineProgress: [],
          scriptRevisions: [],
          versions: [],
          comments: [],
          statusHistory: [
            {
              id: newHistoryId(),
              from: null,
              to: "script_pending",
              actor: "시스템",
              note: "영상 프로젝트 생성",
              changedAt: now,
            },
          ],
          designerAssignmentHistory: [],
          milestones: {},
          scriptLastEditedBy: "시스템",
          createdAt: now,
          updatedAt: now,
        };
        store.projects.push(project);
        return clone(project);
      });
    },

    async updateDetails(
      projectId: string,
      changes: Partial<
        Pick<
          VideoProject,
          | "projectName"
          | "advertiserName"
          | "marketerName"
          | "designerName"
          | "additionalRequests"
          | "requiredContent"
          | "excludedContent"
          | "productionNotes"
          | "deadline"
          | "productAnalysis"
          | "brandGuideline"
        >
      >
    ) {
      return update(projectId, (project) => {
        if (changes.projectName !== undefined)
          project.projectName = clean(changes.projectName, 140);
        if (changes.advertiserName !== undefined)
          project.advertiserName = clean(changes.advertiserName, 120);
        if (changes.marketerName !== undefined)
          project.marketerName = clean(changes.marketerName, 80) || "마케터";
        if (changes.designerName !== undefined) {
          const nextDesigner = clean(changes.designerName, 80);
          if (nextDesigner !== project.designerName) {
            project.designerAssignmentHistory ||= [];
            project.designerAssignmentHistory.push({
              id: crypto.randomUUID(),
              previousDesigner: project.designerName,
              nextDesigner,
              changedBy: clean(changes.marketerName, 80) || project.marketerName || "사용자",
              changedAt: new Date().toISOString(),
            });
            project.designerName = nextDesigner;
          }
        }
        if (changes.additionalRequests !== undefined)
          project.additionalRequests = clean(changes.additionalRequests, 5000);
        if (changes.requiredContent !== undefined)
          project.requiredContent = clean(changes.requiredContent, 3000);
        if (changes.excludedContent !== undefined)
          project.excludedContent = clean(changes.excludedContent, 3000);
        if (changes.productionNotes !== undefined)
          project.productionNotes = clean(changes.productionNotes, 5000);
        if (changes.deadline !== undefined) project.deadline = clean(changes.deadline, 40);
        if (changes.productAnalysis) {
          if (!clean(changes.productAnalysis.productName))
            throw new Error("분석 상품명을 입력해 주세요.");
          project.productAnalysis = clone(changes.productAnalysis);
        }
        if (changes.brandGuideline) project.brandGuideline = clone(changes.brandGuideline);
      });
    },

    async saveConceptSummaries(
      projectId: string,
      concepts: VideoConcept[],
      options: {
        actor?: string;
        hookCandidates?: VideoHookCandidate[];
        referenceAnalyses?: ReferenceVideoAnalysis[];
        replaceConceptId?: string;
      } = {}
    ) {
      return update(projectId, (project) => {
        if (!concepts.length) throw new Error("저장할 영상 기획안 요약이 없습니다.");
        const incomingCodes = new Set<string>();
        for (const concept of concepts) {
          uniqueMaterialCode(project, concept.materialCode, concept.id);
          if (incomingCodes.has(concept.materialCode)) {
            throw new Error("생성된 기획안 사이에 중복 소재코드가 있습니다.");
          }
          incomingCodes.add(concept.materialCode);
          if (!clean(concept.title) || !clean(concept.openingHook) || !clean(concept.cta)) {
            throw new Error("기획안 요약의 제목, 후킹, CTA를 확인해 주세요.");
          }
          if (concept.cuts.length)
            throw new Error("요약 단계에는 상세 대본을 함께 저장하지 않습니다.");
        }
        if (
          project.planningMode === "four-concepts" &&
          !options.replaceConceptId &&
          (concepts.length !== 4 || !validateConceptDiversity(concepts).valid)
        ) {
          throw new Error("사건·상황극·리얼 사용·USP·시크릿 혜택의 서로 다른 기획안 4개가 필요합니다.");
        }
        if (
          project.planningMode !== "four-concepts" &&
          !options.replaceConceptId &&
          concepts.length > 1 &&
          !validateConceptDiversity(concepts).valid
        ) {
          throw new Error("서로 다른 후킹 유형과 광고 가설의 기획안이 필요합니다.");
        }
        if (options.replaceConceptId) {
          const index = project.concepts.findIndex(
            (concept) => concept.id === options.replaceConceptId
          );
          if (index < 0) throw new Error("다시 생성할 기획안을 찾지 못했습니다.");
          project.concepts[index] = clone({
            ...concepts[0],
            id: project.concepts[index].id,
            materialCode: project.concepts[index].materialCode,
          });
        } else {
          project.concepts = clone(concepts);
          project.selectedConceptId = undefined;
          project.finalScript = undefined;
        }
        if (options.hookCandidates) project.hookCandidates = clone(options.hookCandidates);
        if (options.referenceAnalyses) project.referenceAnalyses = clone(options.referenceAnalyses);
        project.generationFailure = undefined;
        if (project.status === "script_pending") {
          transition(
            project,
            "script_review",
            "시스템",
            concepts.length === 1
              ? "선택한 영상 콘셉트 기획안 생성"
              : `후킹 평가 및 기획안 요약 ${concepts.length}개 생성`
          );
        } else if (project.status === "concept_selected") {
          transition(project, "script_review", options.actor || "사용자", "기획안 요약 다시 생성");
        }
        project.scriptLastEditedBy = clean(options.actor, 80) || "시스템";
      });
    },

    async savePlanningIntermediates(
      projectId: string,
      options: {
        hookCandidates?: VideoHookCandidate[];
        referenceAnalyses?: ReferenceVideoAnalysis[];
      }
    ) {
      return update(projectId, (project) => {
        if (options.hookCandidates) project.hookCandidates = clone(options.hookCandidates);
        if (options.referenceAnalyses) project.referenceAnalyses = clone(options.referenceAnalyses);
      });
    },

    async saveGenerationFailure(
      projectId: string,
      failure: VideoGenerationFailure,
      options: { conceptId?: string } = {}
    ) {
      return update(projectId, (project) => {
        project.generationFailure = clone(failure);
        if (options.conceptId) {
          const concept = project.concepts.find((item) => item.id === options.conceptId);
          if (concept) {
            concept.detailStatus = "failed";
            concept.generationFailure = clone(failure);
          }
        }
      });
    },

    async updatePipelineProgress(projectId: string, progress: VideoPipelineProgress[]) {
      return update(projectId, (project) => {
        project.pipelineProgress = clone(progress);
      });
    },

    async saveGeneratedConcepts(
      projectId: string,
      concepts: VideoConcept[],
      options: {
        conceptId?: string;
        actor?: string;
        hookCandidates?: VideoHookCandidate[];
        pipelineProgress?: VideoPipelineProgress[];
        productLockedAsset?: ProductLockedAsset;
        referenceAnalyses?: ReferenceVideoAnalysis[];
      } = {}
    ) {
      return update(projectId, (project) => {
        if (!concepts.length) throw new Error("저장할 영상 기획안이 없습니다.");
        const incomingCodes = new Set<string>();
        for (const concept of concepts) {
          validateConceptForProject(project, concept);
          if (incomingCodes.has(concept.materialCode))
            throw new Error("생성된 기획안 사이에 중복 소재코드가 있습니다.");
          incomingCodes.add(concept.materialCode);
        }
        if (options.conceptId) {
          const index = project.concepts.findIndex((item) => item.id === options.conceptId);
          if (index < 0) throw new Error("다시 생성할 기획안을 찾지 못했습니다.");
          project.scriptRevisions.push({
            id: crypto.randomUUID(),
            conceptId: project.concepts[index].id,
            revision: project.concepts[index].revision,
            changedAt: new Date().toISOString(),
            changedBy: clean(options.actor, 80) || "사용자",
            reason: "regenerated",
            snapshot: clone(project.concepts[index]),
          });
          project.concepts[index] = clone(concepts[0]);
        } else {
          project.concepts = clone(concepts);
          project.scriptRevisions.push(
            ...concepts.map((concept) => ({
              id: crypto.randomUUID(),
              conceptId: concept.id,
              revision: concept.revision,
              changedAt: new Date().toISOString(),
              changedBy: "시스템",
              reason: "generated" as const,
              stage: "ai-generated" as const,
              snapshot: clone(concept),
            }))
          );
        }
        if (project.status === "script_pending") {
          transition(project, "script_review", "시스템", "서로 다른 후킹 기획안 생성");
        }
        project.milestones.scriptCreatedAt ||= new Date().toISOString();
        if (options.hookCandidates) project.hookCandidates = clone(options.hookCandidates);
        if (options.pipelineProgress) project.pipelineProgress = clone(options.pipelineProgress);
        if (options.productLockedAsset)
          project.productLockedAsset = clone(options.productLockedAsset);
        if (options.referenceAnalyses) project.referenceAnalyses = clone(options.referenceAnalyses);
        project.generationFailure = undefined;
        project.scriptLastEditedBy = clean(options.actor, 80) || "시스템";
      });
    },

    async updateConcept(
      projectId: string,
      conceptId: string,
      concept: VideoConcept,
      actor: string
    ) {
      return update(projectId, (project) => {
        if (!["script_review", "concept_selected"].includes(project.status))
          throw new Error("대본 검토 중에만 기획안을 수정할 수 있습니다.");
        const index = project.concepts.findIndex((item) => item.id === conceptId);
        if (index < 0) throw new Error("수정할 기획안을 찾지 못했습니다.");
        const previous = project.concepts[index];
        validateConceptForProject(project, {
          ...concept,
          id: conceptId,
          hookType: previous.hookType,
        });
        project.scriptRevisions.push({
          id: crypto.randomUUID(),
          conceptId,
          revision: previous.revision,
          changedAt: new Date().toISOString(),
          changedBy: clean(actor, 80) || "사용자",
          reason: "manual-edit",
          snapshot: clone(previous),
        });
        project.concepts[index] = {
          ...clone(concept),
          id: previous.id,
          hookType: previous.hookType,
          revision: previous.revision + 1,
          createdAt: previous.createdAt,
          updatedAt: new Date().toISOString(),
        };
        project.scriptLastEditedBy = clean(actor, 80) || "사용자";
      });
    },

    async saveScript(
      projectId: string,
      conceptId: string,
      concept: VideoConcept,
      actor: string,
      options: { productionNotes?: string; createRevision?: boolean } = {}
    ) {
      return update(projectId, (project) => {
        if (project.status === "script_pending") throw new Error("먼저 영상 대본을 생성해 주세요.");
        if (project.status === "approved")
          throw new Error("최종 승인된 대본은 복제한 뒤 수정해 주세요.");
        const index = project.concepts.findIndex((item) => item.id === conceptId);
        const current =
          project.finalScript?.id === conceptId
            ? project.finalScript
            : index >= 0
              ? project.concepts[index]
              : null;
        if (!current) throw new Error("수정할 제작 대본을 찾지 못했습니다.");
        const normalized = normalizeConcept({
          ...clone(concept),
          id: current.id,
          hookType: current.hookType,
          revision: current.revision + 1,
          createdAt: current.createdAt,
          updatedAt: new Date().toISOString(),
        });
        if (normalized.cuts.length >= 15) {
          normalized.validation = validateDetailedPlanning(
            normalized,
            project.productAnalysis,
            project.duration
          );
        }
        validateConceptForProject(project, normalized);
        if (options.createRevision) {
          project.scriptRevisions.push({
            id: crypto.randomUUID(),
            conceptId: current.id,
            revision: current.revision,
            changedAt: new Date().toISOString(),
            changedBy: clean(actor, 80) || project.marketerName,
            reason: "manual-edit",
            snapshot: clone(current),
          });
        } else if (project.status !== "script_review") {
          const latestRevision = {
            id: crypto.randomUUID(),
            conceptId: current.id,
            revision: normalized.revision,
            changedAt: new Date().toISOString(),
            changedBy: clean(actor, 80) || project.marketerName,
            reason: "manual-edit" as const,
            stage: "post-request-latest" as const,
            snapshot: clone(normalized),
          };
          const previousLatestIndex = project.scriptRevisions.findLastIndex(
            (revision) =>
              revision.conceptId === current.id && revision.stage === "post-request-latest"
          );
          if (previousLatestIndex >= 0)
            project.scriptRevisions[previousLatestIndex] = latestRevision;
          else project.scriptRevisions.push(latestRevision);
        }
        if (index >= 0) project.concepts[index] = clone(normalized);
        if (project.finalScript?.id === current.id) project.finalScript = clone(normalized);
        if (options.productionNotes !== undefined)
          project.productionNotes = clean(options.productionNotes, 5000);
        project.scriptLastEditedBy = clean(actor, 80) || project.marketerName;
      });
    },

    async restoreScriptRevision(projectId: string, revisionId: string, actor: string) {
      return update(projectId, (project) => {
        if (project.status === "approved")
          throw new Error("최종 승인된 대본은 복제한 뒤 복원해 주세요.");
        const revision = project.scriptRevisions.find((item) => item.id === revisionId);
        if (!revision) throw new Error("복원할 대본 버전을 찾지 못했습니다.");
        const index = project.concepts.findIndex((item) => item.id === revision.conceptId);
        const current =
          index >= 0
            ? project.concepts[index]
            : project.finalScript?.id === revision.conceptId
              ? project.finalScript
              : undefined;
        if (!current) throw new Error("복원 대상 기획안을 찾지 못했습니다.");
        const restored = normalizeConcept({
          ...clone(revision.snapshot),
          id: current.id,
          hookType: current.hookType,
          materialCode: current.materialCode,
          revision: current.revision + 1,
          createdAt: current.createdAt,
          updatedAt: new Date().toISOString(),
        });
        validateConceptForProject(project, restored);
        project.scriptRevisions.push({
          id: crypto.randomUUID(),
          conceptId: current.id,
          revision: current.revision,
          changedAt: new Date().toISOString(),
          changedBy: clean(actor, 80) || "사용자",
          reason: "manual-edit",
          snapshot: clone(current),
        });
        if (index >= 0) project.concepts[index] = clone(restored);
        if (project.finalScript?.id === current.id) project.finalScript = clone(restored);
        project.scriptLastEditedBy = clean(actor, 80) || "사용자";
      });
    },

    async selectConcept(projectId: string, conceptId: string) {
      return update(projectId, (project) => {
        if (!["script_review", "concept_selected"].includes(project.status))
          throw new Error("대본 검토 중에만 기획안을 선택할 수 있습니다.");
        if (!project.concepts.some((item) => item.id === conceptId))
          throw new Error("선택할 기획안을 찾지 못했습니다.");
        project.selectedConceptId = conceptId;
        if (project.status === "script_review") {
          transition(project, "concept_selected", project.marketerName, "상세 검토 후 기획안 선택");
        }
      });
    },

    async requestProduction(input: {
      projectId: string;
      conceptId: string;
      deadline: string;
      actor: string;
      requestNote?: string;
    }) {
      return update(input.projectId, (project) => {
        if (!["script_review", "concept_selected"].includes(project.status))
          throw new Error("대본 검토 중인 프로젝트만 제작 요청할 수 있습니다.");
        if (!clean(project.designerName) || project.designerName === "디자이너 미지정") {
          throw new Error("제작을 요청하려면 담당 디자이너를 지정해 주세요.");
        }
        const concept = project.concepts.find((item) => item.id === input.conceptId);
        if (!concept) throw new Error("확정할 기획안을 선택해 주세요.");
        const validation =
          concept.cuts.length >= 15
            ? validateDetailedPlanning(concept, project.productAnalysis, project.duration)
            : undefined;
        concept.validation = validation;
        if (concept.cuts.length < 15 || !validation?.valid) {
          throw new Error("자동 품질 검수를 통과한 최소 15개 구간의 상세 대본이 필요합니다.");
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(clean(input.deadline)))
          throw new Error("올바른 제작 마감일을 입력해 주세요.");
        project.selectedConceptId = concept.id;
        project.finalScript = clone(concept);
        project.deadline = clean(input.deadline, 40);
        const finalizedRevision = {
          id: crypto.randomUUID(),
          conceptId: concept.id,
          revision: concept.revision,
          changedAt: new Date().toISOString(),
          changedBy: clean(input.actor, 80) || "마케터",
          reason: "finalized",
          stage: "marketer-final",
          snapshot: clone(concept),
        } as const;
        project.scriptRevisions.push(finalizedRevision);
        const requestedAt = new Date().toISOString();
        project.milestones.scriptFinalizedAt = requestedAt;
        project.milestones.productionRequestedAt = requestedAt;
        project.scriptLastEditedBy = clean(input.actor, 80) || project.marketerName;
        project.productionRequest = {
          requestedAt,
          requestedBy: clean(input.actor, 80) || project.marketerName,
          designerName: project.designerName,
          deadline: project.deadline,
          note: clean(input.requestNote, 500),
          conceptId: concept.id,
          scriptRevisionId: finalizedRevision.id,
          referenceAssetIds: project.referenceAssets.map((asset) => asset.id),
        };
        transition(
          project,
          "production_requested",
          input.actor,
          clean(input.requestNote, 500) || "최종 대본 확정 및 제작 요청"
        );
      });
    },

    async startProduction(projectId: string, actor: string) {
      return update(projectId, (project) => {
        transition(project, "in_production", actor, "디자이너 영상 제작 시작");
        project.milestones.productionStartedAt = new Date().toISOString();
      });
    },

    async addVersion(projectId: string, version: VideoVersion, actor: string) {
      return update(projectId, (project) => {
        if (!["in_production", "revision_requested"].includes(project.status)) {
          throw new Error("현재 상태에서는 새 영상 버전을 업로드할 수 없습니다.");
        }
        const expected = project.versions.length + 1;
        if (version.versionNumber !== expected)
          throw new Error("영상 버전 번호가 올바르지 않습니다.");
        project.versions.push(clone(version));
        project.milestones.videoUploadedAt = version.uploadedAt;
        transition(project, "marketer_review", actor, `영상 v${version.versionNumber} 업로드`);
      });
    },

    async addComment(
      projectId: string,
      comment: ReviewComment,
      options: { requestRevision: boolean; actor: string }
    ) {
      return update(projectId, (project) => {
        if (!project.versions.some((item) => item.id === comment.versionId))
          throw new Error("피드백을 남길 영상 버전을 찾지 못했습니다.");
        project.comments.push(clone(comment));
        if (options.requestRevision) {
          if (project.status !== "marketer_review")
            throw new Error("마케터 검수 중에만 수정 요청할 수 있습니다.");
          project.versions = project.versions.map((item) =>
            item.id === comment.versionId ? { ...item, reviewStatus: "changes_requested" } : item
          );
          transition(project, "revision_requested", options.actor, "영상 수정 의견 등록");
          project.milestones.revisionRequestedAt = new Date().toISOString();
        }
      });
    },

    async resolveComment(projectId: string, commentId: string, actor: string) {
      return update(projectId, (project) => {
        const comment = project.comments.find((item) => item.id === commentId);
        if (!comment) throw new Error("해결 처리할 피드백을 찾지 못했습니다.");
        comment.resolved = true;
        comment.resolvedAt = new Date().toISOString();
        comment.resolvedBy = clean(actor, 80) || "사용자";
      });
    },

    async approveVersion(projectId: string, versionId: string, actor: string) {
      return update(projectId, (project) => {
        if (project.status !== "marketer_review")
          throw new Error("마케터 검수 중인 영상만 최종 승인할 수 있습니다.");
        const version = project.versions.find((item) => item.id === versionId);
        if (!version) throw new Error("최종 승인할 영상 버전을 찾지 못했습니다.");
        project.versions = project.versions.map((item) => ({
          ...item,
          reviewStatus: item.id === versionId ? "approved" : item.reviewStatus,
        }));
        project.approvedVersionId = versionId;
        project.milestones.approvedAt = new Date().toISOString();
        transition(project, "approved", actor, `영상 v${version.versionNumber} 최종 승인`);
      });
    },

    async duplicateApproved(projectId: string, actor: string) {
      return locked((store) => {
        const source = store.projects.find((item) => item.id === projectId);
        if (!source) throw new Error("복제할 영상 프로젝트를 찾지 못했습니다.");
        if (source.status !== "approved" || !source.finalScript)
          throw new Error("최종 승인된 제작 대본만 복제할 수 있습니다.");
        const nowDate = new Date();
        const now = nowDate.toISOString();
        const existingCodes = store.projects.flatMap((project) =>
          project.concepts.map((concept) => concept.materialCode)
        );
        const conceptId = crypto.randomUUID();
        const materialCode = createVideoMaterialCode({
          advertiserName: source.advertiserName,
          productName: source.productAnalysis.productName,
          hookType: source.finalScript.hookType,
          existingCodes,
          createdAt: nowDate,
        });
        const concept: VideoConcept = {
          ...clone(source.finalScript),
          id: conceptId,
          materialCode,
          cuts: source.finalScript.cuts.map((cut, index) => ({
            ...clone(cut),
            id: crypto.randomUUID(),
            cutNumber: index + 1,
            referenceImages: cut.referenceImages.map((image) => ({
              ...clone(image),
              id: crypto.randomUUID(),
            })),
          })),
          revision: 1,
          createdAt: now,
          updatedAt: now,
        };
        const duplicate: VideoProject = {
          ...clone(source),
          id: `video-${crypto.randomUUID()}`,
          projectName: `${source.projectName} 복제`,
          deadline: "",
          status: "script_review",
          concepts: [concept],
          selectedConceptId: concept.id,
          finalScript: undefined,
          scriptRevisions: [
            {
              id: crypto.randomUUID(),
              conceptId: concept.id,
              revision: 1,
              changedAt: now,
              changedBy: clean(actor, 80) || source.marketerName,
              reason: "generated",
              stage: "ai-generated",
              snapshot: clone(concept),
            },
          ],
          versions: [],
          comments: [],
          approvedVersionId: undefined,
          statusHistory: [
            {
              id: newHistoryId(),
              from: null,
              to: "script_review",
              actor: clean(actor, 80) || source.marketerName,
              note: `완료된 프로젝트 ${source.projectName} 제작 대본 복제`,
              changedAt: now,
            },
          ],
          milestones: { scriptCreatedAt: now },
          scriptLastEditedBy: clean(actor, 80) || source.marketerName,
          sourceProjectId: source.id,
          createdAt: now,
          updatedAt: now,
        };
        store.projects.push(duplicate);
        return clone(duplicate);
      });
    },

    async delete(projectId: string) {
      return locked((store) => {
        const index = store.projects.findIndex((item) => item.id === projectId);
        if (index < 0) throw new Error("삭제할 영상 프로젝트를 찾지 못했습니다.");
        const [deleted] = store.projects.splice(index, 1);
        return clone(deleted);
      });
    },

    async replaceForTest(project: VideoProject) {
      return locked((store) => {
        const index = store.projects.findIndex((item) => item.id === project.id);
        const normalized = normalizeProject(project);
        if (index >= 0) store.projects[index] = clone(normalized);
        else store.projects.push(clone(normalized));
        return clone(normalized);
      });
    },
  };
}

export const videoProjectRepository = createVideoProjectRepository();

export function validateCreateVideoProjectInput(input: Partial<CreateVideoProjectInput>) {
  const required: Array<[keyof CreateVideoProjectInput, string]> = [
    ["projectName", "프로젝트명"],
    ["advertiserName", "업체명"],
    ["productUrl", "상품 URL"],
    ["duration", "영상 길이"],
    ["format", "영상 형식"],
    ["objective", "영상 목적"],
    ["productAnalysis", "상품 분석 정보"],
    ["brandGuideline", "업체 참고정보"],
  ];
  for (const [key, label] of required) {
    if (input[key] === undefined || input[key] === null || input[key] === "") {
      throw new Error(`${label}을(를) 입력해 주세요.`);
    }
  }
  if (!input.productAnalysis?.productName) throw new Error("분석된 상품명을 확인해 주세요.");
  if (![15, 20, 30, 45, 60].includes(Number(input.duration)))
    throw new Error("영상 길이는 15초, 20초, 30초, 45초, 60초만 지원합니다.");
  if (!input.format || !["short-form", "reels", "feed", "other"].includes(input.format))
    throw new Error("영상 형식이 올바르지 않습니다.");
  if (
    !input.objective ||
    ![
      "purchase",
      "new-customer-hook",
      "retargeting",
      "usp",
      "review-ugc",
      "interest",
      "new-product",
      "benefit",
    ].includes(input.objective)
  )
    throw new Error("영상 목적이 올바르지 않습니다.");
  if (
    (input.referenceAssets || []).some(
      (asset) =>
        !asset.filePath.startsWith("/video-collaboration/references/") ||
        asset.size <= 0 ||
        asset.size > 100 * 1024 * 1024
    )
  ) {
    throw new Error("참고 파일 정보가 올바르지 않습니다.");
  }
  if (input.platform && !["meta", "instagram", "tiktok", "youtube-shorts"].includes(input.platform))
    throw new Error("영상 플랫폼이 올바르지 않습니다.");
  if (input.conceptFormat && !VIDEO_CONCEPT_FORMATS.includes(input.conceptFormat))
    throw new Error("영상 콘셉트 형식이 올바르지 않습니다.");
  if (
    input.productOriginalAsset &&
    (!input.productOriginalAsset.mimeType.startsWith("image/") ||
      !input.productOriginalAsset.filePath.startsWith("/video-collaboration/references/"))
  )
    throw new Error("상품 원본 이미지 정보가 올바르지 않습니다.");
  let url: URL;
  try {
    url = new URL(String(input.productUrl));
  } catch {
    throw new Error("올바른 상품 URL을 입력해 주세요.");
  }
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("HTTP 또는 HTTPS 상품 URL만 지원합니다.");
}
