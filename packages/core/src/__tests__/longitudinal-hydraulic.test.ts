/**
 * 縦断水理計算 ユニットテスト
 * 公式帳票の計算例（MAFF成果品様式）と照合
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  calcTotalLossCoeff,
  calcMinorLoss,
  calcSegmentFriction,
  calcLongitudinalHydraulic,
} from "../longitudinal-hydraulic.js";
import type { MeasurementPoint, LongitudinalHydraulicInput } from "../types.js";
import { GRAVITY } from "../formulas.js";

// ─── 局部損失計算 ────────────────────────────────────────────────────────────

describe("局部損失計算", () => {
  test("calcTotalLossCoeff: 各係数の合計", () => {
    const pt: MeasurementPoint = {
      id: "IP.161", horizontalDistance: 25.776, groundLevel: 477.20,
      pipeCenterHeight: 475.533, pipeLength: 25.874, flowRate: 0.4515,
      diameter: 0.6, roughnessC: 130,
      bendLossCoeff: 0.022, valveLossCoeff: 0, branchLossCoeff: 0,
    };
    const result = calcTotalLossCoeff(pt);
    assert.ok(Math.abs(result - 0.022) < 1e-10);
  });

  test("calcMinorLoss: 局部損失水頭 = Σf × hv + other", () => {
    const hv = 1.597 * 1.597 / (2 * GRAVITY); // ≈ 0.130
    const loss = calcMinorLoss(0.022, hv, 0);
    // 0.022 × 0.130 ≈ 0.00286
    assert.ok(Math.abs(loss - 0.022 * hv) < 1e-6);
  });

  test("calcMinorLoss: その他損失を加算", () => {
    const hv = 0.130;
    const loss = calcMinorLoss(0.05, hv, 0.01);
    assert.ok(Math.abs(loss - (0.05 * 0.130 + 0.01)) < 1e-6);
  });
});

// ─── 摩擦損失計算 ────────────────────────────────────────────────────────────

describe("区間摩擦損失", () => {
  test("calcSegmentFriction: φ600 C=130 の動水勾配", () => {
    // 公式帳票の例: φ600, C=130, V≈1.597, 動水勾配≈3.6215‰
    const D = 0.6;
    const C = 130;
    // Q = 451.50 L/s = 0.4515 m³/s → V = Q / (π/4 × 0.6²) ≈ 1.597
    const V = 0.4515 / (Math.PI * D * D / 4);
    const { hydraulicGradient, frictionLoss } = calcSegmentFriction(D, C, V, 25.874);

    // 動水勾配 ≈ 3.6215‰ = 0.0036215
    assert.ok(Math.abs(hydraulicGradient * 1000 - 3.6215) < 0.05,
      `動水勾配 ${(hydraulicGradient * 1000).toFixed(4)}‰ ≈ 3.6215‰`);

    // 摩擦損失 ≈ I × L ≈ 0.0036 × 25.874 ≈ 0.094
    assert.ok(frictionLoss > 0.08 && frictionLoss < 0.12,
      `摩擦損失 ${frictionLoss.toFixed(4)} m`);
  });
});

// ─── 縦断水理計算 ────────────────────────────────────────────────────────────

describe("縦断水理計算", () => {
  /** 公式帳票例の最初の3測点（φ600, C=130, Q=451.50L/s） */
  function makeTestPoints(): MeasurementPoint[] {
    return [
      {
        id: "IP.161", horizontalDistance: 25.776, groundLevel: 477.20,
        pipeCenterHeight: 475.533, pipeLength: 25.874, flowRate: 0.4515,
        diameter: 0.6, roughnessC: 130,
        bendLossCoeff: 0.022, valveLossCoeff: 0, branchLossCoeff: 0,
      },
      {
        id: "IP.162", horizontalDistance: 9.000, groundLevel: 478.01,
        pipeCenterHeight: 476.402, pipeLength: 9.033, flowRate: 0.4515,
        diameter: 0.6, roughnessC: 130,
        bendLossCoeff: 0.043, valveLossCoeff: 0, branchLossCoeff: 0,
      },
      {
        id: "IP.163", horizontalDistance: 7.583, groundLevel: 478.71,
        pipeCenterHeight: 477.050, pipeLength: 7.611, flowRate: 0.4515,
        diameter: 0.6, roughnessC: 130,
        bendLossCoeff: 0.049, valveLossCoeff: 0, branchLossCoeff: 0,
      },
    ];
  }

  test("基本的な縦断計算: エネルギー標高が下流に向かって低下", () => {
    const input: LongitudinalHydraulicInput = {
      points: makeTestPoints(),
      staticWaterLevel: 563.0,
      waterhammerPressureMpa: 0.41,
      caseName: "計画最大流量",
    };

    const result = calcLongitudinalHydraulic(input);

    assert.equal(result.caseName, "計画最大流量");
    assert.equal(result.pointResults.length, 3);

    // エネルギー標高は順次低下
    const els = result.pointResults.map(r => r.energyLevel);
    assert.ok(els[0]! > els[1]!, "EL[0] > EL[1]");
    assert.ok(els[1]! > els[2]!, "EL[1] > EL[2]");

    // 動水位もエネルギー標高以下
    for (const r of result.pointResults) {
      assert.ok(r.hydraulicGradeLine <= r.energyLevel,
        `WLm(${r.hydraulicGradeLine.toFixed(2)}) ≦ EL(${r.energyLevel.toFixed(2)})`);
    }
  });

  test("静水圧と設計内圧の関係: Pp = Ps + Pi", () => {
    const input: LongitudinalHydraulicInput = {
      points: makeTestPoints(),
      staticWaterLevel: 563.0,
      waterhammerPressureMpa: 0.41,
    };

    const result = calcLongitudinalHydraulic(input);

    for (const r of result.pointResults) {
      assert.ok(Math.abs(r.designPressure - (r.staticPressure + r.waterhammerPressure)) < 1e-6,
        `Pp(${r.designPressure.toFixed(4)}) = Ps(${r.staticPressure.toFixed(4)}) + Pi(${r.waterhammerPressure.toFixed(4)})`);
    }
  });

  test("水撃圧: 割合指定モード", () => {
    const input: LongitudinalHydraulicInput = {
      points: makeTestPoints(),
      staticWaterLevel: 563.0,
      waterhammerRatio: 0.4,
    };

    const result = calcLongitudinalHydraulic(input);

    for (const r of result.pointResults) {
      assert.ok(Math.abs(r.waterhammerPressure - r.staticPressure * 0.4) < 1e-6,
        `Pi = Ps × 0.4`);
    }
  });

  test("空の測点列では警告を返す", () => {
    const input: LongitudinalHydraulicInput = {
      points: [],
      staticWaterLevel: 563.0,
    };

    const result = calcLongitudinalHydraulic(input);
    assert.equal(result.pointResults.length, 0);
    assert.ok(result.warnings.length > 0);
  });

  test("公式帳票の値と概ね一致（IP.161）", () => {
    // 帳票例: IP.161 の EL=562.909, WLm=562.779, hm=87.146, Ps=1.03, Pi=0.41, Pp=1.44
    // 静水位 = 580.600（帳票タイトル行「静水位：○○吐水槽 H.W.L=580.600m」）
    const input: LongitudinalHydraulicInput = {
      points: makeTestPoints().slice(0, 1),
      staticWaterLevel: 563.009, // 帳票のEL+totalLossから逆算した初期値
      waterhammerPressureMpa: 0.41,
    };

    const result = calcLongitudinalHydraulic(input);
    const r = result.pointResults[0]!;

    // エネルギー標高 ≈ 562.909
    assert.ok(Math.abs(r.energyLevel - 562.909) < 0.1,
      `EL ${r.energyLevel.toFixed(3)} ≈ 562.909`);

    // 全損失水頭 ≈ 0.100
    assert.ok(Math.abs(r.totalLoss - 0.100) < 0.01,
      `全損失 ${r.totalLoss.toFixed(4)} ≈ 0.100`);

    // 設計内圧 = Ps + Pi の整合性
    assert.ok(Math.abs(r.designPressure - (r.staticPressure + r.waterhammerPressure)) < 1e-6,
      `Pp = Ps + Pi`);
  });
});
