import "server-only";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import { creativeGenerationJobStore } from "../creative-generation/jobStore.server";
import { executionResults } from "../creative-generation/jobRunnerPolicy";
import { resolveRuntimeTimeout } from "../creative-generation/fastCreativeRuntime";
import type { GenerationJob, GenerationResult } from "../creative-generation/types";
import { getCreativeArchiveEntry } from "../creative-archive/service.server";
import type { CreativeArchiveEntry } from "../creative-archive/types";
import { loadCopyGuideForProduct } from "../mvp/copyGuideLoader";
import { adCopyRepository } from "./adCopyRepository.server";
import { AD_COPY_PROMPT_VERSION, buildAdCopyPrompt, buildAdCopyQaPrompt } from "./adCopyPromptBuilder.server";
import { adCopyFingerprint, selectRepresentativeResultId, validateAdCopyAgainstTruth } from "./adCopyValidator";
import type { AdCopyQa, ProductAdCopy } from "./types";

const generationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["primaryText", "adTitle", "languageTraits"],
  properties: {
    primaryText: { type: "string", minLength: 20, maxLength: 320 },
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
const openAiClientKey = Symbol.for("daywiz.ad-copy.openai-client-v1");
const openAiClientGlobal = globalThis as typeof globalThis & { [openAiClientKey]?: OpenAI };

function openAiClient() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("광고 문구 생성용 OPENAI_API_KEY가 설정되지 않았습니다.");
  const client = openAiClientGlobal[openAiClientKey] || new OpenAI({ apiKey, maxRetries: 1 });
  openAiClientGlobal[openAiClientKey] = client;
  return client;
}

function adCopyModel() {
  return process.env.CREATIVE_COPY_MODEL?.trim() || process.env.OPENAI_TEXT_MODEL?.trim() || "gpt-5.6-sol";
}

function adCopyReasoning(): "medium" | "high" {
  const configured = process.env.ADATLAS_AD_COPY_REASONING?.trim().toLowerCase();
  return configured === "high" || configured === "xhigh" ? "high" : "medium";
}

async function imageDataUrl(imagePath: string | undefined) {
  if (!imagePath) return undefined;
  const extension = path.extname(imagePath).toLowerCase();
  const mediaType = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
  return `data:${mediaType};base64,${(await readFile(imagePath)).toString("base64")}`;
}

async function requestStructuredResponse<T>(input: {
  prompt: string;
  imageUrl?: string;
  schemaName: string;
  schema: Record<string, unknown>;
  timeoutMs: number;
  maxOutputTokens: number;
}) {
  const response = await openAiClient().responses.create(
    {
      model: adCopyModel(),
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: input.prompt },
            ...(input.imageUrl ? [{ type: "input_image" as const, image_url: input.imageUrl, detail: "high" as const }] : []),
          ],
        },
      ],
      store: false,
      tools: [],
      reasoning: { effort: adCopyReasoning() },
      max_output_tokens: input.maxOutputTokens,
      text: {
        verbosity: "medium",
        format: {
          type: "json_schema",
          name: input.schemaName,
          strict: true,
          schema: input.schema,
        },
      },
    },
    { timeout: input.timeoutMs, maxRetries: 1 }
  );
  if (response.status && response.status !== "completed") {
    const detail = response.incomplete_details?.reason ? ` (${response.incomplete_details.reason})` : "";
    throw new Error(`광고 문구 API 응답이 완료되지 않았습니다: ${response.status}${detail}`);
  }
  if (!response.output_text?.trim()) throw new Error("광고 문구 API가 빈 응답을 반환했습니다.");
  return JSON.parse(response.output_text) as T;
}

function representative(job: GenerationJob) {
  const scoped = executionResults(job);
  const id = selectRepresentativeResultId({ representativeResultId: job.representativeResultId, executionResultIds: job.executionResultIds, results: scoped });
  return scoped.find((result) => result.id === id);
}

function sourceFingerprint(job: GenerationJob, result: GenerationResult) {
  const product = job.productTruth.product;
  return adCopyFingerprint([
    AD_COPY_PROMPT_VERSION,
    job.productTruth.productId,
    product.price || "",
    product.originalPrice || product.oldPrice || "",
    product.discountInfo || "",
    ...job.productTruth.facts.filter((fact) => fact.usableInCopy && fact.verification !== "unverified").map((fact) => `${fact.id}:${fact.value}`),
    result.id,
    result.hookPlan.id,
    result.hookPlan.headline,
    result.hookPlan.body,
    ...(result.nativeCreative?.validation?.observedKoreanText || []),
  ]);
}

function placeholder(
  job: GenerationJob,
  result: GenerationResult,
  fingerprint: string,
  revision: number,
  input: { archiveEntryId?: string; existing?: ProductAdCopy } = {}
): ProductAdCopy {
  const now = new Date().toISOString();
  return {
    id: input.archiveEntryId ? input.existing?.id || `ad-copy-${randomUUID()}` : job.adCopy?.id || `ad-copy-${randomUUID()}`,
    archiveEntryId: input.archiveEntryId,
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

function archivePromptContext(entry: CreativeArchiveEntry) {
  return {
    entryId: entry.id,
    headline: entry.headline,
    subCopy: entry.subCopy,
    mainMessage: entry.mainMessage,
    visualDirection: entry.visualDirection,
  };
}

async function generateWithOpenAI(
  job: GenerationJob,
  result: GenerationResult,
  approvedCopies: Awaited<ReturnType<typeof adCopyRepository.approvedForAdvertiser>>,
  input: { archiveEntry?: CreativeArchiveEntry; imagePath?: string } = {}
) {
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
  const archiveContext = input.archiveEntry ? archivePromptContext(input.archiveEntry) : undefined;
  const imagePath = input.imagePath || result.nativeCreative?.finalPath;
  const attachedImage = await imageDataUrl(imagePath);
  const maxRetries = archiveContext ? 1 : 2;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const prompt = buildAdCopyPrompt({ job, result, approvedCopies, copyGuideContent: loadedGuide?.content, retryFailures: failures, archiveContext });
    const generated = await requestStructuredResponse<GeneratedCopy>({
      prompt,
      imageUrl: attachedImage,
      schemaName: "ad_copy_generation",
      schema: generationSchema,
      timeoutMs: resolveRuntimeTimeout(process.env.ADATLAS_OPENAI_COPY_TIMEOUT_MS, 150_000, 30_000),
      maxOutputTokens: 3_200,
    });
    const local = validateAdCopyAgainstTruth({ primaryText: generated.primaryText, adTitle: generated.adTitle, truth: job.productTruth, hookHeadline: archiveContext ? "" : result.hookPlan.headline, approvedCopies: approvedTexts });
    const qaPrompt = buildAdCopyQaPrompt({ job, result, primaryText: generated.primaryText, adTitle: generated.adTitle, archiveContext });
    const qa = await requestStructuredResponse<QaResponse>({
      prompt: qaPrompt,
      imageUrl: attachedImage,
      schemaName: "ad_copy_qa",
      schema: qaSchema,
      timeoutMs: resolveRuntimeTimeout(process.env.ADATLAS_OPENAI_COPY_QA_TIMEOUT_MS, 120_000, 30_000),
      maxOutputTokens: 1_800,
    });
    failures = [...new Set([...local.failures, ...qa.failures])];
    if (local.passed && qa.recommendation === "approve" && qa.factualAccuracy >= 95 && qa.hookAlignment >= 85 && qa.metaReadability >= 85) {
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
    const outcome = await generateWithOpenAI(job, result, approved);
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

function archiveImagePath(result: GenerationResult) {
  const candidate = [result.deliveryBranding?.imagePath, result.nativeCreative?.finalPath, result.imagePath]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .flatMap((value) => {
      const direct = path.resolve(value);
      const publicFile = value.startsWith("/") ? path.join(process.cwd(), "public", value.replace(/^\/+/, "")) : path.join(process.cwd(), "public", value);
      return direct === publicFile ? [direct] : [direct, publicFile];
    })
    .find((value) => existsSync(value));
  if (!candidate) throw new Error("선택한 아카이브 완성 이미지 파일을 찾지 못했습니다.");
  return path.resolve(candidate);
}

async function runEnsureArchiveEntry(entryId: string, force: boolean) {
  const entry = await getCreativeArchiveEntry(entryId);
  if (!entry) throw new Error("아카이브에서 해당 이미지 콘텐츠를 찾지 못했습니다.");
  if (!entry.jobId || !entry.resultId) throw new Error("이전 방식으로 저장된 소재라 상품 사실과 연결할 수 없어 개별 문구 생성을 지원하지 않습니다.");
  const job = await creativeGenerationJobStore.get(entry.jobId);
  if (!job) throw new Error("아카이브 이미지의 상품 작업을 찾지 못했습니다.");
  const result = job.results.find((candidate) => candidate.id === entry.resultId);
  if (!result) throw new Error("아카이브 이미지의 생성 결과를 찾지 못했습니다.");
  const imagePath = archiveImagePath(result);
  const fingerprint = adCopyFingerprint([
    AD_COPY_PROMPT_VERSION,
    entry.id,
    entry.updatedAt,
    imagePath,
    job.productTruth.productId,
    job.productTruth.product.price || "",
    job.productTruth.product.originalPrice || job.productTruth.product.oldPrice || "",
    job.productTruth.product.discountInfo || "",
    ...job.productTruth.facts.filter((fact) => fact.usableInCopy && fact.verification !== "unverified").map((fact) => `${fact.id}:${fact.value}`),
  ]);
  const existing = await adCopyRepository.getByArchiveEntry(entry.id);
  if (!force && existing?.sourceFingerprint === fingerprint && ["ready", "approved"].includes(existing.status)) return existing;
  const pending = placeholder(job, result, fingerprint, (existing?.revision || 0) + (existing ? 1 : 0), {
    archiveEntryId: entry.id,
    existing,
  });
  await adCopyRepository.save(pending);
  try {
    const approved = await adCopyRepository.approvedForAdvertiser(pending.advertiserId);
    const outcome = await generateWithOpenAI(job, result, approved, { archiveEntry: entry, imagePath });
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
    return adCopyRepository.save(record);
  } catch (error) {
    const now = new Date().toISOString();
    const failed: ProductAdCopy = {
      ...pending,
      status: "needs-review",
      primaryText: undefined,
      adTitle: undefined,
      updatedAt: now,
      qa: {
        passed: false,
        factualAccuracy: 0,
        hookAlignment: 0,
        metaReadability: 0,
        failures: [(error instanceof Error ? error.message : "광고문구 생성 실패").replace(/(?:\/Users|\/private|\/tmp|[A-Z]:\\)[^\s]+/g, "로컬 파일").slice(0, 300)],
        checkedAt: now,
      },
    };
    return adCopyRepository.save(failed);
  }
}

export async function ensureArchiveEntryAdCopy(entryId: string, options: { force?: boolean } = {}) {
  const lockId = `archive:${entryId}`;
  const previous = locks.get(lockId) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  locks.set(lockId, queued);
  await previous;
  try {
    return await runEnsureArchiveEntry(entryId, Boolean(options.force));
  } finally {
    release();
    if (locks.get(lockId) === queued) locks.delete(lockId);
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
