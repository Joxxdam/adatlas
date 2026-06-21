import { promises as fs } from "fs";
import path from "path";
import { CollectedReference } from "./types";

const storePath = path.join(process.cwd(), "data", "collected-references.json");

async function ensureStore() {
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  try {
    await fs.access(storePath);
  } catch {
    await fs.writeFile(storePath, "[]\n", "utf8");
  }
}

export async function readCollectedReferences(): Promise<CollectedReference[]> {
  await ensureStore();
  const file = await fs.readFile(storePath, "utf8");
  return JSON.parse(file) as CollectedReference[];
}

export async function saveCollectedReferences(items: CollectedReference[]) {
  const existing = await readCollectedReferences();
  const byId = new Map(existing.map((item) => [item.id, item]));
  let added = 0;

  for (const item of items) {
    if (!byId.has(item.id)) {
      added += 1;
    }
    byId.set(item.id, item);
  }

  const next = [...byId.values()].sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
  await fs.writeFile(storePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");

  return { added, total: next.length };
}
