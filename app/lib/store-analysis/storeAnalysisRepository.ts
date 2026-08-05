import { promises as fs } from "fs";
import path from "path";
import type { StoreAnalysisResult, StoreAnalysisSummary } from "./types";

export interface StoreAnalysisRepository {
  save(result: StoreAnalysisResult): Promise<void>;
  getById(analysisId: string): Promise<StoreAnalysisResult | null>;
  list(): Promise<StoreAnalysisSummary[]>;
}

const ROOT = path.join(process.cwd(), "data", "store-analysis");
const INDEX_PATH = path.join(ROOT, "index.json");
const SAFE_ID = /^store-[a-z0-9-]{8,80}$/i;
let writeQueue = Promise.resolve();

function resultPath(analysisId: string) {
  if (!SAFE_ID.test(analysisId)) throw new Error("유효하지 않은 analysisId입니다.");
  const resolved = path.join(ROOT, `${analysisId}.json`);
  if (!resolved.startsWith(`${ROOT}${path.sep}`)) throw new Error("유효하지 않은 분석 경로입니다.");
  return resolved;
}

async function atomicWriteJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, filePath);
}

export class FileStoreAnalysisRepository implements StoreAnalysisRepository {
  async save(result: StoreAnalysisResult) {
    writeQueue = writeQueue
      .catch(() => undefined)
      .then(async () => {
        await atomicWriteJson(resultPath(result.analysisId), result);
        const existing = await this.list();
        const summary: StoreAnalysisSummary = {
          analysisId: result.analysisId,
          storeUrl: result.storeInfo.storeUrl,
          storeName: result.storeInfo.storeName,
          createdAt: result.createdAt,
          productCount: result.products.length,
          platform: result.storeInfo.platform,
        };
        const next = [
          summary,
          ...existing.filter((item) => item.analysisId !== result.analysisId),
        ].slice(0, 100);
        await atomicWriteJson(INDEX_PATH, next);
      });
    await writeQueue;
  }

  async getById(analysisId: string) {
    try {
      const raw = await fs.readFile(resultPath(analysisId), "utf8");
      return JSON.parse(raw.replace(/^\uFEFF/, "")) as StoreAnalysisResult;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    }
  }

  async list() {
    try {
      const raw = await fs.readFile(INDEX_PATH, "utf8");
      const parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
      return Array.isArray(parsed) ? (parsed as StoreAnalysisSummary[]) : [];
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return [];
      }
      throw error;
    }
  }
}

export const storeAnalysisRepository = new FileStoreAnalysisRepository();
