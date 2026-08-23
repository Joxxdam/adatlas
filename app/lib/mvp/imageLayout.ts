import type { BoundingBox, TemplateSlot } from "./types";

export type ImageFrame = BoundingBox & {
  imagePath: string;
  fit: "cover" | "contain";
  slotId: string;
  focalPoint: { x: number; y: number };
};

export function resolveImageLayout(params: { slots: TemplateSlot[]; imagePaths: string[]; backgroundImagePath?: string }): ImageFrame[] {
  const images = params.imagePaths.filter(Boolean).slice(0, 4);
  const slots = params.slots.filter((slot) => slot.type === "image");
  if (!slots.length) return [];
  const isSceneSlot = (slot: TemplateSlot) => slot.imageFit === "background-image" || slot.role === "background" || slot.role === "scene" || slot.id === "background" || slot.id === "scene";

  if (params.backgroundImagePath) {
    let productIndex = 0;
    const frames = slots
      .map((slot) => {
        const sceneSlot = isSceneSlot(slot);
        const imagePath = sceneSlot ? params.backgroundImagePath : images[productIndex] || (slot.imageFit === "repeat-product" ? images[0] : images[images.length - 1]);
        if (!sceneSlot) productIndex += 1;
        if (!imagePath) return null;
        const fit = sceneSlot || slot.imageFit === "cover" ? "cover" : slot.imageFit === "contain" || slot.imageFit === "transparent-product" || slot.imageFit === "repeat-product" ? "contain" : "cover";
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
    if (!slots.some(isSceneSlot)) {
      frames.unshift({
        imagePath: params.backgroundImagePath,
        x: 0,
        y: 0,
        width: 1200,
        height: 1200,
        fit: "cover",
        slotId: "__generatedSceneBackground",
        focalPoint: { x: 0.5, y: 0.5 },
      });
    }
    return frames;
  }

  if (!images.length) return [];

  return slots
    .map((slot, index) => {
      if (slot.requiresDistinctImage && index >= images.length) return null;
      const repeat = slot.imageFit === "repeat-product";
      const imagePath = images[index] || (repeat ? images[0] : images[Math.min(index, images.length - 1)]);
      const fit = slot.imageFit === "contain" || slot.imageFit === "transparent-product" || slot.imageFit === "repeat-product" ? "contain" : "cover";
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
