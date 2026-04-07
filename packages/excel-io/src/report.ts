/**
 * 計算結果レポート出力モジュール
 * generateReport() → xlsx Buffer
 *
 * シート構成:
 *   ① 計算結果  – ケースごとの水撃圧計算結果サマリー
 *   ② 管路データ – 入力管路諸元（記録用）
 *   ③ 案件情報  – ProjectMeta（記録用）
 */

import * as XLSX from "xlsx";
import type { SimpleFormulaResult, MeasurementPoint, MeasurementPointResult, LongitudinalHydraulicResult } from "@open-waterhammer/core";
import { headToMpa } from "@open-waterhammer/core";
import type { WorkbookData, ProjectMeta } from "./types.js";

// ─── 型定義 ───────────────────────────────────────────────────────────────────

export interface ReportInput {
  meta: ProjectMeta;
  data: WorkbookData;
  results: SimpleFormulaResult[];
  /** 各ケースの閉そく時間 [s] (caseId → tν) */
  closeTimes?: Record<string, number>;
  /** 縦断水理計算結果（水理計算書シート用） */
  hydraulicResults?: LongitudinalHydraulicResult[];
}

// ─── ヘルパー ─────────────────────────────────────────────────────────────────

function n(v: number | undefined, d = 3): string {
  return v !== undefined ? v.toFixed(d) : "—";
}

function closureLabel(t: string): string {
  if (t === "rapid") return "急閉そく";
  if (t === "slow") return "緩閉そく";
  return "数値解析要";
}

function pipeTypeLabel(pt: string): string {
  switch (pt) {
    case "steel": return "鋼管";
    case "ductile_iron": return "ダクタイル鋳鉄管";
    case "rcp": return "遠心力鉄筋コンクリート管";
    case "cpcp": return "コア式PCCP管";
    case "upvc": return "硬質塩ビ管";
    case "pe2": return "PE管（2種）";
    case "pe3_pe100": return "PE管（3種 PE100）";
    case "wdpe": return "水道配水用PE管";
    case "gfpe": return "GF強化ポリエチレン管";
    default:
      if (pt.startsWith("grp_fw")) return `FRP管（${pt.replace("grp_fw", "")}種）`;
      return pt;
  }
}

function operationLabel(op: string): string {
  switch (op) {
    case "valve_close": return "バルブ閉操作";
    case "valve_open": return "バルブ開操作";
    case "pump_stop": return "ポンプ停止";
    case "pump_start": return "ポンプ起動";
    case "combined": return "複合操作";
    default: return op;
  }
}

/** 列幅を文字数ベースで自動設定 */
function autoCols(ws: XLSX.WorkSheet, rows: unknown[][]): void {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, ci) => {
      const len = String(cell ?? "").length;
      if (!widths[ci] || widths[ci]! < len) widths[ci] = len;
    });
  }
  ws["!cols"] = widths.map((w) => ({ wch: Math.min(w + 2, 40) }));
}

/** ヘッダー行にスタイル付与（xlsx の限定スタイル） */
function styleHeader(ws: XLSX.WorkSheet, headerRowIdx: number, colCount: number): void {
  for (let ci = 0; ci < colCount; ci++) {
    const addr = XLSX.utils.encode_cell({ r: headerRowIdx, c: ci });
    if (!ws[addr]) continue;
    ws[addr].s = {
      font: { bold: true },
      fill: { fgColor: { rgb: "1A1A2E" }, patternType: "solid" },
      alignment: { horizontal: "center" },
    };
  }
}

// ─── シート①: 計算結果 ───────────────────────────────────────────────────────

function makeResultSheet(input: ReportInput): XLSX.WorkSheet {
  const { data, results, closeTimes } = input;

  const title = [
    [`計算結果レポート — ${input.meta.projectName}`],
    [`準拠: 土地改良設計基準パイプライン技術書（令和3年6月改訂）`],
    [`作成日: ${new Date().toLocaleDateString("ja-JP")}`],
    [],
  ];

  const header = [
    "ケースID", "ケース名", "対象施設", "操作種別",
    "管路ID",
    "波速 a [m/s]", "振動周期 T₀ [s]", "閉そく時間 tν [s]", "α = tν/T₀",
    "閉そく区分",
    "ΔH Joukowsky [m]", "Hmax Allievi閉 [m]", "Hmin Allievi開 [m]",
    "水撃圧 [MPa]",
    "初期流速 V₀ [m/s]", "初期水頭 H₀ [m]",
    "警告",
  ];

  const dataRows = results.map((r) => {
    const cas = data.cases.find((c) => c.id === r.caseId);
    const tv = closeTimes?.[r.caseId];

    // 代表水撃圧水頭（MPa換算用）
    const deltaH = r.deltaH_joukowsky ?? r.hmax_allievi_close;
    const waterhammerMpa = deltaH !== undefined ? headToMpa(deltaH) : undefined;

    return [
      r.caseId,
      cas?.name ?? "",
      cas?.targetFacilityId ?? "",
      operationLabel(cas?.operationType ?? ""),
      r.pipeId,
      n(r.waveSpeed.waveSpeed, 1),
      n(r.waveSpeed.vibrationPeriod, 3),
      tv !== undefined ? n(tv, 1) : "—",
      n(r.waveSpeed.alpha, 3),
      closureLabel(r.closureType),
      n(r.deltaH_joukowsky, 2),
      n(r.hmax_allievi_close, 2),
      n(r.hmax_allievi_open, 2),
      waterhammerMpa !== undefined ? n(waterhammerMpa, 4) : "—",
      n(cas?.initialVelocity, 2),
      n(cas?.initialHead, 2),
      r.warnings.join(" / "),
    ];
  });

  const allRows = [...title, header, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(allRows);

  // ヘッダー行インデックス = title行数 (4行)
  styleHeader(ws, title.length, header.length);
  autoCols(ws, allRows);

  // セル結合 (タイトル行)
  const lastCol = header.length - 1;
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: lastCol } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: lastCol } },
  ];

  return ws;
}

// ─── シート②: 管路データ ─────────────────────────────────────────────────────

function makePipeSheet(data: WorkbookData): XLSX.WorkSheet {
  const header = [
    "管路ID", "管路名", "管種", "内径 D [m]", "管厚 t [m]",
    "延長 L [m]", "粗度係数", "始点節点", "終点節点",
  ];

  const rows = data.pipes.map((p) => [
    p.id, p.name ?? "", pipeTypeLabel(p.pipeType),
    p.innerDiameter, p.wallThickness, p.length, p.roughnessCoeff,
    p.startNodeId, p.endNodeId,
  ]);

  const allRows = [header, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(allRows);
  styleHeader(ws, 0, header.length);
  autoCols(ws, allRows);
  return ws;
}

// ─── シート③: 案件情報 ───────────────────────────────────────────────────────

function makeMetaSheet(meta: ProjectMeta): XLSX.WorkSheet {
  const rows = [
    ["フィールド", "値"],
    ["案件名", meta.projectName],
    ["設計者", meta.designer ?? ""],
    ["作成日付", meta.date ?? ""],
    ["適用基準", meta.standardId],
    ["バージョン", meta.version ?? ""],
    ["計算方法", meta.methodId ?? ""],
    ["備考", meta.notes ?? ""],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  styleHeader(ws, 0, 2);
  ws["!cols"] = [{ wch: 20 }, { wch: 40 }];
  return ws;
}

// ─── シート④: 水理計��書（成果品様式準拠） ────────────────────────────────────

function makeHydraulicSheet(
  points: MeasurementPoint[],
  result: LongitudinalHydraulicResult,
  projectName: string,
): XLSX.WorkSheet {
  const title = [
    [`${result.caseName}時の水理計算書`],
    [`${projectName}　　　静水位：${n(result.staticWaterLevel, 3)} m`],
    [],
  ];

  const header1 = [
    "", "", "", "", "", "", "", "", "",
    "", "", "",
    "その他損失水頭(m)", "", "", "", "",
    "", "", "", "", "", "", "",
  ];
  const header2 = [
    "測点", "単距離", "地盤高", "管中心高", "管長", "流量", "管径", "流速係数", "動水勾配",
    "流速", "速度水頭", "摩擦損失水頭",
    "湾曲損失係数", "バルブ損失係数", "直角分流損失係数", "損失係数計", "その他損失水頭計",
    "全損失水頭", "ｴﾈﾙｷﾞｰ標高", "動水位", "動水頭", "静水圧", "水撃圧", "設計内圧",
  ];
  const header3 = [
    "", "Lh", "GL", "FH", "SL", "Q", "D", "CI", "",
    "V", "hv", "hf",
    "fb", "fv", "fβ", "Σf", "Σhc",
    "h", "EL", "WLm", "hm", "Ps", "Pi", "Pp",
  ];
  const unitRow = [
    "", "(m)", "(m)", "(m)", "(m)", "(m³/s)", "(mm)", "", "(‰)",
    "(m/s)", "(m)", "(m)",
    "", "", "", "", "(m)",
    "(m)", "(m)", "(m)", "(m)", "(MPa)", "(MPa)", "(MPa)",
  ];

  const dataRows: unknown[][] = [];
  for (let i = 0; i < points.length; i++) {
    const pt = points[i]!;
    const r = result.pointResults[i];
    if (!r) continue;

    dataRows.push([
      pt.id,
      n(pt.horizontalDistance, 3),
      n(pt.groundLevel, 2),
      n(pt.pipeCenterHeight, 3),
      n(pt.pipeLength, 3),
      n(pt.flowRate, 4),
      (pt.diameter * 1000).toFixed(0),  // m → mm
      n(pt.roughnessC, 0),
      n(r.hydraulicGradient * 1000, 4),  // 無次元 → ‰
      n(r.velocity, 3),
      n(r.velocityHead, 3),
      n(r.frictionLoss, 3),
      n(pt.bendLossCoeff, 3),
      n(pt.valveLossCoeff, 3),
      n(pt.branchLossCoeff, 3),
      n(r.totalLossCoeff, 3),
      n(r.minorLoss, 3),
      n(r.totalLoss, 3),
      n(r.energyLevel, 3),
      n(r.hydraulicGradeLine, 3),
      n(r.pressureHead, 3),
      n(r.staticPressure, 2),
      n(r.waterhammerPressure, 2),
      n(r.designPressure, 2),
    ]);
  }

  const allRows = [...title, header1, header2, header3, unitRow, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(allRows);

  // ヘッダー行スタイル
  const headerRowStart = title.length;
  for (let row = headerRowStart; row < headerRowStart + 4; row++) {
    styleHeader(ws, row, 24);
  }
  autoCols(ws, allRows);

  // タイトル行結合
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 23 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 23 } },
  ];

  return ws;
}

// ─── メイン ───────────────────────────────────────────────────────────────────

/**
 * 計算結果レポートを Excel ワークブックとして出力する。
 *
 * @returns xlsx ファイルの Buffer（ブラウザでは `Blob` に変換して保存）
 */
export function generateReport(input: ReportInput): Buffer {
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, makeResultSheet(input), "計算結果");

  // 水理計算書シート（成果品様式準拠）
  if (input.hydraulicResults && input.data.measurementPoints.length > 0) {
    for (const hr of input.hydraulicResults) {
      const sheetName = `水理計算書_${hr.caseName}`.slice(0, 31); // Excel sheet name limit
      XLSX.utils.book_append_sheet(
        wb,
        makeHydraulicSheet(input.data.measurementPoints, hr, input.meta.projectName),
        sheetName,
      );
    }
  }

  XLSX.utils.book_append_sheet(wb, makePipeSheet(input.data), "管路データ");
  XLSX.utils.book_append_sheet(wb, makeMetaSheet(input.meta), "案件情報");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
