import "server-only";

import {
  readBrandMemory,
  saveGoldenReference,
  updateBrandMemory,
  type AdvertiserBrandMemory,
  type GoldenReference,
} from "./codexRegistry.server.ts";

export type CreativeExpressionStrength = "SAFE" | "STRONG" | "VIRAL";
export type CreativePreferenceState =
  | "approved"
  | "approved-after-copy-edit"
  | "approved-after-image-edit"
  | "rejected"
  | "never-reuse"
  | "reusable-across-products"
  | "feedback";

export type CreativePreferenceEvent = {
  advertiserId: string;
  productId: string;
  hookCode: string;
  state: CreativePreferenceState;
  reason?: string;
  reusableTrait?: string;
};

export type CreativePreferenceSnapshot = {
  expressionStrength: CreativeExpressionStrength;
  memory: AdvertiserBrandMemory;
};

export interface CreativePreferenceRepository {
  read(advertiserId: string): Promise<CreativePreferenceSnapshot>;
  record(event: CreativePreferenceEvent): Promise<void>;
  saveGolden(input: Omit<GoldenReference, "id" | "advertiserId" | "imagePath" | "approvedAt"> & {
    advertiserId: string;
    sourceImagePath: string;
  }): Promise<GoldenReference>;
}

function eventValue(event: CreativePreferenceEvent) {
  return [
    event.state,
    event.productId,
    event.hookCode,
    event.reason,
    event.reusableTrait,
  ].filter(Boolean).join(" · ");
}

export const creativePreferenceRepository: CreativePreferenceRepository = {
  async read(advertiserId) {
    return {
      // 기존 광고주 설정에 값이 없는 경우 과장보다 생활어를 우선하는 STRONG을 사용한다.
      expressionStrength: "STRONG",
      memory: await readBrandMemory(advertiserId),
    };
  },
  async record(event) {
    const kind = event.state === "rejected" || event.state === "never-reuse"
      ? "reject"
      : event.state === "reusable-across-products" || event.state.startsWith("approved")
        ? "approve"
        : "feedback";
    await updateBrandMemory(event.advertiserId, { kind, value:eventValue(event) });
  },
  saveGolden: saveGoldenReference,
};
