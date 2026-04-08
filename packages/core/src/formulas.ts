/**
 * 水撃圧計算 基礎式
 * 出典: 土地改良設計基準パイプライン技術書 第8章
 *
 * 各関数は入力・出力・適用条件を明示し、
 * 適用範囲外の場合はエラーまたは警告を返す。
 */

import type { Pipe, WaveSpeedResult, ClosureType, PipelineSystemType, EmpiricalWaterhammerResult } from "./types.js";
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
 * 技術書 式(8.2.6): α = t₀ / T₀ （T₀ = 4L/a）
 * 物理的判定: tν ≤ 2L/a で急閉そく（往復時間内に操作が完了）
 *           ⇔ α ≤ 0.5
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
  const T0 = (4 * pipeLength) / waveSpeed;
  const alpha = closeTime / T0; // 技術書 式(8.2.6)

  if (alpha <= 0.5) {
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
 * K₁ = (L·V) / (g·H₀·tν)
 *   技術書 式(8.3.7) 直下の定義に従う。
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
 * Hmax/H₀ = K₁/2 + √(K₁²/4 + K₁)
 *
 * 適用条件: tν > 2L/a かつ tν > L/300
 *
 * @param staticHead H₀ [m]
 * @param k1 K₁ 値
 * @returns 最大水撃圧水頭 Hmax [m]
 */
export function allieviClose(staticHead: number, k1: number): number {
  return staticHead * (k1 / 2 + Math.sqrt((k1 * k1) / 4 + k1));
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
  return staticHead * (k1 / 2 - Math.sqrt((k1 * k1) / 4 + k1));
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

// ─── 経験則による水撃圧 ──────────────────────────────────────────────────────

/**
 * 経験則による水撃圧算定 (技術書 8.3.5節)
 *
 * 適用範囲: 給水栓を有する水田用配水系パイプラインで
 *           静水圧 0.35MPa 未満、またはオープンタイプの場合のみ推奨。
 *           その他の場合は計算による方法（ジューコフスキー/アリエビ）を原則とする。
 *
 * @param systemType パイプライン系統の方式区分
 * @param staticPressureMpa 静水圧 [MPa]（自然圧送・ポンプ直送・圧力タンク方式で使用）
 * @param operatingPressureMpa 通水時水圧（動水圧）[MPa]（配水槽方式で使用）
 * @param hydraulicGradePressureMpa 動水勾配線水圧 [MPa]（オープンタイプで使用）
 */
export function calcEmpiricalWaterhammer(
  systemType: PipelineSystemType,
  staticPressureMpa: number,
  operatingPressureMpa?: number,
  hydraulicGradePressureMpa?: number,
): EmpiricalWaterhammerResult {
  const warnings: string[] = [];
  let waterhammerMpa: number;
  let rule: string;

  switch (systemType) {
    // ── 自然圧送 オープンタイプ ─────────────────────────────────────────────
    case "gravity_open": {
      const hgp = hydraulicGradePressureMpa ?? staticPressureMpa;
      if (hydraulicGradePressureMpa === undefined) {
        warnings.push("動水勾配線水圧が未指定のため静水圧で代用しています。正確な計算には動水勾配線水圧を入力してください。");
      }
      waterhammerMpa = hgp * 0.20;
      rule = `オープンタイプ: 動水勾配線水圧 ${hgp.toFixed(3)} MPa × 20% = ${waterhammerMpa.toFixed(3)} MPa`;
      break;
    }

    // ── 自然圧送 クローズド / セミ・クローズドタイプ ───────────────────────
    // §8.3.5 a.② は両タイプを同一式で扱う
    case "gravity_closed":
    case "gravity_semi_closed": {
      const typeLabel = systemType === "gravity_closed" ? "クローズド" : "セミ・クローズド";
      if (staticPressureMpa < 0.35) {
        waterhammerMpa = staticPressureMpa * 1.0;
        rule = `${typeLabel}（静水圧 < 0.35MPa）: 静水圧 ${staticPressureMpa.toFixed(3)} MPa × 100% = ${waterhammerMpa.toFixed(3)} MPa`;
      } else {
        waterhammerMpa = Math.max(staticPressureMpa * 0.40, 0.35);
        rule = `${typeLabel}（静水圧 ≥ 0.35MPa）: max(${staticPressureMpa.toFixed(3)} × 40%, 0.35) = ${waterhammerMpa.toFixed(3)} MPa`;
      }
      break;
    }

    // ── ポンプ系 配水槽方式 ─────────────────────────────────────────────────
    case "pump_distribution_tank": {
      const op = operatingPressureMpa ?? staticPressureMpa;
      if (operatingPressureMpa === undefined) {
        warnings.push("通水時水圧（動水圧）が未指定のため静水圧で代用しています。");
      }
      if (op < 0.45) {
        waterhammerMpa = op * 1.0;
        rule = `配水槽方式（通水圧 < 0.45MPa）: 通水圧 ${op.toFixed(3)} MPa × 100% = ${waterhammerMpa.toFixed(3)} MPa`;
      } else {
        waterhammerMpa = Math.max(op * 0.60, 0.45);
        rule = `配水槽方式（通水圧 ≥ 0.45MPa）: max(${op.toFixed(3)} × 60%, 0.45) = ${waterhammerMpa.toFixed(3)} MPa`;
      }
      break;
    }

    // ── ポンプ系 直送方式 ───────────────────────────────────────────────────
    case "pump_direct": {
      if (staticPressureMpa < 0.45) {
        waterhammerMpa = staticPressureMpa * 1.0;
        rule = `ポンプ直送（静水圧 < 0.45MPa）: 静水圧 ${staticPressureMpa.toFixed(3)} MPa × 100% = ${waterhammerMpa.toFixed(3)} MPa`;
      } else {
        waterhammerMpa = Math.max(staticPressureMpa * 0.60, 0.45);
        rule = `ポンプ直送（静水圧 ≥ 0.45MPa）: max(${staticPressureMpa.toFixed(3)} × 60%, 0.45) = ${waterhammerMpa.toFixed(3)} MPa`;
      }
      break;
    }

    // ── ポンプ系 圧力タンク方式 ─────────────────────────────────────────────
    case "pump_pressure_tank": {
      if (staticPressureMpa < 0.35) {
        waterhammerMpa = staticPressureMpa * 1.0;
        rule = `圧力タンク（静水圧 < 0.35MPa）: 静水圧 ${staticPressureMpa.toFixed(3)} MPa × 100% = ${waterhammerMpa.toFixed(3)} MPa`;
      } else {
        waterhammerMpa = Math.max(staticPressureMpa * 0.40, 0.35);
        rule = `圧力タンク（静水圧 ≥ 0.35MPa）: max(${staticPressureMpa.toFixed(3)} × 40%, 0.35) = ${waterhammerMpa.toFixed(3)} MPa`;
      }
      break;
    }
  }

  return { waterhammerMpa, rule, warnings };
}

/** 水頭 [m] → 圧力 [MPa] 変換 */
export function headToMpa(headM: number): number {
  return (headM * WATER_UNIT_WEIGHT) / 1000;
}

/** 圧力 [MPa] → 水頭 [m] 変換 */
export function mpaToHead(pressureMpa: number): number {
  return (pressureMpa * 1000) / WATER_UNIT_WEIGHT;
}
