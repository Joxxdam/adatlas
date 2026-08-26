import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("업체 로고 18개를 완성 이미지 후처리 전용 목록으로 제공한다", async () => {
  const catalog = await read("app/lib/creative-generation/deliveryBranding.ts");
  const paths = [...catalog.matchAll(/imagePath: "([^"]+\.png)"/g)].map((match) => match[1]);
  assert.equal(paths.length, 18);
  for (const imagePath of paths) {
    const file = await readFile(new URL(`../public${imagePath}`, import.meta.url));
    assert.ok(file.length > 0, `${imagePath} 파일이 비어 있습니다.`);
  }
  assert.match(catalog, /id: "gukdae-hanwoo"[\s\S]*frameWidthPercent: 12,[\s\S]*frameHeightPercent: 8/);
  assert.match(catalog, /id: "daehan-hanwoo"[\s\S]*frameWidthPercent: 20,[\s\S]*frameHeightPercent: 8/);
  assert.match(catalog, /id: "himnaera-farm"[\s\S]*frameWidthPercent: 20,[\s\S]*frameHeightPercent: 8/);
});

test("상품 광고 제작 결과 UI에는 로고와 AI 고지 후처리를 노출하지 않는다", async () => {
  const workspace = await read("app/components/features/creative-generation/SixCreativeGenerator.tsx");
  for (const label of ["완성 이미지에만 로고·AI 고지 일괄 적용", "우측 상단 업체 로고", "AI 생성 이미지 고지 추가", "현재 ${visibleGeneratedResults.length}장에 일괄 적용"]) assert.doesNotMatch(workspace, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(workspace, /\/api\/creative-generation\/jobs\/\$\{encodeURIComponent\(job\.id\)\}\/delivery-branding/);
  assert.match(workspace, /deliveryBranding\?\.updatedAt/);
});

test("후처리는 원본 finalPath를 보존하고 별도 delivery 파일만 다운로드에 우선 사용한다", async () => {
  const renderer = await read("app/lib/creative-generation/deliveryBranding.server.ts");
  const storage = await read("app/lib/creative-generation/nativeCreativeStorage.server.ts");
  const route = await read("app/api/creative-generation/jobs/[jobId]/delivery-branding/route.ts");
  const jobService = await read("app/lib/creative-generation/deliveryBrandingJob.server.ts");
  const autoPackage = await read("app/lib/auto-production/package.server.ts");
  assert.match(renderer, /resolveValidatedNativeOriginal/);
  assert.match(renderer, /path\.join\([\s\S]*nativeJobDirectory[\s\S]*"delivery"/);
  assert.match(renderer, /optimizeNativeFinalImage/);
  assert.match(storage, /preferDeliveryBranding && delivery/);
  assert.match(route, /applyDeliveryBrandingToJob/);
  assert.match(jobService, /if \(clear\) return \{ \.\.\.result, deliveryBranding: undefined \}/);
  assert.match(jobService, /slice\(index, index \+ 2\)/);
  assert.match(autoPackage, /resolveValidatedNativeDownload\(job, result\.id\)/);
  assert.match(autoPackage, /result\.deliveryBranding\?\.updatedAt \|\| "original"/);
  assert.match(renderer, /const frameWidth = Math\.round\(1200 \* \(\(logo\.frameWidthPercent \|\| 12\) \/ 100\)\)/);
  assert.match(renderer, /const frameHeight = Math\.round\(1200 \* \(\(logo\.frameHeightPercent \|\| 7\) \/ 100\)\)/);
  assert.match(renderer, /resize\(\{ width: frameWidth - outlineAllowance, height: frameHeight - outlineAllowance, fit: "inside" \}\)/);
  assert.match(renderer, /create: \{ width: frameWidth, height: frameHeight, channels: 4, background: \{ r: 0, g: 0, b: 0, alpha: 0 \} \}/);
  assert.match(renderer, /left: 30,[\s\S]*top: 696/);
  assert.match(renderer, /needsWhiteOutline \? await addWhiteLogoOutline\(resized\) : resized/);
  assert.match(renderer, /background: \{ r: 0, g: 0, b: 0, alpha: 0 \}/);
  assert.match(renderer, /path\.join\(process\.cwd\(\), "public", logo\.imagePath\.replace\(\/\^\\\/\+\/, ""\)\)/);
  assert.match(renderer, /\.branding-\$\{process\.pid\}-\$\{Date\.now\(\)\}-\$\{randomUUID\(\)\}\.png/);
});

test("아카이브에서 업체·상품·개별 이미지별로 로고·AI 고지 후처리를 적용한다", async () => {
  const workspace = await read("app/components/creative-archive/CreativeArchiveWorkspace.tsx");
  const archiveBranding = await read("app/lib/creative-archive/branding.server.ts");
  const archiveRoute = await read("app/api/creative-archive/delivery-branding/route.ts");
  const archiveImageRoute = await read("app/api/creative-archive/[entryId]/image/route.ts");
  const nativeDownloadRoute = await read("app/api/creative-generation/jobs/[jobId]/results/[resultId]/download/route.ts");
  for (const label of ["아카이브 이미지에 로고·AI 고지 적용", "로고·AI 고지 적용 선택", "현재 선택된 이미지", "✓ 로고·AI 적용 대상", "업체를 선택하세요", "상품을 선택하세요", "로고·AI: 이 상품 전체", "적용할 이미지가 선택되면 설정이 표시됩니다.", "선택 이미지 원본으로"]) assert.match(workspace, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(workspace, /brandingIds\.length \? \(/);
  const archiveStyles = await read("app/components/creative-archive/CreativeArchiveWorkspace.module.css");
  assert.match(archiveStyles, /\.selectedLogoImage\s*\{[\s\S]*?width:\s*150px;[\s\S]*?height:\s*174px;/);
  assert.match(archiveStyles, /object-fit: contain !important/);
  assert.match(archiveStyles, /brandingSelectedCard/);
  assert.match(archiveStyles, /brandingTargetPreviewGrid/);
  assert.doesNotMatch(workspace, /현재 목록 선택/);
  assert.match(workspace, /\/api\/creative-archive\/delivery-branding/);
  assert.match(workspace, /const prepared = await onPrepareDownload\(entry\)/);
  assert.match(workspace, /const prepared = await persistPendingBranding\(productEntries\.map\(\(entry\) => entry\.id\)\)/);
  assert.match(workspace, /await onReleaseTemporaryBranding\(temporaryBrandingIds\)/);
  assert.match(workspace, /await releaseTemporaryBranding\(temporaryBrandingIds\)/);
  assert.match(workspace, /body: JSON\.stringify\(\{ entryIds, clear: true \}\)/);
  assert.match(workspace, /downloadFileName\(activeEntry, downloadSequence, response\.headers\.get\("Content-Type"\) \|\| ""\)/);
  assert.match(workspace, /width: `\$\{previewLogo\.frameWidthPercent \|\| 12\}%`/);
  assert.match(workspace, /setBrandingIds\(\(current\) => current\.filter\(\(id\) => !targetIds\.includes\(id\)\)\)/);
  assert.match(archiveBranding, /applyDeliveryBrandingToJob/);
  assert.match(archiveBranding, /renderDeliveryBrandedRaster/);
  assert.match(archiveBranding, /slice\(index, index \+ 2\)/);
  assert.match(archiveRoute, /applyCreativeArchiveBranding/);
  assert.match(archiveImageRoute, /resolveCreativeArchiveDeliveryFile/);
  assert.match(nativeDownloadRoute, /numberedProductImageFileName/);
  assert.match(nativeDownloadRoute, /filename\*=UTF-8''/);
});
