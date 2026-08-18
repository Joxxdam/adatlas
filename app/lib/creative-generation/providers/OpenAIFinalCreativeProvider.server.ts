import "server-only";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { editImageFromSource } from "../../mvp/openaiImageClient.ts";
import { buildNativeFinalCreativePrompt, buildNativeValidationPrompt } from "../nativeCreativePrompt.ts";
import type { NativeCreativeValidation } from "../types.ts";
import type { CreativeGenerationProvider, NativeGenerationInput } from "./CreativeGenerationProvider.ts";

export class OpenAIFinalCreativeProvider implements CreativeGenerationProvider {
  readonly engine = "openai_api" as const;
  async status() { const available = Boolean(process.env.OPENAI_API_KEY && process.env.ADATLAS_PAID_API_EXPLICIT_ENABLED === "true"); return { engine: this.engine, available, authenticated: available, paidApiUsed: true, detail: available ? "사용자가 선택한 유료 OpenAI API" : "OPENAI_API_KEY와 ADATLAS_PAID_API_EXPLICIT_ENABLED=true가 필요합니다." }; }
  async generate(input: NativeGenerationInput) {
    const state = await this.status(); if (!state.available) throw new Error(state.detail);
    const sourceImagePath = input.sourceImagePath || input.referencePaths[0];
    const generated = await editImageFromSource({ sourceImagePath, referenceImagePaths: input.referencePaths.slice(1, 4), prompt: buildNativeFinalCreativePrompt(input.job, input.result, input.outputPath, input.feedback), size: "1024x1024", quality: "high" });
    await writeFile(input.outputPath, generated.imageBuffer);
    return { outputPath: input.outputPath };
  }
  async validate(input: { job: NativeGenerationInput["job"]; result: NativeGenerationInput["result"]; imagePath: string; referencePaths: string[] }): Promise<NativeCreativeValidation> {
    const state = await this.status();
    if (!state.available) throw new Error(state.detail);
    const imageUrl = async (file: string) => {
      const extension = path.extname(file).toLowerCase();
      const mediaType = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
      return `data:${mediaType};base64,${(await readFile(file)).toString("base64")}`;
    };
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(Number(process.env.ADATLAS_OPENAI_VALIDATION_TIMEOUT_MS || 120_000)),
      body: JSON.stringify({
        model: process.env.OPENAI_VISION_MODEL || process.env.OPENAI_TEXT_MODEL || "gpt-5.6-sol",
        input: [{ role: "user", content: [
          { type: "input_text", text: `${buildNativeValidationPrompt(input.job, input.result)}\nJSON만 반환: {hookAlignment,productIdentity,factualAccuracy,koreanTextAccuracy,readability,composition,diversity,commercialQuality,exportCompliance,observedKoreanText,failures,recommendation}. recommendation은 approve, revise, manual-review 중 하나다.` },
          { type: "input_image", image_url: await imageUrl(input.imagePath), detail: "high" },
          ...await Promise.all(input.referencePaths.slice(0, 4).map(async (file) => ({ type: "input_image", image_url: await imageUrl(file), detail: "high" }))),
        ] }],
        text: { format: { type: "json_object" } },
      }),
    });
    if (!response.ok) throw new Error(`openai_api 광고 검수 실패: HTTP ${response.status}`);
    const payload = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
    const text = payload.output_text || payload.output?.flatMap((item) => item.content || []).map((item) => item.text || "").join("\n") || "";
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim()) as Omit<NativeCreativeValidation, "checkedAt">;
    const score = (value: unknown) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    return {
      hookAlignment: score(parsed.hookAlignment), productIdentity: score(parsed.productIdentity), factualAccuracy: score(parsed.factualAccuracy), koreanTextAccuracy: score(parsed.koreanTextAccuracy), readability: score(parsed.readability), composition: score(parsed.composition), diversity: score(parsed.diversity), commercialQuality: score(parsed.commercialQuality), exportCompliance: score(parsed.exportCompliance),
      observedKoreanText: Array.isArray(parsed.observedKoreanText) ? parsed.observedKoreanText.map(String).slice(0, 30) : [],
      failures: Array.isArray(parsed.failures) ? parsed.failures.map(String).slice(0, 20) : [],
      recommendation: ["approve", "revise", "manual-review"].includes(parsed.recommendation) ? parsed.recommendation : "manual-review",
      checkedAt: new Date().toISOString(),
    };
  }
}
