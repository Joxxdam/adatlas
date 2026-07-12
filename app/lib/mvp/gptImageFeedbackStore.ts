import { promises as fs } from "fs";
import path from "path";
import type { GptImageCandidate, GptImageFeedbackRecord } from "./types";

const dataDir = path.join(process.cwd(), "data");
const feedbacksPath = path.join(dataDir, "gpt-image-feedbacks.json");
const candidatesPath = path.join(dataDir, "gpt-image-candidates.json");

async function readJsonArray<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
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

async function writeJsonArray<T>(filePath: string, records: T[]) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
}

export async function readGptImageFeedbacks() {
  return readJsonArray<GptImageFeedbackRecord>(feedbacksPath);
}

export async function appendGptImageFeedback(record: GptImageFeedbackRecord) {
  const feedbacks = await readGptImageFeedbacks();
  const next = [record, ...feedbacks];
  await writeJsonArray(feedbacksPath, next);
  return next;
}

export async function readGptImageCandidates() {
  return readJsonArray<GptImageCandidate>(candidatesPath);
}

export async function appendGptImageCandidates(candidates: GptImageCandidate[]) {
  const existing = await readGptImageCandidates();
  const next = [...candidates, ...existing];
  await writeJsonArray(candidatesPath, next);
  return next;
}

export const gptImageFeedbackFilePaths = {
  feedbacks: "data/gpt-image-feedbacks.json",
  candidates: "data/gpt-image-candidates.json",
};
