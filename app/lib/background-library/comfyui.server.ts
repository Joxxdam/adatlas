import { createHash, randomInt, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  importBackgroundSources,
  type CatalogImportSource,
} from "./importPipeline.server.ts";
import { readBackgroundCollectionConfigs } from "./catalogStore.server.ts";
import type { BackgroundJobCheckpoint, DiversityPlanItem } from "./catalogTypes.ts";
import { backgroundStorage } from "./storage.ts";

type Workflow = Record<string, { inputs?: Record<string, unknown>; class_type?: string }>;

const locationVariants = ["interior", "outdoor", "studio", "tabletop"];
const timeVariants = ["morning", "afternoon", "golden hour", "evening"];
const seasonVariants = ["spring", "summer", "autumn", "winter"];
const weatherVariants = ["clear", "soft cloudy", "after rain"];
const lensVariants = ["24mm wide", "35mm natural", "50mm editorial"];
const surfaceVariants = ["wood", "stone", "tile", "clean floor"];
const lightVariants = ["left side light", "right side light", "backlight", "soft frontal light"];

function comfyBaseUrl() {
  const raw = String(process.env.COMFYUI_URL || "http://127.0.0.1:8188").trim();
  const url = new URL(raw);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) {
    throw new Error("COMFYUI_URL은 localhost 또는 127.0.0.1만 사용할 수 있습니다.");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

function requiredNodeIds() {
  return {
    output: String(process.env.COMFYUI_OUTPUT_NODE_ID || ""),
    positive: String(process.env.COMFYUI_POSITIVE_PROMPT_NODE_ID || ""),
    negative: String(process.env.COMFYUI_NEGATIVE_PROMPT_NODE_ID || ""),
    seed: String(process.env.COMFYUI_SEED_NODE_ID || ""),
  };
}

async function loadWorkflow() {
  const workflowPath = String(process.env.COMFYUI_WORKFLOW_PATH || "").trim();
  if (!workflowPath) throw new Error("COMFYUI_WORKFLOW_PATH가 설정되지 않았습니다.");
  const resolved = path.resolve(workflowPath);
  const raw = await fs.readFile(resolved, "utf8");
  const workflow = JSON.parse(raw) as Workflow;
  const nodes = requiredNodeIds();
  for (const [name, id] of Object.entries(nodes)) {
    if (!id || !workflow[id]?.inputs) throw new Error(`ComfyUI ${name} node 설정을 확인해주세요.`);
  }
  return { workflow, workflowPath: resolved, workflowHash: createHash("sha256").update(raw).digest("hex"), nodes };
}

export async function checkComfyUi() {
  let endpoint = "";
  try {
    endpoint = comfyBaseUrl().toString();
    const response = await fetch(new URL("/system_stats", endpoint), {
      signal: AbortSignal.timeout(2_500), cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    let workflowValid = false;
    let workflowHash = "";
    let workflowError = "";
    try {
      const loaded = await loadWorkflow();
      workflowValid = true;
      workflowHash = loaded.workflowHash;
    } catch (error) {
      workflowError = error instanceof Error ? error.message : "workflow 검증 실패";
    }
    return { available: true, endpoint, workflowValid, workflowHash, workflowError };
  } catch (error) {
    return {
      available: false,
      endpoint: endpoint || "http://127.0.0.1:8188/",
      workflowValid: false,
      workflowHash: "",
      workflowError: error instanceof Error ? error.message : "ComfyUI에 연결할 수 없습니다.",
    };
  }
}

function seedFor(used: Set<number>) {
  let seed = randomInt(1, 2_147_483_647);
  while (used.has(seed)) seed = randomInt(1, 2_147_483_647);
  used.add(seed);
  return seed;
}

async function recentPlanKeys() {
  const jobs = (await backgroundStorage.list("jobs")).filter((item) => item.key.endsWith(".json")).slice(-20);
  const keys: string[] = [];
  for (const job of jobs) {
    try {
      const parsed = JSON.parse((await backgroundStorage.read(job.key)).toString("utf8")) as Partial<BackgroundJobCheckpoint>;
      (parsed.items || []).slice(-50).forEach((item) => keys.push(`${item.positivePrompt}|${item.seed}`));
    } catch { /* invalid local checkpoint is ignored and reported by verify */ }
  }
  return new Set(keys.slice(-50));
}

export async function createComfyPlan(input: {
  collectionId: string;
  categoryId?: string;
  limit?: number;
  dryRun?: boolean;
}) {
  const configs = await readBackgroundCollectionConfigs();
  const config = configs.find((item) => item.id === input.collectionId);
  if (!config) throw new Error("등록된 컬렉션이 아닙니다.");
  const categories = input.categoryId
    ? Object.entries(config.categories).filter(([id]) => id === input.categoryId)
    : Object.entries(config.categories);
  if (!categories.length) throw new Error("등록된 세부 카테고리가 아닙니다.");
  const connection = await checkComfyUi();
  const workflow = await loadWorkflow().catch(() => null);
  const usedSeeds = new Set<number>();
  const recentKeys = await recentPlanKeys();
  const maximum = Math.max(1, Math.min(2_000, Number(input.limit || categories.reduce((sum, [, count]) => sum + count, 0))));
  const distributionTotal = categories.reduce((sum, [, count]) => sum + count, 0);
  const items: DiversityPlanItem[] = [];
  for (const [categoryId, target] of categories) {
    const count = input.categoryId ? Math.min(maximum, target) : Math.max(1, Math.round(maximum * target / distributionTotal));
    for (let index = 0; index < count && items.length < maximum; index += 1) {
      const family = config.generationPromptParts.promptFamilies[index % config.generationPromptParts.promptFamilies.length];
      const query = config.searchQueries[categoryId]?.[index % Math.max(1, config.searchQueries[categoryId]?.length || 1)] || categoryId;
      const variation = [
        locationVariants[index % locationVariants.length], timeVariants[(index * 3) % timeVariants.length],
        seasonVariants[(index * 5) % seasonVariants.length], weatherVariants[(index * 7) % weatherVariants.length],
        lensVariants[(index * 11) % lensVariants.length], surfaceVariants[(index * 13) % surfaceVariants.length],
        lightVariants[(index * 17) % lightVariants.length], index % 2 ? "product space on left, copy space on right" : "product space on right, copy space on left",
      ].join(", ");
      const positivePrompt = `${config.generationPromptParts.base}, ${query}, ${family}, ${variation}`;
      let seed = seedFor(usedSeeds);
      while (recentKeys.has(`${positivePrompt}|${seed}`)) seed = seedFor(usedSeeds);
      items.push({
        id: `plan-${categoryId}-${index + 1}-${randomUUID().slice(0, 6)}`, collectionId: config.id,
        categoryId, promptFamily: family, positivePrompt, negativePrompt: config.negativePrompt,
        seed, width: 1024, height: 1024, status: "planned", attempts: 0, outputPath: "", error: "",
      });
    }
  }
  const estimatedBytes = items.length * 4.2 * 1024 * 1024;
  const checkpoint: BackgroundJobCheckpoint = {
    id: `comfyui-${Date.now()}-${randomUUID().slice(0, 8)}`, type: "comfyui", collectionId: config.id,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: "planned", cursor: 0,
    workflowHash: workflow?.workflowHash || "", items, failures: 0,
  };
  if (!input.dryRun) await backgroundStorage.write(`jobs/${checkpoint.id}.json`, `${JSON.stringify(checkpoint, null, 2)}\n`);
  return {
    checkpoint, connection, workflowValid: Boolean(workflow), estimatedBytes,
    resolution: "1024×1024 (승인 시 1600×1600 generatedUpscaled 표시)",
    categoryCounts: Object.fromEntries(categories.map(([id]) => [id, items.filter((item) => item.categoryId === id).length])),
    promptExamples: items.slice(0, 3).map((item) => ({ category: item.categoryId, prompt: item.positivePrompt, seed: item.seed })),
    canRun: connection.available && Boolean(workflow),
    resumeCommand: input.dryRun
      ? `npm run backgrounds:comfy:generate -- --collection ${config.id}${input.categoryId ? ` --category ${input.categoryId}` : ""} --limit ${items.length}`
      : `npm run backgrounds:resume -- --job ${checkpoint.id}`,
  };
}

function injectWorkflow(workflow: Workflow, item: DiversityPlanItem, nodes: ReturnType<typeof requiredNodeIds>) {
  const clone = structuredClone(workflow);
  const positiveInputs = clone[nodes.positive].inputs!;
  const negativeInputs = clone[nodes.negative].inputs!;
  const seedInputs = clone[nodes.seed].inputs!;
  if ("text" in positiveInputs) positiveInputs.text = item.positivePrompt;
  else positiveInputs.prompt = item.positivePrompt;
  if ("text" in negativeInputs) negativeInputs.text = item.negativePrompt;
  else negativeInputs.prompt = item.negativePrompt;
  if ("seed" in seedInputs) seedInputs.seed = item.seed;
  else seedInputs.noise_seed = item.seed;
  return clone;
}

async function waitForComfyOutput(base: URL, promptId: string, outputNodeId: string) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const response = await fetch(new URL(`/history/${encodeURIComponent(promptId)}`, base), {
      signal: AbortSignal.timeout(5_000), cache: "no-store",
    });
    if (response.ok) {
      const history = await response.json() as Record<string, { outputs?: Record<string, { images?: Array<{ filename?: string; subfolder?: string; type?: string }> }> }>;
      const output = history[promptId]?.outputs?.[outputNodeId]?.images?.[0];
      if (output?.filename) return output;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("ComfyUI 생성 시간이 제한을 초과했습니다.");
}

async function generateOne(item: DiversityPlanItem, loaded: Awaited<ReturnType<typeof loadWorkflow>>) {
  const base = comfyBaseUrl();
  const response = await fetch(new URL("/prompt", base), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: injectWorkflow(loaded.workflow, item, loaded.nodes), client_id: `adatlas-${process.pid}` }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`ComfyUI prompt 실패: HTTP ${response.status}`);
  const body = await response.json() as { prompt_id?: string };
  if (!body.prompt_id) throw new Error("ComfyUI prompt_id가 없습니다.");
  const output = await waitForComfyOutput(base, body.prompt_id, loaded.nodes.output);
  const viewUrl = new URL("/view", base);
  viewUrl.searchParams.set("filename", output.filename || "");
  viewUrl.searchParams.set("subfolder", output.subfolder || "");
  viewUrl.searchParams.set("type", output.type || "output");
  const imageResponse = await fetch(viewUrl, { signal: AbortSignal.timeout(20_000), redirect: "error" });
  if (!imageResponse.ok) throw new Error(`ComfyUI 출력 읽기 실패: HTTP ${imageResponse.status}`);
  const buffer = Buffer.from(await imageResponse.arrayBuffer());
  if (!buffer.length || buffer.length > 50 * 1024 * 1024) throw new Error("ComfyUI 출력 크기가 올바르지 않습니다.");
  return buffer;
}

export async function resumeComfyJob(jobId: string) {
  if (!/^comfyui-[a-z0-9-]+$/.test(jobId)) throw new Error("잘못된 작업 ID입니다.");
  const connection = await checkComfyUi();
  if (!connection.available) throw new Error(`ComfyUI unavailable: ${connection.workflowError}`);
  const loaded = await loadWorkflow();
  const jobKey = `jobs/${jobId}.json`;
  const job = JSON.parse((await backgroundStorage.read(jobKey)).toString("utf8")) as BackgroundJobCheckpoint;
  if (job.workflowHash && job.workflowHash !== loaded.workflowHash) throw new Error("workflow가 계획 생성 이후 변경되었습니다. 새 plan을 만들어주세요.");
  job.workflowHash = loaded.workflowHash;
  job.status = "running";
  const concurrency = Math.max(1, Math.min(2, Number(process.env.COMFYUI_CONCURRENCY || 1)));
  const pending = job.items.filter((item) => item.status !== "success" && item.attempts < 3);
  for (let offset = 0; offset < pending.length; offset += concurrency) {
    const batch = pending.slice(offset, offset + concurrency);
    await Promise.all(batch.map(async (item) => {
      item.status = "running";
      item.attempts += 1;
      try {
        const buffer = await generateOne(item, loaded);
        const source: CatalogImportSource = { name: `${item.id}.png`, buffer };
        const imported = await importBackgroundSources({
          collectionId: item.collectionId, categoryId: item.categoryId, sourceType: "local-generation",
          sources: [source], generated: { prompt: item.positivePrompt, negativePrompt: item.negativePrompt, seed: item.seed, workflowHash: loaded.workflowHash, upscaled: true },
        });
        const created = imported.items[0];
        if (!created || created.status === "rejected") throw new Error(imported.failures[0]?.reason || "생성 이미지 검증 실패");
        item.status = "success";
        item.outputPath = created.filePath;
        item.error = "";
      } catch (error) {
        item.status = "failed";
        item.error = error instanceof Error ? error.message : "생성 실패";
        job.failures += 1;
      }
    }));
    job.cursor = Math.min(job.items.length, job.cursor + batch.length);
    job.updatedAt = new Date().toISOString();
    await backgroundStorage.write(jobKey, `${JSON.stringify(job, null, 2)}\n`);
  }
  job.status = job.items.every((item) => item.status === "success") ? "completed" : "failed";
  job.updatedAt = new Date().toISOString();
  await backgroundStorage.write(jobKey, `${JSON.stringify(job, null, 2)}\n`);
  return job;
}
