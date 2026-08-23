import type { VideoHookType } from "./types.ts";
import { createVideoMaterialCode, validateVideoMaterialCode } from "./workflow.ts";

export const createVideoAssetCode = (input: { companyName: string; productName: string; hookType: VideoHookType; date?: Date; sequence?: number }) => {
  const existingCodes: string[] = [];
  let code = "";
  for (let index = 0; index < (input.sequence || 1); index += 1) {
    code = createVideoMaterialCode({
      advertiserName: input.companyName,
      productName: input.productName,
      hookType: input.hookType,
      createdAt: input.date,
      existingCodes,
    });
    existingCodes.push(code);
  }
  return code;
};

export const validateVideoAssetCode = validateVideoMaterialCode;

export function safeVideoFileName(assetCode: string, version: number, extension: string) {
  const safeExtension = extension.toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
  return `${assetCode}_v${version}.${safeExtension}`;
}
