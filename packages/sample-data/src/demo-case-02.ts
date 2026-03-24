/**
 * デモケース 02: 農業用パイプライン — バルブ緩閉そく（アリエビ式）
 *
 * 急閉そくとの比較が目的。
 * 閉そく時間を長くとることで水撃圧がどの程度低減されるかを示す。
 */

import type { Pipe, CalculationCase } from "@open-waterhammer/core";

export const DEMO_CASE_02_PIPE: Pipe = {
  id: "pipe-01",
  name: "幹線管路",
  startNodeId: "N1",
  endNodeId: "N2",
  pipeType: "ductile_iron",
  innerDiameter: 0.300,
  wallThickness: 0.007,
  length: 500,
  roughnessCoeff: 130,
};

export const DEMO_CASE_02_CASE: CalculationCase = {
  id: "case-02",
  name: "バルブ緩閉そく",
  description: "末端バルブを緩やかに閉じた場合（アリエビ式適用）。急閉そくとの比較用。",
  operationType: "valve_close",
  targetFacilityId: "valve-01",
  initialVelocity: 1.0,
  initialHead: 30.0,
};

/** バルブ等価閉そく時間 [s]（急閉そくより十分に長い） */
export const DEMO_CASE_02_CLOSE_TIME = 10.0;

export const DEMO_CASE_02_DESCRIPTION = `
デモケース 02: バルブ緩閉そく（アリエビ式）
────────────────────────────────────────────────
管種: ダクタイル鋳鉄管 φ300mm × t7mm × L=500m
初期流速: 1.0 m/s
静水頭: 30.0 m
バルブ閉そく時間: 10.0 s（ケース01との比較）

適用基準: 土地改良設計基準パイプライン（令和3年6月改訂）
計算方法: アリエビの近似式（緩閉そく）

デモの目的: 閉そく時間を延ばすことで水撃圧を大幅に低減できることを確認。
`.trim();
