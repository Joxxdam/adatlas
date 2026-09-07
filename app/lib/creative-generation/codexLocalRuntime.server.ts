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

const nonInteractiveAuthEnvironmentKeys = new Set(["OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN", "AZURE_OPENAI_API_KEY", "OPENAI_BASE_URL", "AZURE_OPENAI_ENDPOINT", "OPENAI_ORGANIZATION", "OPENAI_PROJECT"]);
const secretEnvironmentName = /(?:^|_)(?:API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIALS?)(?:_|$)/i;
const codexPlatformPackage = {
  "darwin-arm64": ["@openai/codex-darwin-arm64", "aarch64-apple-darwin"],
  "darwin-x64": ["@openai/codex-darwin-x64", "x86_64-apple-darwin"],
  "linux-arm64": ["@openai/codex-linux-arm64", "aarch64-unknown-linux-musl"],
  "linux-x64": ["@openai/codex-linux-x64", "x86_64-unknown-linux-musl"],
  "win32-arm64": ["@openai/codex-win32-arm64", "aarch64-pc-windows-msvc"],
  "win32-x64": ["@openai/codex-win32-x64", "x86_64-pc-windows-msvc"],
} as const;

export function codexLocalEnvironment(env: NodeJS.ProcessEnv = process.env) {
  return Object.fromEntries(
    Object.entries(env).filter(([key, value]) => value !== undefined && !nonInteractiveAuthEnvironmentKeys.has(key) && !secretEnvironmentName.test(key))
  ) as Record<string, string>;
}

function resolveBundledCodexExecutable() {
  const target = codexPlatformPackage[`${process.platform}-${process.arch}` as keyof typeof codexPlatformPackage];
  if (!target) return undefined;
  const vendorRoot = path.join(process.cwd(), "node_modules", ...target[0].split("/"), "vendor", target[1]);
  const binaryName = process.platform === "win32" ? "codex.exe" : "codex";
  for (const candidate of [path.join(vendorRoot, "bin", binaryName), path.join(vendorRoot, "codex", binaryName)]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export function resolveCodexLocalExecutable() {
  const explicit = process.env.CODEX_CLI_PATH?.trim();
  // Windows npm installs expose codex.cmd, but the SDK and execFile require
  // the native codex.exe. Ignore command shims and use the packaged binary.
  if (explicit && existsSync(explicit) && !(process.platform === "win32" && /\.(?:cmd|bat)$/i.test(explicit))) return explicit;
  for (const directory of (process.env.PATH || "").split(path.delimiter)) {
    const candidate = path.join(directory, process.platform === "win32" ? "codex.exe" : "codex");
    if (existsSync(candidate)) return candidate;
  }
  return resolveBundledCodexExecutable();
}

export async function codexLocalAuthenticated(options: { force?: boolean } = {}) {
  const ttl = Math.max(30_000, Number(process.env.ADATLAS_CODEX_STATUS_TTL_MS || 5 * 60_000));
  // A logout/login or account switch can happen while the Next.js process is
  // alive. Forced checks must bypass the cached boolean, but concurrent checks
  // should still share the same `codex login status` process.
  if (cache.pending) return cache.pending;
  if (!options.force && typeof cache.authenticated === "boolean" && cache.checkedAt && Date.now() - cache.checkedAt < ttl) {
    return cache.authenticated;
  }
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

export async function requireFreshCodexLocalChatGptLogin() {
  const executable = resolveCodexLocalExecutable();
  if (!executable) throw new Error("로컬 Codex 실행 파일을 찾지 못했습니다.");
  if (!(await codexLocalAuthenticated({ force: true }))) {
    throw new Error("현재 Codex CLI의 ChatGPT 로그인이 필요합니다. 계정을 변경했다면 codex logout 후 codex login을 완료해 주세요.");
  }
  return executable;
}
