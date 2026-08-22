import "server-only";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { buildAdCopyCsv } from "../ad-copy/adCopyValidator";
import { creativeGenerationJobStore } from "../creative-generation/jobStore.server";
import { executionResults } from "../creative-generation/jobRunnerPolicy";
import { autoProductionRepository } from "./productionRepository.server";

const packagesDirectory = path.join(
  process.cwd(),
  "data",
  "auto-production",
  "runtime",
  "packages"
);

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

export async function buildAutoProductionPackage(
  runId: string
): Promise<AutoProductionPackageArtifact> {
  const run = await autoProductionRepository.get(runId);
  if (!run) throw new Error("자동 제작 실행 기록을 찾지 못했습니다.");

  const prepared: Array<{
    task: (typeof run.tasks)[number];
    job: NonNullable<Awaited<ReturnType<typeof creativeGenerationJobStore.get>>>;
    results: ReturnType<typeof executionResults>;
  }> = [];
  const completedResultIds: string[] = [];

  for (const task of run.tasks) {
    if (!task.generationJobId) continue;
    const job = await creativeGenerationJobStore.get(task.generationJobId);
    if (!job) continue;
    const results = executionResults(job).filter(
      (result) =>
        ["success", "approved"].includes(result.status) &&
        Boolean(result.nativeCreative?.finalPath)
    );
    if (!results.length) continue;
    completedResultIds.push(...results.map((result) => result.id));
    prepared.push({ task, job, results });
  }

  if (!completedResultIds.length) {
    throw new Error("다운로드할 검수 통과 광고 이미지가 아직 없습니다.");
  }

  const fingerprint = packageFingerprint(completedResultIds);
  const fileName = `auto-production-${run.businessDate}-${safeName(run.advertiserName)}-${fingerprint}.zip`;
  const packagePath = path.join(packagesDirectory, fileName);
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
    adName?: string;
    utm?: string;
    assetCode?: string;
    hookId?: string;
  }> = [];
  const manifest: Array<Record<string, unknown>> = [];

  for (const { task, job, results } of prepared) {
    const folder = zip.folder(safeName(task.candidate.productName));
    for (const result of results) {
      const hookCode = result.hookPlan.hookCode;
      const imageName =
        result.creativeAsset?.fileName ||
        `${safeName(task.candidate.productName)}-${hookCode}.jpg`;
      try {
        folder?.file(imageName, await fs.readFile(result.nativeCreative!.finalPath!));
      } catch {
        continue;
      }

      const primaryText =
        job.adCopy?.status !== "needs-review" && job.adCopy?.primaryText
          ? job.adCopy.primaryText
          : [result.hookPlan.headline, result.hookPlan.body]
              .filter(Boolean)
              .join("\n");
      const setup = {
        productName: task.candidate.productName,
        productUrl: task.candidate.productUrl,
        hookCode,
        headline: result.hookPlan.headline,
        subCopy: result.hookPlan.body,
        primaryText,
        adName:
          result.creativeAsset?.recommendedAdName || job.adCopy?.adName || "",
        utm: result.creativeAsset?.utmContent || job.adCopy?.utm || "",
        assetCode: result.creativeAsset?.assetCode || job.adCopy?.assetCode || "",
        imageFile: imageName,
        qaStatus: result.status,
      };
      rows.push({
        productName: setup.productName,
        primaryText: setup.primaryText,
        adName: setup.adName,
        utm: setup.utm,
        assetCode: setup.assetCode,
        hookId: setup.hookCode,
      });
      folder?.file(`${hookCode}-ad-setup.json`, `${JSON.stringify(setup, null, 2)}\n`);
      folder?.file(
        `${hookCode}-ad-setup.txt`,
        `후킹\n${setup.headline}\n\n서브 문구\n${setup.subCopy}\n\nMeta 기본 문구\n${setup.primaryText}\n\n광고명\n${setup.adName}\n\nUTM\n${setup.utm}\n\n소재코드\n${setup.assetCode}\n`
      );
      manifest.push(setup);
    }
  }

  zip.file("meta-ad-settings.csv", buildAdCopyCsv(rows));
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
  zip.file(
    "README.txt",
    "상품 폴더마다 AI가 전체 생성하고 검수를 통과한 광고 이미지와 후킹별 광고명·UTM·소재코드가 들어 있습니다. meta-ad-settings.csv는 Meta 세팅용 UTF-8 BOM CSV입니다. 이미지는 템플릿·배경 합성 결과가 아니라 Codex 로컬 AI 네이티브 결과입니다.\n"
  );

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
