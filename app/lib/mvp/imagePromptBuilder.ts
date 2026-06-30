import type {
  AdImageLabel,
  GeneratedAdCopy,
  GptImageGenerationMode,
  GptImagePreservationMode,
  GptImageSourceMode,
  ImageCreativeDirection,
  ProductInfoForPrompt,
} from "./types";
import { buildAutoImagePrompt } from "./defaultImagePromptTemplates";

export { buildAutoImagePrompt } from "./defaultImagePromptTemplates";

type GeneratedCopyInput = Partial<Pick<GeneratedAdCopy, "headline" | "bodyCopy" | "highlightCopy" | "bottomBarCopy" | "cta" | "price">>;

type BuildImagePromptParams = {
  mode: GptImageGenerationMode;
  productInfo?: Partial<ProductInfoForPrompt>;
  productName?: string;
  category?: string;
  mainBenefit?: string;
  targetCustomer?: string;
  landingUrl?: string;
  selectedReferenceLabels?: AdImageLabel[];
  generatedCopy?: GeneratedCopyInput;
  templateId?: string;
  templateSummary?: string;
  productImagePath?: string;
  productImagePaths?: string[];
  selectedSourceImagePath?: string;
  referenceImagePaths?: string[];
  selectedSourceImageType?: string;
  selectedSourceImageLabel?: string;
  imageSourceMode?: GptImageSourceMode;
  preservationMode?: GptImagePreservationMode;
};

const emojiRegex = /[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu;

function clean(value?: string) {
  return String(value ?? "").replace(emojiRegex, "").replace(/\s{2,}/g, " ").trim();
}

function compactList(values: Array<string | undefined>, fallback: string) {
  const items = values.map(clean).filter(Boolean);
  return items.length ? Array.from(new Set(items)).join(" / ") : fallback;
}

function summarizeReferences(labels: AdImageLabel[] = []) {
  const finals = labels.map((label) => label.finalLabel).filter(Boolean);
  return {
    hookType: compactList(finals.map((label) => label.hookType), "commerce hook suited to the product"),
    appealPoint: compactList(finals.map((label) => label.appealPoint), "clear purchase reason"),
    copyNuance: compactList(finals.map((label) => label.copyNuance || label.toneOfVoice), "direct Korean ecommerce copy tone"),
    visualTone: compactList(finals.map((label) => label.visualTone), "high contrast Korean ecommerce visual tone"),
    layoutPattern: compactList(finals.map((label) => label.layoutPattern || label.visualCopyRelation), "hero product centered with strong promotional hierarchy"),
    whyItWorks: compactList(finals.map((label) => label.whyItWorks), "it reduces purchase hesitation and makes the value easy to understand"),
  };
}

function productVisualDetails(category: string, productName: string, benefit: string) {
  const text = `${category} ${productName} ${benefit}`.toLowerCase();
  if (/beef|meat|고기|한우|갈비|등심|스테이크|식품|선물|정육/.test(text)) {
    return "preserve the original food state. If the source image shows cooked meat or plated food, keep it as cooked meat or plated food. Do not turn cooked food into packaged raw meat, a plastic tray product, a new label, a logo package, or a different retail package. Show appetizing food texture, cooked appearance, moisture, sear marks, plate or original serving context when present, realistic commercial food photography";
  }
  if (/beauty|cosmetic|뷰티|화장품|스킨|크림|앰플|향수/.test(text)) {
    return "show clean beauty product shapes, bottle or jar silhouette, glossy texture, premium skincare lighting, neat reflective surfaces";
  }
  if (/fashion|의류|패션|룩|신발|가방|원피스|자켓/.test(text)) {
    return "show garment silhouette, fabric mood, fit impression, tactile textile detail, modern ecommerce fashion styling";
  }
  if (/health|건강|영양|비타민|홍삼|유산균|보충제/.test(text)) {
    return "show trustworthy health supplement product scene, clean packaging, fresh ingredient cues, reliable premium lighting";
  }
  if (/app|앱|디지털|서비스|software|플랫폼/.test(text)) {
    return "show modern app service visual metaphor, clean device mockup style, useful digital lifestyle context";
  }
  if (/living|리빙|가구|침구|인테리어|생활/.test(text)) {
    return "show practical home and living product context, clean interior setting, useful everyday lifestyle scene";
  }
  return "show product-specific shape, material, texture, package and usage context clearly, realistic commercial product photography";
}

function shortCopy(value?: string, max = 34) {
  const text = clean(value);
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

export function buildImageGenerationPrompt(params: BuildImagePromptParams): {
  prompt: string;
  creativeDirection: ImageCreativeDirection;
} {
  const product = params.productInfo ?? {};
  const mode = params.mode;
  const imageSourceMode = params.imageSourceMode ?? (params.selectedSourceImagePath || product.selectedSourceImagePath ? "image-edit" : "text-to-image");
  const preservationMode = params.preservationMode ?? (params.selectedSourceImagePath || product.selectedSourceImagePath ? "preserve-product" : "free-generate");
  const productName = clean(params.productName || product.productName) || "featured ecommerce product";
  const category = clean(params.category || product.category) || "consumer product";
  const mainBenefit = clean(params.mainBenefit || product.mainBenefit || product.extractedDescription);
  const targetCustomer = clean(params.targetCustomer || product.targetCustomer);
  const references = summarizeReferences(params.selectedReferenceLabels);
  const generatedCopy = params.generatedCopy ?? {};
  const productImagePaths = [
    clean(params.selectedSourceImagePath || product.selectedSourceImagePath),
    clean(params.productImagePath || product.productImagePath),
    ...(params.productImagePaths ?? product.productImagePaths ?? []),
  ].filter(Boolean);
  const selectedSourceImagePath = clean(params.selectedSourceImagePath || product.selectedSourceImagePath || productImagePaths[0]);
  const selectedSourceImageType = clean(params.selectedSourceImageType);
  const selectedSourceImageLabel = clean(params.selectedSourceImageLabel);
  const visualDetails = productVisualDetails(category, productName, mainBenefit);
  const templateSummary = clean(params.templateSummary || params.templateId);
  const shouldPreserveProduct = imageSourceMode === "image-edit" && preservationMode === "preserve-product";
  const preservationPolicy = shouldPreserveProduct
    ? "Use the provided source image as the primary visual reference. Preserve the original subject, food texture, composition, color tone, product identity, shape, silhouette, packaging if already present, label placement if already present, product count, and visible details. Do not redesign the product. Do not replace the original image with a newly designed product. Do not turn cooked food into packaged raw meat. Do not create a plastic tray package. Do not create a new label, logo, container, or product package. Edit only the background, lighting, color grading, sharpness, subtle shadows, and advertising mood. Keep the product recognizable as the exact same item from the source image."
    : "Product identity may be newly generated from the prompt; preserve key product cues when available.";

  const creativeDirection: ImageCreativeDirection = mode === "visual-only"
    ? {
      visualTone: references.visualTone,
      composition: `${references.layoutPattern}; product remains the main hero; leave clean negative space for later Korean text overlay`,
      textPolicy: "No readable text of any kind. No letters, no numbers, no typography, no captions, no logo text, no watermark, no emoji.",
      productPreservationPolicy: preservationPolicy,
      whyThisPrompt: `Uses reference visual tone and layout while avoiding all text so it can become a banner background or product hero visual.`,
    }
    : {
      visualTone: references.visualTone,
      composition: `${references.layoutPattern}; strong Korean ecommerce ad hierarchy with product hero, headline, price, highlight banner and CTA button`,
      textPolicy: "Readable Korean ad text is allowed and requested. Use only the provided copy elements, no emoji or decorative pictograms.",
      productPreservationPolicy: preservationPolicy,
      whyThisPrompt: `Uses generatedCopy by priority and adapts reference hook/copy nuance into a complete Korean ecommerce ad image.`,
    };

  const common = [
    "Create a square 1:1 Korean ecommerce performance marketing image.",
    `Product: ${productName}.`,
    `Category: ${category}.`,
    mainBenefit ? `Main selling point: ${mainBenefit}.` : "",
    targetCustomer ? `Target customer: ${targetCustomer}.` : "",
    `Reference visual tone: ${references.visualTone}.`,
    `Reference layout pattern: ${references.layoutPattern}.`,
    `Reference appeal point: ${references.appealPoint}.`,
    `Reference hook/copy nuance to adapt: ${references.hookType}; ${references.copyNuance}.`,
    templateSummary ? `Template feeling: ${templateSummary}.` : "",
    selectedSourceImagePath ? `Selected source image: ${selectedSourceImagePath}. ${selectedSourceImageLabel ? `Label: ${selectedSourceImageLabel}.` : ""} ${selectedSourceImageType ? `Type: ${selectedSourceImageType}.` : ""}` : "",
    selectedSourceImagePath ? "Use the selected source image as the primary product reference." : "",
    selectedSourceImagePath ? "Preserve the product identity, packaging shape, color, surface details, material texture, scale cues, and overall silhouette based on the selected source image." : "",
    selectedSourceImagePath ? "Do not redesign the product. Do not replace it with a different bottle, container, package, meat cut, tray, color, pattern, or shape. Keep the product recognizable as the same item." : "",
    shouldPreserveProduct ? preservationPolicy : "",
    shouldPreserveProduct ? "Make the product the main hero. Create a high-converting Korean ecommerce advertising visual. Use strong commercial lighting and clear separation from the background. The product should look more polished, but not redesigned." : "",
    shouldPreserveProduct ? "If the source image is a detail-page food image, preserve the detail-page food characteristics and do not reinterpret it as a clean packaged product shot." : "",
    productImagePaths.length ? `Additional product image references: ${productImagePaths.slice(0, 4).join(", ")}. Use them only as supporting identity guidance, not as text sources.` : "",
    visualDetails,
    "No emoji, no emoticons, no pictograms, no decorative symbols.",
  ];

  const visualOnly = [
    ...common,
    "Mode: visual-only.",
    imageSourceMode === "image-edit" ? "Image source mode: image-edit. Use the source product as the hero. Preserve the product. Improve only the background, lighting, and advertising mood." : "Image source mode: text-to-image.",
    "Ad-ready product-focused commerce visual for use as a banner background or main product visual.",
    "Absolutely no readable text.",
    "No letters.",
    "No numbers.",
    "No typography.",
    "No captions.",
    "No logo text.",
    "No watermark.",
    "Use high contrast, realistic product photography, premium commercial lighting, clean composition.",
    "Leave negative space where Korean headline can be added later by a separate template renderer.",
  ];

  const textPieces = [
    shortCopy(generatedCopy.headline, 28) && `Large bold Korean headline: "${shortCopy(generatedCopy.headline, 28)}"`,
    shortCopy(generatedCopy.price, 18) && `Price text: "${shortCopy(generatedCopy.price, 18)}"`,
    shortCopy(generatedCopy.highlightCopy, 32) && `Short highlight banner text: "${shortCopy(generatedCopy.highlightCopy, 32)}"`,
    shortCopy(generatedCopy.cta, 18) && `CTA button text: "${shortCopy(generatedCopy.cta, 18)}"`,
    shortCopy(generatedCopy.bodyCopy, 42) && `Short supporting copy: "${shortCopy(generatedCopy.bodyCopy, 42)}"`,
  ].filter(Boolean);

  const textInImage = [
    ...common,
    "Mode: text-in-image.",
    imageSourceMode === "image-edit" ? "Image source mode: image-edit. Use the source product as the hero. Preserve the product while creating the ad layout." : "Image source mode: text-to-image.",
    "Create a complete Korean ecommerce ad image with readable ad text included.",
    "Include bold readable Korean headline text.",
    "Include price text if provided.",
    "Include a short highlight banner text.",
    "Include CTA style button text.",
    "Use strong commerce layout, high contrast promotional hierarchy, product remains the hero.",
    `Copy elements to include by priority: ${textPieces.length ? textPieces.join("; ") : "headline, price, short highlight and CTA based on product information"}.`,
    "Do not overcrowd the image; use 3 to 5 key text elements only.",
    "No emoji, no emoticons, no pictograms. Use clean readable Korean typography only.",
  ];
  const templatePrompt = buildAutoImagePrompt({
    templateMode: mode === "text-in-image" ? "ad-image-with-copy" : "visual-only",
    outputCanvasPreset: "sns-square-1200",
    productName,
    category,
    targetCustomer,
    mainBenefit,
    discountInfo: clean(product.discountInfo),
    price: clean(generatedCopy.price || product.price),
    headline: shortCopy(generatedCopy.headline, 28),
    bodyCopy: shortCopy(generatedCopy.bodyCopy, 42),
    highlightCopy: shortCopy(generatedCopy.highlightCopy, 32),
    bottomBarCopy: shortCopy(generatedCopy.bottomBarCopy, 32),
    cta: shortCopy(generatedCopy.cta, 18),
    referenceVisualTone: references.visualTone,
    referenceLayoutPattern: references.layoutPattern,
    referenceAppealPoint: references.appealPoint,
    referenceHookType: references.hookType,
    referenceCopyNuance: `${references.hookType}; ${references.copyNuance}`,
    selectedSourceImagePath,
    referenceImagePaths: params.referenceImagePaths,
    preservationMode,
  });

  return {
    prompt: [
      templatePrompt.promptText,
      "Additional generation guardrails:",
      ...(mode === "visual-only" ? visualOnly : textInImage),
    ].filter(Boolean).join("\n"),
    creativeDirection,
  };
}
