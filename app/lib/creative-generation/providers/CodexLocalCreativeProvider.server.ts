import "server-only";
import { access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import path from "node:path";
import { Codex, type Thread } from "@openai/codex-sdk";
import { getAdvertiserThread, readBrandMemory, resetAdvertiserThread, saveAdvertiserThread, type AdvertiserThreadRecord } from "../codexRegistry.server.ts";
import { buildNativeFinalCreativePrompt, buildNativeValidationPrompt } from "../nativeCreativePrompt.ts";
import type { NativeCreativeValidation } from "../types.ts";
import type { CreativeGenerationProvider, NativeGenerationInput, ProviderStatus } from "./CreativeGenerationProvider.ts";

const execFileAsync = promisify(execFile);
const validationSchema = {
  type: "object", additionalProperties: false,
  required: ["hookAlignment","productIdentity","factualAccuracy","koreanTextAccuracy","readability","composition","diversity","commercialQuality","exportCompliance","observedKoreanText","failures","recommendation"],
  properties: {
    hookAlignment:{type:"integer",minimum:0,maximum:100}, productIdentity:{type:"integer",minimum:0,maximum:100}, factualAccuracy:{type:"integer",minimum:0,maximum:100}, koreanTextAccuracy:{type:"integer",minimum:0,maximum:100}, readability:{type:"integer",minimum:0,maximum:100}, composition:{type:"integer",minimum:0,maximum:100}, diversity:{type:"integer",minimum:0,maximum:100}, commercialQuality:{type:"integer",minimum:0,maximum:100}, exportCompliance:{type:"integer",minimum:0,maximum:100},
    observedKoreanText:{type:"array",items:{type:"string"}}, failures:{type:"array",items:{type:"string"}}, recommendation:{type:"string",enum:["approve","revise","manual-review"]}
  }
};

function cleanEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !["OPENAI_API_KEY", "CODEX_API_KEY", "AZURE_OPENAI_API_KEY"].includes(key))) as Record<string,string>;
}

function resolveCodexExecutable() {
  const explicit = process.env.CODEX_CLI_PATH?.trim();
  if (explicit && existsSync(explicit)) return explicit;
  for (const directory of (process.env.PATH || "").split(path.delimiter)) {
    const candidate = path.join(directory, process.platform === "win32" ? "codex.exe" : "codex");
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export class CodexLocalCreativeProvider implements CreativeGenerationProvider {
  readonly engine = "codex_local" as const;
  private codex = new Codex({ env: cleanEnvironment(), codexPathOverride: resolveCodexExecutable() });

  async status(): Promise<ProviderStatus> {
    try {
      const { stdout, stderr } = await execFileAsync("codex", ["login", "status"], { timeout: 10_000, env: cleanEnvironment() as NodeJS.ProcessEnv });
      const authenticated = /logged in/i.test(`${stdout}\n${stderr}`);
      return { engine: this.engine, available: authenticated, authenticated, paidApiUsed: false, detail: authenticated ? "로컬 Codex · ChatGPT 로그인 연결됨" : "로컬 Codex 로그인이 필요합니다." };
    } catch {
      return { engine: this.engine, available: false, authenticated: false, paidApiUsed: false, detail: "Codex CLI를 찾지 못했거나 로그인 상태를 확인할 수 없습니다." };
    }
  }

  private async thread(input: NativeGenerationInput, forceNew = false): Promise<{ thread: Thread; record?: AdvertiserThreadRecord; resumed: boolean }> {
    const advertiserId = input.job.advertiserId || "unknown-advertiser";
    const record = await getAdvertiserThread(advertiserId);
    const options = {
      workingDirectory: process.cwd(),
      sandboxMode: "workspace-write" as const,
      approvalPolicy: "never" as const,
      networkAccessEnabled: false,
      model: process.env.ADATLAS_CODEX_MODEL?.trim() || "gpt-5.6-sol",
      modelReasoningEffort: "high" as const,
    };
    const maximumTurns = Math.max(10, Number(process.env.ADATLAS_CODEX_THREAD_MAX_TURNS || 60));
    const shouldRotate = Boolean(record?.threadId && (record.turnCount || 0) >= maximumTurns);
    if (record?.threadId && !forceNew && !shouldRotate) return { thread: this.codex.resumeThread(record.threadId, options), record, resumed: true };
    if (record?.threadId && (forceNew || shouldRotate)) await resetAdvertiserThread(advertiserId);
    return { thread: this.codex.startThread(options), record: { ...record, threadId: undefined, turnCount: 0 } as AdvertiserThreadRecord, resumed: false };
  }

  private threadFailure(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return /bad request|(?:thread|conversation|rollout|resume).*(?:not found|missing|invalid|unknown|expired)|(?:not found|missing|invalid|unknown|expired).*(?:thread|conversation|rollout|resume)/i.test(message);
  }

  private async saveThread(input: NativeGenerationInput, thread: Thread, record?: AdvertiserThreadRecord) {
    const advertiserId = input.job.advertiserId || "unknown-advertiser";
    const threadId = thread.id || undefined;
    await saveAdvertiserThread({ advertiserId, advertiserName: input.job.advertiserName || "", domain: (() => { try { return new URL(input.job.productTruth.product.landingUrl).hostname; } catch { return ""; } })(), threadId, turnCount: (record?.turnCount || 0) + 1 });
    return threadId;
  }

  async generate(input: NativeGenerationInput) {
    const state = await this.status();
    if (!state.available) throw new Error(`codex_local 사용 불가: ${state.detail} 유료 API로 자동 전환하지 않았습니다.`);
    let current = await this.thread(input);
    const memory = await readBrandMemory(input.job.advertiserId || "unknown-advertiser");
    const prompt = buildNativeFinalCreativePrompt(input.job, input.result, input.outputPath, input.feedback, memory);
    const images = [...new Set([...(input.sourceImagePath ? [input.sourceImagePath] : []), ...input.referencePaths])].slice(0, 5);
    const content = [{ type: "text" as const, text: prompt }, ...images.map((file) => ({ type: "local_image" as const, path: file }))];
    try {
      await current.thread.run(content, { signal: AbortSignal.timeout(Number(process.env.ADATLAS_CODEX_IMAGE_TIMEOUT_MS || 300_000)) });
    } catch (error) {
      if (!current.resumed || !this.threadFailure(error)) throw error;
      current = await this.thread(input, true);
      await current.thread.run(content, { signal: AbortSignal.timeout(Number(process.env.ADATLAS_CODEX_IMAGE_TIMEOUT_MS || 300_000)) });
    }
    await access(input.outputPath);
    const threadId = await this.saveThread(input, current.thread, current.record);
    return { outputPath: input.outputPath, threadId };
  }

  async validate(input: { job: NativeGenerationInput["job"]; result: NativeGenerationInput["result"]; imagePath: string; referencePaths: string[] }) {
    const generationInput = { ...input, outputPath: input.imagePath };
    let current = await this.thread(generationInput);
    const content = [{ type: "text" as const, text: buildNativeValidationPrompt(input.job, input.result) }, { type: "local_image" as const, path: input.imagePath }, ...input.referencePaths.slice(0, 4).map((file) => ({ type: "local_image" as const, path: file }))];
    let response;
    try {
      response = await current.thread.run(content, { outputSchema: validationSchema, signal: AbortSignal.timeout(Number(process.env.ADATLAS_CODEX_VALIDATION_TIMEOUT_MS || 150_000)) });
    } catch (error) {
      if (!current.resumed || !this.threadFailure(error)) throw error;
      current = await this.thread(generationInput, true);
      response = await current.thread.run(content, { outputSchema: validationSchema, signal: AbortSignal.timeout(Number(process.env.ADATLAS_CODEX_VALIDATION_TIMEOUT_MS || 150_000)) });
    }
    await this.saveThread(generationInput, current.thread, current.record);
    const parsed = JSON.parse(response.finalResponse) as Omit<NativeCreativeValidation, "checkedAt">;
    return { ...parsed, checkedAt: new Date().toISOString() };
  }
}
