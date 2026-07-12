import type { GptPromptTemplateInput, GptPromptTemplateResult } from "./types";

const emojiRegex = /[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu;

function clean(value?: string) {
  return String(value ?? "")
    .replace(emojiRegex, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function line(label: string, value?: string) {
  const text = clean(value);
  return text ? `${label}: ${text}` : "";
}

export function buildFoodMeatPreservationPrompt(input: GptPromptTemplateInput): string {
  const categoryText = `${input.category || ""} ${input.productName || ""}`;

  if (!/식품|고기|한우|등심|갈비|스테이크|요리|음식|meat|beef|food|steak/i.test(categoryText)) {
    return "";
  }

  return `
[Food / meat preservation rules]
If the source image shows cooked food, keep it as cooked food.
Do not turn cooked food into raw meat.
Do not turn the original image into a packaged product.
Do not create a plastic tray package.
Do not create new product labels, logos, stickers, containers, or packaging.
Do not replace grilled meat with raw sliced meat.
Preserve the cooked texture, grilled surface, oil shine, color, and appetizing food detail.

원본 이미지가 조리된 음식이라면 조리된 상태를 유지해주세요.
구운 고기를 생고기, 포장육, 플라스틱 트레이 상품처럼 바꾸지 마세요.
새로운 라벨, 로고, 포장, 용기, 스티커를 만들지 마세요.
구운 표면, 육즙, 윤기, 식감, 먹음직스러운 디테일을 유지해주세요.
`.trim();
}

export function buildVisualOnlyPrompt(input: GptPromptTemplateInput): string {
  const productName = clean(input.productName) || "selected ecommerce product";
  const category = clean(input.category) || "consumer product";
  const preservationMode = input.preservationMode || "preserve-product";
  const shouldPreserve =
    preservationMode === "preserve-product" && Boolean(input.selectedSourceImagePath);

  const common = [
    "Purpose: create an SNS ecommerce advertising image for a Korean performance marketing banner.",
    "Output canvas: 1200x1200 pixels, square 1:1 composition.",
    "The final image must be useful for a social media ad banner, not a generic product photo.",
    line("Product name", productName),
    line("Category", category),
    line("Target customer", input.targetCustomer),
    line("Main selling benefit", input.mainBenefit),
    line("Discount or offer", input.discountInfo),
    line("Price", input.price),
    line("Reference visual tone", input.referenceVisualTone),
    line("Reference layout pattern", input.referenceLayoutPattern),
    line("Reference appeal point", input.referenceAppealPoint),
    line("Reference hook type", input.referenceHookType),
    line("Reference copy nuance", input.referenceCopyNuance),
    input.referenceImagePaths?.length
      ? `Additional reference images for mood/layout only: ${input.referenceImagePaths.join(", ")}`
      : "",
    input.referenceImagePaths?.length
      ? "Use additional reference images only for visual mood, lighting, composition, and advertising style. Do not copy their product."
      : "",
    input.selectedSourceImagePath
      ? `Selected source image path: ${input.selectedSourceImagePath}`
      : "",
    shouldPreserve
      ? "Use the selected source image as the primary product reference. Preserve the original subject, food/product state, shape, color, texture, packaging only if already present, quantity, scale cues, and visible identity."
      : "",
    shouldPreserve
      ? "Do not redesign the product. Do not replace it with a different item. Do not create new labels, logos, stickers, containers, plastic trays, or packaging."
      : "",
    buildFoodMeatPreservationPrompt(input),
    "No emoji, no emoticons, no decorative pictograms.",
  ];

  return [
    ...common,
    "Template mode: visual-only advertising visual.",
    "Create a strong product hero visual that can later receive text through the app's template renderer.",
    "Do not include any readable text inside the generated image.",
    "No readable text.",
    "No typography.",
    "No letters.",
    "No numbers.",
    "No price. No CTA button. No badges. No captions. No watermark.",
    "Leave clean negative space for future Korean headline and promotional copy overlays.",
    "Use realistic commercial lighting, strong product separation, appetizing or premium texture, and clean composition.",
    "Output: Generate a polished 1200x1200 Korean ecommerce advertising visual without text.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildAdImageWithCopyPrompt(input: GptPromptTemplateInput): string {
  const productName = clean(input.productName) || "selected ecommerce product";
  const category = clean(input.category) || "consumer product";
  const preservationMode = input.preservationMode || "preserve-product";
  const shouldPreserve =
    preservationMode === "preserve-product" && Boolean(input.selectedSourceImagePath);

  const common = [
    "[Goal]",
    "Create a polished Korean ecommerce SNS advertising banner image.",
    "",
    "[Canvas]",
    "Create a 1200x1200 square image.",
    "The image must be suitable for Meta / Instagram feed advertising.",
    "This is a Korean ecommerce performance marketing banner.",
    "",
    "[Product]",
    line("Product name", productName),
    line("Category", category),
    line("Target customer", input.targetCustomer),
    line("Main benefit", input.mainBenefit),
    line("Discount / offer", input.discountInfo),
    line("Price", input.price),
    "",
    "[Visual direction]",
    line(
      "Reference visual tone",
      input.referenceVisualTone || "high-converting Korean ecommerce advertising visual tone"
    ),
    line(
      "Reference layout pattern",
      input.referenceLayoutPattern || "clear hero product layout with strong promotional hierarchy"
    ),
    line("Reference appeal point", input.referenceAppealPoint || "clear purchase reason"),
    line("Reference hook type", input.referenceHookType || "commerce hook suited to the product"),
    line("Reference copy nuance", input.referenceCopyNuance || "direct Korean ecommerce copy tone"),
    input.referenceHookType
      ? `Apply this hook strategy to the visual hierarchy and copy mood: ${clean(input.referenceHookType)}.`
      : "",
    "Create a strong Korean ecommerce advertising banner with clear promotional hierarchy.",
    "",
    "[Source image role]",
    input.selectedSourceImagePath
      ? `Selected source image path: ${input.selectedSourceImagePath}`
      : "",
    input.referenceImagePaths?.length
      ? `Additional reference image paths: ${input.referenceImagePaths.join(", ")}`
      : "",
    input.referenceImagePaths?.length
      ? "Use additional reference images only for mood, lighting, layout, and ad styling. Do not copy their product or brand."
      : "",
    shouldPreserve ? "Use the provided source image as the primary visual reference." : "",
    shouldPreserve
      ? "Preserve the original subject, shape, silhouette, texture, color tone, composition, and visual identity."
      : "",
    shouldPreserve
      ? "Do not redesign the product. Do not replace the product with a different item."
      : "",
    shouldPreserve
      ? "Edit only the background, lighting, color grading, shadows, composition, and commercial advertising mood."
      : "",
    shouldPreserve ? "선택한 원본 기준 이미지를 가장 중요한 시각 기준으로 사용해주세요." : "",
    shouldPreserve
      ? "원본 상품의 형태, 실루엣, 질감, 색감, 구도, 전체 인상을 최대한 유지해주세요."
      : "",
    buildFoodMeatPreservationPrompt(input),
  ];

  return [
    ...common,
    "",
    "[Copy insertion]",
    "Insert only the following copy into the image.",
    "Do not invent extra text, numbers, prices, logos, brand names, stickers, or labels.",
    "Do not add random Korean or English words.",
    "",
    "Headline:",
    clean(input.headline),
    "",
    "Body copy:",
    clean(input.bodyCopy),
    "",
    "Highlight copy:",
    clean(input.highlightCopy),
    "",
    "Bottom bar copy:",
    clean(input.bottomBarCopy),
    "",
    "CTA:",
    clean(input.cta),
    "",
    "Price:",
    clean(input.price),
    "",
    "[Text hierarchy]",
    "- Headline should be the largest and easiest to read.",
    "- Highlight copy should be the second most prominent.",
    "- Body copy should be short and readable.",
    "- CTA should look like a button or bottom-bar element.",
    "- Price should be placed only if provided.",
    "- Make the text readable and balanced for a Korean SNS ad banner.",
    "- Do not cover the product with text.",
    "",
    "[Restrictions]",
    "- Do not distort the product.",
    "- Do not create a new product package unless the original already has one.",
    "- Do not create a new label, logo, sticker, brand name, price tag, or package text.",
    "- Do not add broken text.",
    "- Do not add meaningless Korean or English letters.",
    "- Do not make the product too small.",
    "- Avoid overly artificial AI texture.",
    "",
    "[Output]",
    "Generate a polished 1200x1200 Korean ecommerce SNS advertising banner with text included.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildAutoImagePrompt(input: GptPromptTemplateInput): GptPromptTemplateResult {
  const canvasPreset = "sns-square-1200";
  const normalizedInput: GptPromptTemplateInput = {
    ...input,
    outputCanvasPreset: canvasPreset,
  };
  const promptText =
    normalizedInput.templateMode === "ad-image-with-copy"
      ? buildAdImageWithCopyPrompt(normalizedInput)
      : buildVisualOnlyPrompt(normalizedInput);
  const customNote = clean(input.customPromptNote);

  return {
    mode: input.templateMode,
    canvasPreset,
    promptText: [promptText, customNote ? "[Additional user direction]" : "", customNote]
      .filter(Boolean)
      .join("\n\n"),
  };
}

export const buildDefaultImagePromptTemplate = buildAutoImagePrompt;
