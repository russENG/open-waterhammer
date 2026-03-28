/**
 * 水撃圧計算 基礎式
 * 出典: 土地改良設計基準パイプライン技術書 第8章
 *
 * 各関数は入力・出力・適用条件を明示し、
 * 適用範囲外の場合はエラーまたは警告を返す。
 */

import type { Pipe, WaveSpeedResult, ClosureType } from "./types.js";
import { PIPE_MATERIALS } from "./pipe-materials.js";

/** 重力加速度 [m/s²] */
export const GRAVITY = 9.8;
/** 水の体積弾性係数 K [kN/m²]（基準書既定値） */
export const BULK_MODULUS_WATER = 2.03e6;
/** 水の単位体積重量 w₀ [kN/m³] */
export const WATER_UNIT_WEIGHT = 9.8;

// ─── 波速計算 ─────────────────────────────────────────────────────────────────

/**
 * 波速算定 (式 8.2.4)
 *
 * a = 1 / √( w₀/g × (1/K + D·C₁/(Eₛ·t)) )
 *
 * @param pipe 管路情報
 * @returns 波速 a [m/s]
 */
export function calcWaveSpeed(pipe: Pipe): number {
  const Es =
    pipe.youngsModulus ?? PIPE_MATERIALS[pipe.pipeType].youngsModulusShort;
  const c1 = pipe.c1Coeff ?? 1.0;
  const D = pipe.innerDiameter;
  const t = pipe.wallThickness;

  const term = (WATER_UNIT_WEIGHT / GRAVITY) * (1 / BULK_MODULUS_WATER + (D * c1) / (Es * t));
  return 1 / Math.sqrt(term);
}

/**
 * 圧力振動周期 T₀ (式 8.2.5)
 *
 * T₀ = 4L / a
 */
export function calcVibrationPeriod(pipeLength: number, waveSpeed: number): number {
  return (4 * pipeLength) / waveSpeed;
}

/**
 * 急/緩閉そく判定 + α値
 *
 * α = tν / (2L/a)
 * α ≦ 1: 急閉そく
 * α > 1: 緩閉そく（アリエビ適用条件をさらに確認）
 *
 * @param closeTime 等価閉そく時間 tν [s]
 * @param pipeLength 管路延長 L [m]
 * @param waveSpeed 波速 a [m/s]
 */
export function determineClosureType(
  closeTime: number,
  pipeLength: number,
  waveSpeed: number
): { closureType: ClosureType; alpha: number } {
  const roundTripTime = (2 * pipeLength) / waveSpeed;
  const alpha = closeTime / roundTripTime;

  if (alpha <= 1.0) {
    return { closureType: "rapid", alpha };
  }
  // tν > L/300 でない場合は数値解析が必要
  if (closeTime <= pipeLength / 300) {
    return { closureType: "numerical_required", alpha };
  }
  return { closureType: "slow", alpha };
}

/**
 * 波速計算結果をまとめて返す
 */
export function calcWaveSpeedResult(
  pipe: Pipe,
  closeTime: number
): WaveSpeedResult {
  const a = calcWaveSpeed(pipe);
  const T0 = calcVibrationPeriod(pipe.length, a);
  // α = t₀/T₀ (ここでは t₀ = closeTime で近似)
  const alpha = closeTime / T0;
  return { waveSpeed: a, vibrationPeriod: T0, alpha };
}

// ─── ジューコフスキーの式 ─────────────────────────────────────────────────────

/**
 * ジューコフスキーの式 (式 8.3.6)  — 急閉そく
 *
 * ΔH = -(a/g) × ΔV
 *
 * 適用条件: tν ≦ 2L/a
 *
 * @param waveSpeed 波速 a [m/s]
 * @param deltaV 流速変化 ΔV [m/s]（閉そくなら -V₀）
 * @returns 圧力上昇水頭 ΔH [m]（正で上昇、負で低下）
 */
export function joukowsky(waveSpeed: number, deltaV: number): number {
  return -(waveSpeed / GRAVITY) * deltaV;
}

// ─── アリエビの近似式 ─────────────────────────────────────────────────────────

/**
 * アリエビ式 K₁ 算定
 *
 * K₁ = (L·V) / (g·H₀·tν)²
 *   ※ 注: 基準書の表記は K₁ = (a·V₀) / (g·H₀) を別途使う流派もあるが
 *       本実装は技術書式(8.3.7)の形を採用
 */
export function calcAllieviK1(
  pipeLength: number,
  velocity: number,
  staticHead: number,
  closeTime: number
): number {
  return (pipeLength * velocity) / (GRAVITY * staticHead * closeTime);
}

/**
 * アリエビの近似式（閉操作時最大水撃圧）(式 8.3.7)
 *
 * Hmax = H₀/2 × (K₁ + √(K₁² + 4))
 *
 * 適用条件: tν > 2L/a かつ tν > L/300
 *
 * @param staticHead H₀ [m]
 * @param k1 K₁ 値
 * @returns 最大水撃圧水頭 Hmax [m]
 */
export function allieviClose(staticHead: number, k1: number): number {
  return (staticHead / 2) * (k1 + Math.sqrt(k1 * k1 + 4));
}

/**
 * アリエビの近似式（開操作時最大圧力低下）(式 8.3.8)
 *
 * Hmax = H₀/2 × (K₁ - √(K₁² + 4))
 *
 * @param staticHead H₀ [m]
 * @param k1 K₁ 値
 * @returns 最大圧力低下水頭 Hmax [m]（負値）
 */
export function allieviOpen(staticHead: number, k1: number): number {
  return (staticHead / 2) * (k1 - Math.sqrt(k1 * k1 + 4));
}

// ─── 多段口径管路の等価管路長 ────────────────────────────────────────────────

/**
 * 多段口径管路の等価管路長 (式 8.3.9)
 *
 * L = L₁ + L₂·(A₁/A₂) + L₃·(A₁/A₃) + ...
 *
 * @param segments 各区間 { length [m], area [m²] }
 * @returns 等価管路長 L [m]
 */
export function calcEquivalentLength(
  segments: Array<{ length: number; area: number }>
): number {
  if (segments.length === 0) return 0;
  const baseArea = segments[0]!.area;
  return segments.reduce(
    (sum, seg) => sum + seg.length * (baseArea / seg.area),
    0
  );
}

// ─── 設計水圧 ─────────────────────────────────────────────────────────────────

/**
 * 設計水圧 = 静水圧 + 水撃圧 (式 8.3.2)
 *
 * @param staticPressureMpa 静水圧 [MPa]
 * @param waterhammerPressureMpa 水撃圧 [MPa]
 * @returns 設計水圧 [MPa]
 */
export function calcDesignPressure(
  staticPressureMpa: number,
  waterhammerPressureMpa: number
): number {
  return staticPressureMpa + waterhammerPressureMpa;
}

// ─── 耐圧判定 ─────────────────────────────────────────────────────────────────

/**
 * 設計水圧と許容圧力を比較し判定する
 *
 * 判定基準:
 *   OK      : 設計水圧 ≦ 許容圧力 × 0.9（余裕度 ≧ 10%）
 *   WARNING : 設計水圧 ≦ 許容圧力（余裕度 < 10%）
 *   NG      : 設計水圧 > 許容圧力
 *
 * @param designPressureMpa 設計水圧 [MPa]
 * @param allowablePressureMpa 許容圧力（呼び圧力） [MPa]
 */
export function judgeDesignPressure(
  designPressureMpa: number,
  allowablePressureMpa: number
): import("./types.js").JudgementResult {
  const margin = (allowablePressureMpa - designPressureMpa) / allowablePressureMpa;

  let status: import("./types.js").JudgementStatus;
  let message: string;

  if (designPressureMpa > allowablePressureMpa) {
    status = "ng";
    message = `設計水圧 ${designPressureMpa.toFixed(3)} MPa が許容圧力 ${allowablePressureMpa.toFixed(3)} MPa を超過しています。管種・管厚・防護施設を見直してください。`;
  } else if (margin < 0.1) {
    status = "warning";
    message = `設計水圧が許容圧力の 90% 超です（余裕度 ${(margin * 100).toFixed(1)}%）。詳細検討を推奨します。`;
  } else {
    status = "ok";
    message = `設計水圧 ${designPressureMpa.toFixed(3)} MPa ≦ 許容圧力 ${allowablePressureMpa.toFixed(3)} MPa（余裕度 ${(margin * 100).toFixed(1)}%）`;
  }

  return { status, designPressureMpa, allowablePressureMpa, margin, message };
}

/** 水頭 [m] → 圧力 [MPa] 変換 */
export function headToMpa(headM: number): number {
  return (headM * WATER_UNIT_WEIGHT) / 1000;
}

/** 圧力 [MPa] → 水頭 [m] 変換 */
export function mpaToHead(pressureMpa: number): number {
  return (pressureMpa * 1000) / WATER_UNIT_WEIGHT;
}
