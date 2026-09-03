#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import readline from "node:readline";
import { promisify } from "node:util";

const RETENTION_DAYS = 2;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1_000;
const MAX_INITIAL_LINES = 240;
const MAX_USER_MESSAGES = 4;
const THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const execFileAsync = promisify(execFile);
const execute = process.argv.includes("--execute");
const projectRoot = await realpath(process.cwd());
const codexRoot = await realpath(path.join(process.env.CODEX_HOME?.trim() || path.join(homedir(), ".codex"), "sessions"));
const generatedPathPattern = new RegExp(
  `${projectRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replaceAll("/", "\\/")}\\/(?:\\.data\\/generated|public\\/generated)\\/`,
  "i"
);

function sessionIdFromFile(file) {
  return path.basename(file).match(/-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i)?.[1];
}

async function listSessionFiles(directory, output) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await listSessionFiles(file, output);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) output.push(file);
  }
}

function textFromUserItem(payload) {
  if (payload?.role !== "user") return "";
  if (typeof payload.content === "string") return payload.content;
  if (!Array.isArray(payload.content)) return "";
  return payload.content
    .map((item) => item?.text || item?.input_text || "")
    .filter(Boolean)
    .join("\n");
}

async function inspectInitialRequest(file) {
  let metadata;
  let userMessages = 0;
  let isAdAtlasGeneratedAssetSession = false;
  const lines = readline.createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  let lineCount = 0;
  for await (const line of lines) {
    lineCount += 1;
    try {
      const entry = JSON.parse(line);
      if (entry.type === "session_meta") metadata = entry.payload;
      if (entry.type === "response_item") {
        const userText = textFromUserItem(entry.payload);
        if (userText) {
          userMessages += 1;
          if (generatedPathPattern.test(userText)) {
            isAdAtlasGeneratedAssetSession = true;
            break;
          }
          if (userMessages >= MAX_USER_MESSAGES) break;
        }
      }
    } catch {
      // A malformed historical line must never broaden the deletion scope.
    }
    if (lineCount >= MAX_INITIAL_LINES) break;
  }
  lines.close();
  return { metadata, isAdAtlasGeneratedAssetSession };
}

async function resolveCandidates(now = new Date()) {
  const cutoff = now.getTime() - RETENTION_MS;
  const files = [];
  await listSessionFiles(codexRoot, files);
  const candidates = [];
  for (const file of files) {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.mtimeMs >= cutoff) continue;
    const resolved = await realpath(file);
    if (!resolved.startsWith(`${codexRoot}${path.sep}`)) continue;
    const fileThreadId = sessionIdFromFile(resolved);
    if (!fileThreadId || !THREAD_ID_PATTERN.test(fileThreadId)) continue;
    const inspected = await inspectInitialRequest(resolved);
    const metadataThreadId = String(inspected.metadata?.id || inspected.metadata?.session_id || "");
    const metadataCwd = String(inspected.metadata?.cwd || "");
    if (inspected.metadata?.source !== "exec") continue;
    if (!metadataCwd || (await realpath(metadataCwd).catch(() => "")) !== projectRoot) continue;
    if (metadataThreadId !== fileThreadId || !inspected.isAdAtlasGeneratedAssetSession) continue;
    candidates.push({ file: resolved, threadId: fileThreadId, bytes: info.size, modifiedAt: info.mtimeMs });
  }
  return { cutoff, candidates };
}

function formatBytes(bytes) {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KiB`;
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MiB`;
  return `${(bytes / 1_073_741_824).toFixed(2)} GiB`;
}

const { cutoff, candidates } = await resolveCandidates();
const candidateBytes = candidates.reduce((sum, candidate) => sum + candidate.bytes, 0);
console.log(`AdAtlas 과거 이미지 제작 세션: ${candidates.length}개 / ${formatBytes(candidateBytes)}`);
console.log(`기준 시각: ${new Date(cutoff).toISOString()} 이전에 마지막으로 기록된 세션`);

if (!execute) {
  console.log("검토 전용 실행입니다. 삭제하려면 --execute를 명시하세요.");
  process.exit(0);
}

let deletedCount = 0;
let reclaimedBytes = 0;
let skippedCount = 0;
let failedCount = 0;
for (const [index, candidate] of candidates.entries()) {
  try {
    const current = await lstat(candidate.file);
    if (!current.isFile() || current.isSymbolicLink() || current.mtimeMs >= cutoff) {
      skippedCount += 1;
      continue;
    }
    await execFileAsync("codex", ["delete", "--force", candidate.threadId], {
      cwd: projectRoot,
      timeout: 30_000,
      maxBuffer: 256 * 1_024,
    });
    const remains = await stat(candidate.file).catch((error) => {
      if (error?.code === "ENOENT") return undefined;
      throw error;
    });
    if (remains) throw new Error("Codex 삭제 후에도 세션 파일이 남아 있습니다.");
    deletedCount += 1;
    reclaimedBytes += candidate.bytes;
  } catch (error) {
    failedCount += 1;
    console.error(`세션 ${index + 1}/${candidates.length} 삭제 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`);
  }
  if ((index + 1) % 50 === 0 || index + 1 === candidates.length) {
    console.log(`진행 ${index + 1}/${candidates.length} · 삭제 ${deletedCount} · 건너뜀 ${skippedCount} · 실패 ${failedCount}`);
  }
}

console.log(`완료: ${deletedCount}개 삭제 / ${formatBytes(reclaimedBytes)} 확보 / ${skippedCount}개 건너뜀 / ${failedCount}개 실패`);
if (failedCount) process.exitCode = 1;
