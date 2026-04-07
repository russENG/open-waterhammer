/**
 * デモケース 03: T字分岐管路網 — バルブ閉鎖（MOC特性曲線法）
 *
 * 想定条件:
 *   - 農業用配水系、ダクタイル鋳鉄管、自然圧送
 *   - 貯水槽(H=80m) → 幹線φ400×800m → T字分岐
 *     → 支線A φ300×500m → バルブA（閉鎖操作）
 *     → 支線B φ250×600m → バルブB（開放維持）
 *
 * このデモデータは管路網（分岐・合流）を含む水撃圧解析の検証用。
 * 単一管路（ケース01/02）との比較により、分岐の影響を確認できる。
 */

import type { Pipe } from "@open-waterhammer/core";
import type { MocNetwork, BoundaryCondition } from "@open-waterhammer/core";

export const DEMO_CASE_03_MAIN_PIPE: Pipe = {
  id: "main",
  name: "幹線管路",
  startNodeId: "reservoir",
  endNodeId: "junction",
  pipeType: "ductile_iron",
  innerDiameter: 0.4,
  wallThickness: 0.009,
  length: 800,
  roughnessCoeff: 130,
};

export const DEMO_CASE_03_BRANCH_A: Pipe = {
  id: "branch_a",
  name: "支線A",
  startNodeId: "junction",
  endNodeId: "valve_a",
  pipeType: "ductile_iron",
  innerDiameter: 0.3,
  wallThickness: 0.008,
  length: 500,
  roughnessCoeff: 130,
};

export const DEMO_CASE_03_BRANCH_B: Pipe = {
  id: "branch_b",
  name: "支線B",
  startNodeId: "junction",
  endNodeId: "valve_b",
  pipeType: "ductile_iron",
  innerDiameter: 0.25,
  wallThickness: 0.0075,
  length: 600,
  roughnessCoeff: 130,
};

export const DEMO_CASE_03_PIPES = [
  DEMO_CASE_03_MAIN_PIPE,
  DEMO_CASE_03_BRANCH_A,
  DEMO_CASE_03_BRANCH_B,
];

/** 初期流量 [m3/s] */
export const DEMO_CASE_03_FLOWS = {
  main: 0.16,
  branch_a: 0.10,
  branch_b: 0.06,
};

/** デフォルトのバルブA閉鎖時間 [s] */
export const DEMO_CASE_03_CLOSE_TIME_A = 2.0;

export const DEMO_CASE_03_DESCRIPTION = `
デモケース 03: T字分岐管路網（MOC特性曲線法）
────────────────────────────────────────────────
系統構成:
  貯水槽(H=80m) → 幹線φ400×L=800m → T字分岐
    → 支線A φ300×L=500m → バルブA（2秒閉鎖）
    → 支線B φ250×L=600m → バルブB（開放維持）

管種: 全てダクタイル鋳鉄管
初期流量: 幹線0.16 m3/s, 支線A 0.10 m3/s, 支線B 0.06 m3/s

検証ポイント:
  1. バルブA閉鎖時の水撃圧が分岐点を通じて支線Bにも伝播
  2. 閉鎖時間による水撃圧低減効果の比較
  3. 分岐管路での圧力包絡線の整理
`.trim();
