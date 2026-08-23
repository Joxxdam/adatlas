export const MAX_VIDEO_UPLOAD_BYTES = 200 * 1024 * 1024;
export const ALLOWED_VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);

export function detectVideoType(buffer: Buffer) {
  if (buffer.length >= 12 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return "video/webm";
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("ascii").toLowerCase();
    return brand.includes("qt") ? "video/quicktime" : "video/mp4";
  }
  return "";
}

export function extensionForVideoType(type: string) {
  if (type === "video/webm") return "webm";
  if (type === "video/quicktime") return "mov";
  return "mp4";
}
