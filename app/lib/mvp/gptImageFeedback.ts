import type { GptImageFailureReason } from "./types";

type BuildRevisionPromptParams = {
  failureReasons?: GptImageFailureReason[];
  customFeedback?: string;
  category?: string;
};

const reasonPromptMap: Record<GptImageFailureReason, string[]> = {
  "original-subject-changed": [
    "Keep the original subject recognizable.",
    "Do not change the product type, food state, main shape, color, texture, or quantity.",
    "Only improve the commercial mood, lighting, background, and composition around the original product.",
  ],
  "turned-into-packaged-product": [
    "Do not turn the original image into a packaged product.",
    "Do not create a plastic tray package.",
    "Remove any plastic tray, shrink wrap, barcode, artificial package label, sticker, box, container, or newly designed retail packaging.",
    "Do not create new product labels, logos, stickers, containers, or packaging.",
    "If the source image is cooked food or a real detail-page food photo, keep it as that food instead of converting it into a retail packshot.",
  ],
  "cooked-food-turned-raw": [
    "Do not turn cooked food into raw ingredients.",
    "Preserve the cooked appearance, browned surface, sauce, moisture, garnish, plate, or serving context when present.",
    "For meat, keep the same cooked/raw state as the selected source image.",
  ],
  "product-too-small": [
    "Make the product larger and more dominant in the frame.",
    "The product should be the clear hero subject, not a small prop in the background.",
    "Leave enough clean space only where the template will add copy later.",
  ],
  "bad-background": [
    "Replace the background with a cleaner, more premium, performance-ad-friendly background.",
    "Avoid clutter, messy props, unrelated objects, and confusing surfaces.",
    "Use lighting and contrast that help the product stand out.",
  ],
  "unwanted-text": [
    "No readable text.",
    "No typography.",
    "No letters.",
    "No numbers.",
    "Do not add captions, price, CTA buttons, badges, speech bubbles, stickers, signs, or interface text inside the image.",
  ],
  "unwanted-label-or-logo": [
    "Do not invent new logos, labels, brand marks, seals, stickers, or certification badges.",
    "Do not add fake package information or fake product names.",
    "Keep only visual product details that already exist in the source image.",
  ],
  "copied-reference-product": [
    "Do not copy the reference advertisement's product, brand, package, or exact visual layout.",
    "Use only the broad advertising mood and composition idea, while keeping the selected source product as the subject.",
  ],
  "weak-advertising-mood": [
    "Make the image feel more like a strong Korean ecommerce performance ad visual.",
    "Increase appetite appeal, contrast, freshness, lighting, and purchase-triggering visual impact.",
    "The result should look commercially useful, not like a casual snapshot.",
  ],
  "too-ai-looking": [
    "Make the result more natural and photographic.",
    "Avoid plastic-looking texture, over-smoothed surfaces, distorted edges, fake shine, impossible shadows, and surreal details.",
  ],
  "wrong-composition": [
    "Improve the composition for a 1:1 ecommerce banner.",
    "Center the product clearly and avoid cutting off the important subject.",
    "Keep a usable area for template text overlays without hiding the product.",
  ],
  other: [
    "Apply the user's correction carefully while preserving the selected source image as the main reference.",
  ],
};

export function buildRevisionPromptFromFeedback(params: BuildRevisionPromptParams) {
  const failureReasons = Array.from(new Set(params.failureReasons ?? []));
  const chunks = [
    "Revision request based on user feedback.",
    "Keep the selected original/source image as the primary visual reference.",
  ];

  failureReasons.forEach((reason) => {
    chunks.push(...reasonPromptMap[reason]);
  });

  if (params.category && /(식품|푸드|고기|한우|갈비|정육|food|meat)/i.test(params.category)) {
    chunks.push(
      "Food category reminder: preserve the food's actual state, texture, moisture, doneness, cut, plate or serving context from the source image.",
      "For meat images, do not accidentally convert cooked meat into raw packaged meat, or raw meat into cooked food."
    );
  }

  if (params.customFeedback?.trim()) {
    chunks.push("User's additional feedback:");
    chunks.push(params.customFeedback.trim());
  }

  chunks.push(
    "Generate a revised image that fixes the selected issues.",
    "Do not add text unless the request explicitly asks for a text-in-image advertisement."
  );

  return chunks.filter(Boolean).join("\n");
}
