import type { TemplateSlot } from "./types";

export function slotById(slots: TemplateSlot[] | undefined, id: string) {
  return slots?.find((slot) => slot.id === id);
}

export function validateTemplateSlots(slots: TemplateSlot[] | undefined, width = 1200, height = 1200) {
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const slot of slots || []) {
    if (seen.has(slot.id)) warnings.push(`Duplicate slot id: ${slot.id}`);
    seen.add(slot.id);
    if (slot.width <= 0 || slot.height <= 0) warnings.push(`Invalid slot size: ${slot.id}`);
    if (slot.x < 0 || slot.y < 0 || slot.x + slot.width > width || slot.y + slot.height > height) {
      warnings.push(`Slot outside canvas: ${slot.id}`);
    }
  }

  return warnings;
}
