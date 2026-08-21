import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CreativePlan, ProductTruth } from "./types";
import { PERFORMANCE_TEMPLATE_REGISTRY_VERSION } from "./performanceTemplateRegistry.ts";

export const CREATIVE_PLAN_CACHE_VERSION = "creative-plan-cache-v1";
export const BRAND_RULES_VERSION = "brand-copy-rules-v1";
export const HOOK_PROMPT_VERSION = "codex-local-hook-planner-v2-one-shot";

type CachedPlan = {
  fingerprint: string;
  exploration: ReturnType<typeof import("./hookHypothesisEngine").buildProductHookExploration>;
  copyGeneration: CreativePlan["copyGeneration"];
  createdAt: string;
};

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizedUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    [...url.searchParams.keys()].filter((key) => /^utm_|^(?:fbclid|gclid)$/i.test(key)).forEach((key) => url.searchParams.delete(key));
    return url.toString();
  } catch {
    return value.trim();
  }
}

export function buildCreativePlanFingerprint(truth: ProductTruth) {
  const factsHash = digest(truth.facts.map((fact) => ({ id:fact.id, value:fact.value, verification:fact.verification, usableInCopy:fact.usableInCopy })));
  const representative = truth.confirmedProductImage;
  const representativeImageHash = digest(representative ? {
    path:representative.path,
    width:representative.width,
    height:representative.height,
    transparent:representative.transparent,
  } : null);
  return digest({
    normalizedUrl: normalizedUrl(truth.product.landingUrl),
    productId: truth.productId,
    factsHash,
    representativeImageHash,
    brandRulesVersion: BRAND_RULES_VERSION,
    hookPromptVersion: HOOK_PROMPT_VERSION,
    templateRegistryVersion: PERFORMANCE_TEMPLATE_REGISTRY_VERSION,
  });
}

const root = path.join(process.cwd(), ".data", "creative-plan-cache");

export async function readCreativePlanCache(fingerprint: string) {
  try {
    const parsed = JSON.parse(await readFile(path.join(root, `${fingerprint}.json`), "utf8")) as CachedPlan;
    return parsed.fingerprint === fingerprint ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeCreativePlanCache(input: CachedPlan) {
  await mkdir(root, { recursive:true });
  const file = path.join(root, `${input.fingerprint}.json`);
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(input,null,2)}\n`, "utf8");
  await rename(temporary,file);
}
