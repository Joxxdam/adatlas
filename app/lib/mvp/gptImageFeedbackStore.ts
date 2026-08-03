import type { GptImageCandidate, GptImageFeedbackRecord } from "./types";
import { JsonArrayRepository } from "./jsonRepository";

const feedbackRepository = new JsonArrayRepository<GptImageFeedbackRecord>(
  "data/gpt-image-feedbacks.json"
);
const candidateRepository = new JsonArrayRepository<GptImageCandidate>(
  "data/gpt-image-candidates.json"
);

export async function readGptImageFeedbacks() {
  return feedbackRepository.read();
}

export async function appendGptImageFeedback(record: GptImageFeedbackRecord) {
  return feedbackRepository.prepend([record]);
}

export async function readGptImageCandidates() {
  return candidateRepository.read();
}

export async function appendGptImageCandidates(candidates: GptImageCandidate[]) {
  return candidateRepository.prepend(candidates);
}

export const gptImageFeedbackFilePaths = {
  feedbacks: "data/gpt-image-feedbacks.json",
  candidates: "data/gpt-image-candidates.json",
};
