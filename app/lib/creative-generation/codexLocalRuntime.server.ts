import "server-only";

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cacheKey = Symbol.for("daywiz.codex-local-runtime-status-v1");
type RuntimeCache = {
  checkedAt?: number;
  authenticated?: boolean;
  pending?: Promise<boolean>;
};
const runtimeGlobal = globalThis as typeof globalThis & { [cacheKey]?: RuntimeCache };
const cache = runtimeGlobal[cacheKey] ?? {};
runtimeGlobal[cacheKey] = cache;

const paidApiEnvironmentKeys = new Set(["OPENAI_API_KEY", "CODEX_API_KEY", "AZURE_OPENAI_API_KEY", "OPENAI_BASE_URL", "AZURE_OPENAI_ENDPOINT", "OPENAI_ORGANIZATION", "OPENAI_PROJECT"]);

export function codexLocalEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !paidApiEnvironmentKeys.has(key))) as Record<string, string>;
}

export function resolveCodexLocalExecutable() {
  const explicit = process.env.CODEX_CLI_PATH?.trim();
  if (explicit && existsSync(explicit)) return explicit;
  for (const directory of (process.env.PATH || "").split(path.delimiter)) {
    const candidate = path.join(directory, process.platform === "win32" ? "codex.exe" : "codex");
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export async function codexLocalAuthenticated(options: { force?: boolean } = {}) {
  const ttl = Math.max(30_000, Number(process.env.ADATLAS_CODEX_STATUS_TTL_MS || 5 * 60_000));
  if (!options.force && typeof cache.authenticated === "boolean" && cache.checkedAt && Date.now() - cache.checkedAt < ttl) {
    return cache.authenticated;
  }
  if (!options.force && cache.pending) return cache.pending;
  const pending = (async () => {
    try {
      const executable = resolveCodexLocalExecutable();
      if (!executable) return false;
      const { stdout, stderr } = await execFileAsync(executable, ["login", "status"], {
        timeout: 10_000,
        env: codexLocalEnvironment() as NodeJS.ProcessEnv,
      });
      // `Logged in using an API key` is intentionally rejected. The default
      // creative engine is allowed only with the user's ChatGPT/Codex login.
      return /logged in using chatgpt/i.test(`${stdout}\n${stderr}`);
    } catch {
      return false;
    }
  })();
  cache.pending = pending;
  try {
    const authenticated = await pending;
    cache.authenticated = authenticated;
    cache.checkedAt = Date.now();
    return authenticated;
  } finally {
    if (cache.pending === pending) cache.pending = undefined;
  }
}
