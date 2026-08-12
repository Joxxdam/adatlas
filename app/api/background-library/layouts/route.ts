import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import { NextResponse } from "next/server";

import { generateAdaptiveCreativePlans } from "../../../lib/background-library/adaptiveCreative";
import { toBackgroundHookType } from "../../../lib/background-library/recommender";
import { readBackgroundLibrary } from "../../../lib/background-library/store";
import {
  findBackgroundCatalogItem,
  catalogItemToLegacy,
} from "../../../lib/background-library/catalogStore.server";
import type {
  BackgroundLibraryItem,
  BackgroundSelectionMode,
  BackgroundHookType,
} from "../../../lib/background-library/types";
import { extractPaletteFromImage } from "../../../lib/mvp/colorPaletteExtractor";
import type {
  CreativeStrategy,
  GeneratedAdCopy,
  ProductInfoForPrompt,
} from "../../../lib/mvp/types";

export const runtime = "nodejs";

type LayoutRequest = {
  backgroundId?: string;
  background?: BackgroundLibraryItem;
  product?: Partial<ProductInfoForPrompt>;
  hook?: Partial<CreativeStrategy>;
  copy?: Partial<GeneratedAdCopy>;
  productImagePath?: string;
  backgroundSelectionMode?: BackgroundSelectionMode;
};

async function productGeometry(source: string) {
  const value = String(source || "").trim();
  if (!value) return { aspectRatio: 0.82, transparentBoundsAnalyzed: false, hasUsefulTransparency: false };
  try {
    let buffer: Buffer;
    if (/^data:image\//i.test(value)) {
      const comma = value.indexOf(",");
      buffer = Buffer.from(value.slice(comma + 1), "base64");
    } else if (value.startsWith("/")) {
      const publicRoot = path.resolve(process.cwd(), "public");
      const file = path.resolve(publicRoot, value.replace(/^\/+/, ""));
      if (!file.startsWith(publicRoot + path.sep)) throw new Error("Invalid product path");
      buffer = await fs.readFile(file);
    } else {
      return { aspectRatio: 0.82, transparentBoundsAnalyzed: false, hasUsefulTransparency: false };
    }
    if (buffer.length > 16 * 1024 * 1024) {
      return { aspectRatio: 0.82, transparentBoundsAnalyzed: false, hasUsefulTransparency: false };
    }
    const metadata = await sharp(buffer).metadata();
    const alphaSample = await sharp(buffer)
      .resize(96, 96, { fit: "inside", withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let transparentPixels = 0;
    for (let offset = 3; offset < alphaSample.data.length; offset += alphaSample.info.channels) {
      if (alphaSample.data[offset] < 245) transparentPixels += 1;
    }
    const hasUsefulTransparency =
      transparentPixels / Math.max(1, alphaSample.info.width * alphaSample.info.height) >= 0.025;
    const trimmed = await sharp(buffer)
      .ensureAlpha()
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .toBuffer({ resolveWithObject: true });
    const width = trimmed.info.width || metadata.width || 1;
    const height = trimmed.info.height || metadata.height || 1;
    return {
      aspectRatio: Math.max(0.35, Math.min(2.4, width / height)),
      transparentBoundsAnalyzed: Boolean(metadata.hasAlpha),
      hasUsefulTransparency,
      width,
      height,
    };
  } catch {
    return { aspectRatio: 0.82, transparentBoundsAnalyzed: false, hasUsefulTransparency: false };
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as LayoutRequest;
    if (!body.backgroundId || !body.hook) {
      return NextResponse.json(
        { ok: false, error: "선택한 배경과 후킹이 필요합니다." },
        { status: 400 }
      );
    }
    const items = await readBackgroundLibrary();
    let background = items.find(
      (item) => item.id === body.backgroundId && item.enabled !== false
    );
    if (!background) {
      const catalogItem = await findBackgroundCatalogItem(body.backgroundId);
      if (catalogItem?.status === "approved" && catalogItem.licenseStatus === "verified") {
        background = catalogItemToLegacy(catalogItem);
      }
    }
    if (!background && body.background?.id === body.backgroundId && /^fixed-[a-z0-9-]+$/.test(body.background.id)) {
      const source = String(body.background.file || "");
      if (/^data:image\/svg\+xml;base64,[a-z0-9+/=]+$/i.test(source) && source.length < 20_000) {
        background = { ...body.background, enabled: true };
      }
    }
    if (!background) {
      return NextResponse.json(
        { ok: false, error: "선택한 배경을 찾을 수 없습니다." },
        { status: 404 }
      );
    }
    const hookType = (body.hook.backgroundHookType ||
      (body.hook.hookType ? toBackgroundHookType(body.hook.hookType) : "usp_proof")) as BackgroundHookType;
    const [palette, geometry] = await Promise.all([
      extractPaletteFromImage(background.file, background.category),
      productGeometry(body.productImagePath || body.product?.productImagePath || ""),
    ]);
    const plans = generateAdaptiveCreativePlans({
      background,
      hookType,
      product: body.product || {},
      copy: body.copy,
      palette,
      productAspectRatio: geometry.aspectRatio,
      productHasTransparency: geometry.hasUsefulTransparency,
      backgroundSelectionMode: body.backgroundSelectionMode || "recommended",
      hookId: body.hook.id,
    });
    return NextResponse.json({ ok: true, background, palette, productGeometry: geometry, plans });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "적응형 레이아웃 생성에 실패했습니다.",
      },
      { status: 500 }
    );
  }
}
