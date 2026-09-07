import path from "node:path";

const readOnlyValues = new Set(["1", "true", "yes", "on", "read-only", "readonly"]);

function configuredRuntimeRoot(env: NodeJS.ProcessEnv) {
  return String(env.ADATLAS_RUNTIME_DATA_ROOT || "").trim();
}

/**
 * Mutable production data can be kept outside the Git checkout by setting
 * ADATLAS_RUNTIME_DATA_ROOT. Without the setting, every existing local path
 * stays unchanged so a developer checkout is not migrated implicitly.
 */
export function resolveRuntimeDataRoot(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()) {
  const configured = configuredRuntimeRoot(env);
  return configured ? path.resolve(configured) : path.resolve(cwd, ".data");
}

export function runtimeDataPath(...segments: string[]) {
  return path.join(resolveRuntimeDataRoot(), ...segments);
}

/** Existing auto-production data historically lived under data/. */
export function resolveAutoProductionRuntimeRoot(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()) {
  const configured = configuredRuntimeRoot(env);
  return configured
    ? path.join(resolveRuntimeDataRoot(env, cwd), "auto-production")
    : path.resolve(cwd, "data", "auto-production", "runtime");
}

export function autoProductionRuntimePath(...segments: string[]) {
  return path.join(resolveAutoProductionRuntimeRoot(), ...segments);
}

/** Existing asset metadata historically lived under data/. */
export function resolveCreativeAssetsRuntimeRoot(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()) {
  const configured = configuredRuntimeRoot(env);
  return configured
    ? path.join(resolveRuntimeDataRoot(env, cwd), "creative-assets")
    : path.resolve(cwd, "data", "creative-assets");
}

export function creativeAssetsRuntimePath(...segments: string[]) {
  return path.join(resolveCreativeAssetsRuntimeRoot(), ...segments);
}

export function isReferenceLibraryReadOnly(env: NodeJS.ProcessEnv = process.env) {
  return readOnlyValues.has(String(env.ADATLAS_REFERENCE_LIBRARY_READ_ONLY || "").trim().toLowerCase());
}

export function assertReferenceLibraryWritable(env: NodeJS.ProcessEnv = process.env) {
  if (isReferenceLibraryReadOnly(env)) {
    throw new Error("이 운영 컴퓨터에서는 제작 레퍼런스를 읽기만 할 수 있습니다. 레퍼런스 변경은 개발 컴퓨터에서 반영한 뒤 Git으로 업데이트해 주세요.");
  }
}
