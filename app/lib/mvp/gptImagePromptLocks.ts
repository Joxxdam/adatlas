import type { GptImageGenerationMode, GptImagePreservationMode, GptImageSourceMode } from "./types";

type BuildImagePreservationLockPromptParams = {
  imageGenerationMode: GptImageGenerationMode;
  imageSourceMode: GptImageSourceMode;
  preservationMode: GptImagePreservationMode;
  category?: string;
};

export function buildImagePreservationLockPrompt(params: BuildImagePreservationLockPromptParams) {
  const chunks: string[] = [];

  if (params.imageSourceMode === "image-edit") {
    chunks.push(
      "SOURCE IMAGE LOCK:",
      "Use the selected source image as the main visual reference.",
      "Preserve the original subject, product shape, food state, texture, color, count, angle, and core identity.",
      "Do not replace it with a different product."
    );
  }

  if (params.preservationMode === "preserve-product") {
    chunks.push(
      "PRODUCT PRESERVATION LOCK:",
      "Do not redesign the product.",
      "Do not invent new packaging, labels, logos, stickers, containers, seals, or brand marks.",
      "Only adjust background, lighting, color grading, sharpness, shadows, and advertising mood."
    );
  }

  if (params.category && /(식품|푸드|고기|한우|갈비|정육|food|meat)/i.test(params.category)) {
    chunks.push(
      "FOOD/MEAT LOCK:",
      "Keep the original food category and cooked/raw state.",
      "Do not turn cooked food into raw packaged meat.",
      "Do not turn a real dish or detail-page food photo into a plastic tray product.",
      "Prioritize realistic food texture, moisture, appetite appeal, and natural color."
    );
  }

  if (params.imageGenerationMode === "visual-only") {
    chunks.push(
      "VISUAL-ONLY LOCK:",
      "No readable text.",
      "No typography.",
      "No letters.",
      "No numbers.",
      "No price, CTA, badges, stickers, captions, or logos in the generated image."
    );
  }

  return chunks.join("\n");
}
