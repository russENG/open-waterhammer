/**
 * Excel帳票読み取りモジュール
 * 対応シート: meta / network / cases
 * スキーマ定義: docs/excel-template-spec.md
 */

import * as XLSX from "xlsx";
import type { Pipe, Node, CalculationCase, PipeType, NodeType, OperationType } from "@open-waterhammer/core";
import type { ProjectMeta, WorkbookData, ParseResult, ParseError } from "./types.js";

// ─── 内部ヘルパー ─────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return v != null ? String(v).trim() : "";
}

function num(v: unknown): number | undefined {
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

/** シートを { header行の列名 → セル値 }[] の配列に変換 */
function sheetToRows(ws: XLSX.WorkSheet): Record<string, unknown>[] {
  if (!ws) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: null,
    raw: false,
  });
}

// ─── meta シート ──────────────────────────────────────────────────────────────

function parseMeta(wb: XLSX.WorkBook, errors: ParseError[]): ProjectMeta {
  const ws = wb.Sheets["案件情報"] ?? wb.Sheets["meta"];
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
  if (kv["notes"]) meta.notes = kv["notes"];
  return meta;
}

// ─── network シート（管路・節点） ─────────────────────────────────────────────

const VALID_PIPE_TYPES = new Set<string>([
  "steel", "ductile_iron", "rcp", "cpcp", "upvc",
  "pe2", "pe3_pe100", "wdpe1", "wdpe2", "wdpe3", "wdpe4", "wdpe5",
  "grp_fw", "gfpe",
]);

const VALID_NODE_TYPES = new Set<string>([
  "reservoir", "junction", "tank", "pump_node", "valve_node",
]);

function parsePipes(rows: Record<string, unknown>[], errors: ParseError[]): Pipe[] {
  const pipes: Pipe[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const rowNum = i + 2; // ヘッダー行を1とした場合

    const id = str(row["pipe_id"] ?? row["管路ID"]);
    if (!id) continue; // 空行はスキップ

    const pipeTypeRaw = str(row["pipe_type"] ?? row["管種"]).toLowerCase();
    if (!VALID_PIPE_TYPES.has(pipeTypeRaw)) {
      errors.push({ sheet: "network", row: rowNum, field: "pipe_type", message: `不明な管種コード: "${pipeTypeRaw}"` });
    }

    const pipe: Pipe = {
      id,
      startNodeId: str(row["start_node"] ?? row["始点節点ID"]),
      endNodeId: str(row["end_node"] ?? row["終点節点ID"]),
      pipeType: (VALID_PIPE_TYPES.has(pipeTypeRaw) ? pipeTypeRaw : "ductile_iron") as PipeType,
      innerDiameter: requireNum(row["inner_diameter"] ?? row["管内径 D"], "管内径 D", errors, "network", rowNum),
      wallThickness: requireNum(row["wall_thickness"] ?? row["管厚 t"], "管厚 t", errors, "network", rowNum),
      length: requireNum(row["length"] ?? row["管路延長 L"], "管路延長 L", errors, "network", rowNum),
      roughnessCoeff: requireNum(row["roughness_coeff"] ?? row["粗度係数"], "粗度係数", errors, "network", rowNum),
    };
    const pipeName = str(row["pipe_name"] ?? row["管路名"]);
    if (pipeName) pipe.name = pipeName;
    const Es = num(row["youngs_modulus"] ?? row["ヤング係数 Eₛ"]);
    if (Es !== undefined) pipe.youngsModulus = Es;
    const c1 = num(row["c1_coeff"] ?? row["埋設状況係数 C₁"]);
    if (c1 !== undefined) pipe.c1Coeff = c1;
    pipes.push(pipe);
  }
  return pipes;
}

function parseNodes(rows: Record<string, unknown>[], errors: ParseError[]): Node[] {
  const nodes: Node[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const rowNum = i + 2;

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

function parseNetwork(wb: XLSX.WorkBook, errors: ParseError[]): { pipes: Pipe[]; nodes: Node[] } {
  const ws = wb.Sheets["管路・節点"] ?? wb.Sheets["network"];
  if (!ws) {
    errors.push({ sheet: "network", message: "「管路・節点」シートが見つかりません" });
    return { pipes: [], nodes: [] };
  }

  const allRows = sheetToRows(ws);

  // 「テーブル種別」列で pipes / nodes を分離
  // 仕様: 各行に "table" 列があり値が "pipe" または "node"
  const pipeRows = allRows.filter((r) => {
    const t = str(r["table"] ?? r["テーブル"]).toLowerCase();
    return t === "pipe" || r["pipe_id"] != null || r["管路ID"] != null;
  });
  const nodeRows = allRows.filter((r) => {
    const t = str(r["table"] ?? r["テーブル"]).toLowerCase();
    return t === "node" || r["node_id"] != null || r["節点ID"] != null;
  });

  return {
    pipes: parsePipes(pipeRows, errors),
    nodes: parseNodes(nodeRows, errors),
  };
}

// ─── cases シート ──────────────────────────────────────────────────────────────

const VALID_OPERATION_TYPES = new Set<string>([
  "valve_close", "valve_open", "pump_stop", "pump_start", "combined",
]);

function parseCases(wb: XLSX.WorkBook, errors: ParseError[]): CalculationCase[] {
  const ws = wb.Sheets["ケース設定"] ?? wb.Sheets["cases"];
  if (!ws) {
    errors.push({ sheet: "cases", message: "「ケース設定」シートが見つかりません" });
    return [];
  }

  const rows = sheetToRows(ws);
  const cases: CalculationCase[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const rowNum = i + 2;

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
      targetFacilityId: str(row["target_facility_id"] ?? row["対象施設ID"]),
      initialVelocity: requireNum(row["initial_flow"] ?? row["初期流速 V₀"], "初期流速 V₀", errors, "cases", rowNum),
      initialHead: requireNum(row["initial_head"] ?? row["初期圧力水頭 H₀"], "初期圧力水頭 H₀", errors, "cases", rowNum),
    };
    const desc = str(row["description"] ?? row["説明"]);
    if (desc) cas.description = desc;
    cases.push(cas);
  }

  return cases;
}

// ─── メイン ──────────────────────────────────────────────────────────────────

/**
 * Excel ワークブックを ArrayBuffer から読み取り、ドメインオブジェクトに変換する。
 *
 * ブラウザ環境: `file.arrayBuffer()` で取得した ArrayBuffer を渡す
 * Node.js 環境: `fs.readFileSync(path)` の Buffer を渡す
 */
export function parseWorkbook(buffer: ArrayBuffer | Buffer): ParseResult {
  const errors: ParseError[] = [];
  const warnings: string[] = [];

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  } catch (e) {
    errors.push({ sheet: "(global)", message: `ファイルの読み取りに失敗しました: ${e}` });
    return {
      data: { meta: { projectName: "", standardId: "" }, pipes: [], nodes: [], cases: [] },
      errors,
      warnings,
    };
  }

  const meta = parseMeta(wb, errors);
  const { pipes, nodes } = parseNetwork(wb, errors);
  const cases = parseCases(wb, errors);

  if (pipes.length === 0) {
    warnings.push("管路データが0件です。networkシートを確認してください。");
  }

  return {
    data: { meta, pipes, nodes, cases },
    errors,
    warnings,
  };
}
