import "server-only";

import { normalizeDeliveryBrandingRequest, type DeliveryBrandingRequest } from "./deliveryBranding";
import { renderDeliveryBranding } from "./deliveryBranding.server";
import { creativeGenerationJobStore } from "./jobStore.server";
import type { DeliveryBranding, GenerationJob } from "./types";

export type DeliveryBrandingJobInput = DeliveryBrandingRequest & {
  resultIds?: string[];
};

export async function applyDeliveryBrandingToJob(jobId: string, input: DeliveryBrandingJobInput): Promise<{ job: GenerationJob; appliedCount: number }> {
  const { logoId, aiDisclosure, clear } = normalizeDeliveryBrandingRequest(input);

  const job = await creativeGenerationJobStore.get(jobId);
  if (!job) throw new Error("광고 생성 작업을 찾지 못했습니다.");
  const requested = Array.isArray(input.resultIds) ? new Set(input.resultIds.map(String)) : null;
  const targets = job.results.filter((result) => Boolean(result.imagePath && result.nativeCreative?.finalPath) && (!requested || requested.has(result.id)));
  if (!targets.length) throw new Error("후처리를 적용할 완성 이미지가 없습니다.");

  const rendered = new Map<string, DeliveryBranding>();
  if (!clear) {
    for (let index = 0; index < targets.length; index += 2) {
      const batch = targets.slice(index, index + 2);
      const outputs = await Promise.all(
        batch.map(async (result) => ({
          resultId: result.id,
          branding: await renderDeliveryBranding(job, result.id, { logoId, aiDisclosure }),
        }))
      );
      outputs.forEach((output) => rendered.set(output.resultId, output.branding));
    }
  }

  const targetIds = new Set(targets.map((target) => target.id));
  const updated = await creativeGenerationJobStore.update(job.id, (current) => ({
    ...current,
    results: current.results.map((result) => {
      if (!targetIds.has(result.id)) return result;
      if (clear) return { ...result, deliveryBranding: undefined };
      const branding = rendered.get(result.id);
      if (!branding || branding.sourceImagePath !== result.nativeCreative?.finalPath) return result;
      return { ...result, deliveryBranding: branding };
    }),
  }));
  return { job: updated, appliedCount: targets.length };
}
