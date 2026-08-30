import "server-only";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { creativeGenerationJobStore } from "../creative-generation/jobStore.server";
import { executionResults } from "../creative-generation/jobRunnerPolicy";
import { resolveValidatedNativeDownload } from "../creative-generation/nativeCreativeStorage.server";
import { numberedProductImageFileName, productDownloadStem } from "../creative-generation/downloadNaming";
import { autoProductionRepository } from "./productionRepository.server";

const packagesDirectory = path.join(process.cwd(), "data", "auto-production", "runtime", "packages");
const packageContentVersion = "images-only-flat-v2";

function safeName(value: string) {
  return (
    value
      .replace(/[^\p{L}\p{N}._-]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "product"
  );
}

function packageFingerprint(resultIds: string[]) {
  return createHash("sha256")
    .update(`${packageContentVersion}|${[...resultIds].sort().join("|")}`)
    .digest("hex")
    .slice(0, 12);
}

export type AutoProductionPackageArtifact = {
  path: string;
  fileName: string;
  imageCount: number;
  generatedAt: string;
};

async function buildPackage(runId: string, taskId?: string): Promise<AutoProductionPackageArtifact> {
  const run = await autoProductionRepository.get(runId);
  if (!run) throw new Error("자동 제작 실행 기록을 찾지 못했습니다.");
  const selectedTasks = taskId ? run.tasks.filter((task) => task.id === taskId) : run.tasks;
  if (taskId && !selectedTasks.length) throw new Error("자동 제작 상품 결과를 찾지 못했습니다.");

  const prepared: Array<{
    task: (typeof run.tasks)[number];
    job: NonNullable<Awaited<ReturnType<typeof creativeGenerationJobStore.get>>>;
    results: ReturnType<typeof executionResults>;
  }> = [];
  const completedResultIds: string[] = [];
  const packageFingerprintKeys: string[] = [];

  for (const task of selectedTasks) {
    if (!task.generationJobId) continue;
    const job = await creativeGenerationJobStore.get(task.generationJobId);
    if (!job) continue;
    const results = executionResults(job).filter((result) => Boolean(result.nativeCreative?.finalPath));
    if (!results.length) continue;
    completedResultIds.push(...results.map((result) => result.id));
    packageFingerprintKeys.push(...results.map((result) => `${result.id}:${result.deliveryBranding?.updatedAt || "original"}`));
    prepared.push({ task, job, results });
  }

  if (!completedResultIds.length) {
    throw new Error("다운로드할 생성 이미지가 아직 없습니다.");
  }

  const fingerprint = packageFingerprint(packageFingerprintKeys);
  const taskName = taskId ? `-${safeName(selectedTasks[0].candidate.productName)}` : "";
  const storedFileName = `auto-production-${run.businessDate}-${safeName(run.advertiserName)}${taskName}-${fingerprint}.zip`;
  const fileName = taskId ? `${productDownloadStem(selectedTasks[0].candidate.productName)}.zip` : storedFileName;
  const packagePath = path.join(packagesDirectory, storedFileName);
  try {
    await fs.access(packagePath);
    return {
      path: packagePath,
      fileName,
      imageCount: completedResultIds.length,
      generatedAt: run.packageReadyAt || run.completedAt || run.updatedAt,
    };
  } catch {
    // 현재 결과 조합의 패키지가 없을 때만 생성합니다.
  }

  const zip = new JSZip();
  let imageCount = 0;
  const usedImageNames = new Set<string>();

  for (const { task, job, results } of prepared) {
    const productStem = productDownloadStem(job.productTruth.normalized?.cleanProductName || task.candidate.productName);
    for (const [index, result] of results.entries()) {
      const numberedName = numberedProductImageFileName(productStem, index + 1);
      const nameWithoutExtension = numberedName.replace(/\.[a-z0-9]+$/i, "");
      const extension = numberedName.match(/\.([a-z0-9]+)$/i)?.[1] || "jpg";
      let imageName = `${nameWithoutExtension}.${extension}`;
      let duplicate = 2;
      while (usedImageNames.has(imageName)) imageName = `${nameWithoutExtension}-${duplicate++}.${extension}`;
      try {
        zip.file(imageName, await fs.readFile(resolveValidatedNativeDownload(job, result.id)));
        usedImageNames.add(imageName);
        imageCount += 1;
      } catch {
        continue;
      }
    }
  }

  if (!imageCount) throw new Error("다운로드할 생성 이미지 파일을 읽을 수 없습니다.");

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  await fs.mkdir(packagesDirectory, { recursive: true });
  const temporary = `${packagePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, buffer);
  await fs.rename(temporary, packagePath);
  return {
    path: packagePath,
    fileName,
    imageCount,
    generatedAt: new Date().toISOString(),
  };
}

export function buildAutoProductionPackage(runId: string) {
  return buildPackage(runId);
}

export function buildAutoProductionProductPackage(runId: string, taskId: string) {
  return buildPackage(runId, taskId);
}
