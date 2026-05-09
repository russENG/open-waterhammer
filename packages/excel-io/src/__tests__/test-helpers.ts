/**
 * テスト用ヘルパー: Buffer から exceljs ベースで シート内容を読み出す。
 * （xlsx/SheetJS の sheet_to_json 相当を最小限再現）
 */

import ExcelJS from "exceljs";

/** Buffer をワークブックとして読み込む */
export async function loadWorkbook(buf: Buffer | ArrayBuffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as ArrayBuffer);
  return wb;
}

/** ワークブック内のシート名一覧を取得 */
export function getSheetNames(wb: ExcelJS.Workbook): string[] {
  return wb.worksheets.map((ws) => ws.name);
}

/** cell.value をプリミティブに変換 */
function extractCellValue(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("result" in v && v.result !== undefined && v.result !== null) {
      return extractCellValue(v.result as ExcelJS.CellValue);
    }
    if ("richText" in v && Array.isArray(v.richText)) {
      return v.richText.map((rt) => rt.text ?? "").join("");
    }
    if ("text" in v && typeof v.text === "string") return v.text;
  }
  return String(v);
}

/** シートを 2D 配列として取得 */
export function sheetTo2D(ws: ExcelJS.Worksheet): unknown[][] {
  const result: unknown[][] = [];
  const colCount = ws.columnCount;
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const arr: unknown[] = [];
    for (let c = 1; c <= colCount; c++) {
      arr.push(extractCellValue(row.getCell(c).value));
    }
    result.push(arr);
  }
  return result;
}

/** シートをヘッダー行(1)+データ行 で { 列名: 値 }[] に変換 */
export function sheetToRows(ws: ExcelJS.Worksheet): Record<string, unknown>[] {
  if (ws.rowCount === 0) return [];
  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
    headers[colNum] = String(extractCellValue(cell.value) ?? "");
  });
  const result: Record<string, unknown>[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const obj: Record<string, unknown> = {};
    let hasValue = false;
    for (let c = 1; c < headers.length; c++) {
      const h = headers[c];
      if (!h) continue;
      const v = extractCellValue(row.getCell(c).value);
      obj[h] = v;
      if (v !== null && v !== "") hasValue = true;
    }
    if (hasValue) result.push(obj);
  }
  return result;
}
