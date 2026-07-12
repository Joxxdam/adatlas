import type { BannerTemplateDefinition } from "../../../lib/bannerTemplates";
import {
  fitCopyToTemplate,
  getCopySlotOverflow,
  visibleTemplateCopyLength,
} from "./templateCopyFitter";
import type {
  CopySlotKey,
  CopyVariantKey,
  GeneratedAdCopy,
  GeneratedAdCopyVariant,
  TemplateCopyApplyMode,
  TemplateCopyLimits,
  TemplateCopyPreview,
  TemplateCopyVariantSelection,
} from "./types";

const variantPriority: CopyVariantKey[] = ["long", "medium", "short", "base"];

function baseVariant(copy: GeneratedAdCopy): GeneratedAdCopyVariant {
  return {
    headline: copy.headline,
    bodyCopy: copy.bodyCopy,
    highlightCopy: copy.highlightCopy,
    bottomBarCopy: copy.bottomBarCopy,
    cta: copy.cta,
    price: copy.price,
  };
}

function copyWithVariant(masterCopy: GeneratedAdCopy, variant: GeneratedAdCopyVariant): GeneratedAdCopy {
  return {
    ...masterCopy,
    headline: variant.headline || masterCopy.headline,
    bodyCopy: variant.bodyCopy || masterCopy.bodyCopy,
    highlightCopy: variant.highlightCopy || masterCopy.highlightCopy,
    bottomBarCopy: variant.bottomBarCopy || masterCopy.bottomBarCopy,
    cta: variant.cta || masterCopy.cta,
    price: variant.price || masterCopy.price,
  };
}

function variantCandidates(masterCopy: GeneratedAdCopy): Record<CopyVariantKey, GeneratedAdCopyVariant> {
  const base = baseVariant(masterCopy);
  return {
    short: masterCopy.copyVariants?.short || base,
    medium: masterCopy.copyVariants?.medium || base,
    long: masterCopy.copyVariants?.long || base,
    base,
  };
}

function informationLength(copy: GeneratedAdCopyVariant) {
  return (["headline", "bodyCopy", "highlightCopy", "bottomBarCopy", "cta", "price"] as CopySlotKey[])
    .reduce((total, slot) => total + visibleTemplateCopyLength(String(copy[slot] || "")), 0);
}

function scoreVariant(copy: GeneratedAdCopyVariant, copyLimits?: TemplateCopyLimits) {
  const overflowSlots = getCopySlotOverflow(copy, copyLimits);
  const missingSlots = (["headline", "bodyCopy", "highlightCopy", "bottomBarCopy"] as CopySlotKey[])
    .filter((slot) => !String(copy[slot] || "").trim());

  return {
    overflowSlots,
    missingSlots,
    score: overflowSlots.length * 1000 + missingSlots.length * 200 - informationLength(copy),
  };
}

export function selectBestCopyVariantForTemplate(params: {
  masterCopy: GeneratedAdCopy;
  templateId: string;
  templateName?: string;
  copyLimits?: TemplateCopyLimits;
}): TemplateCopyVariantSelection {
  const candidates = variantCandidates(params.masterCopy);
  const ranked = variantPriority
    .map((key) => {
      const score = scoreVariant(candidates[key], params.copyLimits);
      return { key, copy: candidates[key], ...score };
    })
    .sort((a, b) => {
      if (a.overflowSlots.length !== b.overflowSlots.length) {
        return a.overflowSlots.length - b.overflowSlots.length;
      }
      if (a.score !== b.score) return a.score - b.score;
      return variantPriority.indexOf(a.key) - variantPriority.indexOf(b.key);
    });

  const selected = ranked[0];
  const fittedCopy = fitCopyToTemplate({
    copy: selected.copy,
    templateId: params.templateId,
    copyLimits: params.copyLimits,
  });
  const overflowSlots = getCopySlotOverflow(selected.copy, params.copyLimits);
  const hasOverflow = overflowSlots.length > 0 || fittedCopy.slotFits.some((slot) => slot.status === "trimmed" || slot.status === "too-long");
  const reason = overflowSlots.length
    ? `${selected.key} 문구가 가장 적게 넘쳐 최종 자동축약을 적용합니다.`
    : `${selected.key} 문구가 템플릿 길이에 가장 자연스럽게 맞습니다.`;

  return {
    templateId: params.templateId,
    templateName: params.templateName || params.templateId,
    selectedVariant: selected.key,
    reason,
    beforeFitCopy: selected.copy,
    fittedCopy,
    hasOverflow,
    overflowSlots,
    slotFits: fittedCopy.slotFits,
  };
}

export function resolveCopyForTemplate(params: {
  masterCopy: GeneratedAdCopy;
  templateId: string;
  templateName?: string;
  copyLimits?: TemplateCopyLimits;
  mode: TemplateCopyApplyMode;
}): {
  activeRenderCopy: GeneratedAdCopy;
  preview: TemplateCopyPreview;
} {
  const base = baseVariant(params.masterCopy);

  if (params.mode === "original") {
    const fittedCopy = fitCopyToTemplate({
      copy: base,
      templateId: params.templateId,
      copyLimits: params.copyLimits,
    });
    const overflowSlots = getCopySlotOverflow(base, params.copyLimits);
    return {
      activeRenderCopy: params.masterCopy,
      preview: {
        templateId: params.templateId,
        templateName: params.templateName || params.templateId,
        mode: params.mode,
        selectedVariant: "base",
        originalCopy: params.masterCopy,
        selectedCopy: base,
        fittedCopy,
        hasOverflow: overflowSlots.length > 0,
        overflowSlots,
        slotFits: fittedCopy.slotFits,
      },
    };
  }

  if (params.mode === "force-fit") {
    const fittedCopy = fitCopyToTemplate({
      copy: base,
      templateId: params.templateId,
      copyLimits: params.copyLimits,
    });
    const overflowSlots = fittedCopy.slotFits
      .filter((slot) => slot.status === "trimmed" || slot.status === "too-long")
      .map((slot) => slot.key);
    return {
      activeRenderCopy: copyWithVariant(params.masterCopy, fittedCopy),
      preview: {
        templateId: params.templateId,
        templateName: params.templateName || params.templateId,
        mode: params.mode,
        selectedVariant: "base",
        originalCopy: params.masterCopy,
        selectedCopy: base,
        fittedCopy,
        hasOverflow: overflowSlots.length > 0,
        overflowSlots,
        slotFits: fittedCopy.slotFits,
      },
    };
  }

  const selection = selectBestCopyVariantForTemplate(params);
  return {
    activeRenderCopy: copyWithVariant(params.masterCopy, selection.fittedCopy),
    preview: {
      templateId: params.templateId,
      templateName: params.templateName || params.templateId,
      mode: params.mode,
      selectedVariant: selection.selectedVariant,
      originalCopy: params.masterCopy,
      selectedCopy: selection.beforeFitCopy,
      fittedCopy: selection.fittedCopy,
      hasOverflow: selection.hasOverflow,
      overflowSlots: selection.overflowSlots,
      slotFits: selection.slotFits,
    },
  };
}

export function buildTemplateCopyPreviews(params: {
  masterCopy: GeneratedAdCopy;
  templates: BannerTemplateDefinition[];
  mode: TemplateCopyApplyMode;
}): TemplateCopyPreview[] {
  return params.templates.map((template) => resolveCopyForTemplate({
    masterCopy: params.masterCopy,
    templateId: template.id,
    templateName: template.name,
    copyLimits: template.copyLimits,
    mode: params.mode,
  }).preview);
}
