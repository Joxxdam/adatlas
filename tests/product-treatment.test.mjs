import assert from "node:assert/strict";
import test from "node:test";

import { buildProductTreatment } from "../app/lib/creative/buildProductTreatment.ts";

test("강한 가격 후킹은 누끼 상품에 전환형 강조 효과를 적용한다", () => {
  const effect = buildProductTreatment({
    archetypeId: "price-event",
    intensity: "performance",
    colorHints: ["#ff1f1f"],
  });

  assert.equal(effect.outline, true);
  assert.equal(effect.glow, true);
  assert.equal(effect.shadow, true);
  assert.ok(effect.productScale > 1);
});

test("생활 장면형은 과한 광원 대신 자연스러운 접지 그림자를 사용한다", () => {
  const effect = buildProductTreatment({
    archetypeId: "lifestyle-context",
    intensity: "brand",
    colorHints: ["#ffffff"],
  });

  assert.equal(effect.outline, false);
  assert.equal(effect.glow, false);
  assert.equal(effect.shadow, true);
  assert.equal(effect.productScale, 1);
});
