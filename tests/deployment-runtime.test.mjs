import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  assertReferenceLibraryWritable,
  isReferenceLibraryReadOnly,
  resolveAutoProductionRuntimeRoot,
  resolveCreativeAssetsRuntimeRoot,
  resolveRuntimeDataRoot,
} from "../app/lib/runtimeStorage.ts";

test("runtime storage keeps existing local paths when no external root is configured", () => {
  const cwd = path.resolve("fixture-project");
  assert.equal(resolveRuntimeDataRoot({}, cwd), path.join(cwd, ".data"));
  assert.equal(resolveAutoProductionRuntimeRoot({}, cwd), path.join(cwd, "data", "auto-production", "runtime"));
  assert.equal(resolveCreativeAssetsRuntimeRoot({}, cwd), path.join(cwd, "data", "creative-assets"));
});

test("external runtime storage keeps mutable production files outside the checkout", () => {
  const cwd = path.resolve("fixture-project");
  const external = path.resolve("fixture-runtime");
  const env = { ADATLAS_RUNTIME_DATA_ROOT: external };
  assert.equal(resolveRuntimeDataRoot(env, cwd), external);
  assert.equal(resolveAutoProductionRuntimeRoot(env, cwd), path.join(external, "auto-production"));
  assert.equal(resolveCreativeAssetsRuntimeRoot(env, cwd), path.join(external, "creative-assets"));
});

test("reference library read-only mode blocks every repository mutation", () => {
  assert.equal(isReferenceLibraryReadOnly({}), false);
  assert.equal(isReferenceLibraryReadOnly({ ADATLAS_REFERENCE_LIBRARY_READ_ONLY: "true" }), true);
  assert.throws(
    () => assertReferenceLibraryWritable({ ADATLAS_REFERENCE_LIBRARY_READ_ONLY: "read-only" }),
    /읽기만 할 수 있습니다/u
  );
});
