import type { BannerTemplateDefinition } from "../../../lib/bannerTemplates";
import type { PreparedBannerRender } from "./bannerRenderPipeline";
import type { ProductInfoForPrompt, TemplateSlot } from "./types";

export type OptimizedTemplateSvgInput = {
  template: BannerTemplateDefinition;
  plan: PreparedBannerRender;
  productInfo?: ProductInfoForPrompt;
  productOriginalPrice?: string;
  productOldPrice?: string;
  frameData: Array<{ dataUrl: string }>;
  logoDataUrl?: string;
  aiDisclosureText?: string;
  fontFaceCss: string;
};

function xml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function estimateWidth(text: string, fontSize: number) {
  return [...text].reduce(
    (width, char) => width + fontSize * (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(char) ? 0.96 : 0.62),
    0
  );
}

function slotText(slot: TemplateSlot, input: OptimizedTemplateSvgInput) {
  const { plan, productInfo } = input;
  const role = slot.role || slot.id;
  if (role === "headline") return plan.copy.headline;
  if (role === "bodyCopy" || role === "subheadline" || role === "reviewQuote") {
    return plan.copy.bodyCopy;
  }
  if (
    role === "highlight" ||
    role === "highlightCopy" ||
    role === "benefitChip" ||
    role === "socialProof" ||
    role === "urgency"
  ) {
    return plan.copy.highlightCopy;
  }
  if (role === "bottomBar" || role === "bottomBarCopy") return plan.copy.bottomBarCopy;
  if (role === "cta") return plan.copy.cta;
  if (role === "price") return plan.copy.price || productInfo?.price || "";
  if (role === "originalPrice") {
    return (
      input.productOriginalPrice ||
      input.productOldPrice ||
      productInfo?.originalPrice ||
      productInfo?.oldPrice ||
      ""
    );
  }
  if (role === "productName") return productInfo?.productName || plan.copy.bodyCopy;
  if (role === "productBadge") return "특가";
  return "";
}

function slotStyle(slot: TemplateSlot, plan: PreparedBannerRender) {
  const role = slot.role || slot.id;
  if (role === "headline") return plan.textStyles.headline;
  if (role === "price") return plan.textStyles.price;
  if (role === "originalPrice") return plan.textStyles.originalPrice;
  if (role === "productName") return plan.textStyles.productName || plan.textStyles.bodyCopy;
  if (role === "productBadge") return plan.textStyles.productBadge || plan.textStyles.benefitChip;
  if (role === "highlight" || role === "highlightCopy") return plan.textStyles.highlight;
  if (role === "benefitChip" || role === "socialProof" || role === "urgency") {
    return plan.textStyles.benefitChip || plan.textStyles.highlight;
  }
  if (role === "reviewQuote") return plan.textStyles.reviewQuote || plan.textStyles.bodyCopy;
  if (role === "bottomBar" || role === "bottomBarCopy") return plan.textStyles.bottomBar;
  if (role === "cta") return plan.textStyles.cta;
  if (role === "subheadline") return plan.textStyles.subheadline || plan.textStyles.bodyCopy;
  return plan.textStyles.bodyCopy;
}

function surface(input: OptimizedTemplateSvgInput) {
  const { template, plan } = input;
  const palette = plan.palette;
  if (template.visualTone === "produce-editorial") {
    return `<rect width="1200" height="1200" fill="${xml(palette.backgroundColor)}"/>
      <rect x="548" y="32" width="624" height="924" rx="8" fill="${xml(palette.surfaceColor)}"/>
      <path d="M64 54 H430" stroke="${xml(palette.accentColor)}" stroke-width="8"/>`;
  }
  if (template.visualTone === "beauty-editorial") {
    return `<rect width="1200" height="1200" fill="${xml(palette.backgroundColor)}"/>
      <rect x="556" y="46" width="604" height="850" rx="8" fill="${xml(palette.surfaceColor)}"/>
      <path d="M70 62 H268" stroke="${xml(palette.accentColor)}" stroke-width="5"/>
      <path d="M70 884 H1130" stroke="${xml(palette.mutedColor)}" stroke-width="2"/>`;
  }
  if (template.visualTone === "beauty-clinical") {
    return `<rect width="1200" height="1200" fill="${xml(palette.backgroundColor)}"/>
      <rect x="585" y="0" width="615" height="1200" fill="${xml(palette.surfaceColor)}"/>
      <path d="M585 0 V1200" stroke="${xml(palette.mutedColor)}" stroke-width="2"/>`;
  }
  return `<rect width="1200" height="1200" fill="${xml(palette.backgroundColor)}"/>`;
}

function toneOverlay(template: BannerTemplateDefinition) {
  if (template.visualTone === "meat-impact") {
    return '<rect width="1200" height="1200" fill="url(#optimizedMeatShade)"/>';
  }
  if (template.visualTone === "body-proof") {
    return '<rect width="1200" height="1200" fill="url(#optimizedBodyShade)"/>';
  }
  return "";
}

function imageElements(input: OptimizedTemplateSvgInput) {
  const slots = input.template.slots || [];
  return input.plan.imageFrames
    .map((frame, index) => {
      const dataUrl = input.frameData[index]?.dataUrl;
      if (!dataUrl) return "";
      const slot = slots.find((item) => item.id === frame.slotId);
      const background = slot?.imageFit === "background-image";
      const preserve = frame.fit === "cover" || background ? "slice" : "meet";
      const backdrop =
        !background &&
        ["beauty-editorial", "beauty-clinical", "produce-editorial"].includes(
          input.template.visualTone || ""
        )
          ? `<rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${
              frame.height
            }" rx="8" fill="${xml(input.plan.palette.surfaceColor)}"/>`
          : "";
      return `${backdrop}<image href="${dataUrl}" x="${frame.x}" y="${frame.y}" width="${
        frame.width
      }" height="${frame.height}" preserveAspectRatio="xMidYMid ${preserve}" clip-path="url(#optimizedClip${
        index
      })"${background ? "" : ' filter="url(#optimizedProductShadow)"'}/>`;
    })
    .join("");
}

function textBox(slot: TemplateSlot, role: string, input: OptimizedTemplateSvgInput) {
  const { plan, template } = input;
  if (slot.type === "cta") {
    const fill =
      template.visualTone === "meat-impact" ? plan.palette.dangerColor : plan.palette.accentColor;
    return `<rect x="${slot.x}" y="${slot.y}" width="${slot.width}" height="${slot.height}" rx="${
      ["beauty-editorial", "beauty-clinical"].includes(template.visualTone || "") ? 8 : 0
    }" fill="${xml(fill)}"/>`;
  }
  if (role === "bottomBar" || role === "bottomBarCopy") {
    const fill =
      template.visualTone === "meat-impact"
        ? plan.palette.secondaryColor
        : plan.palette.primaryColor;
    return `<rect x="${slot.x}" y="${slot.y}" width="${slot.width}" height="${
      slot.height
    }" rx="${slot.x > 0 ? 8 : 0}" fill="${xml(fill)}"/>`;
  }
  if (slot.type === "chip") {
    return `<rect x="${slot.x}" y="${slot.y}" width="${slot.width}" height="${
      slot.height
    }" rx="8" fill="${xml(plan.palette.highlightColor)}"/>`;
  }
  if (slot.type === "badge") {
    return `<rect x="${slot.x}" y="${slot.y}" width="${slot.width}" height="${
      slot.height
    }" rx="6" fill="${xml(plan.palette.dangerColor)}"/>`;
  }
  return "";
}

function textElements(input: OptimizedTemplateSvgInput) {
  const slots = input.template.slots || [];
  return slots
    .filter((slot) => ["text", "price", "cta", "badge", "chip"].includes(slot.type))
    .map((slot) => {
      const text = slotText(slot, input).trim();
      const fit = input.plan.fitResults.find((result) => result.slotId === slot.id);
      const style = slotStyle(slot, input.plan);
      if (!text || !fit || !style) return "";
      const role = slot.role || slot.id;
      const centered =
        role === "cta" ||
        role === "bottomBar" ||
        role === "bottomBarCopy" ||
        role === "productBadge" ||
        (role === "headline" && input.template.visualTone === "meat-impact");
      const x = centered ? slot.x + slot.width / 2 : slot.x + (slot.safePadding || 0);
      const lineHeight = fit.fontSize * fit.lineHeight;
      const blockHeight = fit.lines.length * lineHeight;
      const startY =
        slot.y + Math.max(lineHeight, (slot.height - blockHeight) / 2 + lineHeight * 0.78);
      const fill = ["cta", "bottomBar", "bottomBarCopy", "productBadge"].includes(role)
        ? "#ffffff"
        : style.fill;
      const stroke = style.stroke
        ? ` stroke="${xml(style.stroke)}" stroke-width="${
            style.strokeWidth || 0
          }" paint-order="stroke fill" stroke-linejoin="round"`
        : "";
      const fontFamily =
        role === "headline"
          ? `AdAtlasHeadlineFont, ${style.fontFamily}`
          : `AdAtlasSelectedFont, ${style.fontFamily}`;
      const lines = fit.lines
        .map(
          (line, index) =>
            `<text x="${x}" y="${startY + index * lineHeight}" text-anchor="${
              centered ? "middle" : "start"
            }" font-family="${xml(fontFamily)}" font-size="${fit.fontSize}" font-weight="${
              style.fontWeight
            }" letter-spacing="${style.letterSpacing || 0}" fill="${xml(fill)}"${
              stroke
            }>${xml(line)}</text>`
        )
        .join("");
      const strike =
        role === "originalPrice"
          ? `<line x1="${slot.x}" y1="${slot.y + slot.height / 2}" x2="${Math.min(
              slot.x + slot.width,
              slot.x + estimateWidth(fit.finalText, fit.fontSize) + 18
            )}" y2="${slot.y + slot.height / 2}" stroke="${xml(fill)}" stroke-width="4"/>`
          : "";
      const arrow =
        role === "cta"
          ? `<text x="${slot.x + slot.width - 38}" y="${
              slot.y + slot.height / 2 + 10
            }" text-anchor="middle" font-family="AdAtlasSelectedFont" font-size="38" font-weight="700" fill="#ffffff">›</text>`
          : "";
      return `${textBox(slot, role, input)}${lines}${strike}${arrow}`;
    })
    .join("");
}

export function buildOptimizedTemplateSvg(input: OptimizedTemplateSvgInput) {
  const clips = input.plan.imageFrames
    .map((frame, index) => {
      const inset = frame.fit === "contain" ? 8 : 0;
      return `<clipPath id="optimizedClip${index}"><rect x="${
        frame.x + inset
      }" y="${frame.y + inset}" width="${Math.max(
        1,
        frame.width - inset * 2
      )}" height="${Math.max(1, frame.height - inset * 2)}" rx="${
        frame.fit === "contain" ? 6 : 0
      }"/></clipPath>`;
    })
    .join("");
  const logo = input.logoDataUrl
    ? `<image href="${input.logoDataUrl}" x="1028" y="40" width="126" height="126" preserveAspectRatio="xMidYMid meet"/>`
    : "";
  const disclosure = input.aiDisclosureText
    ? `<text x="600" y="1174" text-anchor="middle" font-family="AdAtlasSelectedFont" font-size="18" font-weight="500" fill="#ffffff" stroke="#111111" stroke-width="2" paint-order="stroke fill">${xml(
        input.aiDisclosureText
      )}</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200">
    <defs>
      <style>${input.fontFaceCss}</style>
      ${clips}
      <filter id="optimizedProductShadow" x="-30%" y="-30%" width="160%" height="180%"><feDropShadow dx="0" dy="16" stdDeviation="18" flood-color="#000000" flood-opacity="0.22"/></filter>
      <linearGradient id="optimizedMeatShade" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#000" stop-opacity="0.56"/><stop offset="45%" stop-color="#000" stop-opacity="0.1"/><stop offset="100%" stop-color="#000" stop-opacity="0.78"/></linearGradient>
      <linearGradient id="optimizedBodyShade" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#07100f" stop-opacity="0.88"/><stop offset="62%" stop-color="#07100f" stop-opacity="0.46"/><stop offset="100%" stop-color="#07100f" stop-opacity="0.72"/></linearGradient>
    </defs>
    ${surface(input)}
    ${imageElements(input)}
    ${toneOverlay(input.template)}
    ${textElements(input)}
    ${logo}
    ${disclosure}
  </svg>`;
}
