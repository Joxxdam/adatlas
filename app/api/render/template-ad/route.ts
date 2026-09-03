import { NextResponse } from "next/server";
import { foodCategoryTemplateIds, foodImpactHeroTemplate, templatesById } from "@/lib/bannerTemplates";
import { prepareBannerRender } from "../../../lib/mvp/bannerRenderPipeline";
import { fitCopyToTemplate } from "../../../lib/mvp/templateCopyFitter";
import type { GeneratedAdCopyVariant } from "../../../lib/mvp/types";
import { renderFoodCategoryTemplate, renderFoodImpactHero } from "../../../lib/mvp/legacyTemplateAdRenderers.server";
import { renderAdaptiveCreative, renderOptimizedTemplate } from "../../../lib/mvp/modernTemplateAdRenderers.server";
import { compactRequestedProductImagePaths, type RenderBody } from "../../../lib/mvp/templateAdRenderSupport.server";

export const runtime = "nodejs";

const supportedTemplateIds = new Set(["food-impact-hero-001", ...foodCategoryTemplateIds, "bold-commerce-001", "shock-headline-001", "price-proof-002", "home-shopping-max-010", "premium-gift-006", "ugc-meme-005"]);

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RenderBody;
    if (body.adaptiveCreativePlan && body.selectedBackgroundSource) {
      const adaptive = await renderAdaptiveCreative(body, body.adaptiveCreativePlan);
      return NextResponse.json({
        success: true,
        imagePath: adaptive.imagePath,
        templateId: `adaptive-${body.adaptiveCreativePlan.layoutType}`,
        diagnostics: adaptive.diagnostics,
      });
    }
    const requestedTemplateId = body.templateId || "food-template-001";
    const templateId = supportedTemplateIds.has(requestedTemplateId) ? requestedTemplateId : "food-template-001";
    const registeredTemplate = templatesById.get(templateId);
    const template = registeredTemplate ?? (templateId === foodImpactHeroTemplate.id ? foodImpactHeroTemplate : undefined);
    if (registeredTemplate?.renderMode === "slot-engine") {
      const activeCopy: GeneratedAdCopyVariant = {
        headline: String(body.copy?.headline || ""),
        bodyCopy: String(body.copy?.bodyCopy || ""),
        highlightCopy: String(body.copy?.highlightCopy || ""),
        bottomBarCopy: String(body.copy?.bottomBarCopy || ""),
        cta: String(body.copy?.cta || ""),
        price: String(body.copy?.price || body.productInfo?.price || ""),
      };
      const plan = await prepareBannerRender({
        template: registeredTemplate,
        activeCopy,
        selectedVariant: body.selectedVariant,
        copyVariants: body.copyVariants,
        productInfo: body.productInfo,
        imagePaths: compactRequestedProductImagePaths(body),
        backgroundImagePath: body.backgroundMode === "none" ? undefined : body.selectedBackgroundSource,
        originalPrice: body.productOriginalPrice || body.productOldPrice || body.productInfo?.originalPrice || body.productInfo?.oldPrice,
      });
      const imagePath = await renderOptimizedTemplate(body, registeredTemplate, plan);
      return NextResponse.json({
        success: true,
        imagePath,
        templateId,
        diagnostics: plan.diagnostics,
      });
    }
    const fittedCopy = fitCopyToTemplate({
      copy: body.copy ?? {},
      templateId,
      copyLimits: template?.copyLimits,
    });
    const bodyWithFittedCopy: RenderBody = {
      ...body,
      templateId,
      copy:
        templateId === "food-template-002"
          ? {
              ...body.copy,
              price: fittedCopy.price || body.copy?.price,
            }
          : {
              ...body.copy,
              headline: fittedCopy.headline,
              bodyCopy: fittedCopy.bodyCopy,
              highlightCopy: fittedCopy.highlightCopy,
              bottomBarCopy: fittedCopy.bottomBarCopy,
              cta: fittedCopy.cta,
              price: fittedCopy.price || body.copy?.price,
            },
    };
    const imagePath = foodCategoryTemplateIds.includes(templateId) ? await renderFoodCategoryTemplate(bodyWithFittedCopy, templateId) : await renderFoodImpactHero(bodyWithFittedCopy);
    return NextResponse.json({ success: true, imagePath, templateId });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "배너 생성 중 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}
