/**
 * Excel帳票テンプレート生成
 * デモケースを初期値として入力済みテンプレートを出力する
 */

import * as XLSX from "xlsx";
import type { Pipe, Node, CalculationCase, MeasurementPoint } from "@open-waterhammer/core";
import type { ProjectMeta } from "./types.js";

interface TemplateOptions {
  meta?: Partial<ProjectMeta>;
  pipes?: Pipe[];
  nodes?: Node[];
  cases?: CalculationCase[];
  measurementPoints?: MeasurementPoint[];
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
    "テーブル", "pipe_id\n(管路ID)", "pipe_name\n(管路名)",
    "start_node\n(始点節点)", "end_node\n(終点節点)", "pipe_type\n(管種コード)",
    "inner_diameter\n(内径 [m])", "wall_thickness\n(管厚 [m])", "length\n(延長 [m])",
    "roughness_coeff\n(粗度係数)", "youngs_modulus\n(ヤング係数 [kN/m²])", "c1_coeff\n(埋設状況係数)",
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
    "テーブル", "node_id\n(節点ID)", "node_name\n(節点名)",
    "elevation\n(標高 [m])", "node_type\n(節点種別)", "hydraulic_grade\n(動水位 [m])",
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
    "case_id\n(ケースID)", "case_name\n(ケース名)", "description\n(説明)",
    "operation_type\n(操作種別)", "target_facility_id\n(対象施設ID)",
    "initial_flow\n(初期流速 V₀ [m/s])", "initial_head\n(初期水頭 H₀ [m])",
  ];
  const dataRows = cases.map((c) => [
    c.id, c.name, c.description ?? "",
    c.operationType, c.targetFacilityId,
    c.initialVelocity, c.initialHead,
  ]);
  return XLSX.utils.aoa_to_sheet([header, ...dataRows]);
}

function makeMeasurementPointsSheet(points: MeasurementPoint[]): XLSX.WorkSheet {
  const header = [
    "point_id\n(測点ID)", "point_name\n(測点名)",
    "horizontal_distance\n(単距離 Lh [m])", "ground_level\n(地盤高 GL [m])", "pipe_center_height\n(管中心高 FH [m])",
    "pipe_length\n(管長 SL [m])", "flow_rate\n(流量 Q [m³/s])", "diameter\n(管径 D [m])", "roughness_c\n(流速係数 CI)",
    "bend_loss_coeff\n(湾曲損失係数 fb)", "valve_loss_coeff\n(バルブ損失係数 fv)", "branch_loss_coeff\n(直角分流損失係数 fβ)",
    "other_loss\n(その他損失 [m])",
  ];

  const dataRows = points.map((pt) => [
    pt.id, pt.name ?? "",
    pt.horizontalDistance, pt.groundLevel, pt.pipeCenterHeight,
    pt.pipeLength, pt.flowRate, pt.diameter, pt.roughnessC,
    pt.bendLossCoeff, pt.valveLossCoeff, pt.branchLossCoeff,
    pt.otherLoss ?? "",
  ]);

  const rows = [header, ...dataRows];
  return XLSX.utils.aoa_to_sheet(rows);
}

function makeInstructionSheet(): XLSX.WorkSheet {
  const rows = [
    ["open-waterhammer 入力帳票"],
    [""],
    ["■ シート構成"],
    ["案件情報", "プロジェクト名・採用基準などのメタ情報"],
    ["管路・節点", "管路区間と節点の諸元（Pipeテーブル・Nodeテーブル）"],
    ["測点データ", "水理計算書用の測点データ（成果品様式準拠）"],
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
    ["wdpe", "水道配水用PE管"],
    ["grp_fw1〜grp_fw5", "FW成形強化プラスチック複合管 1〜5種"],
    ["gfpe", "GF強化ポリエチレン管"],
    [""],
    ["■ 単位"],
    ["inner_diameter（管内径）", "m"],
    ["wall_thickness（管厚）", "m"],
    ["length（管路延長）", "m"],
    ["initial_flow（初期流速）", "m/s"],
    ["initial_head（初期圧力水頭）", "m"],
    [""],
    [""],
    ["■ 測点データの入力"],
    ["測点ID", "測点名称（IP点番号、No等）"],
    ["単距離 Lh", "前測点からの水平距離 [m]"],
    ["地盤高 GL", "地盤標高 [m]"],
    ["管中心高 FH", "管路中心の標高 [m]（= GL - 土被り - D/2）"],
    ["管長 SL", "実延長（斜距離）[m]"],
    ["流量 Q", "設計流量 [m³/s]"],
    ["管径 D", "管内径 [m]"],
    ["流速係数 CI", "Hazen-Williams 粗度係数 C"],
    ["湾曲損失係数 fb", "曲管・ベンド部の損失係数 [-]"],
    ["バルブ損失係数 fv", "バルブ・弁類の損失係数 [-]"],
    ["直角分流損失係数 fβ", "分水工の損失係数 [-]"],
    ["その他損失", "上記以外の局部損失水頭 [m]（直接入力）"],
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
  XLSX.utils.book_append_sheet(wb, makeMeasurementPointsSheet(options.measurementPoints ?? []), "測点データ");
  XLSX.utils.book_append_sheet(wb, makeCasesSheet(options.cases ?? []), "ケース設定");

  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
