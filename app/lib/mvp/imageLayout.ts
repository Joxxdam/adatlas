import type { BoundingBox, TemplateSlot } from "./types";

export type ImageFrame = BoundingBox & {
  imagePath: string;
  fit: "cover" | "contain";
  slotId: string;
  focalPoint: { x: number; y: number };
};

export function resolveImageLayout(params: {
  slots: TemplateSlot[];
  imagePaths: string[];
}): ImageFrame[] {
  const images = params.imagePaths.filter(Boolean).slice(0, 4);
  if (!images.length) return [];
  const slots = params.slots.filter((slot) => slot.type === "image");
  if (!slots.length) return [];

  return slots
    .map((slot, index) => {
      if (slot.requiresDistinctImage && index >= images.length) return null;
      const repeat = slot.imageFit === "repeat-product";
      const imagePath =
        images[index] || (repeat ? images[0] : images[Math.min(index, images.length - 1)]);
      const fit =
        slot.imageFit === "contain" ||
        slot.imageFit === "transparent-product" ||
        slot.imageFit === "repeat-product"
          ? "contain"
          : "cover";
      return {
        imagePath,
        x: slot.x,
        y: slot.y,
        width: slot.width,
        height: slot.height,
        fit,
        slotId: slot.id,
        focalPoint: { x: 0.5, y: 0.5 },
      };
    })
    .filter((frame): frame is ImageFrame => Boolean(frame));
}
