import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import {
  backgroundCatalogStatus,
  catalogReviewQueue,
  createCatalogContactSheet,
  dedupeBackgroundCatalog,
  optimizeCatalogFromOriginals,
  rebuildBackgroundCatalogManifest,
  regenerateCatalogThumbnails,
  validateBackgroundCatalog,
} from "../app/lib/background-library/catalogMaintenance.server.ts";
import { checkComfyUi, createComfyPlan, resumeComfyJob } from "../app/lib/background-library/comfyui.server.ts";
import { collectLocalCatalogSources, importBackgroundSources } from "../app/lib/background-library/importPipeline.server.ts";
import { assertPexelsBulkAllowed, pexelsStatus, saveSelectedPexelsPhoto, searchPexels } from "../app/lib/background-library/pexels.server.ts";
import { backgroundStorage } from "../app/lib/background-library/storage.ts";

const execFileAsync = promisify(execFile);
const [, , command = "status", ...rawArgs] = process.argv;

function args(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) parsed[key] = true;
    else { parsed[key] = next; index += 1; }
  }
  return parsed;
}

const options = args(rawArgs);
const dryRun = options["dry-run"] === true || options.dryRun === "true";
const collectionId = String(options.collection || "");
const categoryId = String(options.category || "");
const limit = Math.max(1, Number(options.limit || 24));

function output(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function required(value, label) {
  if (!value) throw new Error(`${label} 옵션이 필요합니다.`);
  return value;
}

async function run() {
  if (command === "status") return output(await backgroundCatalogStatus());
  if (command === "import") {
    required(collectionId, "--collection");
    required(categoryId, "--category");
    const defaultPath = path.join(process.cwd(), "background-library", "import", collectionId, categoryId);
    const sourcePath = path.resolve(String(options.path || defaultPath));
    const sources = (await collectLocalCatalogSources(sourcePath)).slice(0, limit);
    const checkpointId = String(options.job || `import-cli-${Date.now()}`);
    const checkpointKey = `jobs/${checkpointId}.json`;
    if (!dryRun) await backgroundStorage.write(checkpointKey, `${JSON.stringify({ id: checkpointId, type: "import", collectionId, categoryId, sourcePath, limit, status: "running", updatedAt: new Date().toISOString() }, null, 2)}\n`);
    const result = await importBackgroundSources({ collectionId, categoryId, sources, dryRun });
    if (!dryRun) await backgroundStorage.write(checkpointKey, `${JSON.stringify({ id: checkpointId, type: "import", collectionId, categoryId, sourcePath, limit, status: "completed", result, updatedAt: new Date().toISOString() }, null, 2)}\n`);
    return output({ ...result, resumeCommand: dryRun ? "" : `npm run backgrounds:resume -- --job ${checkpointId}` });
  }
  if (command === "validate") return output(await validateBackgroundCatalog());
  if (command === "dedupe") return output(await dedupeBackgroundCatalog({ dryRun }));
  if (command === "optimize") return output(await optimizeCatalogFromOriginals({ dryRun }));
  if (command === "thumbs") return output(await regenerateCatalogThumbnails({ dryRun }));
  if (command === "manifest") return output(await rebuildBackgroundCatalogManifest({ dryRun }));
  if (command === "review") return output({ total: (await catalogReviewQueue()).length, items: (await catalogReviewQueue()).slice(0, limit) });
  if (command === "contact-sheet") return output(await createCatalogContactSheet({ limit, dryRun }));
  if (command === "pexels:search") {
    const result = await searchPexels({ query: required(String(options.query || ""), "--query"), page: Number(options.page || 1), perPage: Math.min(80, limit) });
    return output(result);
  }
  if (command === "pexels:save-selected") {
    required(collectionId, "--collection"); required(categoryId, "--category");
    const photoFile = path.resolve(required(String(options["photo-json"] || ""), "--photo-json"));
    const photo = JSON.parse(await fs.readFile(photoFile, "utf8"));
    return output(await saveSelectedPexelsPhoto({ photo, collectionId, categoryId, matchedQuery: String(options.query || ""), dryRun }));
  }
  if (command === "pexels:bulk-check") {
    assertPexelsBulkAllowed({ confirmedByUser: options.confirm === true, permissionEvidence: String(options.evidence || "") });
    return output({ allowed: true, status: pexelsStatus(), warning: "실행 전 대상·용량·요청 한도를 다시 확인하세요." });
  }
  if (command === "comfy:check") return output(await checkComfyUi());
  if (command === "comfy:plan") {
    return output(await createComfyPlan({ collectionId: required(collectionId, "--collection"), categoryId: categoryId || undefined, limit, dryRun: dryRun || options.save !== true }));
  }
  if (command === "comfy:generate") {
    if (options.job) return output(await resumeComfyJob(String(options.job)));
    const plan = await createComfyPlan({ collectionId: required(collectionId, "--collection"), categoryId: categoryId || undefined, limit, dryRun: false });
    if (!plan.canRun) {
      output({
        started: false, status: plan.connection, workflowValid: plan.workflowValid,
        requiredEnvironment: ["LOCAL_IMAGE_PROVIDER=comfyui", "COMFYUI_URL=http://127.0.0.1:8188", "COMFYUI_WORKFLOW_PATH", "COMFYUI_OUTPUT_NODE_ID", "COMFYUI_POSITIVE_PROMPT_NODE_ID", "COMFYUI_NEGATIVE_PROMPT_NODE_ID", "COMFYUI_SEED_NODE_ID"],
        resumeCommand: plan.resumeCommand,
      });
      process.exitCode = 2;
      return;
    }
    return output(await resumeComfyJob(plan.checkpoint.id));
  }
  if (command === "resume") {
    const jobId = required(String(options.job || ""), "--job");
    if (jobId.startsWith("comfyui-")) return output(await resumeComfyJob(jobId));
    if (jobId.startsWith("import-cli-")) {
      const checkpoint = JSON.parse((await backgroundStorage.read(`jobs/${jobId}.json`)).toString("utf8"));
      const sources = (await collectLocalCatalogSources(String(checkpoint.sourcePath))).slice(0, Math.max(1, Number(checkpoint.limit || limit)));
      const result = await importBackgroundSources({ collectionId: String(checkpoint.collectionId), categoryId: String(checkpoint.categoryId), sources, dryRun: false });
      await backgroundStorage.write(`jobs/${jobId}.json`, `${JSON.stringify({ ...checkpoint, status: "completed", result, updatedAt: new Date().toISOString() }, null, 2)}\n`);
      return output(result);
    }
    throw new Error("지원하지 않는 작업 ID입니다.");
  }
  if (command === "verify") {
    const catalog = await validateBackgroundCatalog();
    let legacy = { valid: false, output: "" };
    try {
      const result = await execFileAsync(process.execPath, ["scripts/validate-background-library.mjs"], { cwd: process.cwd(), maxBuffer: 4 * 1024 * 1024 });
      legacy = { valid: true, output: result.stdout.trim() };
    } catch (error) {
      legacy = { valid: false, output: error instanceof Error ? error.message : "legacy verify failed" };
    }
    output({ valid: catalog.valid && legacy.valid, catalog, legacy });
    if (!catalog.valid || !legacy.valid) process.exitCode = 1;
    return;
  }
  throw new Error(`지원하지 않는 명령입니다: ${command}`);
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  if (command.startsWith("comfy:")) {
    process.stderr.write("설정 후 재개: npm run backgrounds:comfy:plan -- --collection <id> --dry-run\n");
  }
  process.exitCode = 1;
});
