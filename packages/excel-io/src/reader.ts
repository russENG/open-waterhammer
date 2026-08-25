/**
 * Excel帳票読み取りモジュール
 * 対応シート: meta / network / cases
 * スキーマ定義: docs/excel-template-spec.md
 *
 * exceljs ベース実装（xlsx/SheetJS から移行: 2026-05-08）
 * 移行理由: SheetJS (npm xlsx) に Prototype Pollution / ReDoS 脆弱性があり npm 配布版に修正がないため
 */

import ExcelJS from "exceljs";
import type { Pipe, Node, CalculationCase, MeasurementPoint, PipeType, NodeType, OperationType } from "@open-waterhammer/core";
import type { ProjectMeta, WorkbookData, ParseResult, ParseError } from "./types.js";

// ─── 内部ヘルパー ─────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return v != null ? String(v).trim() : "";
}

function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = parseFloat(String(v));
  return isNaN(n) ? undefined : n;
}

function requireNum(v: unknown, label: string, errors: ParseError[], sheet: string, row: number): number {
  const n = num(v);
  if (n === undefined) {
    errors.push({ sheet, row, field: label, message: `${label} が数値ではありません: "${v}"` });
    return 0;
  }
  return n;
}

/**
 * 各行に埋め込む「実際のシート行番号」のキー。
 * エラーメッセージの行番号を、空行を含む実際の位置に合わせるために使う。
 * 列ヘッダーと衝突しないよう記号付きの名前にしている。
 */
const ROW_NUMBER = "__sheetRow__";

function rowNumberOf(row: Record<string, unknown>, fallback: number): number {
  const n = row[ROW_NUMBER];
  return typeof n === "number" ? n : fallback;
}

/** 複合ヘッダー "field_id\n(日本語名)\n(入力区分)" → "field_id" に正規化 */
function normalizeKey(key: string): string {
  const idx = key.indexOf("\n");
  return idx >= 0 ? key.substring(0, idx) : key;
}

/** exceljs の cell.value（リッチテキスト・式・日付など）をプリミティブに変換 */
function extractCellValue(v: ExcelJS.CellValue): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    // 数式の計算結果
    if ("result" in v && v.result !== undefined && v.result !== null) {
      return extractCellValue(v.result as ExcelJS.CellValue);
    }
    // リッチテキスト
    if ("richText" in v && Array.isArray(v.richText)) {
      return v.richText.map((rt) => rt.text ?? "").join("");
    }
    // ハイパーリンク
    if ("text" in v && typeof v.text === "string") return v.text;
    // エラー値（#REF! など）
    if ("error" in v) return null;
  }
  return String(v);
}

/** ワークシートを ヘッダー行(1)+データ行 として { 列名 → セル値 }[] に変換 */
function sheetToRows(ws: ExcelJS.Worksheet | undefined): Record<string, unknown>[] {
  if (!ws || ws.rowCount === 0) return [];

  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  // 1-indexed: headers[c] = ヘッダー名
  headerRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
    headers[colNum] = normalizeKey(String(extractCellValue(cell.value) ?? ""));
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
    if (hasValue) {
      obj[ROW_NUMBER] = r;
      result.push(obj);
    }
  }
  return result;
}

/** ワークシートを 2D 配列として取得（ヘッダー行/コメント行を含む生の表現） */
function sheetTo2D(ws: ExcelJS.Worksheet | undefined): unknown[][] {
  if (!ws || ws.rowCount === 0) return [];
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

// ─── meta シート ──────────────────────────────────────────────────────────────

function parseMeta(wb: ExcelJS.Workbook, errors: ParseError[]): ProjectMeta {
  const ws = wb.getWorksheet("案件情報") ?? wb.getWorksheet("meta");
  if (!ws) {
    errors.push({ sheet: "meta", message: "「案件情報」シートが見つかりません" });
    return { projectName: "", standardId: "" };
  }

  // meta シートはキー・バリュー形式（A列: フィールドID, B列: 値）
  const rows = sheetToRows(ws);
  const kv: Record<string, string> = {};
  for (const row of rows) {
    const key = str(row["フィールドID"] ?? row["field_id"] ?? Object.values(row)[0]);
    const val = str(row["値"] ?? row["value"] ?? Object.values(row)[1]);
    if (key) kv[key] = val;
  }

  if (!kv["project_name"]) {
    errors.push({ sheet: "meta", field: "project_name", message: "案件名が未入力です" });
  }

  const meta: ProjectMeta = {
    projectName: kv["project_name"] ?? "",
    standardId: kv["standard_id"] ?? "nochi_pipeline_2021",
  };
  if (kv["designer"]) meta.designer = kv["designer"];
  if (kv["date"]) meta.date = kv["date"];
  if (kv["version"]) meta.version = kv["version"];
  if (kv["method_id"]) meta.methodId = kv["method_id"];
  const staticWaterLevel = num(kv["static_water_level"]);
  if (staticWaterLevel !== undefined) meta.staticWaterLevel = staticWaterLevel;
  if (kv["notes"]) meta.notes = kv["notes"];
  return meta;
}

// ─── network シート（管路・節点） ─────────────────────────────────────────────

const VALID_PIPE_MATERIALS = new Set<string>([
  "steel", "ductile_iron", "rcp", "cpcp", "upvc",
  "pe2", "pe3_pe100", "wdpe",
  "grp_fw1", "grp_fw2", "grp_fw3", "grp_fw4", "grp_fw5", "gfpe",
]);

const VALID_NODE_TYPES = new Set<string>([
  "reservoir", "junction", "tank", "pump_node", "valve_node",
]);

function parsePipes(rows: Record<string, unknown>[], errors: ParseError[]): Pipe[] {
  const pipes: Pipe[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const rowNum = rowNumberOf(row, i + 2);

    const id = str(row["pipe_id"] ?? row["管路ID"]);
    if (!id) continue; // 空行はスキップ

    // 2番目以降のキーは旧フィールドID・日本語見出し（既存の帳票を読むための後方互換）
    const pipeTypeRaw = str(row["pipe_material"] ?? row["pipe_type"] ?? row["管種"]).toLowerCase();
    if (!VALID_PIPE_MATERIALS.has(pipeTypeRaw)) {
      errors.push({ sheet: "network", row: rowNum, field: "pipe_material", message: `不明な管種コード: "${pipeTypeRaw}"` });
    }

    const pipe: Pipe = {
      id,
      startNodeId: str(row["start_node"] ?? row["始点節点ID"]),
      endNodeId: str(row["end_node"] ?? row["終点節点ID"]),
      pipeType: (VALID_PIPE_MATERIALS.has(pipeTypeRaw) ? pipeTypeRaw : "ductile_iron") as PipeType,
      innerDiameter: requireNum(row["inner_diameter"] ?? row["管内径 D"], "管内径 D", errors, "network", rowNum),
      wallThickness: requireNum(row["wall_thickness"] ?? row["管厚 t"], "管厚 t", errors, "network", rowNum),
      length: requireNum(row["length"] ?? row["管路延長 L"], "管路延長 L", errors, "network", rowNum),
      roughnessCoeff: requireNum(row["hazen_williams_c"] ?? row["roughness_coeff"] ?? row["粗度係数"], "粗度係数 C", errors, "network", rowNum),
    };
    const pipeName = str(row["pipe_name"] ?? row["管路名"]);
    if (pipeName) pipe.name = pipeName;
    const Es = num(row["youngs_modulus"] ?? row["ヤング係数 Eₛ"]);
    if (Es !== undefined) pipe.youngsModulus = Es;
    const c1 = num(row["pipe_restraint_coeff"] ?? row["c1_coeff"] ?? row["埋設状況係数 C₁"]);
    if (c1 !== undefined) pipe.c1Coeff = c1;
    const allowable = num(row["allowable_pressure"] ?? row["許容圧力"]);
    if (allowable !== undefined) pipe.allowablePressureMpa = allowable;
    pipes.push(pipe);
  }
  return pipes;
}

function parseNodes(rows: Record<string, unknown>[], errors: ParseError[]): Node[] {
  const nodes: Node[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const rowNum = rowNumberOf(row, i + 2);

    const id = str(row["node_id"] ?? row["節点ID"]);
    if (!id) continue;

    const nodeTypeRaw = str(row["node_type"] ?? row["節点種別"]).toLowerCase();
    if (!VALID_NODE_TYPES.has(nodeTypeRaw)) {
      errors.push({ sheet: "network", row: rowNum, field: "node_type", message: `不明な節点種別: "${nodeTypeRaw}"` });
    }

    const node: Node = {
      id,
      elevation: requireNum(row["elevation"] ?? row["地盤高"], "地盤高", errors, "network", rowNum),
      nodeType: (VALID_NODE_TYPES.has(nodeTypeRaw) ? nodeTypeRaw : "junction") as NodeType,
    };
    const nodeName = str(row["node_name"] ?? row["節点名"]);
    if (nodeName) node.name = nodeName;
    const hg = num(row["hydraulic_grade"] ?? row["動水位"]);
    if (hg !== undefined) node.hydraulicGrade = hg;
    nodes.push(node);
  }
  return nodes;
}

/**
 * 生 2D 配列から列ヘッダー行を検出してオブジェクト配列に変換する。
 * 最初のセルが keyIndicators のいずれかを含む行をヘッダーとして扱う。
 */
function sectionToRows(
  raw: unknown[][],
  keyIndicators: string[],
  rowOffset = 0,
): Record<string, unknown>[] {
  const headerIdx = raw.findIndex((row) =>
    keyIndicators.some((k) => str(row[0]).toLowerCase().includes(k)),
  );
  if (headerIdx === -1) return [];

  const headers = raw[headerIdx]!.map((h) => normalizeKey(str(h)));
  const result: Record<string, unknown>[] = [];

  for (let i = headerIdx + 1; i < raw.length; i++) {
    const row = raw[i]!;
    const first = str(row[0]);
    // 次のセクション見出し（"# ..."）でこのセクションは終わり
    if (first.startsWith("#")) break;
    // 空行は飛ばす。ここで打ち切ると、表の途中に空行を挟んだときに
    // それ以降の入力行が黙って読み捨てられてしまう。
    if (headers.every((_, ci) => row[ci] == null || str(row[ci]) === "")) continue;

    const obj: Record<string, unknown> = {};
    headers.forEach((h, ci) => { if (h) obj[h] = row[ci] ?? null; });
    obj[ROW_NUMBER] = rowOffset + i + 1;
    result.push(obj);
  }

  return result;
}

function parseNetwork(wb: ExcelJS.Workbook, errors: ParseError[]): { pipes: Pipe[]; nodes: Node[] } {
  const ws = wb.getWorksheet("管路・節点") ?? wb.getWorksheet("network");
  if (!ws) {
    errors.push({ sheet: "network", message: "「管路・節点」シートが見つかりません" });
    return { pipes: [], nodes: [] };
  }

  // 生の 2D 配列で取得（コメント行・セクション見出しを含む）
  const raw = sheetTo2D(ws);

  // pipe_id 列を持つセクション → 管路、node_id 列を持つセクション → 節点
  const pipeRows = sectionToRows(raw, ["テーブル", "table", "pipe_id"]);
  const nodeStartIdx = raw.findIndex((r) => str(r[0]).includes("節点"));
  const nodeRaw = nodeStartIdx >= 0 ? raw.slice(nodeStartIdx + 1) : raw;
  const nodeRows = sectionToRows(nodeRaw, ["テーブル", "table", "node_id"], nodeStartIdx >= 0 ? nodeStartIdx + 1 : 0);

  return {
    pipes: parsePipes(pipeRows, errors),
    nodes: parseNodes(nodeRows, errors),
  };
}

// ─── cases シート ──────────────────────────────────────────────────────────────

const VALID_OPERATION_TYPES = new Set<string>([
  "valve_close", "valve_open", "pump_stop", "pump_start", "combined",
]);

function parseCases(wb: ExcelJS.Workbook, errors: ParseError[], warnings: string[]): CalculationCase[] {
  const ws = wb.getWorksheet("シナリオ設定") ?? wb.getWorksheet("ケース設定") ?? wb.getWorksheet("cases");
  if (!ws) {
    errors.push({ sheet: "cases", message: "「シナリオ設定」シートが見つかりません" });
    return [];
  }

  const rows = sheetToRows(ws);
  const cases: CalculationCase[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const rowNum = rowNumberOf(row, i + 2);

    const id = str(row["case_id"] ?? row["ケースID"]);
    if (!id) continue;

    const opRaw = str(row["operation_type"] ?? row["操作種別"]).toLowerCase();
    if (!VALID_OPERATION_TYPES.has(opRaw)) {
      errors.push({ sheet: "cases", row: rowNum, field: "operation_type", message: `不明な操作種別: "${opRaw}"` });
    }

    const cas: CalculationCase = {
      id,
      name: str(row["case_name"] ?? row["ケース名"]) || id,
      operationType: (VALID_OPERATION_TYPES.has(opRaw) ? opRaw : "valve_close") as OperationType,
      targetFacilityId: str(row["target_device_id"] ?? row["target_facility_id"] ?? row["対象施設ID"]),
      // initial_flow は旧フィールドID（流速なのに flow という誤称）。既存ブックのため読み取りだけ残す。
      initialVelocity: requireNum(row["initial_velocity"] ?? row["initial_flow"] ?? row["初期流速 V₀"], "初期流速 V₀", errors, "cases", rowNum),
      initialHead: requireNum(row["initial_head"] ?? row["初期圧力水頭 H₀"], "初期圧力水頭 H₀", errors, "cases", rowNum),
    };
    const desc = str(row["description"] ?? row["説明"]);
    if (desc) cas.description = desc;
    const closeTime = num(row["close_time"] ?? row["等価閉そく時間 tν"]);
    if (closeTime !== undefined) cas.closeTime = closeTime;
    if (cas.closeTime === undefined && (cas.operationType === "valve_close" || cas.operationType === "valve_open")) {
      warnings.push(`ケース ${cas.id}: 等価閉そく時間（close_time）が未入力です。急閉そく・緩閉そくの判定ができません。`);
    }
    cases.push(cas);
  }

  return cases;
}

// ─── 測点シート ──────────────────────────────────────────────────────────────

function parseMeasurementPoints(wb: ExcelJS.Workbook, errors: ParseError[]): MeasurementPoint[] {
  const ws = wb.getWorksheet("測点データ") ?? wb.getWorksheet("measurement_points");
  if (!ws) {
    // 測点シートは任意（後方互換のため）
    return [];
  }

  const rows = sheetToRows(ws);
  const points: MeasurementPoint[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const rowNum = rowNumberOf(row, i + 2);

    const id = str(row["point_id"] ?? row["測点ID"]);
    if (!id) continue;

    const pt: MeasurementPoint = {
      id,
      horizontalDistance: requireNum(row["horizontal_distance"] ?? row["単距離 Lh"], "単距離", errors, "測点データ", rowNum),
      groundLevel: requireNum(row["ground_level"] ?? row["地盤高 GL"], "地盤高", errors, "測点データ", rowNum),
      pipeCenterHeight: requireNum(row["pipe_centerline_elevation"] ?? row["pipe_center_height"] ?? row["管中心高 FH"], "管中心高", errors, "測点データ", rowNum),
      pipeLength: requireNum(row["slope_length"] ?? row["pipe_length"] ?? row["管長 SL"], "管長", errors, "測点データ", rowNum),
      flowRate: requireNum(row["flow_rate"] ?? row["流量 Q"], "流量", errors, "測点データ", rowNum),
      diameter: requireNum(row["inner_diameter"] ?? row["diameter"] ?? row["管径 D"], "管径", errors, "測点データ", rowNum),
      roughnessC: requireNum(row["hazen_williams_c"] ?? row["roughness_c"] ?? row["流速係数 CI"], "流速係数 C", errors, "測点データ", rowNum),
      bendLossCoeff: num(row["bend_loss_coeff"] ?? row["湾曲損失係数 fb"]) ?? 0,
      valveLossCoeff: num(row["valve_loss_coeff"] ?? row["バルブ損失係数 fv"]) ?? 0,
      branchLossCoeff: num(row["branch_loss_coeff"] ?? row["直角分流損失係数 fβ"]) ?? 0,
    };
    const ptName = str(row["point_name"] ?? row["測点名"]);
    if (ptName) pt.name = ptName;
    const pipeId = str(row["pipe_id"] ?? row["所属管路ID"]);
    if (pipeId) pt.pipeId = pipeId;
    const nodeId = str(row["node_id"] ?? row["同一位置の節点ID"]);
    if (nodeId) pt.nodeId = nodeId;
    const distanceAlongPipe = num(row["distance_along_pipe"] ?? row["管路始点からの実延長"]);
    if (distanceAlongPipe !== undefined) pt.distanceAlongPipe = distanceAlongPipe;
    const other = num(row["other_minor_loss_head"] ?? row["other_loss"] ?? row["その他損失"]);
    if (other !== undefined) pt.otherLoss = other;
    points.push(pt);
  }

  return points;
}

// ─── メイン ──────────────────────────────────────────────────────────────────

/**
 * Excel ワークブックを ArrayBuffer から読み取り、ドメインオブジェクトに変換する。
 *
 * ブラウザ環境: `await file.arrayBuffer()` で取得した ArrayBuffer を渡す
 * Node.js 環境: `fs.readFileSync(path)` の Buffer を渡す
 *
 * exceljs ベース実装のため戻り値は Promise。
 */
export async function parseWorkbook(buffer: ArrayBuffer | Buffer): Promise<ParseResult> {
  const errors: ParseError[] = [];
  const warnings: string[] = [];

  const wb = new ExcelJS.Workbook();
  try {
    // exceljs の load() は ArrayBuffer または Node Buffer を受け付ける
    // Buffer を渡すと内部で ArrayBuffer 化される
    await wb.xlsx.load(buffer as ArrayBuffer);
  } catch (e) {
    errors.push({ sheet: "(global)", message: `ファイルの読み取りに失敗しました: ${e}` });
    return {
      data: { meta: { projectName: "", standardId: "" }, pipes: [], nodes: [], cases: [], measurementPoints: [] },
      errors,
      warnings,
    };
  }

  const meta = parseMeta(wb, errors);
  const { pipes, nodes } = parseNetwork(wb, errors);
  const cases = parseCases(wb, errors, warnings);
  const measurementPoints = parseMeasurementPoints(wb, errors);

  if (pipes.length === 0) {
    warnings.push("管路データが0件です。networkシートを確認してください。");
  }

  return {
    data: { meta, pipes, nodes, cases, measurementPoints },
    errors,
    warnings,
  };
}
