import { promises as fs } from "node:fs";
import path from "node:path";
import type { CreativeExperiment, CreateExperimentPlanResult, ExperimentAnalysis, ExperimentAsset, HookExperimentStore, ObjectiveHookInsight, PerformanceRecord } from "./types.ts";

const emptyStore = (): HookExperimentStore => ({
  version: "hook-experiments-v1",
  experiments: [],
  hookGroups: [],
  experimentAssets: [],
  performanceRecords: [],
  analyses: [],
  insights: [],
});

export function createHookExperimentRepository(options: { dataDirectory?: string } = {}) {
  const dataDirectory = options.dataDirectory || path.join(process.cwd(), "data", "hook-experiments");
  const storePath = path.join(dataDirectory, "store.json");
  let queue: Promise<void> = Promise.resolve();

  async function readStore(): Promise<HookExperimentStore> {
    try {
      const parsed = JSON.parse(await fs.readFile(storePath, "utf8")) as Partial<HookExperimentStore>;
      return {
        ...emptyStore(),
        ...parsed,
        experiments: Array.isArray(parsed.experiments) ? parsed.experiments : [],
        hookGroups: Array.isArray(parsed.hookGroups) ? parsed.hookGroups : [],
        experimentAssets: Array.isArray(parsed.experimentAssets) ? parsed.experimentAssets : [],
        performanceRecords: Array.isArray(parsed.performanceRecords) ? parsed.performanceRecords : [],
        analyses: Array.isArray(parsed.analyses) ? parsed.analyses : [],
        insights: Array.isArray(parsed.insights) ? parsed.insights : [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
      throw new Error("후킹 실험 저장 데이터를 불러오지 못했습니다.");
    }
  }

  async function writeStore(store: HookExperimentStore) {
    await fs.mkdir(dataDirectory, { recursive: true });
    const temporary = `${storePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    await fs.rename(temporary, storePath);
  }

  function locked<T>(operation: (store: HookExperimentStore) => Promise<T> | T) {
    const next = queue.then(async () => {
      const store = await readStore();
      const result = await operation(store);
      await writeStore(store);
      return result;
    });
    queue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  function snapshot(store: HookExperimentStore, experimentId: string) {
    const experiment = store.experiments.find((item) => item.id === experimentId);
    if (!experiment) return null;
    return {
      experiment,
      hookGroups: store.hookGroups.filter((item) => item.experimentId === experimentId),
      experimentAssets: store.experimentAssets.filter((item) => item.experimentId === experimentId),
      performanceRecords: store.performanceRecords.filter((item) => item.experimentId === experimentId),
      analysis: store.analyses.find((item) => item.experimentId === experimentId) || null,
    };
  }

  return {
    async createPlan(plan: CreateExperimentPlanResult, generationJobId: string) {
      return locked((store) => {
        if (store.experiments.some((item) => item.experimentCode === plan.experiment.experimentCode)) {
          throw new Error("같은 상품·목표·회차의 실험이 이미 존재합니다.");
        }
        const experiment = {
          ...plan.experiment,
          generationJobId,
          status: "generating" as const,
          updatedAt: new Date().toISOString(),
        };
        store.experiments.push(experiment);
        store.hookGroups.push(...plan.hookGroups);
        store.experimentAssets.push(...plan.experimentAssets);
        return { ...plan, experiment };
      });
    },

    async get(experimentId: string) {
      return snapshot(await readStore(), experimentId);
    },

    async list() {
      const store = await readStore();
      return [...store.experiments].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).map((experiment) => snapshot(store, experiment.id)!);
    },

    async findByCode(experimentCode: string) {
      const store = await readStore();
      const experiment = store.experiments.find((item) => item.experimentCode === experimentCode);
      return experiment ? snapshot(store, experiment.id) : null;
    },

    async updateExperiment(experimentId: string, changes: Partial<Pick<CreativeExperiment, "status" | "metaTestPlan" | "startDate" | "endDate">>) {
      return locked((store) => {
        const experiment = store.experiments.find((item) => item.id === experimentId);
        if (!experiment) throw new Error("수정할 실험을 찾지 못했습니다.");
        const definedChanges = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined));
        Object.assign(experiment, definedChanges, { updatedAt: new Date().toISOString() });
        return experiment;
      });
    },

    async attachAsset(input: { experimentId: string; generationResultId: string; assetId: string; assetCode: string }) {
      return locked((store) => {
        const index = store.experimentAssets.findIndex((item) => item.experimentId === input.experimentId && item.generationResultId === input.generationResultId);
        if (index < 0) throw new Error("실험 소재 연결 항목을 찾지 못했습니다.");
        const now = new Date().toISOString();
        store.experimentAssets[index] = {
          ...store.experimentAssets[index],
          assetId: input.assetId,
          assetCode: input.assetCode,
          updatedAt: now,
        };
        const experiment = store.experiments.find((item) => item.id === input.experimentId);
        if (experiment) {
          const items = store.experimentAssets.filter((item) => item.experimentId === input.experimentId);
          experiment.status = items.every((item) => item.assetId) ? "ready_for_registration" : "generating";
          experiment.updatedAt = now;
        }
        const group = store.hookGroups.find((item) => item.id === store.experimentAssets[index].hookGroupId);
        if (group) {
          const groupItems = store.experimentAssets.filter((item) => item.hookGroupId === group.id);
          group.status = groupItems.every((item) => item.assetId) ? "generated" : group.status;
          group.updatedAt = now;
        }
        return store.experimentAssets[index];
      });
    },

    async linkExistingAsset(input: { experimentId: string; experimentAssetId: string; assetId: string; assetCode: string }) {
      return locked((store) => {
        const index = store.experimentAssets.findIndex((item) => item.id === input.experimentAssetId && item.experimentId === input.experimentId);
        if (index < 0) throw new Error("기존 소재를 연결할 실험 슬롯을 찾지 못했습니다.");
        const duplicate = store.experimentAssets.find((item) => item.experimentId === input.experimentId && item.assetId === input.assetId && item.id !== input.experimentAssetId);
        if (duplicate) throw new Error("이 소재는 이미 해당 실험에 연결되어 있습니다.");
        const now = new Date().toISOString();
        store.experimentAssets[index] = {
          ...store.experimentAssets[index],
          assetId: input.assetId,
          assetCode: input.assetCode,
          updatedAt: now,
        };
        const experiment = store.experiments.find((item) => item.id === input.experimentId);
        if (experiment) {
          const relations = store.experimentAssets.filter((item) => item.experimentId === input.experimentId);
          experiment.status = relations.every((item) => item.assetId) ? "ready_for_registration" : experiment.status;
          experiment.updatedAt = now;
        }
        return store.experimentAssets[index];
      });
    },

    async updateAssetRegistration(experimentId: string, experimentAssetId: string, changes: Partial<Pick<ExperimentAsset, "hostingRegistrationStatus" | "registeredHostProductNo" | "cremaCollectionStatus" | "catalogProductId" | "productMatchStatus" | "notes">>) {
      return locked((store) => {
        const index = store.experimentAssets.findIndex((item) => item.id === experimentAssetId && item.experimentId === experimentId);
        if (index < 0) throw new Error("등록 상태를 수정할 실험 소재를 찾지 못했습니다.");
        const definedChanges = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined));
        store.experimentAssets[index] = {
          ...store.experimentAssets[index],
          ...definedChanges,
          updatedAt: new Date().toISOString(),
        };
        return store.experimentAssets[index];
      });
    },

    async savePerformance(experimentId: string, records: PerformanceRecord[]) {
      return locked((store) => {
        if (!store.experiments.some((item) => item.id === experimentId)) throw new Error("실험을 찾지 못했습니다.");
        for (const record of records) {
          const key = `${record.experimentId}|${record.platform}|${record.adId}|${record.dateStart}|${record.dateEnd}`;
          const index = store.performanceRecords.findIndex((item) => `${item.experimentId}|${item.platform}|${item.adId}|${item.dateStart}|${item.dateEnd}` === key);
          if (index >= 0) store.performanceRecords[index] = record;
          else store.performanceRecords.push(record);
        }
        const experiment = store.experiments.find((item) => item.id === experimentId)!;
        experiment.status = "analyzing";
        experiment.updatedAt = new Date().toISOString();
        return store.performanceRecords.filter((item) => item.experimentId === experimentId);
      });
    },

    async updatePerformanceMatch(input: { experimentId: string; recordId: string; assetId: string; assetCode: string; hookGroupId: string }) {
      return locked((store) => {
        const index = store.performanceRecords.findIndex((item) => item.id === input.recordId && item.experimentId === input.experimentId);
        if (index < 0) throw new Error("수동 연결할 보고서 행을 찾지 못했습니다.");
        store.performanceRecords[index] = {
          ...store.performanceRecords[index],
          assetId: input.assetId,
          assetCode: input.assetCode,
          hookGroupId: input.hookGroupId,
          matchStatus: "matched",
          matchMessage: "사용자 수동 연결",
        };
        return store.performanceRecords[index];
      });
    },

    async saveAnalysis(analysis: ExperimentAnalysis) {
      return locked((store) => {
        const index = store.analyses.findIndex((item) => item.experimentId === analysis.experimentId);
        if (index >= 0) store.analyses[index] = analysis;
        else store.analyses.push(analysis);
        const experiment = store.experiments.find((item) => item.id === analysis.experimentId);
        if (experiment) {
          experiment.status = analysis.needsMoreData ? "additional_data_required" : "completed";
          experiment.updatedAt = new Date().toISOString();
        }
        for (const result of analysis.groups) {
          const group = store.hookGroups.find((item) => item.id === result.hookGroupId);
          if (!group) continue;
          group.rank = result.rank;
          group.isWinner = result.hookCode === analysis.winnerHookCode;
          group.stability = result.stability;
          group.status = result.eligible ? "ranked" : "additional_data_required";
          group.updatedAt = new Date().toISOString();
          for (const record of store.performanceRecords.filter((item) => item.experimentId === analysis.experimentId && item.hookGroupId === result.hookGroupId)) {
            record.resultStatus = analysis.needsMoreData || !result.eligible ? "needs-more-data" : result.hookCode === analysis.winnerHookCode ? "validated-winner" : result.rank === 1 ? "promising" : "loser";
            record.dataSufficiency = result.eligible ? "comparison-ready" : "additional-data-required";
          }
        }
        return analysis;
      });
    },

    async replaceInsights(insights: ObjectiveHookInsight[]) {
      return locked((store) => {
        const keys = new Set(insights.map((item) => item.id));
        store.insights = [...store.insights.filter((item) => !keys.has(item.id)), ...insights];
        return insights;
      });
    },

    async listInsights(filters: { advertiserId?: string; productId?: string; objective?: string } = {}) {
      return (await readStore()).insights.filter((item) => (!filters.advertiserId || item.advertiserId === filters.advertiserId) && (!filters.productId || item.productId === filters.productId) && (!filters.objective || item.objective === filters.objective));
    },

    async readAll() {
      return readStore();
    },
  };
}

export const hookExperimentRepository = createHookExperimentRepository();
