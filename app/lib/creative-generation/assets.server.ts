import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { validatePublicHttpUrl } from "../store-analysis/urlSafety.ts";

const MAX_ASSET_BYTES = 12 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const publicRoot = path.join(process.cwd(), "public");
const generatedRoot = path.join(process.cwd(), ".data", "generated");

async function readLimited(response: Response) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_ASSET_BYTES) throw new Error("이미지 용량은 12MB 이하여야 합니다.");
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_ASSET_BYTES) {
      await reader.cancel();
      throw new Error("이미지 용량은 12MB 이하여야 합니다.");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size);
}

async function downloadRemoteAsset(value: string) {
  let current = await validatePublicHttpUrl(value);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetch(current, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Accept: "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5",
        "User-Agent": "Mozilla/5.0 (compatible; AdAtlasCreativeRenderer/1.0)",
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirects === MAX_REDIRECTS) throw new Error("이미지 리디렉션이 너무 많습니다.");
      current = await validatePublicHttpUrl(new URL(location, current).toString());
      continue;
    }
    await validatePublicHttpUrl(response.url || current.toString());
    if (!response.ok) throw new Error(`이미지 다운로드 실패: HTTP ${response.status}`);
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.startsWith("image/") || contentType.includes("svg")) {
      throw new Error("지원되는 래스터 이미지가 아닙니다.");
    }
    return readLimited(response);
  }
  throw new Error("이미지 리디렉션이 너무 많습니다.");
}

function decodeDataUrl(value: string) {
  const matched = value.match(/^data:image\/(?:png|jpe?g|webp|avif);base64,([a-z0-9+/=]+)$/i);
  if (!matched) return null;
  const buffer = Buffer.from(matched[1], "base64");
  if (!buffer.length || buffer.length > MAX_ASSET_BYTES) throw new Error("data URL 이미지 크기가 올바르지 않습니다.");
  return buffer;
}

function resolvePublicFile(value: string) {
  const relative = String(value || "").replace(/^\/+/, "");
  const resolved = path.resolve(publicRoot, relative);
  if (!resolved.startsWith(`${publicRoot}${path.sep}`)) throw new Error("public 외부 파일은 읽을 수 없습니다.");
  return resolved;
}

function isWithinRoot(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function resolveLocalRasterFile(value: string) {
  if (!path.isAbsolute(value)) return resolvePublicFile(value);
  const resolved = path.resolve(value);
  if (isWithinRoot(publicRoot, resolved) || isWithinRoot(generatedRoot, resolved)) return resolved;

  // Browser-facing public paths (for example `/background-library/foo.webp`)
  // are absolute from the URL's point of view, not from the host filesystem's.
  // Resolve them under public/ while keeping the existing traversal guard.
  if (value.startsWith("/") && !value.startsWith("//")) return resolvePublicFile(value);
  throw new Error("허용되지 않은 로컬 이미지 경로입니다.");
}

async function readLocalRasterFile(value: string) {
  const resolved = resolveLocalRasterFile(value);
  let lastError: unknown;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const stat = await fs.stat(resolved);
      if (!stat.isFile() || stat.size > MAX_ASSET_BYTES) throw new Error("이미지 용량은 12MB 이하여야 합니다.");
      const buffer = await fs.readFile(resolved);
      if (buffer.length !== stat.size) throw new Error("이미지 파일 저장이 아직 완료되지 않았습니다.");
      return buffer;
    } catch (error) {
      lastError = error;
      if (!isWithinRoot(generatedRoot, resolved) || attempt === 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw lastError;
}

export async function readCreativeRasterAsset(value: string) {
  const data = decodeDataUrl(value);
  const buffer = data ? data : /^https?:\/\//i.test(value) ? await downloadRemoteAsset(value) : await readLocalRasterFile(value);
  const metadata = await sharp(buffer).metadata();
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > 40_000_000) {
    throw new Error("이미지 해상도가 지원 범위를 벗어났습니다.");
  }
  return buffer;
}
