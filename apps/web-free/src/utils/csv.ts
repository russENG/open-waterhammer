/**
 * CSVダウンロード共通ユーティリティ
 * Excel で開かれることを想定し、UTF-8 BOM を付与する。
 */

type Cell = string | number | null | undefined;

function escapeCell(v: Cell): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function rowsToCsv(rows: Cell[][]): string {
  return rows.map((r) => r.map(escapeCell).join(",")).join("\r\n");
}

export function downloadCsv(filename: string, rows: Cell[][]): void {
  const csv = rowsToCsv(rows);
  const BOM = "\uFEFF";
  const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
