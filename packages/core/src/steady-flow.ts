/**
 * 定常流水理計算
 * 出典: 土地改良設計基準　設計「パイプライン」技術書（令和3年6月改訂）第5章・第6章
 *
 * Darcy-Weisbach 式および Hazen-Williams 式による摩擦損失水頭の算定
 */

import { GRAVITY } from "./formulas.js";

// ─── 型定義 ──────────────────────────��─────────────────────────────��─────────

export interface SteadyFlowInput {
  /** 管内径 D [m] */
  innerDiameter: number;
  /** 管路延長 L [m] */
  length: number;
  /** 設計流量 Q [m³/s] */
  flowRate: number;
  /** 上流側標高 [m] */
  upstreamElevation: number;
  /** 下流側標高 [m] */
  downstreamElevation: number;
}

export interface DarcyWeisbachInput extends SteadyFlowInput {
  /** 摩擦損失係数 f [-]（Moody 線図等から） */
  frictionFactor: number;
}

export interface HazenWilliamsInput extends SteadyFlowInput {
  /** Hazen-Williams 粗度係数 C [-] */
  roughnessC: number;
}

export interface SteadyFlowResult {
  /** 管内断面積 A [m²] */
  area: number;
  /** 平均流速 V [m/s] */
  velocity: number;
  /** 摩擦損失水頭 hf [m] */
  frictionLoss: number;
  /** 動水勾配 I [-] = hf / L */
  hydraulicGradient: number;
  /** 高低差（上流 - 下流）[m] */
  elevationDiff: number;
  /** 必要全揚程（摩擦損失 + 高低差）[m]（負なら自然流下で余裕あり） */
  totalHead: number;
  /** 速度水頭 V²/2g [m] */
  velocityHead: number;
  /** 使用した計算手法 */
  method: "darcy-weisbach" | "hazen-williams";
  warnings: string[];
}

// ─── Darcy-Weisbach 式 ─────────────────────────────────���────────────────────

/**
 * Darcy-Weisbach 式による摩擦損失水頭
 *
 *   hf = f × (L / D) × (V² / 2g)
 *
 * @param input 管路諸元・流量・摩擦損失係数
 */
export function calcDarcyWeisbach(input: DarcyWeisbachInput): SteadyFlowResult {
  const { innerDiameter: D, length: L, flowRate: Q, frictionFactor: f,
          upstreamElevation, downstreamElevation } = input;
  const warnings: string[] = [];

  const A = Math.PI * D * D / 4;
  const V = Q / A;
  const velocityHead = V * V / (2 * GRAVITY);
  const hf = f * (L / D) * velocityHead;
  const I = hf / L;
  const elevationDiff = downstreamElevation - upstreamElevation;
  const totalHead = hf + elevationDiff;

  if (V < 0.5) warnings.push(`流速 ${V.toFixed(2)} m/s は推奨下限 0.5 m/s を下回っています。`);
  if (V > 2.5) warnings.push(`流速 ${V.toFixed(2)} m/s は推奨上限 2.5 m/s を超えています。管径の拡大を検討してください。`);

  return { area: A, velocity: V, frictionLoss: hf, hydraulicGradient: I,
           elevationDiff, totalHead, velocityHead, method: "darcy-weisbach", warnings };
}

// ─── Hazen-Williams 式 ──────────────────────────────────────────────��───────

/**
 * Hazen-Williams 式による摩擦損失水頭
 *
 *   V = 0.84935 × C × R^0.63 × I^0.54
 *   → I = (V / (0.84935 × C × R^0.63))^(1/0.54)
 *   → hf = I × L
 *
 * @param input 管路諸元・流量・粗度係数 C
 */
export function calcHazenWilliams(input: HazenWilliamsInput): SteadyFlowResult {
  const { innerDiameter: D, length: L, flowRate: Q, roughnessC: C,
          upstreamElevation, downstreamElevation } = input;
  const warnings: string[] = [];

  const A = Math.PI * D * D / 4;
  const V = Q / A;
  const R = D / 4; // 円管の動水半径 = D/4
  const I = Math.pow(V / (0.84935 * C * Math.pow(R, 0.63)), 1 / 0.54);
  const hf = I * L;
  const velocityHead = V * V / (2 * GRAVITY);
  const elevationDiff = downstreamElevation - upstreamElevation;
  const totalHead = hf + elevationDiff;

  if (V < 0.5) warnings.push(`流速 ${V.toFixed(2)} m/s は推奨下限 0.5 m/s を下回っています。`);
  if (V > 2.5) warnings.push(`流速 ${V.toFixed(2)} m/s は推奨上限 2.5 m/s を超えています。管径の拡大を検討してください。`);

  return { area: A, velocity: V, frictionLoss: hf, hydraulicGradient: I,
           elevationDiff, totalHead, velocityHead, method: "hazen-williams", warnings };
}
