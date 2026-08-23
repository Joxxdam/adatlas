import "server-only";

import { randomUUID } from "crypto";
import { composeCategoryCreative, defaultCategoryCreativeCopy, paletteForStyle, rerenderCategoryCreativeCopy } from "./composer.server";
import { getCategoryCreativeJob, getCategoryCreativeSource, saveCategoryCreativeJob } from "./repository.server";
import type { CategoryCreativeCopy, CategoryCreativeJob, CategoryCreativeStyle } from "./types";

function cleanCopy(copy: CategoryCreativeCopy) {
  return {
    headline: copy.headline.trim().slice(0, 48),
    subheadline: copy.subheadline.trim().slice(0, 64),
    cta: copy.cta.trim().slice(0, 24),
  };
}

export async function createCategoryCreative(input: { advertiserId: string; advertiserName: string; categoryId: string; categoryName: string; style: CategoryCreativeStyle; sourceIds: string[]; representativeSourceId?: string; copy?: CategoryCreativeCopy }) {
  const sourceIds = [...new Set(input.sourceIds)].slice(0, 5);
  if (sourceIds.length < 3) throw new Error("같은 광고주·카테고리의 실제 상품 이미지를 3장 이상 선택해 주세요.");
  const sources = await Promise.all(sourceIds.map(getCategoryCreativeSource));
  if (sources.some((source) => !source)) throw new Error("선택한 원본 이미지 중 찾을 수 없는 항목이 있습니다.");
  if (sources.some((source) => source?.advertiserId !== input.advertiserId || source?.categoryId !== input.categoryId)) throw new Error("다른 광고주 또는 카테고리의 이미지는 함께 사용할 수 없습니다.");
  const now = new Date().toISOString();
  const job: CategoryCreativeJob = {
    id: `category-creative-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
    kind: "category-creative",
    status: "generating",
    advertiserId: input.advertiserId,
    advertiserName: input.advertiserName.trim().slice(0, 120),
    categoryId: input.categoryId,
    categoryName: input.categoryName.trim().slice(0, 80),
    style: input.style,
    sourceIds,
    representativeSourceId: input.representativeSourceId && sourceIds.includes(input.representativeSourceId) ? input.representativeSourceId : sourceIds[0],
    copy: cleanCopy(input.copy || defaultCategoryCreativeCopy(input.categoryName, input.style)),
    palette: paletteForStyle(input.style),
    conceptId: `fashion-category-${input.style}`,
    conceptSummary: "같은 광고주의 실제 상품 이미지를 한 장에 모은 에디토리얼형 카테고리 대표 비주얼",
    referenceProfile: "fashion-editorial-v1",
    outputs: null,
    qa: [],
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  await saveCategoryCreativeJob(job);
  try {
    job.outputs = await composeCategoryCreative(job, sources.filter((source): source is NonNullable<typeof source> => Boolean(source)));
    job.status = "completed";
    job.qa = [
      { code: "source-scope", level: "pass", message: "모든 원본이 동일 광고주·카테고리에 속합니다." },
      { code: "responsive-pair", level: "pass", message: "동일 콘셉트로 정사각형·세로형을 각각 재배치했습니다." },
      { code: "server-text", level: "pass", message: "한국어 문구를 서버에서 렌더링했습니다." },
    ];
  } catch (error) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : "카테고리 이미지 제작에 실패했습니다.";
  }
  job.updatedAt = new Date().toISOString();
  await saveCategoryCreativeJob(job);
  return job;
}

export async function updateCategoryCreativeCopy(jobId: string, copy: CategoryCreativeCopy) {
  const job = await getCategoryCreativeJob(jobId);
  if (!job || job.status !== "completed" || !job.outputs) throw new Error("수정할 카테고리 이미지 결과를 찾지 못했습니다.");
  job.copy = cleanCopy(copy);
  job.updatedAt = new Date().toISOString();
  await rerenderCategoryCreativeCopy(job);
  await saveCategoryCreativeJob(job);
  return job;
}
