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
 * Hazen-Williams 式で1区間の摩擦損失水頭を算定（技術書 式7.2.2）
 *
 * V = 0.849 × C × R^0.63 × I^0.54
 * → I = (V / (0.849 × C × R^0.63))^(1/0.54)
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
  const I = Math.pow(velocity / (0.849 * roughnessC * Math.pow(R, 0.63)), 1 / 0.54);
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
  // 同じ内容の警告を測点ごとに積まないためのフラグ（31測点なら31行出てしまう）。
  let provisionalWaterhammerReported = false;
  let negativeStaticPressureReported = false;
  const slowPoints: string[] = [];
  const fastPoints: string[] = [];
  const negativeHeadPoints: Array<{ id: string; head: number }> = [];
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
    //
    // 静水圧に比例させる指定（waterhammerRatio・既定の 40%）は正圧を前提にした経験則なので、
    // Ps <= 0 の測点に適用すると水撃圧・設計内圧まで負値になる。そこでは算定せず undefined を
    // 返し、帳票では「—」として空欄にする。waterhammerPressureMpa で絶対値を与えた場合は
    // 設計者が明示した値なので、静水圧の符号によらずそのまま使う。
    let Pi: number | undefined;
    if (waterhammerPressureMpa !== undefined) {
      Pi = waterhammerPressureMpa;
    } else if (Ps <= 0) {
      Pi = undefined;
      if (!negativeStaticPressureReported) {
        negativeStaticPressureReported = true;
        warnings.push("静水圧が0以下の測点があるため、その区間の水撃圧・設計内圧は算定していません。水撃圧をMPaで直接指定するか、管路計画を見直してください。");
      }
    } else if (waterhammerRatio !== undefined) {
      Pi = Ps * waterhammerRatio;
    } else {
      Pi = Ps * 0.4; // デフォルト: 静水圧×40%（経験則の一般的な目安）
      if (!provisionalWaterhammerReported) {
        provisionalWaterhammerReported = true;
        warnings.push("水撃圧が未指定のため、静水圧×40%で仮算定しています。別途水撃圧計算（Step 2〜4）の結果を適用してください。");
      }
    }

    // 設計内圧 [MPa]
    const Pp = Pi === undefined ? undefined : Ps + Pi;

    // 警告は測点ごとに積まず、ループ後にまとめて1行にする（31測点で31行出ると読めない）。
    if (V < 0.5) slowPoints.push(pt.id);
    if (V > 2.5) fastPoints.push(pt.id);
    if (hm < 0) negativeHeadPoints.push({ id: pt.id, head: hm });

    maxVelocity = Math.max(maxVelocity, V);
    if (Pp !== undefined) maxDesignPressure = Math.max(maxDesignPressure, Pp);

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

  if (slowPoints.length > 0) {
    warnings.push(`流速が推奨下限 0.5 m/s を下回る測点が ${slowPoints.length} 件あります（${summarizeIds(slowPoints)}）。`);
  }
  if (fastPoints.length > 0) {
    warnings.push(`流速が推奨上限 2.5 m/s を超える測点が ${fastPoints.length} 件あります（${summarizeIds(fastPoints)}）。管径の拡大を検討してください。`);
  }
  if (negativeHeadPoints.length > 0) {
    const worst = negativeHeadPoints.reduce((a, b) => (b.head < a.head ? b : a));
    warnings.push(`動水頭が負圧の測点が ${negativeHeadPoints.length} 件あります（最小 ${worst.id} で ${worst.head.toFixed(2)} m）。管路が動水位を超えています。水柱分離の検討が必要です。`);
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

/** 警告文に測点IDを並べる。件数が多いときは先頭3件＋「ほかN件」に丸める。 */
function summarizeIds(ids: string[]): string {
  return ids.length <= 3 ? ids.join(", ") : `${ids.slice(0, 3).join(", ")} ほか${ids.length - 3}件`;
}
