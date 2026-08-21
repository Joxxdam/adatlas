import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  MetaAdvertiserAssetMap,
  MetaInsightSnapshot,
  MetaRegistrationJob,
  PerformanceExperiment,
} from "./types.ts";

type MetaStore = {
  advertiserMappings: MetaAdvertiserAssetMap[];
  registrations: MetaRegistrationJob[];
  performance: PerformanceExperiment[];
  snapshots: MetaInsightSnapshot[];
  mediaHashes: Record<string, string>;
  idempotencyKeys: string[];
  audit: Array<{
    at: string;
    operation: string;
    outcome: string;
    target?: string;
    detail?: string;
  }>;
};

const emptyStore: MetaStore = {
  advertiserMappings: [],
  registrations: [],
  performance: [],
  snapshots: [],
  mediaHashes: {},
  idempotencyKeys: [],
  audit: [],
};

export function createMetaRepository(options?: { dataDirectory?: string }) {
  const directory = options?.dataDirectory || path.join(process.cwd(), "data", "meta");
  const storePath = path.join(directory, "store.json");
  let queue = Promise.resolve();
  const locks = new Set<string>();

  async function read(): Promise<MetaStore> {
    try {
      const raw = JSON.parse(await readFile(storePath, "utf8")) as Partial<MetaStore>;
      return {
        ...emptyStore,
        ...raw,
        advertiserMappings: raw.advertiserMappings || [],
        registrations: raw.registrations || [],
        performance: raw.performance || [],
        snapshots: raw.snapshots || [],
        mediaHashes: raw.mediaHashes || {},
        idempotencyKeys: raw.idempotencyKeys || [],
        audit: raw.audit || [],
      };
    } catch {
      return structuredClone(emptyStore);
    }
  }

  async function write(store: MetaStore) {
    await mkdir(directory, { recursive: true });
    const temporaryPath = `${storePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(store, null, 2), "utf8");
    await rename(temporaryPath, storePath);
  }

  async function mutate<T>(operation: (store: MetaStore) => T | Promise<T>) {
    let result!: T;
    const task = queue.then(async () => {
      const store = await read();
      result = await operation(store);
      await write(store);
    });
    queue = task.catch(() => undefined);
    await task;
    return result;
  }

  return {
    read,
    async saveAdvertiserMapping(mapping: MetaAdvertiserAssetMap) {
      return mutate((store) => {
        const index = store.advertiserMappings.findIndex(
          (item) => item.advertiserId === mapping.advertiserId
        );
        if (index >= 0) store.advertiserMappings[index] = mapping;
        else store.advertiserMappings.push(mapping);
        return mapping;
      });
    },
    async saveRegistration(job: MetaRegistrationJob) {
      return mutate((store) => {
        const index = store.registrations.findIndex((item) => item.id === job.id);
        if (index >= 0) store.registrations[index] = job;
        else store.registrations.push(job);
        return job;
      });
    },
    async findRegistrationByRequestKey(requestKey: string) {
      return (await read()).registrations.find((item) => item.requestKey === requestKey);
    },
    async saveMediaHash(hash: string, mediaId: string) {
      return mutate((store) => {
        store.mediaHashes[hash] = mediaId;
        return mediaId;
      });
    },
    async findMediaId(hash: string) {
      return (await read()).mediaHashes[hash];
    },
    async upsertPerformance(experiment: PerformanceExperiment) {
      return mutate((store) => {
        const duplicate = store.performance.find(
          (item) =>
            item.id !== experiment.id &&
            (item.adSetId === experiment.adSetId ||
              item.rows.some((row) => experiment.rows.some((next) => next.adId === row.adId)))
        );
        if (duplicate) throw new Error("동일 광고 세트 또는 광고가 이미 연결되어 있습니다.");
        const index = store.performance.findIndex((item) => item.id === experiment.id);
        if (index >= 0) store.performance[index] = experiment;
        else store.performance.push(experiment);
        return experiment;
      });
    },
    async upsertSnapshots(snapshots: MetaInsightSnapshot[]) {
      return mutate((store) => {
        for (const snapshot of snapshots) {
          const index = store.snapshots.findIndex(
            (item) =>
              item.adId === snapshot.adId &&
              item.dateStart === snapshot.dateStart &&
              item.dateStop === snapshot.dateStop
          );
          if (index >= 0) store.snapshots[index] = snapshot;
          else store.snapshots.push(snapshot);
        }
        return snapshots.length;
      });
    },
    acquireLock(key: string) {
      if (locks.has(key)) return false;
      locks.add(key);
      return true;
    },
    releaseLock(key: string) {
      locks.delete(key);
    },
    async audit(entry: MetaStore["audit"][number]) {
      return mutate((store) => {
        store.audit.push(entry);
        store.audit = store.audit.slice(-500);
      });
    },
  };
}

export const metaRepository = createMetaRepository();
