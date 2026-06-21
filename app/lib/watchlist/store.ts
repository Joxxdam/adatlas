import { promises as fs } from "fs";
import path from "path";
import { ContentAnalysis, WatchlistBrand } from "./types";

const watchlistPath = path.join(process.cwd(), "data", "brand-watchlist.json");
const analysisPath = path.join(process.cwd(), "data", "content-analyses.json");

async function ensureAnalysisStore() {
  await fs.mkdir(path.dirname(analysisPath), { recursive: true });
  try {
    await fs.access(analysisPath);
  } catch {
    await fs.writeFile(analysisPath, "[]\n", "utf8");
  }
}

export async function readWatchlist(): Promise<WatchlistBrand[]> {
  const file = await fs.readFile(watchlistPath, "utf8");
  return JSON.parse(file) as WatchlistBrand[];
}

export async function readContentAnalyses(): Promise<ContentAnalysis[]> {
  await ensureAnalysisStore();
  const file = await fs.readFile(analysisPath, "utf8");
  return JSON.parse(file) as ContentAnalysis[];
}

export async function saveContentAnalyses(items: ContentAnalysis[]) {
  const existing = await readContentAnalyses();
  const byId = new Map(existing.map((item) => [item.id, item]));
  let added = 0;

  for (const item of items) {
    if (!byId.has(item.id)) {
      added += 1;
    }
    byId.set(item.id, item);
  }

  const next = [...byId.values()].sort((a, b) => b.analyzedAt.localeCompare(a.analyzedAt));
  await fs.writeFile(analysisPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");

  return { added, total: next.length };
}
