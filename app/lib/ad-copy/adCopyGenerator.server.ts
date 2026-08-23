import "server-only";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { Codex } from "@openai/codex-sdk";
import { creativeGenerationJobStore } from "../creative-generation/jobStore.server";
import { executionResults } from "../creative-generation/jobRunnerPolicy";
import type { GenerationJob, GenerationResult } from "../creative-generation/types";
import { getAdvertiserThread, resetAdvertiserThread, saveAdvertiserThread } from "../creative-generation/codexRegistry.server";
import { loadCopyGuideForProduct } from "../mvp/copyGuideLoader";
import { adCopyRepository } from "./adCopyRepository.server";
import { AD_COPY_PROMPT_VERSION, buildAdCopyPrompt, buildAdCopyQaPrompt } from "./adCopyPromptBuilder.server";
import { adCopyFingerprint, selectRepresentativeResultId, validateAdCopyAgainstTruth } from "./adCopyValidator";
import type { AdCopyQa, ProductAdCopy } from "./types";

const execFileAsync = promisify(execFile);
const generationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["primaryText", "adTitle", "languageTraits"],
  properties: {
    primaryText: { type: "string", minLength: 20, maxLength: 600 },
    adTitle: { type: "string", minLength: 4, maxLength: 40 },
    languageTraits: { type: "array", minItems: 2, maxItems: 10, items: { type: "string" } },
  },
} as const;
const qaSchema = {
  type: "object",
  additionalProperties: false,
  required: ["factualAccuracy", "hookAlignment", "metaReadability", "failures", "recommendation"],
  properties: {
    factualAccuracy: { type: "integer", minimum: 0, maximum: 100 },
    hookAlignment: { type: "integer", minimum: 0, maximum: 100 },
    metaReadability: { type: "integer", minimum: 0, maximum: 100 },
    failures: { type: "array", items: { type: "string" } },
    recommendation: { type: "string", enum: ["approve", "revise", "manual-review"] },
  },
} as const;

type GeneratedCopy = { primaryText: string; adTitle: string; languageTraits: string[] };
type QaResponse = Omit<AdCopyQa, "passed" | "checkedAt"> & { recommendation: "approve" | "revise" | "manual-review" };
const locks = new Map<string, Promise<void>>();

function cleanEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !["OPENAI_API_KEY", "CODEX_API_KEY", "AZURE_OPENAI_API_KEY"].includes(key))) as Record<string, string>;
}

function codexExecutable() {
  const explicit = process.env.CODEX_CLI_PATH?.trim();
  if (explicit && existsSync(explicit)) return explicit;
  for (const directory of (process.env.PATH || "").split(path.delimiter)) {
    const candidate = path.join(directory, process.platform === "win32" ? "codex.exe" : "codex");
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

async function assertAuthenticated() {
  const executable = codexExecutable();
  if (!executable) throw new Error("로컬 Codex 실행 파일을 찾지 못했습니다.");
  const { stdout, stderr } = await execFileAsync(executable, ["login", "status"], { timeout: 10_000, env: cleanEnvironment() as NodeJS.ProcessEnv });
  if (!/logged in/i.test(`${stdout}\n${stderr}`)) throw new Error("로컬 Codex 로그인이 필요합니다.");
}

function representative(job: GenerationJob) {
  const scoped = executionResults(job);
  const id = selectRepresentativeResultId({ representativeResultId: job.representativeResultId, executionResultIds: job.executionResultIds, results: scoped });
  return scoped.find((result) => result.id === id);
}

function sourceFingerprint(job: GenerationJob, result: GenerationResult) {
  return adCopyFingerprint([AD_COPY_PROMPT_VERSION, job.productTruth.productId, ...job.productTruth.facts.filter((fact) => fact.usableInCopy && fact.verification !== "unverified").map((fact) => `${fact.id}:${fact.value}`), result.id, result.hookPlan.id, result.hookPlan.headline, result.hookPlan.body, ...(result.nativeCreative?.validation?.observedKoreanText || [])]);
}

function placeholder(job: GenerationJob, result: GenerationResult, fingerprint: string, revision: number): ProductAdCopy {
  const now = new Date().toISOString();
  return {
    id: job.adCopy?.id || `ad-copy-${randomUUID()}`,
    jobId: job.id,
    advertiserId: job.advertiserId || "unknown-advertiser",
    productId: job.productTruth.productId,
    creativeId: result.hookPlan.creativeBrief?.creativeId || result.id,
    representativeResultId: result.id,
    basedOnHookId: result.hookPlan.id,
    basedOnCreativeBriefId: result.hookPlan.creativeBrief?.creativeId || result.id,
    assetCode: result.creativeAsset?.assetCode,
    adName: result.creativeAsset?.recommendedAdName,
    utm: result.creativeAsset?.utmContent,
    verifiedFacts: job.productTruth.facts.filter((fact) => fact.usableInCopy && fact.verification !== "unverified").map((fact) => `${fact.label}: ${fact.value}`),
    languageTraits: [],
    generatedAt: now,
    updatedAt: now,
    status: "generating",
    revision,
    promptVersion: AD_COPY_PROMPT_VERSION,
    sourceFingerprint: fingerprint,
  };
}

async function generateWithCodex(job: GenerationJob, result: GenerationResult, approvedCopies: Awaited<ReturnType<typeof adCopyRepository.approvedForAdvertiser>>) {
  await assertAuthenticated();
  const codex = new Codex({ env: cleanEnvironment(), codexPathOverride: codexExecutable() });
  const identity = `${job.advertiserId || "unknown-advertiser"}--ad-copy`;
  const record = await getAdvertiserThread(identity);
  const options = { workingDirectory: process.cwd(), sandboxMode: "workspace-write" as const, approvalPolicy: "never" as const, networkAccessEnabled: false, model: process.env.ADATLAS_CODEX_MODEL?.trim() || "gpt-5.6-sol", modelReasoningEffort: "high" as const };
  let thread = record?.threadId ? codex.resumeThread(record.threadId, options) : codex.startThread(options);
  const approvedTexts = approvedCopies.map((copy) => copy.primaryText || "").filter(Boolean);
  const product = job.productTruth.product;
  const loadedGuide = product.copyGuideContext
    ? product.copyGuideContext
    : await loadCopyGuideForProduct({
        advertiserName: job.advertiserName || product.advertiserName,
        brandName: product.brandName,
        productUrl: product.landingUrl,
        category: product.category,
        productName: product.productName,
        copyGuideId: product.copyGuideId,
      });
  let failures: string[] = [];
  for (let attempt = 0; attempt <= 2; attempt += 1) {
    const prompt = buildAdCopyPrompt({ job, result, approvedCopies, copyGuideContent: loadedGuide?.content, retryFailures: failures });
    const content = [{ type: "text" as const, text: prompt }, ...(result.nativeCreative?.finalPath ? [{ type: "local_image" as const, path: result.nativeCreative.finalPath }] : [])];
    let response;
    try {
      response = await thread.run(content, { outputSchema: generationSchema, signal: AbortSignal.timeout(Number(process.env.ADATLAS_CODEX_COPY_TIMEOUT_MS || 150_000)) });
    } catch (error) {
      if (!record?.threadId || attempt > 0) throw error;
      await resetAdvertiserThread(identity);
      thread = codex.startThread(options);
      response = await thread.run(content, { outputSchema: generationSchema, signal: AbortSignal.timeout(Number(process.env.ADATLAS_CODEX_COPY_TIMEOUT_MS || 150_000)) });
    }
    const generated = JSON.parse(response.finalResponse) as GeneratedCopy;
    const local = validateAdCopyAgainstTruth({ primaryText: generated.primaryText, adTitle: generated.adTitle, truth: job.productTruth, hookHeadline: result.hookPlan.headline, approvedCopies: approvedTexts });
    const qaThread = codex.startThread(options);
    const qaResponse = await qaThread.run(buildAdCopyQaPrompt({ job, result, primaryText: generated.primaryText, adTitle: generated.adTitle }), { outputSchema: qaSchema, signal: AbortSignal.timeout(Number(process.env.ADATLAS_CODEX_COPY_QA_TIMEOUT_MS || 120_000)) });
    const qa = JSON.parse(qaResponse.finalResponse) as QaResponse;
    failures = [...new Set([...local.failures, ...qa.failures])];
    if (local.passed && qa.recommendation === "approve" && qa.factualAccuracy >= 95 && qa.hookAlignment >= 85 && qa.metaReadability >= 85) {
      await saveAdvertiserThread({ advertiserId: identity, advertiserName: `${job.advertiserName || "광고주"} · 광고문구`, domain: "local-ad-copy", threadId: thread.id || undefined, turnCount: (record?.turnCount || 0) + 1 });
      return {
        generated: {
          primaryText: generated.primaryText.trim(),
          adTitle: generated.adTitle.trim(),
          languageTraits: generated.languageTraits
            .map(String)
            .map((value) => value.trim())
            .filter(Boolean)
            .slice(0, 10),
        },
        qa: { passed: true, factualAccuracy: qa.factualAccuracy, hookAlignment: qa.hookAlignment, metaReadability: qa.metaReadability, failures: [], checkedAt: new Date().toISOString() } satisfies AdCopyQa,
      };
    }
  }
  return { generated: undefined, qa: { passed: false, factualAccuracy: 0, hookAlignment: 0, metaReadability: 0, failures: failures.length ? failures : ["독립 문구 검수를 통과하지 못했습니다."], checkedAt: new Date().toISOString() } satisfies AdCopyQa };
}

async function runEnsure(jobId: string, force: boolean) {
  let job = await creativeGenerationJobStore.get(jobId);
  if (!job) throw new Error("광고 생성 작업을 찾지 못했습니다.");
  const result = representative(job);
  if (!result) return job;
  const fingerprint = sourceFingerprint(job, result);
  if (!force && job.adCopy?.sourceFingerprint === fingerprint && ["ready", "approved"].includes(job.adCopy.status)) return job;
  const pending = placeholder(job, result, fingerprint, (job.adCopy?.revision || 0) + (job.adCopy ? 1 : 0));
  job = await creativeGenerationJobStore.update(jobId, (current) => ({ ...current, representativeResultId: result.id, adCopy: pending }));
  try {
    const approved = await adCopyRepository.approvedForAdvertiser(pending.advertiserId);
    const outcome = await generateWithCodex(job, result, approved);
    const now = new Date().toISOString();
    const record: ProductAdCopy = outcome.generated
      ? {
          ...pending,
          primaryText: outcome.generated.primaryText,
          adTitle: outcome.generated.adTitle,
          languageTraits: outcome.generated.languageTraits,
          status: "ready",
          qa: outcome.qa,
          generatedAt: now,
          updatedAt: now,
        }
      : {
          ...pending,
          primaryText: undefined,
          adTitle: undefined,
          status: "needs-review",
          qa: outcome.qa,
          updatedAt: now,
        };
    await adCopyRepository.save(record);
    return creativeGenerationJobStore.update(jobId, (current) => ({ ...current, adCopy: record }));
  } catch (error) {
    const now = new Date().toISOString();
    const failed: ProductAdCopy = {
      ...pending,
      status: "needs-review",
      primaryText: undefined,
      adTitle: undefined,
      updatedAt: now,
      qa: { passed: false, factualAccuracy: 0, hookAlignment: 0, metaReadability: 0, failures: [(error instanceof Error ? error.message : "광고문구 생성 실패").replace(/(?:\/Users|\/private|\/tmp|[A-Z]:\\)[^\s]+/g, "로컬 파일").slice(0, 300)], checkedAt: now },
    };
    await adCopyRepository.save(failed);
    return creativeGenerationJobStore.update(jobId, (current) => ({ ...current, adCopy: failed }));
  }
}

export async function ensureProductAdCopy(jobId: string, options: { force?: boolean } = {}) {
  const previous = locks.get(jobId) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  locks.set(jobId, queued);
  await previous;
  try {
    return await runEnsure(jobId, Boolean(options.force));
  } finally {
    release();
    if (locks.get(jobId) === queued) locks.delete(jobId);
  }
}

export async function approveProductAdCopy(jobId: string, input: { reason?: string; performanceData?: Record<string, number> } = {}) {
  const approved = await adCopyRepository.approve(jobId, input);
  return creativeGenerationJobStore.update(jobId, (job) => ({ ...job, adCopy: approved }));
}

export async function excludeProductAdCopy(jobId: string) {
  const job = await creativeGenerationJobStore.update(jobId, (current) => (current.adCopy ? { ...current, adCopy: { ...current.adCopy, status: "excluded", updatedAt: new Date().toISOString() } } : current));
  if (job.adCopy) await adCopyRepository.save(job.adCopy);
  return job;
}
