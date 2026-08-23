import assert from "node:assert/strict";
import test from "node:test";

import { foodCategoryTemplates, healthCategoryTemplates } from "../lib/bannerTemplates.ts";

const upgradedIds = ["camping-popularity-impact", "circle-focus-review", "black-repeat-product", "sports-benefit-chip", "before-after-split-review"];

test("reference templates use the safe slot renderer", () => {
  upgradedIds.forEach((id) => {
    const template = foodCategoryTemplates.find((item) => item.id === id);
    assert.ok(template, id);
    assert.equal(template.renderMode, "slot-engine", id);
    assert.equal(template.optimizationEnabled, true, id);
    assert.ok(template.palettePolicy && template.palettePolicy !== "fixed", id);
    assert.ok(template.textStylePresetKey, id);
    assert.ok(
      template.slots.some((slot) => slot.role === "headline"),
      id
    );
    assert.ok(
      template.slots.some((slot) => slot.type === "image"),
      id
    );
    assert.ok(template.copyLimits?.headline?.minFontSize >= 38, id);
  });
});

test("health products receive proof, lifestyle and repeated-product layouts", () => {
  const ids = new Set(healthCategoryTemplates.map((template) => template.id));
  assert.ok(ids.has("auto-body-solution-001"));
  assert.ok(ids.has("sports-benefit-chip"));
  assert.ok(ids.has("before-after-split-review"));
  assert.ok(ids.has("black-repeat-product"));
});
