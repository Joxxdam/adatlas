import "server-only";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { editImageFromSource } from "../../mvp/openaiImageClient.ts";
import { buildNativeGroupValidationPrompt, buildNativeStagePrompt, buildNativeValidationPrompt } from "../nativeCreativePrompt.ts";
import { readBrandMemory } from "../codexRegistry.server.ts";
import type { NativeCreativeValidation, NativeGroupValidation } from "../types.ts";
import type { CreativeGenerationProvider, NativeCreativeSession, NativeGenerationInput, NativeValidationInput } from "./CreativeGenerationProvider.ts";
import { normalizeNativeCreativeValidation } from "../nativeCreativeValidation";

export class OpenAIFinalCreativeProvider implements CreativeGenerationProvider {
  readonly engine = "openai_api" as const;
  private readonly explicitPaidApiAuthorization: boolean;

  constructor(options: { explicitPaidApiAuthorization?: boolean } = {}) {
    this.explicitPaidApiAuthorization = options.explicitPaidApiAuthorization === true;
  }

  async status() {
    const serverEnabled = process.env.ADATLAS_PAID_API_EXPLICIT_ENABLED === "true";
    const available = Boolean(this.explicitPaidApiAuthorization && serverEnabled && process.env.OPENAI_API_KEY);
    return {
      engine: this.engine,
      available,
      authenticated: available,
      paidApiUsed: available,
      detail: available ? "이 작업에 사용자가 별도로 승인한 유료 OpenAI API" : "작업별 유료 API 선택, 서버 허용, OPENAI_API_KEY가 모두 필요합니다.",
    };
  }
  async openSession(): Promise<NativeCreativeSession> {
    const state = await this.status();
    if (!state.available) throw new Error(state.detail);
    let closed = false;
    const assertOpen = () => {
      if (closed) throw new Error("이미 종료된 OpenAI 이미지 제작 세션입니다.");
    };
    return {
      generate: async (input) => {
        assertOpen();
        return this.generateOnce(input);
      },
      validate: async (input) => {
        assertOpen();
        return this.validateOnce(input);
      },
      async close() {
        closed = true;
      },
    };
  }

  private async generateOnce(input: NativeGenerationInput) {
    const state = await this.status();
    if (!state.available) throw new Error(state.detail);
    const stage = input.stage || "copy-replacement";
    const productReferences = input.productReferencePaths || input.referencePaths;
    const sourceImagePath = stage === "structure-recreation" ? input.adReferencePath || input.sourceImagePath : input.sourceImagePath;
    if (!sourceImagePath) throw new Error(`${stage} 단계의 첫 번째 편집 소스가 없습니다.`);
    const memory = await readBrandMemory(input.job.advertiserId || "unknown-advertiser");
    // Golden advertisements contribute only abstract reusable traits through
    // brand memory. Their pixels are deliberately not attached, preventing an
    // older ad or its copy panel from being reproduced inside the new output.
    const editReferences = stage === "structure-recreation" ? [] : [...productReferences.slice(0, 3), input.adReferencePath].filter((file, index, files): file is string => Boolean(file) && file !== sourceImagePath && files.indexOf(file) === index).slice(0, 4);
    const generated = await editImageFromSource({
      sourceImagePath,
      referenceImagePaths: editReferences,
      prompt: buildNativeStagePrompt(stage, input.job, input.result, input.outputPath, input.feedback, memory),
      size: "1024x1024",
      quality: "high",
      explicitPaidApiAuthorization: this.explicitPaidApiAuthorization,
    });
    await writeFile(input.outputPath, generated.imageBuffer);
    return { outputPath: input.outputPath };
  }
  private async validateOnce(input: NativeValidationInput): Promise<NativeCreativeValidation> {
    const state = await this.status();
    if (!state.available) throw new Error(state.detail);
    const imageUrl = async (file: string) => {
      const extension = path.extname(file).toLowerCase();
      const mediaType = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
      return `data:${mediaType};base64,${(await readFile(file)).toString("base64")}`;
    };
    const validationReferences = [input.adReferencePath, ...input.referencePaths].filter((file, index, files): file is string => Boolean(file) && files.indexOf(file) === index).slice(0, 5);
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(Number(process.env.ADATLAS_OPENAI_VALIDATION_TIMEOUT_MS || 120_000)),
      body: JSON.stringify({
        model: process.env.OPENAI_VISION_MODEL || process.env.OPENAI_TEXT_MODEL || "gpt-5.6-sol",
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `${buildNativeValidationPrompt(input.job, input.result)}\nJSON만 반환: {hookAlignment,productIdentity,factualAccuracy,koreanTextAccuracy,readability,composition,diversity,commercialQuality,exportCompliance,productVisibility,humanNaturalness,categoryFit,foodAppetiteAppeal,sensoryExpression,mobileReadability,observedKoreanText,standaloneLogoDetected,standaloneLogoFindings,failures,recommendation}. standaloneLogoDetected는 실제 상품 패키지 밖에 새로 생성된 독립 로고·워드마크·엠블럼이 하나라도 있으면 true다. recommendation은 approve, revise, manual-review 중 하나다.`,
              },
              { type: "input_image", image_url: await imageUrl(input.imagePath), detail: "high" },
              ...(await Promise.all(
                validationReferences.map(async (file) => ({
                  type: "input_image",
                  image_url: await imageUrl(file),
                  detail: "high",
                }))
              )),
            ],
          },
        ],
        text: { format: { type: "json_object" } },
      }),
    });
    if (!response.ok) throw new Error(`openai_api 광고 검수 실패: HTTP ${response.status}`);
    const payload = (await response.json()) as {
      output_text?: string;
      output?: Array<{ content?: Array<{ text?: string }> }>;
    };
    const text =
      payload.output_text ||
      payload.output
        ?.flatMap((item) => item.content || [])
        .map((item) => item.text || "")
        .join("\n") ||
      "";
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim()) as Omit<NativeCreativeValidation, "checkedAt">;
    const score = (value: unknown) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    return normalizeNativeCreativeValidation(
      {
        hookAlignment: score(parsed.hookAlignment),
        productIdentity: score(parsed.productIdentity),
        factualAccuracy: score(parsed.factualAccuracy),
        koreanTextAccuracy: score(parsed.koreanTextAccuracy),
        readability: score(parsed.readability),
        composition: score(parsed.composition),
        diversity: score(parsed.diversity),
        commercialQuality: score(parsed.commercialQuality),
        exportCompliance: score(parsed.exportCompliance),
        productVisibility: score(parsed.productVisibility),
        humanNaturalness: score(parsed.humanNaturalness),
        categoryFit: score(parsed.categoryFit),
        foodAppetiteAppeal: score(parsed.foodAppetiteAppeal),
        sensoryExpression: score(parsed.sensoryExpression),
        mobileReadability: score(parsed.mobileReadability),
        observedKoreanText: Array.isArray(parsed.observedKoreanText) ? parsed.observedKoreanText.map(String).slice(0, 30) : [],
        standaloneLogoDetected: parsed.standaloneLogoDetected === true,
        standaloneLogoFindings: Array.isArray(parsed.standaloneLogoFindings) ? parsed.standaloneLogoFindings.map(String).slice(0, 10) : [],
        failures: Array.isArray(parsed.failures) ? parsed.failures.map(String).slice(0, 20) : [],
        recommendation: ["approve", "revise", "manual-review"].includes(parsed.recommendation) ? parsed.recommendation : "manual-review",
        checkedAt: new Date().toISOString(),
      },
      {
        category: input.job.creativePlan.categoryCreativeProfile?.category || "general",
        exportComplianceVerified: input.exportComplianceVerified,
      }
    );
  }
  async validateGroup(input: { job: NativeGenerationInput["job"]; contactSheetPath: string }): Promise<NativeGroupValidation> {
    const state = await this.status();
    if (!state.available) throw new Error(state.detail);
    const extension = path.extname(input.contactSheetPath).toLowerCase();
    const mediaType = extension === ".png" ? "image/png" : "image/jpeg";
    const imageUrl = `data:${mediaType};base64,${(await readFile(input.contactSheetPath)).toString("base64")}`;
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(Number(process.env.ADATLAS_OPENAI_VALIDATION_TIMEOUT_MS || 120_000)),
      body: JSON.stringify({
        model: process.env.OPENAI_VISION_MODEL || process.env.OPENAI_TEXT_MODEL || "gpt-5.6-sol",
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `${buildNativeGroupValidationPrompt(input.job)}\nJSON만 반환한다.`,
              },
              { type: "input_image", image_url: imageUrl, detail: "high" },
            ],
          },
        ],
        text: { format: { type: "json_object" } },
      }),
    });
    if (!response.ok) throw new Error(`openai_api 그룹 검수 실패: HTTP ${response.status}`);
    const payload = (await response.json()) as {
      output_text?: string;
      output?: Array<{ content?: Array<{ text?: string }> }>;
    };
    const text =
      payload.output_text ||
      payload.output
        ?.flatMap((item) => item.content || [])
        .map((item) => item.text || "")
        .join("\n") ||
      "";
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim()) as Omit<NativeGroupValidation, "checkedAt">;
    const score = (value: unknown) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    const hookCodes = new Set(["H01", "H02", "H03", "H04", "H05", "H06"]);
    return {
      sceneDiversity: score(parsed.sceneDiversity),
      productPlacementDiversity: score(parsed.productPlacementDiversity),
      cameraDiversity: score(parsed.cameraDiversity),
      colorMoodDiversity: score(parsed.colorMoodDiversity),
      messageSeparation: score(parsed.messageSeparation),
      hookSceneAlignment: score(parsed.hookSceneAlignment),
      typographyDiversity: score(parsed.typographyDiversity),
      visualArchetypeDiversity: score(parsed.visualArchetypeDiversity),
      categoryFit: score(parsed.categoryFit),
      duplicatePairs: Array.isArray(parsed.duplicatePairs) ? parsed.duplicatePairs.filter((pair) => hookCodes.has(pair.leftHookCode) && hookCodes.has(pair.rightHookCode)).slice(0, 15) : [],
      reviseHookCodes: Array.isArray(parsed.reviseHookCodes) ? parsed.reviseHookCodes.filter((code) => hookCodes.has(code)).slice(0, 6) : [],
      failures: Array.isArray(parsed.failures) ? parsed.failures.map(String).slice(0, 20) : [],
      recommendation: ["approve", "revise", "manual-review"].includes(parsed.recommendation) ? parsed.recommendation : "manual-review",
      checkedAt: new Date().toISOString(),
    };
  }
}
