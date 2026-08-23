import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CremaMarketDataset, ProductOpportunity } from "./types.ts";

const dataDirectory = path.join(process.cwd(), "data", "crema-market");

function safeId(value: string) {
  const normalized = value
    .trim()
    .replace(/[^a-z0-9가-힣_-]+/gi, "-")
    .slice(0, 80);
  if (!normalized) throw new Error("광고주 ID가 필요합니다.");
  return normalized;
}

async function readDataset(advertiserId: string) {
  try {
    return JSON.parse(await readFile(path.join(dataDirectory, `${safeId(advertiserId)}.json`), "utf8")) as CremaMarketDataset;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export const cremaMarketRepository = {
  async get(advertiserId: string) {
    return readDataset(advertiserId);
  },
  async save(dataset: CremaMarketDataset) {
    await mkdir(dataDirectory, { recursive: true });
    dataset.updatedAt = new Date().toISOString();
    await writeFile(path.join(dataDirectory, `${safeId(dataset.advertiser.id)}.json`), `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
    return dataset;
  },
  async list() {
    try {
      const { readdir } = await import("node:fs/promises");
      const files = (await readdir(dataDirectory)).filter((file) => file.endsWith(".json"));
      const datasets = await Promise.all(files.map((file) => readDataset(file.replace(/\.json$/, ""))));
      return datasets.filter((dataset): dataset is CremaMarketDataset => Boolean(dataset));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  },
  async findOpportunity(opportunityId: string) {
    const datasets = await this.list();
    for (const dataset of datasets) {
      const opportunity = dataset.opportunities.find((item) => item.id === opportunityId);
      if (opportunity) return { dataset, opportunity };
    }
    return null;
  },
  async updateOpportunity(opportunityId: string, updates: Partial<Pick<ProductOpportunity, "status">>) {
    const found = await this.findOpportunity(opportunityId);
    if (!found) return null;
    found.opportunity.status = updates.status || found.opportunity.status;
    found.opportunity.recommendationStatus = found.opportunity.status === "creative_generated" ? "creative_generated" : found.opportunity.status === "excluded" ? "rejected" : found.opportunity.status === "later" ? "reviewed" : "accepted";
    found.opportunity.updatedAt = new Date().toISOString();
    await this.save(found.dataset);
    return found.opportunity;
  },
};

export const ProductOpportunityRepository = cremaMarketRepository;
