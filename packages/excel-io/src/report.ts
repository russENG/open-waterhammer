/**
 * 計算結果レポート出力モジュール
 * generateReport() → xlsx Buffer
 *
 * シート構成:
 *   ① 計算結果  – ケースごとの水撃圧計算結果サマリー
 *   ② 管路データ – 入力管路諸元（記録用）
 *   ③ 案件情報  – ProjectMeta（記録用）
 *   ④ 水理計算書 – 成果品様式準拠（測点ベース）
 *
 * exceljs ベース実装（xlsx/SheetJS から移行: 2026-05-08）
 */

import ExcelJS from "exceljs";
import type { SimpleFormulaResult, MeasurementPoint, LongitudinalHydraulicResult } from "@open-waterhammer/core";
import { headToMpa, judgeDesignPressure } from "@open-waterhammer/core";
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

function judgementLabel(status: string): string {
  if (status === "ok") return "OK";
  if (status === "warning") return "注意";
  if (status === "ng") return "NG";
  return "—";
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

/** 列幅を文字数ベースで自動設定（exceljs の columns プロパティ） */
function autoCols(ws: ExcelJS.Worksheet, rows: unknown[][]): void {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, ci) => {
      const len = String(cell ?? "").length;
      if (!widths[ci] || widths[ci]! < len) widths[ci] = len;
    });
  }
  ws.columns = widths.map((w) => ({ width: Math.min(w + 2, 40) }));
}

/** ヘッダー行にスタイル付与（1-indexed の行番号） */
function styleHeader(ws: ExcelJS.Worksheet, headerRowNum: number, colCount: number): void {
  const row = ws.getRow(headerRowNum);
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A1A2E" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  }
}

// ─── シート①: 計算結果 ───────────────────────────────────────────────────────

function addResultSheet(wb: ExcelJS.Workbook, input: ReportInput): void {
  const ws = wb.addWorksheet("計算結果");
  const { data, results, closeTimes } = input;

  const title = [
    [`計算結果レポート — ${input.meta.projectName}`],
    [`参照: 土地改良設計基準パイプライン技術書（令和3年6月改訂）`],
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
    // 設計水圧の判定（管路の許容圧力が入力されている場合のみ値が入る）
    "設計水圧 [MPa]", "許容圧力 [MPa]", "余裕度 [%]", "判定",
    "警告",
  ];

  const dataRows = results.map((r) => {
    const cas = data.cases.find((c) => c.id === r.caseId);
    const tv = closeTimes?.[r.caseId];

    // 代表水撃圧水頭（MPa換算用）
    const deltaH = r.deltaH_joukowsky ?? r.hmax_allievi_close;
    const waterhammerMpa = deltaH !== undefined ? headToMpa(deltaH) : undefined;

    // 設計水圧の判定。ハンマー水頭の採り方は protocol.py の _joukowsky_allievi と同じで、
    // 急閉そくならジューコフスキー水頭、緩閉そくならアリエビ最大水頭 − H₀ を採る。
    // 管路に許容圧力が入っていないケースは判定できないので4列とも「—」にする。
    const pipe = data.pipes.find((candidate) => candidate.id === r.pipeId);
    const allowable = pipe?.allowablePressureMpa;
    const initialHead = cas?.initialHead;
    const hammerHead = r.deltaH_joukowsky
      ?? (r.hmax_allievi_close !== undefined && initialHead !== undefined
        ? r.hmax_allievi_close - initialHead
        : undefined);
    const judgement = allowable !== undefined && allowable > 0
      && hammerHead !== undefined && initialHead !== undefined
      ? judgeDesignPressure(headToMpa(initialHead + hammerHead), allowable)
      : undefined;

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
      n(judgement?.designPressureMpa, 3),
      n(judgement?.allowablePressureMpa, 3),
      judgement !== undefined ? n(judgement.margin * 100, 1) : "—",
      judgementLabel(judgement?.status ?? ""),
      [judgement?.message, ...r.warnings].filter((w): w is string => Boolean(w)).join(" / "),
    ];
  });

  const allRows = [...title, header, ...dataRows];
  ws.addRows(allRows);

  // ヘッダー行は title.length + 1 行目（1-indexed）
  styleHeader(ws, title.length + 1, header.length);
  autoCols(ws, allRows);

  // タイトル行（1〜3）の結合
  ws.mergeCells(1, 1, 1, header.length);
  ws.mergeCells(2, 1, 2, header.length);
  ws.mergeCells(3, 1, 3, header.length);
}

// ─── シート②: 管路データ ─────────────────────────────────────────────────────

function addPipeSheet(wb: ExcelJS.Workbook, data: WorkbookData): void {
  const ws = wb.addWorksheet("管路データ");
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
  ws.addRows(allRows);
  styleHeader(ws, 1, header.length);
  autoCols(ws, allRows);
}

// ─── シート③: 案件情報 ───────────────────────────────────────────────────────

function addMetaSheet(wb: ExcelJS.Workbook, meta: ProjectMeta): void {
  const ws = wb.addWorksheet("案件情報");
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
  ws.addRows(rows);
  styleHeader(ws, 1, 2);
  ws.columns = [{ width: 20 }, { width: 40 }];
}

// ─── シート④: 水理計算書（成果品様式準拠） ────────────────────────────────────

function addHydraulicSheet(
  wb: ExcelJS.Workbook,
  sheetName: string,
  points: MeasurementPoint[],
  result: LongitudinalHydraulicResult,
  projectName: string,
  allowablePressureMpa: number | undefined,
): void {
  const ws = wb.addWorksheet(sheetName);

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
    "", "",
  ];
  const header2 = [
    "測点", "単距離", "地盤高", "管中心高", "管長", "流量", "管径", "流速係数", "動水勾配",
    "流速", "速度水頭", "摩擦損失水頭",
    "湾曲損失係数", "バルブ損失係数", "直角分流損失係数", "損失係数計", "その他損失水頭計",
    "全損失水頭", "ｴﾈﾙｷﾞｰ標高", "動水位", "動水頭", "静水圧", "水撃圧", "設計内圧",
    "許容圧力", "判定",
  ];
  const header3 = [
    "", "Lh", "GL", "FH", "SL", "Q", "D", "CI", "",
    "V", "hv", "hf",
    "fb", "fv", "fβ", "Σf", "Σhc",
    "h", "EL", "WLm", "hm", "Ps", "Pi", "Pp",
    "", "",
  ];
  const unitRow = [
    "", "(m)", "(m)", "(m)", "(m)", "(m³/s)", "(mm)", "", "(‰)",
    "(m/s)", "(m)", "(m)",
    "", "", "", "", "(m)",
    "(m)", "(m)", "(m)", "(m)", "(MPa)", "(MPa)", "(MPa)",
    "(MPa)", "",
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
      n(allowablePressureMpa, 3),
      // 設計内圧が未算定（負圧区間）の測点、許容圧力が未入力の案件は判定しない。
      allowablePressureMpa !== undefined && allowablePressureMpa > 0 && r.designPressure !== undefined
        ? judgementLabel(judgeDesignPressure(r.designPressure, allowablePressureMpa).status)
        : "—",
    ]);
  }

  const allRows = [...title, header1, header2, header3, unitRow, ...dataRows];
  ws.addRows(allRows);

  // ヘッダー行スタイル（1-indexed: title.length + 1〜+ 4）
  const headerRowStart = title.length + 1;
  for (let r = headerRowStart; r < headerRowStart + 4; r++) {
    styleHeader(ws, r, header2.length);
  }
  autoCols(ws, allRows);

  // タイトル行結合
  ws.mergeCells(1, 1, 1, header2.length);
  ws.mergeCells(2, 1, 2, header2.length);
}

// ─── メイン ───────────────────────────────────────────────────────────────────

/**
 * 計算結果レポートを Excel ワークブックとして出力する。
 *
 * @returns xlsx ファイルの Buffer（ブラウザでは `Blob` に変換して保存）
 */
export async function generateReport(input: ReportInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  addResultSheet(wb, input);

  // 水理計算書シート（成果品様式準拠）
  if (input.hydraulicResults && input.data.measurementPoints.length > 0) {
    for (const hr of input.hydraulicResults) {
      const sheetName = `水理計算書_${hr.caseName}`.slice(0, 31); // Excel sheet name limit
      // 許容圧力は管路が持つ。測点列が属する管路が特定できないときは判定列を空にする。
      const allowable = input.data.pipes.length === 1
        ? input.data.pipes[0]!.allowablePressureMpa
        : input.data.pipes.find((p) => p.id === input.data.measurementPoints[0]?.pipeId)?.allowablePressureMpa;
      addHydraulicSheet(wb, sheetName, input.data.measurementPoints, hr, input.meta.projectName, allowable);
    }
  }

  addPipeSheet(wb, input.data);
  addMetaSheet(wb, input.meta);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf as ArrayBuffer);
}
