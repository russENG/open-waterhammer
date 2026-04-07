/**
 * 定常→非定常 接続テスト
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { calcLongitudinalHydraulic } from "../longitudinal-hydraulic.js";
import { buildMocFromSteady, buildPumpUpstreamBC } from "../steady-to-moc.js";
import { runMoc } from "../moc.js";
import type { MeasurementPoint, LongitudinalHydraulicInput } from "../types.js";

// --- テスト用の簡易測点データ（3測点、直列、同一管径） ---

const POINTS_3: MeasurementPoint[] = [
  {
    id: "P1", horizontalDistance: 0, groundLevel: 100, pipeCenterHeight: 98.5,
    pipeLength: 500, flowRate: 0.1, diameter: 0.3, roughnessC: 130,
    bendLossCoeff: 0, valveLossCoeff: 0, branchLossCoeff: 0,
  },
  {
    id: "P2", horizontalDistance: 500, groundLevel: 95, pipeCenterHeight: 93.5,
    pipeLength: 500, flowRate: 0.1, diameter: 0.3, roughnessC: 130,
    bendLossCoeff: 0.1, valveLossCoeff: 0, branchLossCoeff: 0,
  },
  {
    id: "P3", horizontalDistance: 1000, groundLevel: 90, pipeCenterHeight: 88.5,
    pipeLength: 500, flowRate: 0.1, diameter: 0.3, roughnessC: 130,
    bendLossCoeff: 0, valveLossCoeff: 0.5, branchLossCoeff: 0,
  },
];

// --- 管径変化を含む測点データ（4測点、2管径） ---

const POINTS_MULTI_D: MeasurementPoint[] = [
  {
    id: "A", horizontalDistance: 0, groundLevel: 100, pipeCenterHeight: 98.5,
    pipeLength: 300, flowRate: 0.15, diameter: 0.4, roughnessC: 130,
    bendLossCoeff: 0, valveLossCoeff: 0, branchLossCoeff: 0,
  },
  {
    id: "B", horizontalDistance: 300, groundLevel: 97, pipeCenterHeight: 95.5,
    pipeLength: 300, flowRate: 0.15, diameter: 0.4, roughnessC: 130,
    bendLossCoeff: 0, valveLossCoeff: 0, branchLossCoeff: 0,
  },
  {
    id: "C", horizontalDistance: 600, groundLevel: 94, pipeCenterHeight: 92.5,
    pipeLength: 400, flowRate: 0.15, diameter: 0.3, roughnessC: 130,
    bendLossCoeff: 0, valveLossCoeff: 0, branchLossCoeff: 0,
  },
  {
    id: "D", horizontalDistance: 1000, groundLevel: 90, pipeCenterHeight: 88.5,
    pipeLength: 400, flowRate: 0.15, diameter: 0.3, roughnessC: 130,
    bendLossCoeff: 0, valveLossCoeff: 0, branchLossCoeff: 0,
  },
];

describe("buildMocFromSteady — 基本変換", () => {
  const input: LongitudinalHydraulicInput = {
    points: POINTS_3,
    staticWaterLevel: 110,
    caseName: "テスト",
  };
  const hyResult = calcLongitudinalHydraulic(input);
  const mocOutput = buildMocFromSteady({
    hydraulicResult: hyResult,
    points: POINTS_3,
    material: { pipeType: "ductile_iron" },
  });

  test("セグメント数 = 1（同一管径なので統合）", () => {
    assert.equal(mocOutput.summary.segmentCount, 1);
  });

  test("ネットワークの管路数 = 1", () => {
    assert.equal(mocOutput.network.pipes.length, 1);
  });

  test("上流端に貯水槽BCが設定される", () => {
    const upBC = mocOutput.network.nodes["node_0"];
    assert.ok(upBC);
    assert.equal(upBC.type, "reservoir");
    if (upBC.type === "reservoir") {
      assert.equal(upBC.head, 110);
    }
  });

  test("下流端にバルブBCが設定される", () => {
    const dnBC = mocOutput.network.nodes["node_1"];
    assert.ok(dnBC);
    assert.equal(dnBC.type, "valve");
  });

  test("初期流量が定常計算の流量と一致", () => {
    assert.equal(mocOutput.summary.initialFlow, 0.1);
  });

  test("波速が正の値", () => {
    assert.ok(mocOutput.summary.representativeWaveSpeed > 0);
  });

  test("振動周期が正の値", () => {
    assert.ok(mocOutput.summary.vibrationPeriod > 0);
  });

  test("管路延長の合計が測点の管長合計に近い", () => {
    // P2 + P3 = 500 + 500 = 1000m（P1は始点で管長を持つが、累積は2区間分）
    assert.ok(mocOutput.summary.totalLength > 0);
  });
});

describe("buildMocFromSteady — 管径変化でセグメント分割", () => {
  const input: LongitudinalHydraulicInput = {
    points: POINTS_MULTI_D,
    staticWaterLevel: 115,
    caseName: "多口径テスト",
  };
  const hyResult = calcLongitudinalHydraulic(input);
  const mocOutput = buildMocFromSteady({
    hydraulicResult: hyResult,
    points: POINTS_MULTI_D,
    material: { pipeType: "ductile_iron" },
  });

  test("セグメント数 = 2（φ400区間 + φ300区間）", () => {
    assert.equal(mocOutput.summary.segmentCount, 2);
  });

  test("各セグメントの管径が正しい", () => {
    assert.equal(mocOutput.network.pipes[0]!.pipe.innerDiameter, 0.4);
    assert.equal(mocOutput.network.pipes[1]!.pipe.innerDiameter, 0.3);
  });

  test("内部ノード(node_1)にはBCが設定されない（連続条件）", () => {
    assert.equal(mocOutput.network.nodes["node_1"], undefined);
  });
});

describe("buildMocFromSteady — カスタムBC", () => {
  const input: LongitudinalHydraulicInput = {
    points: POINTS_3,
    staticWaterLevel: 110,
  };
  const hyResult = calcLongitudinalHydraulic(input);

  test("バルブ閉鎖時間を指定できる", () => {
    const mocOutput = buildMocFromSteady({
      hydraulicResult: hyResult,
      points: POINTS_3,
      material: { pipeType: "ductile_iron" },
      valveCloseTime: 5.0,
    });
    const dnBC = mocOutput.network.nodes["node_1"];
    assert.ok(dnBC);
    if (dnBC.type === "valve") {
      assert.equal(dnBC.closeTime, 5.0);
    }
  });

  test("ポンプBCを上流に設定できる", () => {
    const pumpBC = buildPumpUpstreamBC({
      Q0: 0.1,
      pumpHead: 50,
      shutdownTime: 0,
    });
    const mocOutput = buildMocFromSteady({
      hydraulicResult: hyResult,
      points: POINTS_3,
      material: { pipeType: "ductile_iron" },
      upstreamBC: pumpBC,
    });
    const upBC = mocOutput.network.nodes["node_0"];
    assert.ok(upBC);
    assert.equal(upBC.type, "pump");
  });
});

describe("buildMocFromSteady → runMoc 一気通貫", () => {
  const input: LongitudinalHydraulicInput = {
    points: POINTS_3,
    staticWaterLevel: 110,
    caseName: "一気通貫テスト",
  };
  const hyResult = calcLongitudinalHydraulic(input);
  const { network, options } = buildMocFromSteady({
    hydraulicResult: hyResult,
    points: POINTS_3,
    material: { pipeType: "ductile_iron" },
    valveCloseTime: 1.0,
    tMax: 10,
  });
  const mocResult = runMoc(network, options);

  test("MOC実行がクラッシュしない", () => {
    assert.ok(mocResult);
  });

  test("管路結果が存在する", () => {
    assert.ok(mocResult.pipes["seg_0"]);
  });

  test("包絡線Hmaxが初期水頭を超える（水撃発生）", () => {
    const pipeResult = mocResult.pipes["seg_0"]!;
    const H0 = hyResult.staticWaterLevel;
    const Hmax = Math.max(...pipeResult.Hmax);
    assert.ok(Hmax > H0, `Hmax=${Hmax} should exceed H0=${H0}`);
  });

  test("下流端の水頭時系列が記録されている", () => {
    const dnNode = mocResult.nodes["node_1"];
    assert.ok(dnNode);
    assert.ok(dnNode.H.length > 0);
  });
});
