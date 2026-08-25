/**
 * Excel帳票テンプレート生成
 * デモケースを初期値として入力済みテンプレートを出力する
 *
 * exceljs ベース実装（xlsx/SheetJS から移行: 2026-05-08）
 * 入力区分の色分け・凡例・用語対応表・入力規則を追加（2026-08-25）
 */

import ExcelJS from "exceljs";
import { PRODUCT_VERSION } from "@open-waterhammer/contracts";
import type { Pipe, Node, CalculationCase, MeasurementPoint } from "@open-waterhammer/core";
import type { ProjectMeta } from "./types.js";

interface TemplateOptions {
  meta?: Partial<ProjectMeta>;
  pipes?: Pipe[];
  nodes?: Node[];
  cases?: CalculationCase[];
  measurementPoints?: MeasurementPoint[];
}

// ─── 入力区分・書式 ───────────────────────────────────────────────────────────

/**
 * 入力区分。ヘッダーの3行目に記号を出し、データセルを色で塗り分ける。
 *
 * ヘッダー文字列は "field_id\n(日本語名)\n◎必須" になるが、
 * reader.normalizeKey() は最初の改行までを見るため field_id の解決には影響しない。
 */
type InputClass = "required" | "optional" | "auto";

const MARK: Record<InputClass, string> = {
  required: "◎必須",
  optional: "○任意",
  auto: "―自動",
};

const FILL: Record<InputClass, ExcelJS.FillPattern> = {
  required: { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } }, // 薄い黄
  optional: { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2EFDA" } }, // 薄い緑
  auto: { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEDED" } },     // 薄い灰
};

const HEADER_FILL: ExcelJS.FillPattern = {
  type: "pattern", pattern: "solid", fgColor: { argb: "FF44546A" },
};

const SECTION_FILL: ExcelJS.FillPattern = {
  type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E2F3" },
};

const BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFBFBFBF" } },
  left: { style: "thin", color: { argb: "FFBFBFBF" } },
  bottom: { style: "thin", color: { argb: "FFBFBFBF" } },
  right: { style: "thin", color: { argb: "FFBFBFBF" } },
};

/** 列定義: 英名（フィールドID） / 日本語名 / 入力区分 / 列幅 / 選択肢 */
interface ColumnDef {
  /** フィールドID。reader が正規化して参照するキー */
  id: string;
  /** 日本語名（単位・記号を含む） */
  ja: string;
  cls: InputClass;
  width: number;
  /** 入力規則（ドロップダウン）に出す選択肢 */
  list?: readonly string[];
}

function headerText(c: ColumnDef): string {
  return `${c.id}\n(${c.ja})\n${MARK[c.cls]}`;
}

/** 空欄追加行数（利用者が行を足さずに書き込めるようにする） */
const BLANK_ROWS = { pipe: 12, node: 12, point: 20, case: 8 } as const;

// ─── 選択肢 ───────────────────────────────────────────────────────────────────

const PIPE_MATERIAL_CODES = [
  "steel", "ductile_iron", "rcp", "cpcp", "upvc",
  "pe2", "pe3_pe100", "wdpe",
  "grp_fw1", "grp_fw2", "grp_fw3", "grp_fw4", "grp_fw5", "gfpe",
] as const;

const NODE_TYPE_CODES = ["reservoir", "junction", "tank", "pump_node", "valve_node"] as const;

const OPERATION_TYPE_CODES = ["valve_close", "valve_open", "pump_stop", "pump_start", "combined"] as const;

const PIPE_MATERIAL_LABELS: ReadonlyArray<readonly [string, string, string]> = [
  ["steel", "鋼管", "Steel pipe"],
  ["ductile_iron", "ダクタイル鋳鉄管", "Ductile iron pipe"],
  ["rcp", "遠心力鉄筋コンクリート管", "Reinforced concrete pipe (RCP)"],
  ["cpcp", "コア式PCCP管", "Prestressed concrete cylinder pipe (PCCP)"],
  ["upvc", "硬質塩ビ管", "Unplasticized PVC pipe (uPVC)"],
  ["pe2", "一般用PE管（2種）", "Polyethylene pipe, type 2"],
  ["pe3_pe100", "一般用PE管（3種 PE100）", "Polyethylene pipe, type 3 (PE100)"],
  ["wdpe", "水道配水用PE管", "PE pipe for water distribution"],
  ["grp_fw1〜grp_fw5", "FW成形強化プラスチック複合管 1〜5種", "Filament-wound GRP pipe, types 1-5"],
  ["gfpe", "GF強化ポリエチレン管", "Glass-fibre reinforced PE pipe"],
];

const NODE_TYPE_LABELS: ReadonlyArray<readonly [string, string, string]> = [
  ["reservoir", "貯水池・水源（水位固定）", "Reservoir (fixed-head source)"],
  ["junction", "分岐・接合点", "Junction"],
  ["tank", "水槽（水位変動）", "Tank (variable level)"],
  ["pump_node", "ポンプ設置点", "Pump node"],
  ["valve_node", "バルブ設置点", "Valve node"],
];

const OPERATION_TYPE_LABELS: ReadonlyArray<readonly [string, string, string]> = [
  ["valve_close", "バルブ閉そく", "Valve closure"],
  ["valve_open", "バルブ開操作", "Valve opening"],
  ["pump_stop", "ポンプ停止", "Pump trip / shutdown"],
  ["pump_start", "ポンプ起動", "Pump start-up"],
  ["combined", "複合操作", "Combined operation"],
];

const STANDARD_IDS = ["nochi_pipeline_2021"] as const;
const METHOD_IDS = ["joukowsky_v1", "allievi_v1", "moc_v1"] as const;

// ─── 列スキーマ ───────────────────────────────────────────────────────────────

const TABLE_COL: ColumnDef = { id: "テーブル", ja: "表種別・変更不可", cls: "auto", width: 10 };

const PIPE_COLS: readonly ColumnDef[] = [
  { id: "pipe_id", ja: "管路ID", cls: "required", width: 12 },
  { id: "pipe_name", ja: "管路名", cls: "optional", width: 14 },
  { id: "start_node", ja: "始点節点ID", cls: "required", width: 12 },
  { id: "end_node", ja: "終点節点ID", cls: "required", width: 12 },
  { id: "pipe_material", ja: "管種コード", cls: "required", width: 15, list: PIPE_MATERIAL_CODES },
  { id: "inner_diameter", ja: "管内径 D [m]", cls: "required", width: 14 },
  { id: "wall_thickness", ja: "管厚 t [m]", cls: "required", width: 13 },
  { id: "length", ja: "管路延長 L [m]", cls: "required", width: 14 },
  { id: "hazen_williams_c", ja: "粗度係数 C（ヘーゼン・ウィリアムス）", cls: "required", width: 16 },
  { id: "youngs_modulus", ja: "ヤング係数 Eₛ [kN/m²]・空欄なら管種から自動", cls: "optional", width: 18 },
  { id: "pipe_restraint_coeff", ja: "埋設状況係数 C₁・空欄なら 1.0", cls: "optional", width: 18 },
];

const NODE_COLS: readonly ColumnDef[] = [
  { id: "node_id", ja: "節点ID", cls: "required", width: 12 },
  { id: "node_name", ja: "節点名", cls: "optional", width: 14 },
  { id: "elevation", ja: "地盤高（標高）[m]", cls: "required", width: 15 },
  { id: "node_type", ja: "節点種別", cls: "required", width: 14, list: NODE_TYPE_CODES },
  { id: "hydraulic_grade", ja: "動水位 [m]・定常計算で更新", cls: "optional", width: 17 },
];

const CASE_COLS: readonly ColumnDef[] = [
  { id: "case_id", ja: "ケースID", cls: "required", width: 12 },
  { id: "case_name", ja: "ケース名", cls: "required", width: 18 },
  { id: "description", ja: "説明", cls: "optional", width: 40 },
  { id: "operation_type", ja: "操作種別", cls: "required", width: 15, list: OPERATION_TYPE_CODES },
  { id: "target_device_id", ja: "対象施設ID（バルブ・ポンプ等）", cls: "required", width: 18 },
  { id: "initial_velocity", ja: "初期流速 V₀ [m/s]", cls: "required", width: 16 },
  { id: "initial_head", ja: "初期圧力水頭 H₀ [m]", cls: "required", width: 17 },
  { id: "close_time", ja: "等価閉そく時間 tν [s]・バルブ操作は必須", cls: "optional", width: 18 },
];

const POINT_COLS: readonly ColumnDef[] = [
  { id: "point_id", ja: "測点ID", cls: "required", width: 12 },
  { id: "point_name", ja: "測点名", cls: "optional", width: 14 },
  { id: "horizontal_distance", ja: "単距離 Lh [m]", cls: "required", width: 14 },
  { id: "ground_level", ja: "地盤高 GL [m]", cls: "required", width: 14 },
  { id: "pipe_centerline_elevation", ja: "管中心高 FH [m]", cls: "required", width: 17 },
  { id: "slope_length", ja: "管長 SL [m]（斜距離）", cls: "required", width: 14 },
  { id: "flow_rate", ja: "流量 Q [m³/s]", cls: "required", width: 14 },
  { id: "inner_diameter", ja: "管径 D [m]（内径）", cls: "required", width: 14 },
  { id: "hazen_williams_c", ja: "流速係数 CI（ヘーゼン・ウィリアムス C）", cls: "required", width: 16 },
  { id: "bend_loss_coeff", ja: "湾曲損失係数 fb・既定 0", cls: "optional", width: 15 },
  { id: "valve_loss_coeff", ja: "バルブ損失係数 fv・既定 0", cls: "optional", width: 15 },
  { id: "branch_loss_coeff", ja: "直角分流損失係数 fβ・既定 0", cls: "optional", width: 16 },
  { id: "other_minor_loss_head", ja: "その他損失水頭 [m]", cls: "optional", width: 18 },
];

/** 案件情報シートの行スキーマ（キー・バリュー形式） */
const META_ROWS: ReadonlyArray<{ id: string; desc: string; cls: InputClass; list?: readonly string[] }> = [
  { id: "project_name", desc: "案件名 / Project name", cls: "required" },
  { id: "designer", desc: "設計者名 / Designer", cls: "optional" },
  { id: "date", desc: "設計年月日 / Design date（YYYY-MM-DD）", cls: "optional" },
  { id: "standard_id", desc: "採用基準ID / Design standard（既定のまま可）", cls: "optional", list: STANDARD_IDS },
  { id: "version", desc: "ソフトウェアバージョン / Software version（自動・編集不要）", cls: "auto" },
  { id: "method_id", desc: "手法識別子 / Calculation method（既定のまま可）", cls: "optional", list: METHOD_IDS },
  { id: "notes", desc: "備考 / Notes", cls: "optional" },
];

// ─── 書式ヘルパー ─────────────────────────────────────────────────────────────

function styleHeaderRow(ws: ExcelJS.Worksheet, rowNum: number, cols: readonly ColumnDef[], startCol: number): void {
  const row = ws.getRow(rowNum);
  row.height = 46;
  cols.forEach((_c, i) => {
    const cell = row.getCell(startCol + i);
    cell.fill = HEADER_FILL;
    cell.font = { bold: true, size: 9, color: { argb: "FFFFFFFF" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = BORDER;
  });
}

/** データ行（実データ＋空欄行）を入力区分で塗り分け、選択肢列に入力規則を付ける */
function styleDataBlock(
  ws: ExcelJS.Worksheet,
  firstRow: number,
  lastRow: number,
  cols: readonly ColumnDef[],
  startCol: number,
): void {
  for (let r = firstRow; r <= lastRow; r++) {
    const row = ws.getRow(r);
    cols.forEach((c, i) => {
      const cell = row.getCell(startCol + i);
      cell.fill = FILL[c.cls];
      cell.border = BORDER;
      cell.alignment = { vertical: "middle" };
      if (c.cls === "auto") cell.font = { color: { argb: "FF808080" } };
      if (c.list) {
        cell.dataValidation = {
          type: "list",
          allowBlank: c.cls !== "required",
          formulae: [`"${c.list.join(",")}"`],
          showErrorMessage: true,
          errorStyle: "warning",
          errorTitle: "入力候補にない値です",
          error: `「使い方」シートの一覧から選んでください: ${c.list.join(" / ")}`,
        };
      }
    });
  }
}

function applyWidths(ws: ExcelJS.Worksheet, cols: readonly ColumnDef[], startCol: number): void {
  cols.forEach((c, i) => {
    ws.getColumn(startCol + i).width = c.width;
  });
}

function styleSectionTitle(ws: ExcelJS.Worksheet, rowNum: number, span: number): void {
  const row = ws.getRow(rowNum);
  row.getCell(1).font = { bold: true, size: 11, color: { argb: "FF1F3864" } };
  for (let i = 1; i <= span; i++) row.getCell(i).fill = SECTION_FILL;
}

function blankRows(count: number, width: number): unknown[][] {
  return Array.from({ length: count }, () => Array.from({ length: width }, () => null));
}

// ─── シート生成 ───────────────────────────────────────────────────────────────

function addMetaSheet(wb: ExcelJS.Workbook, meta: Partial<ProjectMeta>): ExcelJS.Worksheet {
  const ws = wb.addWorksheet("案件情報");
  const values: Record<string, string> = {
    project_name: meta.projectName ?? "",
    designer: meta.designer ?? "",
    date: meta.date ?? new Date().toISOString().slice(0, 10),
    standard_id: meta.standardId ?? "nochi_pipeline_2021",
    version: meta.version ?? PRODUCT_VERSION,
    method_id: meta.methodId ?? "joukowsky_v1",
    notes: meta.notes ?? "",
  };

  ws.addRow(["フィールドID", "値", "説明", "入力区分"]);
  for (const m of META_ROWS) {
    ws.addRow([m.id, values[m.id] ?? "", m.desc, MARK[m.cls]]);
  }

  const head = ws.getRow(1);
  head.height = 20;
  for (let c = 1; c <= 4; c++) {
    const cell = head.getCell(c);
    cell.fill = HEADER_FILL;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = BORDER;
  }

  // A列（キー）と C・D列（説明・区分）は編集不可。入力欄は B列だけ。
  META_ROWS.forEach((m, i) => {
    const row = ws.getRow(i + 2);
    row.height = 18;
    for (const c of [1, 3, 4]) {
      const cell = row.getCell(c);
      cell.fill = FILL.auto;
      cell.font = { color: { argb: "FF595959" } };
      cell.border = BORDER;
    }
    row.getCell(4).alignment = { horizontal: "center" };

    const valueCell = row.getCell(2);
    valueCell.fill = FILL[m.cls];
    valueCell.border = BORDER;
    if (m.cls === "auto") valueCell.font = { color: { argb: "FF808080" } };
    if (m.list) {
      valueCell.dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`"${m.list.join(",")}"`],
        showErrorMessage: true,
        errorStyle: "warning",
        errorTitle: "入力候補にない値です",
        error: `候補: ${m.list.join(" / ")}`,
      };
    }
  });

  ws.getColumn(1).width = 18;
  ws.getColumn(2).width = 30;
  ws.getColumn(3).width = 52;
  ws.getColumn(4).width = 10;
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return ws;
}

function addNetworkSheet(wb: ExcelJS.Workbook, pipes: Pipe[], nodes: Node[]): ExcelJS.Worksheet {
  const ws = wb.addWorksheet("管路・節点");

  const pipeCols = [TABLE_COL, ...PIPE_COLS];
  const nodeCols = [TABLE_COL, ...NODE_COLS];

  const pipeData = pipes.map((p) => [
    "pipe", p.id, p.name ?? "",
    p.startNodeId, p.endNodeId, p.pipeType,
    p.innerDiameter, p.wallThickness, p.length,
    p.roughnessCoeff, p.youngsModulus ?? "", p.c1Coeff ?? "",
  ]);
  const nodeData = nodes.map((n) => [
    "node", n.id, n.name ?? "",
    n.elevation, n.nodeType, n.hydraulicGrade ?? "",
  ]);

  // reader.parseNetwork() は A列に「節点」を含む行を Node セクションの開始として探すため、
  // それより前の A列に「節点」の語を置かないこと。
  ws.addRow(["# 管路区間（Pipe） / Pipe segments"]);
  const pipeHeaderRow = 2;
  ws.addRow(pipeCols.map(headerText));
  const pipeFirst = pipeHeaderRow + 1;
  for (const r of pipeData) ws.addRow(r);
  for (const r of blankRows(BLANK_ROWS.pipe, pipeCols.length)) ws.addRow(r);
  const pipeLast = pipeFirst + pipeData.length + BLANK_ROWS.pipe - 1;

  ws.addRow([]);
  const nodeTitleRow = pipeLast + 2;
  ws.addRow(["# 節点（Node） / Nodes"]);
  const nodeHeaderRow = nodeTitleRow + 1;
  ws.addRow(nodeCols.map(headerText));
  const nodeFirst = nodeHeaderRow + 1;
  for (const r of nodeData) ws.addRow(r);
  for (const r of blankRows(BLANK_ROWS.node, nodeCols.length)) ws.addRow(r);
  const nodeLast = nodeFirst + nodeData.length + BLANK_ROWS.node - 1;

  styleSectionTitle(ws, 1, pipeCols.length);
  styleHeaderRow(ws, pipeHeaderRow, pipeCols, 1);
  styleDataBlock(ws, pipeFirst, pipeLast, pipeCols, 1);

  styleSectionTitle(ws, nodeTitleRow, nodeCols.length);
  styleHeaderRow(ws, nodeHeaderRow, nodeCols, 1);
  styleDataBlock(ws, nodeFirst, nodeLast, nodeCols, 1);

  applyWidths(ws, pipeCols, 1);
  return ws;
}

function addCasesSheet(wb: ExcelJS.Workbook, cases: CalculationCase[]): ExcelJS.Worksheet {
  const ws = wb.addWorksheet("シナリオ設定");
  ws.addRow(CASE_COLS.map(headerText));
  const dataRows = cases.map((c) => [
    c.id, c.name, c.description ?? "",
    c.operationType, c.targetFacilityId,
    c.initialVelocity, c.initialHead, c.closeTime ?? "",
  ]);
  for (const r of dataRows) ws.addRow(r);
  for (const r of blankRows(BLANK_ROWS.case, CASE_COLS.length)) ws.addRow(r);

  styleHeaderRow(ws, 1, CASE_COLS, 1);
  styleDataBlock(ws, 2, 1 + dataRows.length + BLANK_ROWS.case, CASE_COLS, 1);
  applyWidths(ws, CASE_COLS, 1);
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return ws;
}

function addMeasurementPointsSheet(wb: ExcelJS.Workbook, points: MeasurementPoint[]): ExcelJS.Worksheet {
  const ws = wb.addWorksheet("測点データ");
  ws.addRow(POINT_COLS.map(headerText));
  const dataRows = points.map((pt) => [
    pt.id, pt.name ?? "",
    pt.horizontalDistance, pt.groundLevel, pt.pipeCenterHeight,
    pt.pipeLength, pt.flowRate, pt.diameter, pt.roughnessC,
    pt.bendLossCoeff, pt.valveLossCoeff, pt.branchLossCoeff,
    pt.otherLoss ?? "",
  ]);
  for (const r of dataRows) ws.addRow(r);
  for (const r of blankRows(BLANK_ROWS.point, POINT_COLS.length)) ws.addRow(r);

  styleHeaderRow(ws, 1, POINT_COLS, 1);
  styleDataBlock(ws, 2, 1 + dataRows.length + BLANK_ROWS.point, POINT_COLS, 1);
  applyWidths(ws, POINT_COLS, 1);
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
  return ws;
}

// ─── 使い方シート ─────────────────────────────────────────────────────────────

/** 用語対応表: 日本語名 / English / 記号 / 単位 / フィールドID */
const GLOSSARY: ReadonlyArray<readonly [string, string, string, string, string]> = [
  ["管種（管材）", "Pipe material", "—", "—", "pipe_material"],
  ["管内径", "Inner diameter", "D", "m", "inner_diameter"],
  ["管厚", "Wall thickness", "t", "m", "wall_thickness"],
  ["管路延長", "Pipe length", "L", "m", "length"],
  ["管長（斜距離）", "Slope length", "SL", "m", "slope_length"],
  ["単距離（水平距離）", "Horizontal distance", "Lh", "m", "horizontal_distance"],
  ["地盤高", "Ground level / elevation", "GL", "m", "ground_level / elevation"],
  ["管中心高", "Pipe centreline elevation", "FH", "m", "pipe_centerline_elevation"],
  ["流量", "Flow rate / discharge", "Q", "m³/s", "flow_rate"],
  ["流速", "Flow velocity", "V", "m/s", "initial_velocity"],
  ["初期圧力水頭", "Initial pressure head", "H₀", "m", "initial_head"],
  ["粗度係数（流速係数）", "Hazen-Williams roughness coefficient", "C, CI", "—", "hazen_williams_c"],
  ["ヤング係数（縦弾性係数）", "Young modulus of pipe material", "Eₛ", "kN/m²", "youngs_modulus"],
  ["埋設状況係数", "Pipe restraint (anchorage) coefficient", "C₁", "—", "pipe_restraint_coeff"],
  ["湾曲損失係数", "Bend loss coefficient", "fb", "—", "bend_loss_coeff"],
  ["バルブ損失係数", "Valve loss coefficient", "fv", "—", "valve_loss_coeff"],
  ["直角分流損失係数", "Right-angle branch loss coefficient", "fβ", "—", "branch_loss_coeff"],
  ["その他損失水頭", "Other minor loss head", "Σhc", "m", "other_minor_loss_head"],
  ["動水位", "Hydraulic grade line", "WLm", "m", "hydraulic_grade"],
  ["波速（圧力波伝播速度）", "Wave speed / celerity", "a", "m/s", "（計算値）"],
  ["圧力振動周期", "Pressure wave period", "T₀", "s", "（計算値 4L/a）"],
  ["等価閉そく時間", "Equivalent valve closure time", "tν", "s", "close_time"],
  ["水撃圧", "Water hammer (surge) pressure", "Pi", "MPa", "（計算値）"],
  ["静水圧", "Static pressure", "Ps", "MPa", "（計算値）"],
  ["設計内圧", "Design internal pressure", "Pp", "MPa", "（計算値 Ps+Pi）"],
];

/**
 * 旧フィールドIDとの対応。
 * reader は旧IDも読み取るため、既存の帳票はそのまま使える。
 */
const RENAMED_FIELD_IDS: ReadonlyArray<readonly [string, string, string]> = [
  ["initial_flow", "initial_velocity", "値は流速 [m/s]。flow は流量を指すため誤り"],
  ["pipe_type", "pipe_material", "選ぶのは管の材質（管種）"],
  ["roughness_coeff", "hazen_williams_c", "ヘーゼン・ウィリアムス C であることを明示"],
  ["roughness_c", "hazen_williams_c", "管路表と同じ量なので名前をそろえた"],
  ["c1_coeff", "pipe_restraint_coeff", "記号 C₁ ではなく意味（埋設状況）で示す"],
  ["target_facility_id", "target_device_id", "対象はバルブ・ポンプなどの機器"],
  ["diameter", "inner_diameter", "管路表と同じ量なので名前をそろえた"],
  ["pipe_length", "slope_length", "管路延長 length と別物（斜距離）と分かるように"],
  ["pipe_center_height", "pipe_centerline_elevation", "標高は elevation にそろえた"],
  ["other_loss", "other_minor_loss_head", "係数ではなく水頭 [m]"],
];

function addInstructionSheet(wb: ExcelJS.Workbook): ExcelJS.Worksheet {
  const ws = wb.addWorksheet("使い方");

  const push = (row: unknown[]) => ws.addRow(row);
  const headRows: number[] = [];
  const head = (text: string) => { push([text]); headRows.push(ws.rowCount); };

  push(["open-waterhammer 入力帳票 / Water hammer analysis input workbook"]);
  ws.getRow(1).font = { bold: true, size: 14, color: { argb: "FF1F3864" } };
  push([]);

  head("■ このExcelの役割 / Role of this workbook");
  push(["初期一括入力", "このExcelはプロジェクト開始時の一括入力に使用します。"]);
  push(["読込後の正本", "読込後はWeb画面のプロジェクトデータを確認・修正し、その値を正本とします。"]);
  push(["保存・共有・再開", ".owhproj を使用します。Webでの変更はこのExcelへ自動的に書き戻されません。"]);
  push(["再読込", "対応する計算入力を上書きします。元の状態を残す場合は、先に .owhproj を書き出してください。"]);
  push([]);

  head("■ 色の意味（入力するセルの見分け方） / Legend");
  push(["◎必須", "必ず入力してください", "Required — must be filled in"]);
  const legendRequired = ws.rowCount;
  push(["○任意", "空欄でも計算できます（既定値・自動補完が入ります）", "Optional — a default is used when blank"]);
  const legendOptional = ws.rowCount;
  push(["―自動", "編集不要。ソフトが書き込む欄・表の構造を決める欄です", "Auto / fixed — do not edit"]);
  const legendAuto = ws.rowCount;
  push(["（濃紺の行）", "見出し行。文字を書き換えると読み込めなくなります", "Header row — do not rename"]);
  const legendHeader = ws.rowCount;
  push([]);
  push(["※ 各シートの見出しは「フィールドID（英名）／日本語名／入力区分」の3段で表示しています。"]);
  push(["※ 見出しの英名はソフトが列を見分けるキーです。日本語名だけを書き換えることはできません。"]);
  push([]);

  head("■ シート構成 / Sheets");
  push(["案件情報", "プロジェクト名・採用基準などのメタ情報", "Project metadata"]);
  push(["管路・節点", "管路区間と節点の諸元（Pipeテーブル・Nodeテーブル）", "Pipes and nodes"]);
  push(["測点データ", "水理計算書用の測点データ（成果品参照様式）", "Measurement points for the hydraulic calculation sheet"]);
  push(["シナリオ設定", "境界条件・操作イベント・防護工条件の初期一覧", "Initial scenarios"]);
  push([]);

  head("■ 管種コード / Pipe material codes（pipe_material 欄）");
  push(["コード", "日本語名", "English"]);
  for (const r of PIPE_MATERIAL_LABELS) push([...r]);
  push([]);

  head("■ 節点種別コード / Node type codes（node_type 欄）");
  push(["コード", "日本語名", "English"]);
  for (const r of NODE_TYPE_LABELS) push([...r]);
  push([]);

  head("■ 操作種別コード / Operation type codes（operation_type 欄）");
  push(["コード", "日本語名", "English"]);
  for (const r of OPERATION_TYPE_LABELS) push([...r]);
  push([]);

  head("■ 用語対応表 / Glossary");
  push(["日本語名", "English", "記号", "単位", "フィールドID"]);
  const glossaryHeaderRow = ws.rowCount;
  for (const r of GLOSSARY) push([...r]);
  push([]);

  head("■ 旧フィールドIDとの対応 / Renamed field IDs");
  push(["旧ID", "現行ID", "変更の理由"]);
  for (const [oldId, newId, why] of RENAMED_FIELD_IDS) push([oldId, newId, why]);
  push(["", "旧IDの帳票もそのまま読み込めます。", "Workbooks using the old IDs are still accepted."]);
  push([]);

  head("■ シナリオ設定の入力について / Notes on scenarios");
  push(["等価閉そく時間 tν", "バルブ操作ケース（valve_close / valve_open）では必ず入力してください。"]);
  push(["", "急閉そく・緩閉そくの判定と、アリエビ式の適用可否（tν > L/300）に使います。"]);
  push(["", "ポンプ操作ケースでは不要です。"]);
  push(["対象施設ID", "操作するバルブ・ポンプのIDです。"]);
  push([]);

  head("■ 表への行の追加について / Adding rows");
  push(["行の追加", "各表の下に空欄行を用意しています。足りないときは行を挿入してください。"]);
  push(["空行", "表の途中に空行があっても、その先の行まで読み込みます。"]);
  push([]);

  head("■ 測点データの入力について / Notes on measurement points");
  push(["管中心高 FH", "管路中心の標高 [m]（= GL − 土被り − D/2）"]);
  push(["管長 SL", "実延長（斜距離）[m]。単距離 Lh は水平距離"]);
  push(["損失係数 fb / fv / fβ", "無次元 [-]。速度水頭 hv に乗じて損失水頭になります"]);
  push(["その他損失", "上記以外の局部損失水頭 [m]（係数ではなく水頭を直接入力）"]);
  push([]);

  push(["参照: 土地改良事業計画設計基準 設計「パイプライン」技術書（令和3年6月改訂）"]);
  push(["ライセンス: AGPL-3.0-or-later"]);

  for (const r of headRows) {
    const row = ws.getRow(r);
    row.getCell(1).font = { bold: true, size: 11, color: { argb: "FF1F3864" } };
    for (let c = 1; c <= 5; c++) row.getCell(c).fill = SECTION_FILL;
  }

  ws.getRow(legendRequired).getCell(1).fill = FILL.required;
  ws.getRow(legendOptional).getCell(1).fill = FILL.optional;
  ws.getRow(legendAuto).getCell(1).fill = FILL.auto;
  const headerSample = ws.getRow(legendHeader).getCell(1);
  headerSample.fill = HEADER_FILL;
  headerSample.font = { bold: true, color: { argb: "FFFFFFFF" } };
  for (const r of [legendRequired, legendOptional, legendAuto, legendHeader]) {
    const cell = ws.getRow(r).getCell(1);
    cell.alignment = { horizontal: "center" };
    cell.border = BORDER;
  }

  const glossaryHead = ws.getRow(glossaryHeaderRow);
  for (let c = 1; c <= 5; c++) {
    glossaryHead.getCell(c).font = { bold: true };
    glossaryHead.getCell(c).border = BORDER;
  }

  ws.getColumn(1).width = 26;
  ws.getColumn(2).width = 46;
  ws.getColumn(3).width = 44;
  ws.getColumn(4).width = 10;
  ws.getColumn(5).width = 30;
  return ws;
}

// ─── メイン ──────────────────────────────────────────────────────────────────

/**
 * Excel テンプレートを ArrayBuffer として生成する。
 *
 * ブラウザでのダウンロード例:
 * ```typescript
 * const buf = await generateTemplate({ meta, pipes, nodes, cases });
 * const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
 * const url = URL.createObjectURL(blob);
 * const a = document.createElement("a");
 * a.href = url;
 * a.download = "waterhammer-input.xlsx";
 * a.click();
 * ```
 */
export async function generateTemplate(options: TemplateOptions = {}): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();

  addInstructionSheet(wb);
  addMetaSheet(wb, options.meta ?? {});
  addNetworkSheet(wb, options.pipes ?? [], options.nodes ?? []);
  addMeasurementPointsSheet(wb, options.measurementPoints ?? []);
  addCasesSheet(wb, options.cases ?? []);

  // exceljs writeBuffer は Node.js では Buffer、ブラウザでは ArrayBuffer 互換 (Uint8Array)
  // 呼び出し側は Blob() に渡せるのでどちらでも動く
  const buf = await wb.xlsx.writeBuffer();
  return buf as ArrayBuffer;
}
