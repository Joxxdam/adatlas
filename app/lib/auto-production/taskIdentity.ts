import { createHash } from "node:crypto";
import type { AutoProductionRun } from "./types";

export function createAutoProductionTaskId(runId: string, productId: string, occurrence = 0) {
  const digest = createHash("sha256").update(`${runId}\u0000${productId}\u0000${occurrence}`).digest("base64url").slice(0, 32);
  return `auto-task-${digest}`;
}

export function normalizeAutoProductionTaskIds(run: AutoProductionRun): AutoProductionRun {
  const seen = new Set<string>();
  let changed = false;
  const tasks = run.tasks.map((task, index) => {
    const productIdentity = task.candidate.id || task.candidate.productUrl || task.candidate.productName;
    let occurrence = 0;
    let id = createAutoProductionTaskId(run.id, productIdentity, occurrence);
    while (seen.has(id)) {
      occurrence += 1;
      id = createAutoProductionTaskId(run.id, `${productIdentity}:${index}`, occurrence);
    }
    seen.add(id);
    if (task.id === id) return task;
    changed = true;
    return { ...task, id };
  });
  return changed ? { ...run, tasks } : run;
}
