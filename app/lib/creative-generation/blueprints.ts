import blueprintData from "../../../data/creative-blueprints.json" with { type: "json" };
import type { CreativeBlueprint, CreativeBlueprintId } from "./types";

export const creativeBlueprints = blueprintData as CreativeBlueprint[];

export function getCreativeBlueprint(id: CreativeBlueprintId) {
  const blueprint = creativeBlueprints.find((item) => item.id === id);
  if (!blueprint) throw new Error(`Unknown creative blueprint: ${id}`);
  return blueprint;
}

export function validateBlueprintCatalog() {
  const ids = creativeBlueprints.map((item) => item.id);
  return {
    valid: creativeBlueprints.length === 6 && new Set(ids).size === 6,
    count: creativeBlueprints.length,
    ids,
  };
}
