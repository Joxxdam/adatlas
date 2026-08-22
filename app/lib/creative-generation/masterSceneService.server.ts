import crypto from "node:crypto";
import sharp from "sharp";
import { getOpenAIImageModel } from "../mvp/openaiImageClient.ts";
import { OpenAISceneGenerationProvider } from "../image-generation/OpenAISceneGenerationProvider.ts";
import { isPaidImageGenerationEnabled } from "../image-generation/SceneGenerationProvider.ts";
import type { SceneGenerationProvider } from "../image-generation/SceneGenerationProvider.ts";
import {
  masterSceneCacheKey,
  readCachedMasterScene,
  saveMasterSceneArtifact,
  writeMasterSceneFile,
} from "./creativeCache.server.ts";
import { readCreativeRasterAsset } from "./assets.server.ts";
import {
  AI_BACKGROUND_PROMPT_VERSION,
  AI_FULL_CREATIVE_PROMPT_VERSION,
  buildAiBackgroundPrompt,
  buildAiFullCreativePrompt,
  buildMasterScenePrompt,
  MASTER_SCENE_PROMPT_VERSION,
} from "./promptBuilder.ts";
import { createProtectedProductComposite } from "./protectedProductCompositor.server.ts";
import { evaluateProductIdentity } from "./productIdentityEvaluator.ts";
import { evaluateMasterSceneCandidate } from "./sceneQualityEvaluator.ts";
import type {
  CreativeImageAsset,
  MasterSceneArtifact,
  MasterSceneCandidate,
  MasterSceneGenerationMode,
  MasterSceneSpec,
  ProductReferenceProfile,
  ProductTruth,
  SceneAsset,
} from "./types.ts";

function clampCandidates() {
  const value = Number(process.env.ADATLAS_MAX_SCENE_CANDIDATES || 3);
  return Number.isFinite(value) ? Math.max(1, Math.min(3, Math.floor(value))) : 3;
}

async function normalizedMasterBuffer(buffer: Buffer) {
  return sharp(buffer)
    .rotate()
    .resize(1200, 1200, { fit: "cover", position: "centre" })
    .removeAlpha()
    .webp({ quality: 92, effort: 5 })
    .toBuffer();
}

function digest(buffer: Buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function selectedProductImage(truth: ProductTruth): CreativeImageAsset {
  if (!truth.confirmedProductImage) {
    throw new Error("실제 상품 사진을 유지하는 마스터 장면을 만들 제품 이미지가 없습니다.");
  }
  return truth.confirmedProductImage;
}

function candidateProvider(provider: string): MasterSceneCandidate["provider"] {
  return provider === "openai" ? "openai" : "library";
}

async function protectedCandidate(input: {
  truth: ProductTruth;
  profile: ProductReferenceProfile;
  spec: MasterSceneSpec;
  fallbackScene: SceneAsset;
  cacheKey: string;
  warning?: string;
}) {
  const product = selectedProductImage(input.truth);
  const composited = await createProtectedProductComposite({
    backgroundPath: input.fallbackScene.file,
    productImagePath: product.path,
    productTransparent: product.transparent,
    spec: input.spec,
  });
  const identity = await evaluateProductIdentity({
    profile: input.profile,
    candidate: composited.buffer,
    generationMode: "protected-product-composite",
  });
  const quality = await evaluateMasterSceneCandidate({
    buffer: composited.buffer,
    profile: input.profile,
    spec: input.spec,
    generationMode: "protected-product-composite",
    identity,
  });
  const file = await writeMasterSceneFile(input.cacheKey, composited.buffer, "protected");
  return {
    buffer: composited.buffer,
    file,
    quality,
    productBounds: composited.productBounds,
    estimatedProductAreaRatio: composited.estimatedProductAreaRatio,
    candidate: {
      id: `candidate-protected-${input.cacheKey.slice(0, 12)}`,
      file,
      provider: "protected-composite" as const,
      generationMode: "protected-product-composite" as const,
      quality,
      selected: true,
      warning: input.warning,
    },
    warnings: [
      input.warning,
      "실제 상품 사진을 유지하여 장면과 자연스럽게 결합했습니다.",
      ...composited.repairs,
    ].filter((value): value is string => Boolean(value)),
  };
}

async function realPhotoCandidate(input: {
  truth: ProductTruth;
  profile: ProductReferenceProfile;
  spec: MasterSceneSpec;
  fallbackScene: SceneAsset;
  cacheKey: string;
}) {
  const product = selectedProductImage(input.truth);
  const sceneIsCurrentProductPhoto = input.fallbackScene.sourceType === "product";
  if (product.role !== "product-lifestyle" || !sceneIsCurrentProductPhoto) {
    throw new Error("실사 전체 사진으로 확인된 상품 이미지가 없습니다.");
  }
  // Concept exploration deliberately rotates several verified detail photos.
  // Preserve the scene selected for this hook instead of silently reusing the
  // representative image for every result.
  const source = await readCreativeRasterAsset(input.fallbackScene.file);
  const buffer = await sharp(source)
    .rotate()
    .resize(1200, 1200, { fit: "cover", position: "centre" })
    .modulate({ brightness: 1.01, saturation: 1.04 })
    .sharpen({ sigma: 0.55, m1: 0.35, m2: 0.8 })
    .removeAlpha()
    .webp({ quality: 94, effort: 5 })
    .toBuffer();
  const identity = await evaluateProductIdentity({
    profile: input.profile,
    candidate: buffer,
    generationMode: "real-photo-adaptation",
  });
  const quality = await evaluateMasterSceneCandidate({
    buffer,
    profile: input.profile,
    spec: input.spec,
    generationMode: "real-photo-adaptation",
    identity,
  });
  const file = await writeMasterSceneFile(input.cacheKey, buffer, "real-photo");
  return {
    buffer,
    file,
    quality,
    productBounds: input.spec.productSafeZone,
    estimatedProductAreaRatio: 0.58,
    candidate: {
      id: `candidate-real-photo-${input.cacheKey.slice(0, 12)}`,
      file,
      provider: "library" as const,
      generationMode: "real-photo-adaptation" as const,
      quality,
      selected: true,
      warning: "실제 상세페이지 상품 사진을 1:1 광고 장면으로 보존했습니다.",
    },
    warnings: [
      "배경 제거 대신 실제 상품 사진 전체를 보존했습니다.",
      "상품 색·표면 질감·판매 품목을 바꾸지 않고 광고 비율과 선명도만 조정했습니다.",
    ],
  };
}

export async function createOrReuseMasterScene(input: {
  truth: ProductTruth;
  profile: ProductReferenceProfile;
  spec: MasterSceneSpec;
  fallbackScene?: SceneAsset;
  forceRevision?: boolean;
  revision?: number;
  provider?: SceneGenerationProvider;
}): Promise<MasterSceneArtifact> {
  // Legacy master-scene creation never opts into a paid provider implicitly.
  // A caller must inject an explicitly authorized provider from a separate paid UI.
  const provider = input.provider || new OpenAISceneGenerationProvider();
  const paidConfigured = isPaidImageGenerationEnabled() && provider.isConfigured();
  const requestedMode = input.spec.generationMode;
  const aiBackgroundOnly = requestedMode === "ai-background-composite";
  const aiFullCreative = requestedMode === "ai-reference-full-creative";
  const promptVersion = aiFullCreative
    ? AI_FULL_CREATIVE_PROMPT_VERSION
    : aiBackgroundOnly
      ? AI_BACKGROUND_PROMPT_VERSION
      : MASTER_SCENE_PROMPT_VERSION;
  if ((aiBackgroundOnly || aiFullCreative) && !paidConfigured) {
    throw new Error(
      "후킹별 AI 광고 콘텐츠 생성 설정이 필요합니다. OPENAI_API_KEY와 ADATLAS_IMAGE_GENERATION_ENABLED=true를 설정해 주세요. 기존 배경으로 대체하지 않습니다."
    );
  }
  const imageModel = paidConfigured ? getOpenAIImageModel() : "local-protected-composite-v1";
  const revision = input.forceRevision ? Math.max(1, input.revision || Date.now()) : Math.max(0, input.revision || 0);
  const cacheKey = masterSceneCacheKey({
    productId: input.truth.productId,
    profile: input.profile,
    spec: input.spec,
    promptVersion,
    imageModel,
    sourceAssetFile: input.fallbackScene?.file || "ai-generated-background",
    revision,
  });
  if (!input.forceRevision) {
    const cached = await readCachedMasterScene(cacheKey);
    if (cached) return cached;
  }

  const candidates: MasterSceneCandidate[] = [];
  let selected:
    | {
        buffer: Buffer;
        file: string;
        quality: MasterSceneCandidate["quality"];
        productBounds: MasterSceneSpec["productSafeZone"];
        estimatedProductAreaRatio: number;
        mode: MasterSceneGenerationMode;
        provider: MasterSceneCandidate["provider"];
        warnings: string[];
      }
    | undefined;

  if (aiFullCreative) {
    const referenceImageUrls = Array.from(new Set([
      selectedProductImage(input.truth).path,
      ...input.spec.referenceImageUrls,
    ])).filter(Boolean).slice(0, 4);
    if (!referenceImageUrls.length) {
      throw new Error("AI 전체 콘텐츠 제작에 사용할 상세페이지 상품 레퍼런스가 없습니다.");
    }
    const prompt = buildAiFullCreativePrompt(input.profile, input.spec);
    const generated = await provider.generateReferenceImage({
      width: 1200,
      height: 1200,
      prompt,
      negativePrompt: input.spec.forbiddenElements.join("; "),
      referenceImages: referenceImageUrls,
      profileId: input.truth.productId,
      colorHints: [input.spec.colorDirection],
    });
    if (!generated.imageBuffer) {
      throw new Error("AI 이미지 provider가 완성형 광고 키비주얼을 반환하지 않았습니다.");
    }
    const buffer = await normalizedMasterBuffer(generated.imageBuffer);
    const identity = await evaluateProductIdentity({
      profile: input.profile,
      candidate: buffer,
      generationMode: "ai-reference-full-creative",
    });
    const quality = await evaluateMasterSceneCandidate({
      buffer,
      profile: input.profile,
      spec: input.spec,
      generationMode: "ai-reference-full-creative",
      identity,
    });
    if (
      identity.brandMismatch ||
      identity.severeDistortion ||
      identity.humanArtifactDetected ||
      identity.textArtifactDetected ||
      identity.score < 55
    ) {
      throw new Error(
        `AI 전체 콘텐츠가 상품 동일성 검사를 통과하지 못했습니다: ${identity.findings.join(" · ") || "상품 형태·라벨 확인 필요"}`
      );
    }
    const file = await writeMasterSceneFile(cacheKey, buffer, "ai-full-creative");
    const candidate: MasterSceneCandidate = {
      id: `candidate-ai-full-${cacheKey.slice(0, 12)}`,
      file,
      provider: candidateProvider(generated.provider),
      generationMode: "ai-reference-full-creative",
      quality,
      selected: true,
      warning: generated.warning,
    };
    candidates.push(candidate);
    selected = {
      buffer,
      file,
      quality,
      productBounds: identity.productBounds || input.spec.productSafeZone,
      estimatedProductAreaRatio: identity.estimatedProductAreaRatio || Number(
        ((input.spec.productSafeZone.width * input.spec.productSafeZone.height * 0.72) / (1200 * 1200)).toFixed(4)
      ),
      mode: "ai-reference-full-creative",
      provider: candidate.provider,
      warnings: [
        "상세페이지의 실제 상품·사용·질감 이미지를 참조해 이 후킹의 완성형 키비주얼 전체를 AI로 제작했습니다.",
        "기존 배경 라이브러리와 배경 선택 기능은 사용하지 않았습니다.",
        "상품 동일성 자동 검사를 통과한 뒤 정확한 한국어 카피와 원본 로고를 후처리했습니다.",
        quality.copySafetyScore < 55
          ? "AI 장면의 카피 영역이 복잡해 렌더 단계에서 가독성 보호 그라데이션을 자동 적용했습니다."
          : undefined,
        quality.productIdentityScore < 78 ? "상품 라벨과 세부 형태를 최종 화면에서 한 번 더 확인해 주세요." : undefined,
        generated.warning,
      ].filter((value): value is string => Boolean(value)),
    };
  }

  if (aiBackgroundOnly) {
    const prompt = buildAiBackgroundPrompt(input.profile, input.spec);
    const generated = await provider.generateScene({
      width: 1200,
      height: 1200,
      prompt,
      negativePrompt: input.spec.forbiddenElements.join("; "),
      referenceImages: [],
      profileId: input.truth.productId,
      colorHints: [input.spec.colorDirection],
    });
    if (!generated.imageBuffer) {
      throw new Error("AI 이미지 provider가 후킹 장면 파일을 반환하지 않았습니다.");
    }
    const buffer = await normalizedMasterBuffer(generated.imageBuffer);
    // The AI creates only the scene plate. Product identity is guaranteed by
    // compositing the verified product pixels in the shared renderer later.
    const identity = {
      score: 100,
      productVisible: true,
      severeDistortion: false,
      textArtifactDetected: false,
      brandMismatch: false,
      humanArtifactDetected: false,
      groundingMismatch: false,
      findings: [],
      method: "protected-original" as const,
    };
    const quality = await evaluateMasterSceneCandidate({
      buffer,
      profile: input.profile,
      spec: input.spec,
      generationMode: "ai-background-composite",
      identity,
    });
    const file = await writeMasterSceneFile(cacheKey, buffer, "ai-background");
    const candidate: MasterSceneCandidate = {
      id: `candidate-ai-background-${cacheKey.slice(0, 12)}`,
      file,
      provider: candidateProvider(generated.provider),
      generationMode: "ai-background-composite",
      quality,
      selected: true,
      warning: generated.warning,
    };
    candidates.push(candidate);
    selected = {
      buffer,
      file,
      quality,
      productBounds: input.spec.productSafeZone,
      estimatedProductAreaRatio: 0,
      mode: "ai-background-composite",
      provider: candidate.provider,
      warnings: [
        "이 후킹만을 위해 AI 광고 장면을 새로 생성했습니다.",
        "기존 배경 라이브러리는 사용하지 않았습니다.",
        "검증된 실제 상품 누끼와 로고·한국어 문구는 렌더 단계에서 정확하게 합성합니다.",
        quality.copySafetyScore < 55
          ? "AI 장면의 카피 영역이 복잡해 렌더 단계에서 가독성 보호 그라데이션을 자동 적용했습니다."
          : undefined,
        generated.warning,
      ].filter((value): value is string => Boolean(value)),
    };
  }

  if (requestedMode === "real-photo-adaptation") {
    if (!input.fallbackScene) {
      throw new Error("실사 장면 제작에 사용할 실제 상품 사진이 없습니다.");
    }
    try {
      const realPhoto = await realPhotoCandidate({
        truth: input.truth,
        profile: input.profile,
        spec: input.spec,
        fallbackScene: input.fallbackScene,
        cacheKey,
      });
      candidates.push(realPhoto.candidate);
      selected = {
        buffer: realPhoto.buffer,
        file: realPhoto.file,
        quality: realPhoto.quality,
        productBounds: realPhoto.productBounds,
        estimatedProductAreaRatio: realPhoto.estimatedProductAreaRatio,
        mode: "real-photo-adaptation",
        provider: "library",
        warnings: realPhoto.warnings,
      };
    } catch {
      // If the selected source is not a confirmed full-frame product photo,
      // continue with the protected-product fallback below.
    }
  }

  const canGenerateFullScene =
    !selected &&
    paidConfigured &&
    requestedMode !== "protected-product-composite" &&
    requestedMode !== "library-fallback" &&
    input.spec.referenceImageUrls.length > 0;
  if (canGenerateFullScene) {
    let retryFailures: string[] = [];
    for (let index = 0; index < clampCandidates(); index += 1) {
      try {
        const prompt = buildMasterScenePrompt(input.profile, input.spec, { retryFailures });
        const generated = await provider.generateReferenceImage({
          width: 1200,
          height: 1200,
          prompt,
          negativePrompt: input.spec.forbiddenElements.join("; "),
          referenceImages: input.spec.referenceImageUrls,
          profileId: input.truth.productId,
          colorHints: [input.spec.colorDirection],
        });
        if (!generated.imageBuffer) throw new Error("이미지 provider가 장면 파일을 반환하지 않았습니다.");
        const buffer = await normalizedMasterBuffer(generated.imageBuffer);
        const identity = await evaluateProductIdentity({
          profile: input.profile,
          candidate: buffer,
          generationMode: requestedMode,
        });
        const quality = await evaluateMasterSceneCandidate({
          buffer,
          profile: input.profile,
          spec: input.spec,
          generationMode: requestedMode,
          identity,
        });
        const file = await writeMasterSceneFile(cacheKey, buffer, `candidate-${index + 1}`);
        const candidate: MasterSceneCandidate = {
          id: `candidate-ai-${cacheKey.slice(0, 12)}-${index + 1}`,
          file,
          provider: candidateProvider(generated.provider),
          generationMode: requestedMode,
          quality,
          selected: false,
          warning: generated.warning,
        };
        candidates.push(candidate);
        retryFailures = quality.failures;
        if (
          quality.recommendation === "approve" &&
          (!selected || quality.score > selected.quality.score)
        ) {
          selected = {
            buffer,
            file,
            quality,
            productBounds: input.spec.productSafeZone,
            estimatedProductAreaRatio: Number(
              ((input.spec.productSafeZone.width * input.spec.productSafeZone.height * 0.58) / (1200 * 1200)).toFixed(4)
            ),
            mode: requestedMode,
            provider: candidate.provider,
            warnings: generated.warning ? [generated.warning] : [],
          };
        }
      } catch (error) {
        retryFailures = [error instanceof Error ? error.message : "AI 장면 생성 실패"];
      }
    }
  }

  if (!selected) {
    if (!input.fallbackScene) {
      throw new Error("안전 합성에 사용할 장면이 없습니다.");
    }
    const reason = canGenerateFullScene
      ? "생성된 제품 모습을 자동 승인하기 어려워 실제 상품 사진을 유지했습니다."
      : paidConfigured
        ? "제품 레퍼런스가 부족해 실제 상품 사진을 유지했습니다."
        : "이미지 생성 기능이 꺼져 있어 실제 상품 사진을 유지한 안전한 장면으로 제작했습니다.";
    try {
      const protectedResult = await protectedCandidate({
        truth: input.truth,
        profile: input.profile,
        spec: input.spec,
        fallbackScene: input.fallbackScene,
        cacheKey,
        warning: reason,
      });
      candidates.push(protectedResult.candidate);
      selected = {
        buffer: protectedResult.buffer,
        file: protectedResult.file,
        quality: protectedResult.quality,
        productBounds: protectedResult.productBounds,
        estimatedProductAreaRatio: protectedResult.estimatedProductAreaRatio,
        mode: "protected-product-composite",
        provider: "protected-composite",
        warnings: protectedResult.warnings,
      };
    } catch (error) {
      const background = await normalizedMasterBuffer(
        await readCreativeRasterAsset(input.fallbackScene.file)
      );
      const identity = await evaluateProductIdentity({
        profile: input.profile,
        candidate: background,
        generationMode: "library-fallback",
      });
      const quality = await evaluateMasterSceneCandidate({
        buffer: background,
        profile: input.profile,
        spec: input.spec,
        generationMode: "library-fallback",
        identity,
      });
      const file = await writeMasterSceneFile(cacheKey, background, "library");
      selected = {
        buffer: background,
        file,
        quality: { ...quality, recommendation: "manual-review" },
        productBounds: input.spec.productSafeZone,
        estimatedProductAreaRatio: 0,
        mode: "library-fallback",
        provider: "library",
        warnings: [
          "실제 상품 사진 합성을 완료하지 못했습니다. 다른 상품 사진으로 다시 제작해주세요.",
          error instanceof Error ? error.message : "보호 합성 실패",
        ],
      };
      candidates.push({
        id: `candidate-library-${cacheKey.slice(0, 12)}`,
        file,
        provider: "library",
        generationMode: "library-fallback",
        quality: selected.quality,
        selected: true,
        warning: selected.warnings[0],
      });
    }
  }

  const selectedCandidate = candidates.find(
    (candidate) => candidate.file === selected!.file && candidate.generationMode === selected!.mode
  );
  candidates.forEach((candidate) => {
    candidate.selected = candidate === selectedCandidate;
  });
  const finalFile = await writeMasterSceneFile(cacheKey, selected.buffer);
  const artifact: MasterSceneArtifact = {
    id: input.spec.sceneId,
    file: finalFile,
    cacheKey,
    productReferenceProfileId: input.profile.id,
    generationMode: selected.mode,
    requestedGenerationMode: requestedMode,
    includesProduct:
      selected.mode !== "library-fallback" &&
      selected.mode !== "ai-background-composite",
    provider: selected.provider,
    imageModel,
    generationPromptVersion: promptVersion,
    referenceImageIds: aiBackgroundOnly
      ? []
      : input.profile.referenceImages
          .filter((image) => input.spec.referenceImageUrls.includes(image.url))
          .map((image) => image.id),
    sceneSpec: { ...input.spec, generationMode: selected.mode },
    sceneQualityResult: selected.quality,
    candidates,
    productIdentityScore: selected.quality.productIdentityScore,
    masterVisualDigest: digest(selected.buffer),
    estimatedProductAreaRatio: selected.estimatedProductAreaRatio,
    productBounds: selected.productBounds,
    reused: false,
    requiresProductReview: aiBackgroundOnly
      ? false
      : selected.quality.recommendation !== "approve" ||
        selected.quality.productIdentityScore < 78,
    warnings: selected.warnings,
    createdAt: new Date().toISOString(),
  };
  await saveMasterSceneArtifact(artifact);
  return artifact;
}
