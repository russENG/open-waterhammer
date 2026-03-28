/**
 * Excel帳票テンプレート生成
 * デモケースを初期値として入力済みテンプレートを出力する
 */

import * as XLSX from "xlsx";
import type { Pipe, Node, CalculationCase } from "@open-waterhammer/core";
import type { ProjectMeta } from "./types.js";

interface TemplateOptions {
  meta?: Partial<ProjectMeta>;
  pipes?: Pipe[];
  nodes?: Node[];
  cases?: CalculationCase[];
}

// ─── シート生成ヘルパー ───────────────────────────────────────────────────────

function makeMetaSheet(meta: Partial<ProjectMeta>): XLSX.WorkSheet {
  const rows = [
    ["フィールドID", "値", "説明"],
    ["project_name", meta.projectName ?? "", "案件名（必須）"],
    ["designer", meta.designer ?? "", "設計者名"],
    ["date", meta.date ?? new Date().toISOString().slice(0, 10), "設計年月日"],
    ["standard_id", meta.standardId ?? "nochi_pipeline_2021", "採用基準ID"],
    ["version", meta.version ?? "0.0.1", "ソフトウェアバージョン（自動）"],
    ["method_id", meta.methodId ?? "joukowsky_v1", "手法識別子"],
    ["notes", meta.notes ?? "", "備考"],
  ];
  return XLSX.utils.aoa_to_sheet(rows);
}

function makePipeRows(pipes: Pipe[]): unknown[][] {
  const header = [
    "テーブル", "pipe_id", "pipe_name",
    "start_node", "end_node", "pipe_type",
    "inner_diameter", "wall_thickness", "length",
    "roughness_coeff", "youngs_modulus", "c1_coeff",
  ];
  const dataRows = pipes.map((p) => [
    "pipe", p.id, p.name ?? "",
    p.startNodeId, p.endNodeId, p.pipeType,
    p.innerDiameter, p.wallThickness, p.length,
    p.roughnessCoeff, p.youngsModulus ?? "", p.c1Coeff ?? "",
  ]);
  return [header, ...dataRows];
}

function makeNodeRows(nodes: Node[]): unknown[][] {
  const header = [
    "テーブル", "node_id", "node_name",
    "elevation", "node_type", "hydraulic_grade",
  ];
  const dataRows = nodes.map((n) => [
    "node", n.id, n.name ?? "",
    n.elevation, n.nodeType, n.hydraulicGrade ?? "",
  ]);
  return [header, ...dataRows];
}

function makeNetworkSheet(pipes: Pipe[], nodes: Node[]): XLSX.WorkSheet {
  const rows: unknown[][] = [
    // --- 管路テーブル ---
    ["# 管路区間（Pipe）"],
    ...makePipeRows(pipes),
    [],
    // --- 節点テーブル ---
    ["# 節点（Node）"],
    ...makeNodeRows(nodes),
  ];
  return XLSX.utils.aoa_to_sheet(rows);
}

function makeCasesSheet(cases: CalculationCase[]): XLSX.WorkSheet {
  const header = [
    "case_id", "case_name", "description",
    "operation_type", "target_facility_id",
    "initial_flow", "initial_head",
  ];
  const dataRows = cases.map((c) => [
    c.id, c.name, c.description ?? "",
    c.operationType, c.targetFacilityId,
    c.initialVelocity, c.initialHead,
  ]);
  return XLSX.utils.aoa_to_sheet([header, ...dataRows]);
}

function makeInstructionSheet(): XLSX.WorkSheet {
  const rows = [
    ["open-waterhammer 入力帳票"],
    [""],
    ["■ シート構成"],
    ["案件情報", "プロジェクト名・採用基準などのメタ情報"],
    ["管路・節点", "管路区間と節点の諸元（Pipeテーブル・Nodeテーブル）"],
    ["ケース設定", "計算ケースの一覧（操作種別・初期条件）"],
    [""],
    ["■ 管種コード一覧（pipe_type 欄に入力）"],
    ["steel", "鋼管"],
    ["ductile_iron", "ダクタイル鋳鉄管"],
    ["rcp", "遠心力鉄筋コンクリート管"],
    ["cpcp", "コア式PCCP管"],
    ["upvc", "硬質塩ビ管"],
    ["pe2", "一般用PE管（2種）"],
    ["pe3_pe100", "一般用PE管（3種 PE100）"],
    ["wdpe1〜wdpe5", "水道配水用PE管 1〜5種"],
    ["grp_fw", "FW成形強化プラスチック複合管"],
    ["gfpe", "GF強化ポリエチレン管"],
    [""],
    ["■ 単位"],
    ["inner_diameter（管内径）", "m"],
    ["wall_thickness（管厚）", "m"],
    ["length（管路延長）", "m"],
    ["initial_flow（初期流速）", "m/s"],
    ["initial_head（初期圧力水頭）", "m"],
    [""],
    ["準拠: 土地改良設計基準パイプライン（令和3年6月改訂）"],
    ["ライセンス: AGPL-3.0-or-later"],
  ];
  return XLSX.utils.aoa_to_sheet(rows);
}

// ─── メイン ──────────────────────────────────────────────────────────────────

/**
 * Excel テンプレートを ArrayBuffer として生成する。
 *
 * ブラウザでのダウンロード例:
 * ```typescript
 * const buf = generateTemplate({ meta, pipes, nodes, cases });
 * const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
 * const url = URL.createObjectURL(blob);
 * const a = document.createElement("a");
 * a.href = url;
 * a.download = "waterhammer-input.xlsx";
 * a.click();
 * ```
 */
export function generateTemplate(options: TemplateOptions = {}): ArrayBuffer {
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, makeInstructionSheet(), "使い方");
  XLSX.utils.book_append_sheet(wb, makeMetaSheet(options.meta ?? {}), "案件情報");
  XLSX.utils.book_append_sheet(wb, makeNetworkSheet(options.pipes ?? [], options.nodes ?? []), "管路・節点");
  XLSX.utils.book_append_sheet(wb, makeCasesSheet(options.cases ?? []), "ケース設定");

  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
