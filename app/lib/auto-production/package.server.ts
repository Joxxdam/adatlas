import "server-only";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { buildAdCopyCsv } from "../ad-copy/adCopyValidator";
import { creativeGenerationJobStore } from "../creative-generation/jobStore.server";
import { executionResults } from "../creative-generation/jobRunnerPolicy";
import { resolveValidatedNativeDownload } from "../creative-generation/nativeCreativeStorage.server";
import { numberedProductImageFileName, productDownloadStem } from "../creative-generation/downloadNaming";
import { autoProductionRepository } from "./productionRepository.server";

const packagesDirectory = path.join(process.cwd(), "data", "auto-production", "runtime", "packages");

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
    .update([...resultIds].sort().join("|"))
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
  const rows: Array<{
    productName: string;
    primaryText: string;
    adTitle?: string;
    adName?: string;
    utm?: string;
    assetCode?: string;
    hookId?: string;
  }> = [];
  const manifest: Array<Record<string, unknown>> = [];
  const failures = selectedTasks.flatMap((task) => [
    ...(task.error ? [{ productName: task.candidate.productName, taskId: task.id, status: task.status, error: task.error }] : []),
    ...task.results
      .filter((result) => !result.imageUrl)
      .map((result) => ({
        productName: task.candidate.productName,
        taskId: task.id,
        resultId: result.generationResultId,
        hookCode: result.hookCode,
        status: result.status,
      })),
  ]);

  for (const { task, job, results } of prepared) {
    const productStem = productDownloadStem(job.productTruth.normalized?.cleanProductName || task.candidate.productName);
    const folder = zip.folder(productStem);
    for (const [index, result] of results.entries()) {
      const hookCode = result.hookPlan.hookCode;
      const imageName = numberedProductImageFileName(productStem, index + 1);
      try {
        folder?.file(imageName, await fs.readFile(resolveValidatedNativeDownload(job, result.id)));
      } catch {
        continue;
      }

      const primaryText = job.adCopy?.status !== "needs-review" && job.adCopy?.primaryText ? job.adCopy.primaryText : [result.hookPlan.headline, result.hookPlan.body].filter(Boolean).join("\n");
      const primaryLabel = job.copyPlanMode === "reference-adapted" ? "메인 문구" : "후킹";
      const setup = {
        productName: task.candidate.productName,
        productUrl: task.candidate.productUrl,
        hookCode,
        headline: result.hookPlan.headline,
        subCopy: result.hookPlan.body,
        primaryText,
        adTitle: job.adCopy?.adTitle || result.hookPlan.headline,
        adName: result.creativeAsset?.recommendedAdName || job.adCopy?.adName || "",
        utm: result.creativeAsset?.utmContent || job.adCopy?.utm || "",
        assetCode: result.creativeAsset?.assetCode || job.adCopy?.assetCode || "",
        imageFile: imageName,
        qaStatus: result.status,
      };
      rows.push({
        productName: setup.productName,
        primaryText: setup.primaryText,
        adTitle: setup.adTitle,
        adName: setup.adName,
        utm: setup.utm,
        assetCode: setup.assetCode,
        hookId: setup.hookCode,
      });
      folder?.file(`${hookCode}-ad-setup.json`, `${JSON.stringify(setup, null, 2)}\n`);
      folder?.file(`${hookCode}-ad-setup.txt`, `${primaryLabel}\n${setup.headline}\n\n서브 문구\n${setup.subCopy}\n\nMeta 기본 문구\n${setup.primaryText}\n\n광고 제목\n${setup.adTitle}\n\n광고명\n${setup.adName}\n\nUTM\n${setup.utm}\n\n소재코드\n${setup.assetCode}\n`);
      manifest.push(setup);
    }
  }

  zip.file("meta-ad-settings.csv", buildAdCopyCsv(rows));
  if (failures.length) {
    zip.file("failures.json", `${JSON.stringify(failures, null, 2)}\n`);
    zip.file("failures.txt", `${failures.map((failure) => `${failure.productName} · ${"hookCode" in failure ? failure.hookCode : "상품"} · ${failure.status}${"error" in failure ? ` · ${failure.error}` : ""}`).join("\n")}\n`);
  }
  zip.file(
    "manifest.json",
    `${JSON.stringify(
      {
        runId: run.id,
        advertiserId: run.advertiserId,
        advertiserName: run.advertiserName,
        businessDate: run.businessDate,
        productCount: prepared.length,
        imageCount: rows.length,
        engine: "codex_local",
        items: manifest,
      },
      null,
      2
    )}\n`
  );
  zip.file("README.txt", "상품 폴더마다 생성된 광고 이미지 및 소재별 광고명·UTM·소재코드가 들어 있습니다. 내부 진단이 확인 필요로 표시된 이미지도 사용자가 직접 검토할 수 있도록 포함됩니다. meta-ad-settings.csv는 Meta 세팅용 UTF-8 BOM CSV이며, 이미지 생성에 실패한 항목이 있으면 failures 파일에서 확인할 수 있습니다.\n");

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
    imageCount: rows.length,
    generatedAt: new Date().toISOString(),
  };
}

export function buildAutoProductionPackage(runId: string) {
  return buildPackage(runId);
}

export function buildAutoProductionProductPackage(runId: string, taskId: string) {
  return buildPackage(runId, taskId);
}
