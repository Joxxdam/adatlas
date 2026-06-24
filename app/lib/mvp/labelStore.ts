import { promises as fs } from "fs";
import path from "path";
import { AdImageLabel } from "./types";

const labelsPath = path.join(process.cwd(), "data", "ad-image-labels.json");

async function ensureLabelsFile() {
  await fs.mkdir(path.dirname(labelsPath), { recursive: true });

  try {
    await fs.access(labelsPath);
  } catch {
    await fs.writeFile(labelsPath, "[]\n", "utf8");
  }
}

export async function readAdImageLabels() {
  await ensureLabelsFile();
  const raw = await fs.readFile(labelsPath, "utf8");
  const labels = JSON.parse(raw.replace(/^\uFEFF/, "")) as AdImageLabel[];
  return labels.map((label) => ({
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
  }));
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

  await fs.writeFile(labelsPath, `${JSON.stringify(labels, null, 2)}\n`, "utf8");
  return nextLabel;
}
