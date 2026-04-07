/**
 * 縦断水理計算エンジン
 * 出典: 農水省 成果品様式「計画最大流量時の水理計算書」
 *       土地改良設計基準 設計「パイプライン」技術書（令和3年6月改訂）§5
 *
 * 測点ベースで上流→下流に損失を累積し、各測点のエネルギー標高・動水位・静水圧・設計内圧を算出。
 */

import { GRAVITY, headToMpa } from "./formulas.js";
import type {
  MeasurementPoint,
  MeasurementPointResult,
  LongitudinalHydraulicInput,
  LongitudinalHydraulicResult,
} from "./types.js";

// ─── 局部損失計算 ────────────────────────────────────────────────────────────

/**
 * 局部損失係数の合計 Σf [-]
 *
 * Σf = fb + fv + fβ
 */
export function calcTotalLossCoeff(point: MeasurementPoint): number {
  return point.bendLossCoeff + point.valveLossCoeff + point.branchLossCoeff;
}

/**
 * 局部損失水頭 Σhc [m]
 *
 * Σhc = Σf × V²/2g + その他損失
 *
 * @param totalLossCoeff Σf [-]
 * @param velocityHead V²/2g [m]
 * @param otherLoss その他損失 [m]（直接入力）
 */
export function calcMinorLoss(
  totalLossCoeff: number,
  velocityHead: number,
  otherLoss: number,
): number {
  return totalLossCoeff * velocityHead + otherLoss;
}

// ─── 1測点の摩擦損失 ────────────────────────────────────────────────────────

/**
 * Hazen-Williams 式で1区間の摩擦損失水頭を算定
 *
 * V = 0.84935 × C × R^0.63 × I^0.54
 * → I = (V / (0.84935 × C × R^0.63))^(1/0.54)
 * → hf = I × SL
 *
 * @param diameter D [m]
 * @param roughnessC Hazen-Williams C
 * @param velocity V [m/s]
 * @param pipeLength SL [m]（実延長）
 * @returns { hydraulicGradient: I [‰に非ず、無次元], frictionLoss: hf [m] }
 */
export function calcSegmentFriction(
  diameter: number,
  roughnessC: number,
  velocity: number,
  pipeLength: number,
): { hydraulicGradient: number; frictionLoss: number } {
  const R = diameter / 4;
  const I = Math.pow(velocity / (0.84935 * roughnessC * Math.pow(R, 0.63)), 1 / 0.54);
  const hf = I * pipeLength;
  return { hydraulicGradient: I, frictionLoss: hf };
}

// ─── 縦断水理計算 ────────────────────────────────────────────────────────────

/**
 * 縦断水理計算（メイン関数）
 *
 * 上流から下流に向かって各測点の損失を累積し、
 * エネルギー標高 EL・動水位 WLm・動水頭 hm・静水圧 Ps・水撃圧 Pi・設計内圧 Pp を算出する。
 *
 * 初期エネルギー標高 = 静水位（水槽 HWL）
 * 各測点: EL = 前測点EL - 全損失水頭 h
 *         WLm = EL - 速度水頭 hv
 *         hm = WLm - 管中心高 FH
 *         Ps = hm × w₀ / 1000 [MPa]
 *         Pi = 入力指定値 or Ps × 割合
 *         Pp = Ps + Pi
 */
export function calcLongitudinalHydraulic(
  input: LongitudinalHydraulicInput,
): LongitudinalHydraulicResult {
  const { points, staticWaterLevel, waterhammerPressureMpa, waterhammerRatio } = input;
  const caseName = input.caseName ?? "計画最大流量";
  const warnings: string[] = [];
  const pointResults: MeasurementPointResult[] = [];

  if (points.length === 0) {
    return { caseName, staticWaterLevel, pointResults, maxVelocity: 0, maxDesignPressure: 0, warnings: ["測点データがありません"] };
  }

  let maxVelocity = 0;
  let maxDesignPressure = 0;
  // 初期エネルギー標高 = 静水位
  let prevEL = staticWaterLevel;

  for (let i = 0; i < points.length; i++) {
    const pt = points[i]!;

    // 断面積・流速
    const A = Math.PI * pt.diameter * pt.diameter / 4;
    const V = pt.flowRate / A;
    const hv = V * V / (2 * GRAVITY);

    // 摩擦損失
    const { hydraulicGradient, frictionLoss: hf } = calcSegmentFriction(
      pt.diameter, pt.roughnessC, V, pt.pipeLength,
    );

    // 局部損失
    const totalLossCoeff = calcTotalLossCoeff(pt);
    const minorLoss = calcMinorLoss(totalLossCoeff, hv, pt.otherLoss ?? 0);

    // 全損失水頭
    const totalLoss = hf + minorLoss;

    // エネルギー標高（最初の測点は始点: 損失0とするか、最初の区間分を減じるか）
    // 公式帳票では各測点が「その区間の下流端」を表す → 区間損失分を減じる
    const EL = prevEL - totalLoss;

    // 動水位 = エネルギー標高 - 速度水頭
    const WLm = EL - hv;

    // 動水頭 = 動水位 - 管中心高
    const hm = WLm - pt.pipeCenterHeight;

    // 静水圧 [MPa] = 動水頭 × w₀ / 1000
    const Ps = headToMpa(hm);

    // 水撃圧 [MPa]
    let Pi: number;
    if (waterhammerPressureMpa !== undefined) {
      Pi = waterhammerPressureMpa;
    } else if (waterhammerRatio !== undefined) {
      Pi = Ps * waterhammerRatio;
    } else {
      Pi = Ps * 0.4; // デフォルト: 静水圧×40%（経験則の一般的な目安）
      if (i === 0) {
        warnings.push("水撃圧が未指定のため、静水圧×40%で仮算定しています。別途水撃圧計算（Step 2〜4）の結果を適用してください。");
      }
    }

    // 設計内圧 [MPa]
    const Pp = Ps + Pi;

    // 警告
    if (V < 0.5) {
      warnings.push(`${pt.id}: 流速 ${V.toFixed(2)} m/s は推奨下限 0.5 m/s を下回っています`);
    }
    if (V > 2.5) {
      warnings.push(`${pt.id}: 流速 ${V.toFixed(2)} m/s は推奨上限 2.5 m/s を超えています`);
    }
    if (hm < 0) {
      warnings.push(`${pt.id}: 動水頭 ${hm.toFixed(2)} m が負圧です。管路が動水位を超えています`);
    }

    maxVelocity = Math.max(maxVelocity, V);
    maxDesignPressure = Math.max(maxDesignPressure, Pp);

    pointResults.push({
      pointId: pt.id,
      hydraulicGradient,
      velocity: V,
      velocityHead: hv,
      frictionLoss: hf,
      totalLossCoeff,
      minorLoss,
      totalLoss,
      energyLevel: EL,
      hydraulicGradeLine: WLm,
      pressureHead: hm,
      staticPressure: Ps,
      waterhammerPressure: Pi,
      designPressure: Pp,
    });

    prevEL = EL;
  }

  return {
    caseName,
    staticWaterLevel,
    pointResults,
    maxVelocity,
    maxDesignPressure,
    warnings,
  };
}
