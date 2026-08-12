import * as XLSX from "xlsx";

function rowsFromSheet(workbook: XLSX.WorkBook, sheetName: string | undefined) {
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  return sheet ? XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: false }) : [];
}

function findSheet(names: string[], patterns: RegExp[]) {
  return names.find((name) => patterns.some((pattern) => pattern.test(name))) || undefined;
}

export function parseCremaMarketWorkbook(buffer: Buffer, fileName: string) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const names = workbook.SheetNames;
  if (!names.length) throw new Error("업로드 파일에 읽을 수 있는 시트가 없습니다.");
  if (/\.csv$/i.test(fileName)) {
    const rows = rowsFromSheet(workbook, names[0]);
    return { productRows: rows, metricRows: rows, reviewRows: [] };
  }
  const productSheet = findSheet(names, [/상품/i, /product/i, /master/i]) || names[0];
  const metricSheet = findSheet(names, [/지표/i, /일별/i, /metric/i, /daily/i, /funnel/i]);
  const reviewSheet = findSheet(names, [/후기/i, /리뷰/i, /review/i, /insight/i]);
  if (!metricSheet) throw new Error("일별 지표 시트를 찾지 못했습니다. 시트명에 '지표', '일별' 또는 'metric'을 포함해 주세요.");
  return {
    productRows: rowsFromSheet(workbook, productSheet),
    metricRows: rowsFromSheet(workbook, metricSheet),
    reviewRows: rowsFromSheet(workbook, reviewSheet),
  };
}
