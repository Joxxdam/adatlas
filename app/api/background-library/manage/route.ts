import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";
import sharp from "sharp";

import { appendBackgroundLibraryItem, deleteBackgroundLibraryItem, readBackgroundLibrary, resolvePublicBackgroundFile, summarizeBackgroundLibrary, updateBackgroundLibraryItem } from "../../../lib/background-library/store";
import { audienceAgeGroups, backgroundAssetTypes, backgroundHookTypes, backgroundPeopleTypes, type BackgroundLibraryItem } from "../../../lib/background-library/types";

export const runtime = "nodejs";

const categoriesPath = path.join(process.cwd(), "data", "background-library-categories.json");
const safeCategoryPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function readCategories() {
  try {
    const parsed = JSON.parse(await fs.readFile(categoriesPath, "utf8")) as unknown;
    return Array.isArray(parsed) ? parsed.map(String).filter((value) => safeCategoryPattern.test(value)) : [];
  } catch {
    return [];
  }
}

async function writeCategories(categories: string[]) {
  const next = Array.from(new Set(categories)).sort();
  const temporaryPath = `${categoriesPath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, categoriesPath);
  return next;
}

function list(value: FormDataEntryValue | null, fallback: string[] = []) {
  const values = String(value || "")
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length ? Array.from(new Set(values)) : fallback;
}

function enumList<T extends string>(value: FormDataEntryValue | null, allowed: readonly T[]) {
  return list(value).filter((item): item is T => allowed.includes(item as T));
}

function text(value: FormDataEntryValue | null, max = 160) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function publicFileIsManaged(file: string) {
  return /^\/background-library\/[a-z0-9-]+\/[a-z0-9-]+\.webp$/.test(file);
}

export async function GET() {
  const items = await readBackgroundLibrary({ includeDisabled: true });
  return NextResponse.json({
    ok: true,
    items,
    categories: await readCategories(),
    summary: summarizeBackgroundLibrary(items),
  });
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = (await request.json()) as { action?: string; category?: string };
      const category = String(body.category || "")
        .trim()
        .toLowerCase();
      if (body.action !== "create-category" || !safeCategoryPattern.test(category)) {
        return NextResponse.json({ ok: false, error: "카테고리는 영문 소문자·숫자·하이픈으로 입력해주세요." }, { status: 400 });
      }
      const categories = await writeCategories([...(await readCategories()), category]);
      await fs.mkdir(path.join(process.cwd(), "public", "background-library", category), {
        recursive: true,
      });
      return NextResponse.json({ ok: true, categories });
    }

    const form = await request.formData();
    const upload = form.get("file");
    if (!(upload instanceof File) || upload.size <= 0 || upload.size > 20 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: "20MB 이하의 정상 이미지 파일을 선택해주세요." }, { status: 400 });
    }
    if (!/^image\/(?:png|jpe?g|webp|avif)$/i.test(upload.type)) {
      return NextResponse.json({ ok: false, error: "지원하지 않는 이미지 형식입니다." }, { status: 400 });
    }

    const category = text(form.get("category"), 48).toLowerCase();
    const categories = await readCategories();
    if (!safeCategoryPattern.test(category) || !categories.includes(category)) {
      return NextResponse.json({ ok: false, error: "등록된 카테고리를 선택해주세요." }, { status: 400 });
    }
    const input = Buffer.from(await upload.arrayBuffer());
    const metadata = await sharp(input).metadata();
    if (!metadata.width || !metadata.height || Math.min(metadata.width, metadata.height) < 800) {
      return NextResponse.json({ ok: false, error: "짧은 변 기준 800px 이상의 이미지만 업로드할 수 있습니다." }, { status: 400 });
    }
    const optimized = await sharp(input).rotate().resize(1600, 1600, { fit: "cover", position: "attention", withoutEnlargement: false }).webp({ quality: 83, effort: 5 }).toBuffer();
    const id = `user-${category}-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const file = `/background-library/${category}/${id}.webp`;
    const outputFile = resolvePublicBackgroundFile(file);
    if (!outputFile || !publicFileIsManaged(file)) throw new Error("안전한 저장 경로를 만들지 못했습니다.");
    await fs.mkdir(path.dirname(outputFile), { recursive: true });
    await fs.writeFile(outputFile, optimized);

    const includesPerson = form.get("includesPerson") === "true";
    const assetType = enumList(form.get("assetType"), backgroundAssetTypes)[0] || "user_uploaded";
    const now = new Date().toISOString();
    const item = {
      id,
      file,
      enabled: true,
      category,
      subcategories: list(form.get("subcategories"), ["general"]),
      industries: list(form.get("industries"), [category]),
      assetType,
      hookTypes: enumList(form.get("hookTypes"), backgroundHookTypes).length ? enumList(form.get("hookTypes"), backgroundHookTypes) : ["situation"],
      ageGroups: includesPerson ? enumList(form.get("ageGroups"), audienceAgeGroups) : ["no_people"],
      peopleType: includesPerson ? enumList(form.get("peopleType"), backgroundPeopleTypes) : ["no_people"],
      peopleCount: includesPerson ? Math.max(1, Math.min(12, Number(form.get("peopleCount")) || 1)) : 0,
      includesPerson,
      personPosition: includesPerson ? text(form.get("personPosition"), 12) || "center" : "none",
      personGaze: includesPerson ? text(form.get("personGaze"), 12) || "front" : "none",
      personEmotion: includesPerson ? text(form.get("personEmotion"), 60) : "",
      personAction: includesPerson ? text(form.get("personAction"), 100) : "",
      scene: text(form.get("scene"), 160) || "사용자가 추가한 광고 합성용 배경",
      mood: list(form.get("mood"), ["정돈된"]),
      elements: list(form.get("elements"), ["negative-space"]),
      colors: list(form.get("colors"), ["neutral"]),
      productPosition: text(form.get("productPosition"), 20) || "center-right",
      textSafeArea: text(form.get("textSafeArea"), 20) || "top-left",
      focalArea: text(form.get("focalArea"), 30) || "center",
      brightness: text(form.get("brightness"), 12) || "medium",
      contrast: text(form.get("contrast"), 12) || "medium",
      orientation: "square",
      sourceType: "user_uploaded",
      sourceName: text(form.get("sourceName"), 80) || "사용자 업로드",
      sourcePageUrl: text(form.get("sourcePageUrl"), 500),
      originalImageUrl: "",
      licenseUrl: text(form.get("licenseUrl"), 500),
      authorName: text(form.get("authorName"), 100) || "사용자",
      uploadedAt: now,
      width: 1600,
      height: 1600,
      fileSize: optimized.length,
      hash: createHash("sha256").update(optimized).digest("hex"),
    } as BackgroundLibraryItem;
    await appendBackgroundLibraryItem(item);
    return NextResponse.json({ ok: true, item });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "배경 저장에 실패했습니다." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      id?: string;
      changes?: Partial<BackgroundLibraryItem>;
    };
    const id = String(body.id || "");
    if (!/^[a-z0-9-]+$/.test(id)) {
      return NextResponse.json({ ok: false, error: "잘못된 배경 ID입니다." }, { status: 400 });
    }
    const incoming = body.changes || {};
    const changes: Partial<BackgroundLibraryItem> = {};
    if (typeof incoming.enabled === "boolean") changes.enabled = incoming.enabled;
    if (typeof incoming.scene === "string") changes.scene = incoming.scene.slice(0, 160);
    for (const key of ["subcategories", "industries", "mood", "elements", "colors"] as const) {
      if (Array.isArray(incoming[key])) changes[key] = incoming[key].map(String).slice(0, 12);
    }
    if (Array.isArray(incoming.hookTypes)) {
      changes.hookTypes = incoming.hookTypes.filter((value) => backgroundHookTypes.includes(value));
    }
    if (Array.isArray(incoming.ageGroups)) {
      changes.ageGroups = incoming.ageGroups.filter((value) => audienceAgeGroups.includes(value));
    }
    const item = await updateBackgroundLibraryItem(id, changes);
    return item ? NextResponse.json({ ok: true, item }) : NextResponse.json({ ok: false, error: "배경을 찾지 못했습니다." }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "배경 수정에 실패했습니다." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id") || "";
    if (!/^[a-z0-9-]+$/.test(id)) {
      return NextResponse.json({ ok: false, error: "잘못된 배경 ID입니다." }, { status: 400 });
    }
    const target = await deleteBackgroundLibraryItem(id);
    if (!target) return NextResponse.json({ ok: false, error: "배경을 찾지 못했습니다." }, { status: 404 });
    if (publicFileIsManaged(target.file)) {
      const file = resolvePublicBackgroundFile(target.file);
      if (file) await fs.unlink(file).catch(() => undefined);
    }
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "배경 삭제에 실패했습니다." }, { status: 500 });
  }
}
