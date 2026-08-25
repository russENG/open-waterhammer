/**
 * デモケース 01: 農業用パイプライン — バルブ急閉そく（ジューコフスキー式）
 *
 * 想定条件:
 *   - 農業用配水系、ダクタイル鋳鉄管、自然圧送
 *   - バルブ閉そく時間が短く急閉そく条件に該当
 *
 * このデモデータは初見ユーザーが計算結果をすぐ確認できるよう、
 * Excel入力なしで利用できる形で提供する。
 * Excelテンプレート（demo-case-01.xlsx）としてもダウンロード可能。
 */

import type { Pipe, Node, CalculationCase } from "@open-waterhammer/core";

export const DEMO_CASE_01_PIPE: Pipe = {
  id: "pipe-01",
  name: "幹線管路",
  startNodeId: "N1",
  endNodeId: "N2",
  pipeType: "ductile_iron",
  innerDiameter: 0.300,   // 300mm
  wallThickness: 0.007,   // 7mm
  length: 500,            // 500m
  roughnessCoeff: 130,    // ハーゼン・ウィリアムス C
  // youngsModulus: 管種から自動参照 (160×10⁶ kN/m²)
  // c1Coeff: デフォルト 1.0
};

/**
 * 節点。末端バルブ（N2）を標高 0 m の基準にとり、上流水槽（N1）の水面を
 * 標高 30 m に置くことで、バルブ位置の静水頭が H₀ = 30 m と一致する。
 */
export const DEMO_CASE_01_NODES: Node[] = [
  { id: "N1", name: "上流水槽", elevation: 30.0, nodeType: "reservoir", hydraulicGrade: 30.0 },
  { id: "N2", name: "末端バルブ", elevation: 0.0, nodeType: "valve_node" },
];

/** バルブ等価閉そく時間 [s] */
export const DEMO_CASE_01_CLOSE_TIME = 0.5;

export const DEMO_CASE_01_CASE: CalculationCase = {
  id: "case-01",
  name: "バルブ急閉そく",
  description: "末端バルブを急閉した場合の水撃圧（ジューコフスキー式適用）",
  operationType: "valve_close",
  targetFacilityId: "valve-01",
  initialVelocity: 1.0,   // V₀ = 1.0 m/s
  initialHead: 30.0,      // H₀ = 30.0 m（静水頭）
  closeTime: DEMO_CASE_01_CLOSE_TIME,
};

export const DEMO_CASE_01_DESCRIPTION = `
デモケース 01: バルブ急閉そく（農業用パイプライン）
────────────────────────────────────────────────
管種: ダクタイル鋳鉄管 φ300mm × t7mm × L=500m
初期流速: 1.0 m/s
静水頭: 30.0 m
バルブ閉そく時間: 0.5 s

適用基準: 土地改良設計基準パイプライン（令和3年6月改訂）
計算方法: ジューコフスキーの式（急閉そく）

期待される結果の概要:
  波速 a ≈ 1100 m/s 程度
  圧力波往復時間 2L/a ≈ 0.9 s → tν < 2L/a → 急閉そく
  ΔH = (a/g) × V₀ ≈ 110 m 程度の水撃圧上昇
`.trim();
