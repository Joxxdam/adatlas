import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import { NextResponse } from "next/server";

import type { SceneCandidate, SceneCandidateQuality, SceneGenerationInput, SceneGenerationProviderId, SceneGenerationResult, VisualDirection } from "../../../lib/creative/types";
import { GeminiSceneGenerationProvider } from "../../../lib/image-generation/GeminiSceneGenerationProvider";
import { MockSceneGenerationProvider } from "../../../lib/image-generation/MockSceneGenerationProvider";
import { OpenAISceneGenerationProvider } from "../../../lib/image-generation/OpenAISceneGenerationProvider";
import { isPaidImageGenerationEnabled, type SceneGenerationProvider } from "../../../lib/image-generation/SceneGenerationProvider";

export const runtime = "nodejs";

type Body = {
  direction?: VisualDirection;
  provider?: SceneGenerationProviderId;
  candidateCount?: number;
  /** Legacy advanced route only. The default Codex flow never sends this flag. */
  paidApiExplicitlySelected?: boolean;
};

type SceneAssessment = {
  resizedBuffer: Buffer;
  score: number;
  sourceOpaque: boolean;
  transparencyRatio: number;
  darkPixelRatio: number;
  brightness: number;
  contrast: number;
  reasons: string[];
  needsRetry: boolean;
};

const outputDirectory = path.join(process.cwd(), "public", "background-images");

function providerFor(id: SceneGenerationProviderId, options: { explicitPaidApiAuthorization?: boolean } = {}): SceneGenerationProvider {
  if (id === "gemini") return new GeminiSceneGenerationProvider();
  if (id === "mock") return new MockSceneGenerationProvider();
  return new OpenAISceneGenerationProvider(options);
}

function paletteFor(direction: VisualDirection) {
  const valid = direction.colorDirection.filter((color) => /^#[0-9a-f]{6}$/i.test(color));
  if (valid.length >= 3) return valid.slice(0, 4);
  if (direction.sceneProfileId.startsWith("personal-care")) {
    return ["#071c24", "#116c78", "#4dd7c4", "#e8fffb"];
  }
  if (direction.sceneProfileId.startsWith("food-meat")) {
    return ["#17100c", "#4a2b1b", "#a84a2a", "#f0c979"];
  }
  if (direction.sceneProfileId.startsWith("agriculture")) {
    return ["#29462c", "#6f8848", "#d5a648", "#fff3d5"];
  }
  return ["#101b2c", "#245a8e", "#39a6a4", "#f2f7fb"];
}

function backplateSvg(direction: VisualDirection) {
  const colors = paletteFor(direction);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200">
    <defs>
      <linearGradient id="base" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${colors[0]}"/>
        <stop offset="0.58" stop-color="${colors[1]}"/>
        <stop offset="1" stop-color="${colors[2]}"/>
      </linearGradient>
      <radialGradient id="light" cx="68%" cy="36%" r="66%">
        <stop offset="0" stop-color="${colors[3] || colors[2]}" stop-opacity="0.34"/>
        <stop offset="1" stop-color="${colors[3] || colors[2]}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="1200" height="1200" fill="url(#base)"/>
    <rect width="1200" height="1200" fill="url(#light)"/>
  </svg>`);
}

async function assessScene(buffer: Buffer): Promise<SceneAssessment> {
  const resizedBuffer = await sharp(buffer).rotate().resize(1200, 1200, { fit: "cover", position: "centre", kernel: sharp.kernel.lanczos3 }).ensureAlpha().png().toBuffer();
  const stats = await sharp(resizedBuffer).stats();
  const alpha = stats.channels[3];
  const transparencyRatio = alpha ? Math.max(0, 1 - alpha.mean / 255) : 0;
  const sample = await sharp(resizedBuffer).resize(96, 96, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  let visiblePixels = 0;
  let darkPixels = 0;
  let brightnessSum = 0;

  for (let offset = 0; offset < sample.data.length; offset += sample.info.channels) {
    const alphaValue = sample.info.channels === 4 ? sample.data[offset + 3] : 255;
    if (alphaValue < 32) continue;
    const red = sample.data[offset];
    const green = sample.data[offset + 1];
    const blue = sample.data[offset + 2];
    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    visiblePixels += 1;
    brightnessSum += luminance;
    if (luminance < 18) darkPixels += 1;
  }

  const brightness = visiblePixels ? brightnessSum / visiblePixels : 0;
  const darkPixelRatio = visiblePixels ? darkPixels / visiblePixels : 1;
  const contrast = stats.channels.slice(0, 3).reduce((sum, channel) => sum + channel.stdev, 0) / 3;
  const reasons: string[] = [];
  if (transparencyRatio > 0.002) reasons.push("투명하거나 비어 있는 픽셀이 감지되었습니다.");
  if (darkPixelRatio > 0.52) reasons.push("검은 영역이 지나치게 넓습니다.");
  if (brightness < 22) reasons.push("전체 장면이 지나치게 어둡습니다.");
  if (brightness > 246) reasons.push("전체 장면이 지나치게 밝습니다.");
  if (contrast < 7) reasons.push("장면의 명암과 디테일이 부족합니다.");

  const score = Math.max(0, Math.min(100, Math.round(100 - Math.min(58, transparencyRatio * 360) - Math.max(0, darkPixelRatio - 0.3) * 55 - Math.max(0, 34 - brightness) * 0.7 - Math.max(0, brightness - 232) * 0.6 - Math.max(0, 14 - contrast) * 1.4)));

  return {
    resizedBuffer,
    score,
    sourceOpaque: transparencyRatio <= 0.0001,
    transparencyRatio,
    darkPixelRatio,
    brightness,
    contrast,
    reasons,
    needsRetry: reasons.length > 0,
  };
}

async function saveScene(assessment: SceneAssessment, direction: VisualDirection, retried: boolean) {
  await fs.mkdir(outputDirectory, { recursive: true });
  const fileName = `scene-${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${direction.id.replace(/[^a-z0-9-]/gi, "").slice(0, 42)}.png`;
  const outputPath = path.join(outputDirectory, fileName);
  const finalBuffer = await sharp(backplateSvg(direction))
    .composite([{ input: assessment.resizedBuffer, blend: "over" }])
    .removeAlpha()
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  await fs.writeFile(outputPath, finalBuffer);
  const metadata = await sharp(finalBuffer).metadata();
  const repaired = !assessment.sourceOpaque || retried;
  const quality: SceneCandidateQuality = {
    score: assessment.score,
    status: assessment.reasons.length ? "review" : repaired ? "repaired" : "pass",
    sourceOpaque: assessment.sourceOpaque,
    outputOpaque: metadata.hasAlpha !== true,
    transparencyRatio: Number(assessment.transparencyRatio.toFixed(4)),
    darkPixelRatio: Number(assessment.darkPixelRatio.toFixed(4)),
    brightness: Number(assessment.brightness.toFixed(1)),
    retried,
    repaired,
    reasons: assessment.reasons,
  };
  return { imagePath: `/background-images/${fileName}`, quality };
}

function sceneInput(direction: VisualDirection, prompt: string): SceneGenerationInput {
  return {
    width: 1200,
    height: 1200,
    prompt,
    negativePrompt: direction.scenePromptPlan.negativePrompt,
    productSafeZone: direction.scenePromptPlan.productSafeZone,
    textSafeZones: direction.scenePromptPlan.textSafeZones,
    profileId: direction.sceneProfileId,
    colorHints: direction.colorDirection,
  };
}

function repairPrompt(prompt: string, assessment: SceneAssessment) {
  return `${prompt}\n\nQUALITY REPAIR PASS. The previous result failed these checks: ${assessment.reasons.join(" ")} Render a complete edge-to-edge opaque location photograph. Fill every pixel and all four corners with a continuous set, wall, table, floor, or atmosphere. The product-safe and text-safe zones must be low-detail parts of that same photographed environment, never transparency, black voids, white blanks, masks, cards, or cutouts. Do not depict any sold-category object or substitute product anywhere.`;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Body;
    const direction = body.direction;
    if (!direction?.scenePromptPlan?.prompt || !direction.id) {
      return NextResponse.json({ ok: false, error: "먼저 비주얼 방향을 선택해주세요." }, { status: 400 });
    }
    const requestedProvider = body.provider || "openai";
    const explicitPaidSelection = body.paidApiExplicitlySelected === true;
    if (requestedProvider !== "mock" && (!explicitPaidSelection || !isPaidImageGenerationEnabled())) {
      return NextResponse.json(
        {
          ok: false,
          error: "유료 이미지 API는 별도 공급자 선택과 작업별 동의 전에는 사용할 수 없습니다. 기본 광고 제작의 Codex·ChatGPT 로그인 생성을 이용해 주세요.",
        },
        { status: 403 }
      );
    }
    const count = Math.max(1, Math.min(3, Number(body.candidateCount) || 2));
    const primary = providerFor(requestedProvider, {
      explicitPaidApiAuthorization: explicitPaidSelection,
    });
    const fallback = new MockSceneGenerationProvider();
    const candidates: SceneCandidate[] = [];
    const errors: string[] = [];

    for (let index = 0; index < count; index += 1) {
      const variationPrompt = `${direction.scenePromptPlan.prompt}\n\nCandidate variation ${index + 1}: vary camera height, peripheral props, material detail, and light falloff while preserving every safe zone. Keep the frame fully opaque and do not add the sold category or any substitute product.`;
      const warnings: string[] = [];
      let retried = false;
      let result: SceneGenerationResult;
      let assessment: SceneAssessment;

      try {
        if (!primary.isConfigured()) {
          throw new Error(requestedProvider === "gemini" ? "GEMINI_API_KEY가 설정되지 않았습니다." : requestedProvider === "openai" ? "선택한 유료 OpenAI 이미지 공급자의 서버 인증정보를 확인해 주세요." : "안전 배경을 사용합니다.");
        }
        result = await primary.generateScene(sceneInput(direction, variationPrompt));
        if (!result.imageBuffer) throw new Error("장면 이미지 데이터가 없습니다.");
        assessment = await assessScene(result.imageBuffer);

        if (assessment.needsRetry && result.provider !== "mock") {
          retried = true;
          warnings.push(`1차 생성 품질을 자동 보정했습니다: ${assessment.reasons.join(" ")}`);
          try {
            const retryResult = await primary.generateScene(sceneInput(direction, repairPrompt(variationPrompt, assessment)));
            if (retryResult.imageBuffer) {
              const retryAssessment = await assessScene(retryResult.imageBuffer);
              if (retryAssessment.score >= assessment.score) {
                result = retryResult;
                assessment = retryAssessment;
              } else {
                warnings.push("재생성 결과보다 1차 결과의 기술 품질이 높아 1차 결과를 사용했습니다.");
              }
            }
          } catch (retryError) {
            const retryMessage = retryError instanceof Error ? retryError.message : "배경 품질 재생성 실패";
            console.error("[generate-scene] quality retry failed", {
              provider: requestedProvider,
              directionId: direction.id,
              retryMessage,
            });
            warnings.push("품질 재생성에 실패해 1차 결과를 불투명 보정했습니다.");
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "AI 장면 생성 실패";
        console.error("[generate-scene] provider failed", {
          provider: requestedProvider,
          directionId: direction.id,
          message,
        });
        errors.push(message);
        warnings.push(message);
        result = await fallback.generateScene(sceneInput(direction, variationPrompt));
        if (!result.imageBuffer) throw new Error("안전 배경 이미지 데이터가 없습니다.");
        assessment = await assessScene(result.imageBuffer);
      }

      const saved = await saveScene(assessment, direction, retried);
      if (assessment.reasons.length) warnings.push(...assessment.reasons);
      if (result.warning) warnings.push(result.warning);
      candidates.push({
        id: `scene-${Date.now()}-${index}-${crypto.randomBytes(3).toString("hex")}`,
        imagePath: saved.imagePath,
        provider: result.provider,
        directionId: direction.id,
        sceneType: direction.scenePromptPlan.sceneType,
        sceneProfileId: direction.sceneProfileId,
        reason: direction.scenePromptPlan.reason,
        archetypeId: direction.archetypeId,
        productSafeZone: direction.scenePromptPlan.productSafeZone,
        textSafeZones: direction.scenePromptPlan.textSafeZones,
        fallback: Boolean(result.fallback),
        warning: warnings.length ? Array.from(new Set(warnings)).join(" ") : undefined,
        quality: saved.quality,
        createdAt: new Date().toISOString(),
      });
    }

    const fallbackUsed = candidates.some((candidate) => candidate.fallback);
    const reviewed = candidates.filter((candidate) => candidate.quality?.status === "review").length;
    return NextResponse.json({
      ok: true,
      candidates,
      fallbackUsed,
      message: fallbackUsed ? "AI 배경 생성 연결이 불가능해 카테고리별 안전 배경을 만들었습니다. API 키와 서버 로그를 확인해주세요." : reviewed ? `${candidates.length}개의 장면을 생성했으며 ${reviewed}개는 추가 확인이 필요합니다.` : `${candidates.length}개의 불투명 1200x1200 광고 장면을 생성했습니다.`,
      errors,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "장면 생성에 실패했습니다.",
      },
      { status: 500 }
    );
  }
}
