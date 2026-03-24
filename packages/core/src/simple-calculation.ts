/**
 * 簡易式計算エンジン
 * ジューコフスキー / アリエビ の実行と警告生成
 */

import type { Pipe, CalculationCase, SimpleFormulaResult } from "./types.js";
import {
  calcWaveSpeed,
  calcVibrationPeriod,
  determineClosureType,
  joukowsky,
  calcAllieviK1,
  allieviClose,
  allieviOpen,
  GRAVITY,
} from "./formulas.js";

export function runSimpleFormula(
  pipe: Pipe,
  cas: CalculationCase,
  closeTime: number
): SimpleFormulaResult {
  const warnings: string[] = [];

  // 1. 波速算定
  const a = calcWaveSpeed(pipe);
  const T0 = calcVibrationPeriod(pipe.length, a);
  const alpha = closeTime / T0;

  // 2. 急/緩閉そく判定
  const { closureType } = determineClosureType(closeTime, pipe.length, a);

  if (closureType === "numerical_required") {
    warnings.push(
      `tν (${closeTime}s) ≦ L/300 (${(pipe.length / 300).toFixed(3)}s) のため数値解析が必要です`
    );
  }

  // 3. 計算実行
  let deltaH_joukowsky: number | undefined;
  let hmax_allievi_close: number | undefined;
  let hmax_allievi_open: number | undefined;
  let k1: number | undefined;
  let allieviApplicable: boolean | undefined;

  if (closureType === "rapid") {
    // ジューコフスキーの式（閉操作: ΔV = -V₀）
    deltaH_joukowsky = joukowsky(a, -cas.initialVelocity);
  } else if (closureType === "slow") {
    // アリエビの近似式
    allieviApplicable = closeTime > pipe.length / 300;
    k1 = calcAllieviK1(pipe.length, cas.initialVelocity, cas.initialHead, closeTime);
    hmax_allievi_close = allieviClose(cas.initialHead, k1);
    hmax_allievi_open = allieviOpen(cas.initialHead, k1);

    if (!allieviApplicable) {
      warnings.push(
        "アリエビ式の適用条件 (tν > L/300) を満たしません。数値解析を推奨します。"
      );
    }
  }

  // 4. 負圧チェック
  if (hmax_allievi_open !== undefined && hmax_allievi_open < 0) {
    const minHead = cas.initialHead + hmax_allievi_open;
    if (minHead < 0) {
      warnings.push(
        `負圧が発生する可能性があります（最小水頭: ${minHead.toFixed(2)} m）。対策施設を検討してください。`
      );
    }
  }

  return {
    caseId: cas.id,
    pipeId: pipe.id,
    waveSpeed: { waveSpeed: a, vibrationPeriod: T0, alpha },
    closureType,
    deltaH_joukowsky,
    hmax_allievi_close,
    hmax_allievi_open,
    k1,
    allieviApplicable,
    warnings,
  };
}
