import { promises as fs } from "fs";
import path from "path";

export type ProcessedProductImageRecord = {
  id: string;
  provider: string;
  originalImagePath: string;
  processedImagePath: string;
  createdAt: string;
};

const dataDir = path.join(process.cwd(), "data");
const storePath = path.join(dataDir, "processed-product-images.json");

export async function readProcessedProducts() {
  try {
    const raw = await fs.readFile(storePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ProcessedProductImageRecord[]) : [];
  } catch {
    return [];
  }
}

export async function appendProcessedProductImage(record: ProcessedProductImageRecord) {
  await fs.mkdir(dataDir, { recursive: true });
  const records = await readProcessedProducts();
  const next = [record, ...records].slice(0, 500);
  await fs.writeFile(storePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export const appendProcessedProduct = appendProcessedProductImage;
