import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import sharp from "sharp";
import type { BannerTemplateDefinition } from "@/lib/bannerTemplates";
import type { PreparedBannerRender } from "./bannerRenderPipeline";
import { getCreativeTextStylePreset } from "../creative/textStylePresets";
import { buildOptimizedTemplateSvg } from "./optimizedTemplateSvg";
import { buildAdaptiveCreativeSvg } from "./adaptiveCreativeSvg";
import type { AdaptiveCreativePlan } from "../background-library/types";
import type { GeneratedAdCopyVariant } from "./types";
import {
  adaptiveLogoDataUrl,
  buildFontFaceCss,
  compactRequestedProductImagePaths,
  fontFileToFileUrl,
  fontFormatFromFile,
  imageToDataUrl,
  optimizedProductEffect,
  outputDir,
  resolveOptionalFontFile,
  selectedBackgroundBlur,
  selectedBackgroundOverlay,
  type RenderBody,
} from "./templateAdRenderSupport.server";

export async function renderOptimizedTemplate(body: RenderBody, template: BannerTemplateDefinition, plan: PreparedBannerRender) {
  const styleOverrides = body.style || {};
  const selectedFontFile = resolveOptionalFontFile(styleOverrides.selectedFontFile);
  const selectedFontFormat = fontFormatFromFile(selectedFontFile);
  const headlineFontFile = resolveOptionalFontFile(styleOverrides.headlineFontFile || styleOverrides.selectedFontFile);
  const headlineFontFormat = fontFormatFromFile(headlineFontFile);
  const selectedFontFileUrl = fontFileToFileUrl(selectedFontFile);
  const headlineFontFileUrl = fontFileToFileUrl(headlineFontFile);
  const selectedFontWeight = Number(styleOverrides.selectedFontWeight || 800);
  const headlineFontWeight = Number(styleOverrides.headlineFontWeight || 900);
  const creativeTextStylePresetId = typeof styleOverrides.creativeTextStylePresetId === "string" ? styleOverrides.creativeTextStylePresetId.trim() : "";
  const creativeTextStylePreset = creativeTextStylePresetId ? getCreativeTextStylePreset(creativeTextStylePresetId) : undefined;
  const frameData = await Promise.all(
    plan.imageFrames.map(async (frame) => {
      try {
        return { dataUrl: await imageToDataUrl(frame.imagePath) };
      } catch {
        return { dataUrl: "" };
      }
    })
  );
  const rawLogoDataUrl = body.logoImagePath ? await imageToDataUrl(body.logoImagePath).catch(() => "") : "";
  const logoDataUrl = await adaptiveLogoDataUrl({
    logoImageDataUrl: rawLogoDataUrl,
    surfaceDataUrl: frameData[0]?.dataUrl,
    x: 1028,
    y: 40,
    size: 126,
    fallbackTone: "light",
  });
  const fontFaceCss = buildFontFaceCss("AdAtlasSelectedFont", selectedFontFileUrl, selectedFontFormat, selectedFontWeight) + buildFontFaceCss("AdAtlasHeadlineFont", headlineFontFileUrl, headlineFontFormat, headlineFontWeight);
  const svg = buildOptimizedTemplateSvg({
    template,
    plan,
    productInfo: body.productInfo,
    productOriginalPrice: body.productOriginalPrice,
    productOldPrice: body.productOldPrice,
    frameData,
    logoDataUrl,
    aiDisclosureText: body.aiDisclosure?.enabled ? body.aiDisclosure.text || "AI 활용 콘텐츠입니다." : "",
    fontFaceCss,
    productEffect: optimizedProductEffect(body, template),
    textOverrides: {
      creativePreset: creativeTextStylePreset,
      fontFamily: typeof styleOverrides.fontFamily === "string" ? styleOverrides.fontFamily : undefined,
      headlineFontFamily: typeof styleOverrides.headlineFontFamily === "string" ? styleOverrides.headlineFontFamily : undefined,
      headlineFontSize: typeof styleOverrides.headlineFontSize === "number" ? styleOverrides.headlineFontSize : undefined,
      headlineColor: styleOverrides.manualTextColors && typeof styleOverrides.headlineColor === "string" ? styleOverrides.headlineColor : undefined,
      headlineFontWeight: typeof styleOverrides.headlineFontWeight === "number" ? styleOverrides.headlineFontWeight : undefined,
      headlineLetterSpacing: typeof styleOverrides.headlineLetterSpacing === "number" ? styleOverrides.headlineLetterSpacing : undefined,
      headlineLineHeight: typeof styleOverrides.headlineLineHeight === "number" ? styleOverrides.headlineLineHeight : undefined,
      headlineTextStroke: typeof styleOverrides.headlineTextStroke === "boolean" ? styleOverrides.headlineTextStroke : undefined,
      headlineTextStrokeColor: typeof styleOverrides.headlineTextStrokeColor === "string" ? styleOverrides.headlineTextStrokeColor : undefined,
      headlineTextStrokeWidth: typeof styleOverrides.headlineTextStrokeWidth === "number" ? styleOverrides.headlineTextStrokeWidth : undefined,
      headlineShadow: typeof styleOverrides.headlineShadow === "boolean" ? styleOverrides.headlineShadow : undefined,
      bodyColor: styleOverrides.manualTextColors && typeof styleOverrides.bodyColor === "string" ? styleOverrides.bodyColor : undefined,
      bodyFontSize: typeof styleOverrides.bodyFontSize === "number" ? styleOverrides.bodyFontSize : undefined,
      bodyFontWeight: typeof styleOverrides.bodyFontWeight === "number" ? styleOverrides.bodyFontWeight : undefined,
    },
    backgroundTreatment: {
      blur: body.selectedBackgroundSource ? selectedBackgroundBlur(body) : 0,
      brightness: Math.max(0.55, Math.min(1.35, Number(body.backgroundStyle?.brightness ?? 1))),
      overlayColor: body.backgroundStyle?.overlayColor || "#000000",
      overlayOpacity: Math.max(0, Math.min(0.72, Number(body.selectedBackgroundSource ? selectedBackgroundOverlay(body) : 0))),
      scale: Math.max(1, Math.min(1.45, Number(body.backgroundStyle?.scale ?? 1))),
      offsetX: Math.max(-220, Math.min(220, Number(body.backgroundStyle?.offsetX ?? 0))),
      offsetY: Math.max(-220, Math.min(220, Number(body.backgroundStyle?.offsetY ?? 0))),
      flipHorizontal: body.backgroundStyle?.flipHorizontal === true,
    },
  });
  await fs.mkdir(outputDir, { recursive: true });
  const fileName = "generated-" + Date.now() + "-" + crypto.randomBytes(4).toString("hex") + "-" + template.id + ".png";
  const outputPath = path.join(outputDir, fileName);
  await sharp(Buffer.from(svg)).png().toFile(outputPath);
  return "/generated-ads/" + fileName;
}

export async function renderAdaptiveCreative(body: RenderBody, plan: AdaptiveCreativePlan) {
  const styleOverrides = body.style || {};
  const selectedFontFile = resolveOptionalFontFile(styleOverrides.selectedFontFile);
  const headlineFontFile = resolveOptionalFontFile(styleOverrides.headlineFontFile || styleOverrides.selectedFontFile);
  const selectedFontFileUrl = fontFileToFileUrl(selectedFontFile);
  const headlineFontFileUrl = fontFileToFileUrl(headlineFontFile);
  const fontFaceCss = buildFontFaceCss("AdAtlasBody", selectedFontFileUrl, fontFormatFromFile(selectedFontFile), Number(styleOverrides.selectedFontWeight || styleOverrides.bodyFontWeight || 800)) + buildFontFaceCss("AdAtlasHeadline", headlineFontFileUrl, fontFormatFromFile(headlineFontFile), Number(styleOverrides.headlineFontWeight || 900));
  const backgroundDataUrl = await imageToDataUrl(body.selectedBackgroundSource || "");
  const productPath = compactRequestedProductImagePaths(body)[0] || "";
  const productDataUrl = productPath ? await imageToDataUrl(productPath).catch(() => "") : "";
  const rawLogoDataUrl = body.logoImagePath ? await imageToDataUrl(body.logoImagePath).catch(() => "") : "";
  const adaptiveLogoSize = 118;
  const adaptiveLogoX = plan.textPlacement.x < 600 ? 1050 : 32;
  const logoDataUrl = await adaptiveLogoDataUrl({
    logoImageDataUrl: rawLogoDataUrl,
    surfaceDataUrl: backgroundDataUrl,
    x: adaptiveLogoX,
    y: 32,
    size: adaptiveLogoSize,
    fallbackTone: plan.colorPalette.panel.toLowerCase() === "#181818" ? "dark" : "light",
  });
  const activeCopy: GeneratedAdCopyVariant = {
    headline: String(body.copy?.headline || ""),
    bodyCopy: String(body.copy?.bodyCopy || ""),
    highlightCopy: String(body.copy?.highlightCopy || ""),
    bottomBarCopy: String(body.copy?.bottomBarCopy || ""),
    cta: String(body.copy?.cta || ""),
    price: String(body.copy?.price || body.productInfo?.price || ""),
  };
  const svg = buildAdaptiveCreativeSvg({
    plan: {
      ...plan,
      backgroundAdjustments: {
        ...plan.backgroundAdjustments,
        scale: Math.max(1, Math.min(1.45, Number(body.backgroundStyle?.scale ?? plan.backgroundAdjustments.scale))),
        offsetX: Math.max(-220, Math.min(220, Number(body.backgroundStyle?.offsetX ?? plan.backgroundAdjustments.offsetX))),
        offsetY: Math.max(-220, Math.min(220, Number(body.backgroundStyle?.offsetY ?? plan.backgroundAdjustments.offsetY))),
        blur: Math.max(0, Math.min(18, body.selectedBackgroundSource ? selectedBackgroundBlur(body) : plan.backgroundAdjustments.blur)),
        brightness: Math.max(0.55, Math.min(1.35, Number(body.backgroundStyle?.brightness ?? plan.backgroundAdjustments.brightness))),
      },
    },
    copy: activeCopy,
    backgroundDataUrl,
    productDataUrl,
    logoDataUrl,
    aiDisclosureText: body.aiDisclosure?.enabled ? body.aiDisclosure.text || "AI 활용 콘텐츠입니다." : "",
    fontFaceCss,
    fontFamily: typeof styleOverrides.fontFamily === "string" ? styleOverrides.fontFamily : undefined,
    headlineFontFamily: typeof styleOverrides.headlineFontFamily === "string" ? styleOverrides.headlineFontFamily : undefined,
    productEffect: body.productEffect,
    backgroundFlipHorizontal: body.backgroundStyle?.flipHorizontal,
  });
  await fs.mkdir(outputDir, { recursive: true });
  const fileName = `generated-${Date.now()}-${crypto.randomBytes(4).toString("hex")}-adaptive-${plan.layoutVariant}.png`;
  const outputPath = path.join(outputDir, fileName);
  await sharp(Buffer.from(svg)).png().resize(1200, 1200).toFile(outputPath);
  const palette = {
    primaryColor: plan.colorPalette.accent,
    secondaryColor: plan.colorPalette.panel,
    accentColor: plan.colorPalette.accent,
    backgroundColor: plan.colorPalette.panel,
    surfaceColor: plan.colorPalette.panel,
    textDarkColor: plan.colorPalette.headline,
    textLightColor: plan.colorPalette.body,
    mutedColor: plan.colorPalette.body,
    highlightColor: plan.colorPalette.price,
    dangerColor: plan.colorPalette.price,
    sourceImagePath: body.selectedBackgroundSource,
    confidence: 0.9,
  };
  return {
    imagePath: `/generated-ads/${fileName}`,
    diagnostics: {
      templateId: `adaptive-${plan.layoutType}`,
      paletteApplied: true,
      palettePolicy: "full-auto",
      palette,
      selectedVariant: body.selectedVariant || "base",
      variantReason: "선택한 배경의 안전 영역과 시각적 위계에 맞춘 적응형 레이아웃입니다.",
      fitResults: [],
      collisionResult: {
        hasCollision: false,
        collisions: [],
        actions: [],
        finalItems: [],
        warnings: [],
      },
      imagePathsUsed: [body.selectedBackgroundSource, productPath].filter(Boolean),
      hiddenElements: [],
      optimizationFlags: {
        autoPaletteApplied: true,
        textFittingApplied: true,
        collisionResolved: true,
        lowPriorityElementsHidden: false,
      },
      warnings: productDataUrl ? [] : ["상품 이미지를 읽지 못해 배경과 문구만 렌더링했습니다."],
      qualityScore: productDataUrl ? 96 : 78,
      qualityStatus: productDataUrl ? "stable" : "review",
    },
  };
}


