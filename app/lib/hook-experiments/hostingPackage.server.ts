import JSZip from "jszip";
import * as XLSX from "xlsx";
import { creativeAssetRepository } from "../creative-assets/repository.server.ts";
import { readCreativeRasterAsset } from "../creative-generation/assets.server.ts";
import type { CreativeExperiment, ExperimentAsset, HookGroup } from "./types.ts";

function registrationRow(experiment: CreativeExperiment, group: HookGroup, relation: ExperimentAsset, asset: NonNullable<Awaited<ReturnType<typeof creativeAssetRepository.getById>>>) {
  const landing = experiment.product.landingUrl || "";
  const separator = landing.includes("?") ? "&" : "?";
  return {
    실험코드: experiment.experimentCode,
    실험단계: experiment.stage,
    "캠페인 목표": experiment.objective,
    "후킹 카테고리 코드": group.categoryCode,
    소재코드: asset.assetCode,
    광고주: experiment.advertiserName,
    브랜드: experiment.brandName,
    "원본 상품번호": experiment.originalHostProductNo,
    "원본 상품명": experiment.product.productName,
    "원본 상품 URL": experiment.product.landingUrl,
    "후킹 유형": group.hookType,
    "후킹 문구": relation.mainMessage,
    "소재 순번": relation.variant,
    "시각적 표현 유형": relation.visualDirection,
    "이미지 파일명": asset.fileName,
    "권장 등록 상품명": `${experiment.product.productName} ${group.hookCode} ${relation.variant}`,
    "권장 자체상품코드": asset.assetCode,
    "권장 비노출 카테고리": group.categoryCode,
    "랜딩 URL": landing,
    UTM: landing ? `${landing}${separator}utm_content=${encodeURIComponent(asset.assetCode)}` : asset.utmContent,
    "권장 광고명": asset.recommendedAdName,
    "등록된 호스팅사 상품번호": relation.registeredHostProductNo || "",
    "크리마 애드 수집 상태": relation.cremaCollectionStatus,
    "카탈로그 상품 ID": relation.catalogProductId || "",
    "상품 ID 매칭 상태": relation.productMatchStatus,
    비고: relation.notes || "",
  };
}

function workbookBuffer(rows: Record<string, unknown>[]) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, "registration");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function csvBuffer(rows: Record<string, unknown>[]) {
  const sheet = XLSX.utils.json_to_sheet(rows);
  return Buffer.from(`\ufeff${XLSX.utils.sheet_to_csv(sheet)}`, "utf8");
}

export function createHostingRegistrationPackageService(dependencies: { assetRepository: Pick<typeof creativeAssetRepository, "getById">; readRasterAsset: typeof readCreativeRasterAsset }) {
  return {
    async build(input: { experiment: CreativeExperiment; hookGroups: HookGroup[]; experimentAssets: ExperimentAsset[] }) {
      const zip = new JSZip();
      const allRows: Record<string, unknown>[] = [];
      const groupSummaries: Array<Record<string, unknown>> = [];
      for (const [index, group] of input.hookGroups.entries()) {
        const relations = input.experimentAssets.filter((item) => item.hookGroupId === group.id);
        const rows: Record<string, unknown>[] = [];
        const folder = zip.folder(`${String(index + 1).padStart(2, "0")}_${group.hookCode}`)!;
        for (const relation of relations) {
          if (!relation.assetId) continue;
          const asset = await dependencies.assetRepository.getById(relation.assetId);
          if (!asset) continue;
          rows.push(registrationRow(input.experiment, group, relation, asset));
          try {
            folder.file(asset.fileName, await dependencies.readRasterAsset(asset.generatedImageUrl));
          } catch {
            folder.file(`${asset.assetCode}-IMAGE-MISSING.txt`, "원본 이미지 파일을 찾지 못했습니다. AdAtlas 생성 기록에서 다시 다운로드해 주세요.");
          }
        }
        allRows.push(...rows);
        groupSummaries.push({
          후킹: group.hookCode,
          후킹명: group.hookType,
          카테고리: group.categoryCode,
          소재수: rows.length,
          가설: group.hypothesis,
        });
        folder.file(`${group.hookCode}-registration.xlsx`, workbookBuffer(rows));
        folder.file(`${group.hookCode}-registration.csv`, csvBuffer(rows));
      }
      const planRows = [
        {
          실험코드: input.experiment.experimentCode,
          단계: input.experiment.stage,
          목표: input.experiment.objective,
          후킹수: input.experiment.hookCount,
          후킹당소재수: input.experiment.variantsPerHook,
          총소재수: input.experiment.totalAssetCount,
          테스트방식: input.experiment.metaTestPlan.testMode,
          캠페인명: input.experiment.metaTestPlan.campaignName,
          광고세트명: input.experiment.metaTestPlan.adsetName,
          타깃: input.experiment.metaTestPlan.target,
          게재위치: input.experiment.metaTestPlan.placements,
          기여설정: input.experiment.metaTestPlan.attributionSetting,
        },
        ...groupSummaries,
      ];
      const meta = zip.folder("00_experiment")!;
      meta.file("experiment-plan.xlsx", workbookBuffer(planRows));
      meta.file("experiment-guide.txt", [`${input.experiment.experimentCode} 후킹 실험 등록 안내`, "", "1. 각 후킹 폴더의 registration 파일과 이미지를 확인합니다.", "2. 권장 자체상품코드와 이미지 파일명의 소재코드를 변경하지 않습니다.", "3. 권장 비노출 카테고리를 호스팅사에 수동으로 등록합니다.", "4. 크리마 애드 수집 상태와 실제 호스팅사 상품번호를 AdAtlas에 기록합니다.", "5. Meta 광고 이름에 소재코드를 포함한 뒤 보고서를 업로드합니다.", "", "AdAtlas는 호스팅사·크리마 애드·Meta에 자동 등록하지 않습니다."].join("\n"));
      meta.file("all-registration.xlsx", workbookBuffer(allRows));
      return {
        fileName: `${input.experiment.experimentCode}.zip`,
        buffer: await zip.generateAsync({
          type: "nodebuffer",
          compression: "DEFLATE",
          compressionOptions: { level: 6 },
        }),
        rowCount: allRows.length,
      };
    },
  };
}

export const HostingRegistrationPackageService = createHostingRegistrationPackageService({
  assetRepository: creativeAssetRepository,
  readRasterAsset: readCreativeRasterAsset,
});
