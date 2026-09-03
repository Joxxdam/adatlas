import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import JSZip from "jszip";
import sharp from "sharp";
import * as XLSX from "xlsx";

const sourceZipPath = path.resolve(process.argv[2] || "");
const outputPath = path.resolve(process.argv[3] || "data/original-source-research-extraction-cache.json");
const eucKrDecoder = new TextDecoder("euc-kr");

if (!process.argv[2]) {
  throw new Error("Usage: node scripts/analyze-original-source-workbooks.mjs <source.zip> [output.json]");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function cleanCellText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeZipFileName(bytes) {
  return eucKrDecoder.decode(bytes);
}

function workbookCells(buffer) {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
    cellFormula: false,
    cellText: true,
  });
  return workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const cells = Object.keys(sheet)
      .filter((address) => !address.startsWith("!"))
      .map((address) => {
        const cell = sheet[address];
        const text = cleanCellText(cell.w ?? cell.v);
        return text ? { ref: address, text } : null;
      })
      .filter(Boolean);
    return { name: cleanCellText(sheetName), cells };
  });
}

async function main() {
  const sourceZip = await fs.readFile(sourceZipPath);
  const sourceArchive = await JSZip.loadAsync(sourceZip, { decodeFileName: decodeZipFileName });
  const workbookEntries = Object.values(sourceArchive.files)
    .filter((entry) => !entry.dir && /\.xlsx$/i.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name, "ko"));

  if (workbookEntries.length !== 5) {
    throw new Error(`Expected 5 workbooks, found ${workbookEntries.length}`);
  }

  const workbooks = [];

  for (const workbookEntry of workbookEntries) {
      const buffer = Buffer.from(await workbookEntry.async("uint8array"));
      const archive = await JSZip.loadAsync(buffer);
      const mediaEntries = Object.values(archive.files)
        .filter((entry) => !entry.dir && /^xl\/media\//i.test(entry.name))
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));
      const embeddedMedia = [];

      for (const mediaEntry of mediaEntries) {
        const mediaBuffer = Buffer.from(await mediaEntry.async("uint8array"));
        const contentHash = sha256(mediaBuffer);
        const extension = path.extname(mediaEntry.name).toLowerCase();
        let metadata = {};
        try {
          metadata = await sharp(mediaBuffer, { animated: false }).metadata();
        } catch {
          // Vision에서 디코딩 가능 여부를 별도로 확인한다.
        }
        const media = {
          name: mediaEntry.name.replace(/^xl\/media\//i, ""),
          contentHash,
          byteLength: mediaBuffer.length,
          width: metadata.width || null,
          height: metadata.height || null,
          format: metadata.format || extension.replace(/^\./, "") || null,
        };
        embeddedMedia.push(media);
      }

      workbooks.push({
        sourceDocument: cleanCellText(workbookEntry.name),
        contentHash: sha256(buffer),
        byteLength: buffer.length,
        sheets: workbookCells(buffer),
        embeddedMedia,
      });
  }

    const textCellCount = workbooks.reduce((sum, workbook) => sum + workbook.sheets.reduce((sheetSum, sheet) => sheetSum + sheet.cells.length, 0), 0);
    const embeddedMediaCount = workbooks.reduce((sum, workbook) => sum + workbook.embeddedMedia.length, 0);
    const uniqueMediaCount = new Set(workbooks.flatMap((workbook) => workbook.embeddedMedia.map((media) => media.contentHash))).size;
    const output = {
      version: 1,
      sourceType: "vendor-provided-research-extraction-cache",
      sourceLabel: "오리지널 소스 5가지 제품 상세 조사 자료",
      sourceZip: path.basename(sourceZipPath),
      sourceZipHash: sha256(sourceZip),
      analyzedAt: new Date().toISOString(),
      extraction: {
        method: "xlsx-direct-cell-extraction",
        workbookCount: workbooks.length,
        textCellCount,
        embeddedMediaCount,
        uniqueMediaCount,
        embeddedMediaPolicy: "metadata-only-no-ocr",
        note: "광고 문구 근거는 엑셀 셀에 글로 작성된 원문만 직접 추출했습니다. 삽입 이미지는 OCR하지 않고 해시와 규격만 기록했습니다.",
      },
      workbooks,
    };
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify({ outputPath, ...output.extraction }, null, 2)}\n`);
}

await main();
