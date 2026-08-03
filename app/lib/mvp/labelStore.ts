import { AdImageLabel } from "./types";
import { JsonArrayRepository } from "./jsonRepository";

const labelRepository = new JsonArrayRepository<AdImageLabel>(
  "data/ad-image-labels.json",
  (label) => ({
    ...label,
    category: label.category ?? label.finalLabel?.category ?? "",
    aiDraft: {
      ...label.aiDraft,
      category: label.aiDraft?.category ?? label.finalLabel?.category ?? label.category ?? "",
    },
    finalLabel: {
      ...label.finalLabel,
      category: label.finalLabel?.category ?? label.category ?? "",
    },
    structuredLabels: label.structuredLabels || {
      hookTypes: label.finalLabel?.hookType ? [label.finalLabel.hookType] : [],
      appealPoints: label.finalLabel?.appealPoint ? [label.finalLabel.appealPoint] : [],
    },
  })
);

export async function readAdImageLabels() {
  return labelRepository.read();
}

export async function upsertAdImageLabel(label: AdImageLabel) {
  const labels = await readAdImageLabels();
  const index = labels.findIndex((item) => item.imageId === label.imageId);
  const nextLabel = { ...label, labeledAt: new Date().toISOString() };

  if (index >= 0) {
    labels[index] = nextLabel;
  } else {
    labels.unshift(nextLabel);
  }

  await labelRepository.write(labels);
  return nextLabel;
}
