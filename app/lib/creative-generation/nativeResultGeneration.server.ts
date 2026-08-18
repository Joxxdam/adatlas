import "server-only";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { creativeGenerationJobStore } from "./jobStore.server.ts";
import { createCreativeGenerationProvider } from "./providers/providerFactory.server.ts";
import { nativeHookDirectory, optimizeNativeFinalImage, prepareNativeReferenceImages, publicPathFor, writeNativeManifest } from "./nativeCreativeStorage.server.ts";
import { NATIVE_FINAL_PROMPT_VERSION } from "./nativeCreativePrompt.ts";
import { createAssetFromGenerationResult } from "../creative-assets/fromGeneration.server.ts";
import { toCreativeAssetSnapshot } from "../creative-assets/types.ts";
import { readBrandMemory, updateBrandMemory } from "./codexRegistry.server.ts";
import { passesNativeCreativeValidation } from "./nativeCreativeValidation.ts";

type NativeResultInput = { jobId: string; resultId: string; requestId?: string; action?: "generate"|"regenerate"|"revise"|"revalidate"|"approve"|"exclude"|"feedback"; feedback?: string };
const advertiserLocks = new Map<string, Promise<void>>();

async function runNativeResultGeneration(input: NativeResultInput) {
  const started = Date.now();
  let job = await creativeGenerationJobStore.get(input.jobId);
  if (!job) throw new Error("작업을 찾지 못했습니다.");
  const initial = job.results.find((item) => item.id === input.resultId);
  if (!initial) throw new Error("결과 항목을 찾지 못했습니다.");
  const action = input.action || "generate";
  if (["approve","exclude","feedback"].includes(action)) {
    const kind = action === "approve" ? "approve" : action === "exclude" ? "reject" : "feedback";
    await updateBrandMemory(job.advertiserId || "unknown-advertiser", { kind, value: input.feedback || `${initial.hookPlan.hookCode}: ${initial.hookPlan.headline}` });
    job = await creativeGenerationJobStore.update(job.id, (current) => ({ ...current, results: current.results.map((result) => result.id === input.resultId ? { ...result, status: action === "approve" ? "approved" : action === "exclude" ? "excluded" : result.status, userFeedback: input.feedback || result.userFeedback } : result) }));
    await writeNativeManifest(job, await readBrandMemory(job.advertiserId || "unknown-advertiser"));
    return { job, result: job.results.find((item) => item.id === input.resultId)! };
  }

  job = await creativeGenerationJobStore.update(job.id, (current) => ({ ...current, status: "running", startedAt: current.startedAt || new Date().toISOString(), results: current.results.map((result) => result.id === input.resultId ? { ...result, status: "running", generationStage: "reference-preparing", attempts: result.attempts + 1, error: undefined, startedAt: new Date().toISOString() } : result) }));
  const provider = createCreativeGenerationProvider(job.engine || "codex_local");
  const references = await prepareNativeReferenceImages(job);
  const directory = nativeHookDirectory(job.advertiserId || "unknown-advertiser", job.id, initial.hookPlan.hookCode);
  await mkdir(directory, { recursive: true });
  let sourceImagePath = action === "revise" ? initial.nativeCreative?.finalPath : undefined;
  let originalPath = action === "regenerate" ? undefined : initial.nativeCreative?.originalPath;
  const revisionPaths: string[] = action === "regenerate" ? [] : [...(initial.nativeCreative?.revisionPaths || [])];
  let validation = initial.nativeCreative?.validation;
  let generatedPath = "";
  let threadId = job.codexThreadId;
  if (action === "revalidate" && initial.nativeCreative?.finalPath) {
    generatedPath = initial.nativeCreative.finalPath;
    const active = job.results.find((item) => item.id === input.resultId)!;
    job = await creativeGenerationJobStore.update(job.id, (current) => ({ ...current, results: current.results.map((result) => result.id === input.resultId ? { ...result, generationStage: "quality-check" } : result) }));
    validation = await provider.validate({ job, result: active, imagePath: generatedPath, referencePaths: references });
  } else for (let revision = 0; revision <= 2; revision += 1) {
    const isRevision = revision > 0 || action === "revise";
    job = await creativeGenerationJobStore.update(job.id, (current) => ({ ...current, results: current.results.map((result) => result.id === input.resultId ? { ...result, generationStage: isRevision ? "ai-revising" : "ai-generating" } : result) }));
    generatedPath = path.join(directory, isRevision ? `revision-${Date.now()}-${revision}.png` : `original-${Date.now()}.png`);
    const active = job.results.find((item) => item.id === input.resultId)!;
    const generated = await provider.generate({ job, result: active, outputPath: generatedPath, referencePaths: references, sourceImagePath, feedback: isRevision ? input.feedback || validation?.failures.join(" · ") || "한국어 문구와 제품 동일성을 정확히 수정" : input.feedback });
    if (!isRevision) originalPath = generatedPath;
    threadId = generated.threadId || threadId;
    if (isRevision) revisionPaths.push(generatedPath);
    job = await creativeGenerationJobStore.update(job.id, (current) => ({ ...current, codexThreadId: threadId, results: current.results.map((result) => result.id === input.resultId ? { ...result, generationStage: "quality-check" } : result) }));
    validation = await provider.validate({ job, result: active, imagePath: generatedPath, referencePaths: references });
    if (passesNativeCreativeValidation(validation)) break;
    sourceImagePath = generatedPath;
  }
  if (!validation) throw new Error("AI 광고 검수 결과가 없습니다.");
  const finalFile = path.join(directory, "final.jpg");
  job = await creativeGenerationJobStore.update(job.id, (current) => ({ ...current, results: current.results.map((result) => result.id === input.resultId ? { ...result, generationStage: "exporting" } : result) }));
  const exported = await optimizeNativeFinalImage(generatedPath, finalFile);
  const successful = passesNativeCreativeValidation(validation);
  const status = successful ? "success" : validation.koreanTextAccuracy < 95 ? "korean-review" : validation.productIdentity < 80 ? "product-review" : "failed";
  const publicImage = publicPathFor(exported.file);
  const latest = job.results.find((item) => item.id === input.resultId)!;
  const assetResult = successful ? await createAssetFromGenerationResult({ job, result: latest, generatedImageUrl: publicImage, generationRequestKey: `native:${job.id}:${latest.id}:${input.requestId || Date.now()}`, copy: { headline: latest.hookPlan.headline, body: latest.hookPlan.body, proof: latest.hookPlan.proof, offer: latest.hookPlan.offer } }) : undefined;
  job = await creativeGenerationJobStore.update(job.id, (current) => ({ ...current, paidApiUsed: current.engine === "openai_api", results: current.results.map((result) => result.id === input.resultId ? { ...result, status, generationStage: successful ? "completed" : "quality-check", imagePath: publicImage, downloadName: assetResult?.asset.fileName || `${current.advertiserId}-${result.hookPlan.hookCode}.jpg`, creativeAsset: assetResult ? toCreativeAssetSnapshot(assetResult.asset) : result.creativeAsset, nativeCreative: { engine: current.engine || "codex_local", originalPath, revisionPaths, finalPath: finalFile, promptVersion: NATIVE_FINAL_PROMPT_VERSION, revisionCount: revisionPaths.length, validation, export: { width: exported.width, height: exported.height, fileSizeBytes: exported.bytes, jpegQuality: exported.quality, colorSpace: exported.colorSpace, format: exported.format } }, error: successful ? undefined : validation.failures.join(" · ") || "AI 품질 기준을 통과하지 못했습니다.", completedAt: new Date().toISOString(), durationMs: Date.now() - started } : result) }));
  const complete = job.results.every((result) => !["pending","running"].includes(result.status));
  if (complete) job = await creativeGenerationJobStore.update(job.id, (current) => ({ ...current, status: current.results.every((result) => ["success","approved"].includes(result.status)) ? "completed" : "partial", completedAt: new Date().toISOString(), timing: { ...current.timing, totalMs: Date.now() - new Date(current.createdAt).getTime() } }));
  await writeNativeManifest(job, await readBrandMemory(job.advertiserId || "unknown-advertiser"));
  return { job, result: job.results.find((item) => item.id === input.resultId)! };
}

export async function handleNativeResultGeneration(input: NativeResultInput) {
  const job = await creativeGenerationJobStore.get(input.jobId);
  const key = job?.advertiserId || input.jobId;
  const previous = advertiserLocks.get(key) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  advertiserLocks.set(key, queued);
  await previous;
  try { return await runNativeResultGeneration(input); }
  finally { release(); if (advertiserLocks.get(key) === queued) advertiserLocks.delete(key); }
}
