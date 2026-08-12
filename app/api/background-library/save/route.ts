import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";
import sharp from "sharp";

import {
  inferAudienceProfile,
  inferBackgroundCategory,
  toBackgroundHookType,
} from "../../../lib/background-library/recommender";
import {
  appendBackgroundLibraryItem,
  resolvePublicBackgroundFile,
} from "../../../lib/background-library/store";
import type { BackgroundLibraryItem } from "../../../lib/background-library/types";
import type { CreativeStrategy, ProductInfoForPrompt } from "../../../lib/mvp/types";

export const runtime = "nodejs";

type Body = {
  imagePath?: string;
  provider?: string;
  product?: Partial<ProductInfoForPrompt>;
  hook?: Partial<CreativeStrategy>;
};

function safeList(value: unknown, fallback: string[], limit = 6) {
  const list = Array.isArray(value) ? value : [];
  const normalized = Array.from(
    new Set(list.map((item) => String(item || "").replace(/\s+/g, " ").trim()).filter(Boolean))
  ).slice(0, limit);
  return normalized.length ? normalized : fallback;
}

function isGeneratedScenePath(value: string) {
  return /^\/background-images\/scene-[a-z0-9_-]+\.(png|jpe?g|webp)$/i.test(value);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const imagePath = String(body.imagePath || "").trim();
    if (!isGeneratedScenePath(imagePath)) {
      return NextResponse.json(
        { ok: false, error: "AdAtlas에서 생성한 배경만 라이브러리에 저장할 수 있습니다." },
        { status: 400 }
      );
    }
    const sourceFile = resolvePublicBackgroundFile(imagePath);
    if (!sourceFile) {
      return NextResponse.json({ ok: false, error: "잘못된 배경 경로입니다." }, { status: 400 });
    }
    await fs.access(sourceFile);

    const category = inferBackgroundCategory(body.product || {});
    const suffix = randomUUID().slice(0, 8);
    const id = `ai-${category}-${Date.now()}-${suffix}`;
    const file = `/background-library/${category}/${id}.webp`;
    const outputFile = resolvePublicBackgroundFile(file);
    if (!outputFile) throw new Error("저장 경로를 만들 수 없습니다.");
    await fs.mkdir(path.dirname(outputFile), { recursive: true });
    const optimized = await sharp(sourceFile)
      .rotate()
      .resize(1600, 1600, { fit: "cover", position: "centre" })
      .webp({ quality: 84, effort: 5 })
      .toBuffer();
    await fs.writeFile(outputFile, optimized);

    const hook = body.hook || {};
    const now = new Date().toISOString();
    const audience = inferAudienceProfile({ ...(body.product || {}), targetAgeGroups: hook.targetAgeGroups });
    const hookType = hook.hookType ? toBackgroundHookType(hook.hookType) : "usp_proof";
    const item: BackgroundLibraryItem = {
      id,
      file,
      enabled: true,
      category,
      subcategories: safeList(
        [body.product?.productSubCategory, body.product?.category],
        [category],
        5
      ),
      industries: safeList([body.product?.category, body.product?.productName], [category], 5),
      assetType: "ai_generated",
      hookTypes: [hookType],
      ageGroups: audience.ageGroups,
      peopleType: ["no_people"],
      peopleCount: 0,
      includesPerson: false,
      personPosition: "none",
      personGaze: "none",
      personEmotion: "",
      personAction: "",
      scene: String(hook.sceneDescription || "AI가 생성한 상품 합성용 상업 배경").slice(0, 160),
      mood: safeList(hook.mood, ["상업적", "정돈된"], 5),
      elements: safeList(hook.backgroundTags, ["여백", "스튜디오"], 6),
      colors: safeList(hook.preferredColors, ["neutral"], 6),
      productPosition: hook.productPosition || "center-right",
      textSafeArea: hook.textSafeArea || "top-left",
      focalArea: "center",
      brightness: "medium",
      contrast: "medium",
      orientation: "square",
      width: 1600,
      height: 1600,
      fileSize: optimized.length,
      hash: createHash("sha256").update(optimized).digest("hex"),
      sourceType: "ai_generated",
      sourceName: `AdAtlas ${body.provider || "AI"}`,
      sourcePageUrl: "",
      originalImageUrl: "",
      licenseUrl: "",
      authorName: "AdAtlas",
      generationModel: body.provider || "unknown",
      generationPrompt: String(hook.sceneDescription || "공용 광고 합성 배경"),
      generatedAt: now,
      reviewed: true,
    };
    await appendBackgroundLibraryItem(item);
    return NextResponse.json({ ok: true, item });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "AI 배경 저장에 실패했습니다." },
      { status: 500 }
    );
  }
}
