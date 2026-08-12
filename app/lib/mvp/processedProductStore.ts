import { JsonArrayRepository } from "./jsonRepository";

export type ProcessedProductImageRecord = {
  id: string;
  provider: string;
  originalImagePath: string;
  processedImagePath: string;
  cacheKey?: string;
  representationType?: string;
  extractionScope?: string;
  pipelineVersion?: string;
  createdAt: string;
};

const processedProductRepository = new JsonArrayRepository<ProcessedProductImageRecord>(
  "data/processed-product-images.json"
);

export async function readProcessedProducts() {
  return processedProductRepository.read();
}

export async function appendProcessedProductImage(record: ProcessedProductImageRecord) {
  return processedProductRepository.prepend([record], 500);
}

export const appendProcessedProduct = appendProcessedProductImage;
