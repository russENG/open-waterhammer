/**
 * EPANET アダプタ vs TS native impl の数値一致検証
 *
 * Hazen-Williams 式による単純な樹枝状管路網で、
 * 流量・水頭・流速が許容差内で一致することを確認する。
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { calcSteadyNetwork, type SteadyNetworkInput } from "@open-waterhammer/core";
import { calcSteadyNetworkEpanet, buildInp } from "../index.js";

// ─── テストフィクスチャ ────────────────────────────────────────────────────────

/** 単純な3節点・2管路の樹枝状網: R(150m) → J1 → J2(0.05 m³/s 取水) */
const simpleNetwork: SteadyNetworkInput = {
  caseName: "テスト網",
  pipes: [
    {
      id: "P1",
      upstreamNodeId: "R1",
      downstreamNodeId: "J1",
      innerDiameter: 0.300,
      length: 500,
      roughnessC: 130,
    },
    {
      id: "P2",
      upstreamNodeId: "J1",
      downstreamNodeId: "J2",
      innerDiameter: 0.250,
      length: 300,
      roughnessC: 130,
    },
  ],
  nodes: [
    { id: "R1", elevation: 100, type: "reservoir", head: 150 },
    { id: "J1", elevation: 80, type: "junction" },
    { id: "J2", elevation: 60, type: "demand", demand: 0.05 },
  ],
};

/** 単一管路: R(120m) → J1(0.03 m³/s 取水) */
const trivialNetwork: SteadyNetworkInput = {
  caseName: "単一管路",
  pipes: [
    {
      id: "P1",
      upstreamNodeId: "R1",
      downstreamNodeId: "J1",
      innerDiameter: 0.200,
      length: 1000,
      roughnessC: 130,
    },
  ],
  nodes: [
    { id: "R1", elevation: 100, type: "reservoir", head: 120 },
    { id: "J1", elevation: 90, type: "demand", demand: 0.03 },
  ],
};

// ─── INP 構築テスト ───────────────────────────────────────────────────────────

describe("buildInp", () => {
  test("必須セクションが含まれる", () => {
    const inp = buildInp(simpleNetwork);
    assert.ok(inp.includes("[TITLE]"));
    assert.ok(inp.includes("[JUNCTIONS]"));
    assert.ok(inp.includes("[RESERVOIRS]"));
    assert.ok(inp.includes("[PIPES]"));
    assert.ok(inp.includes("[OPTIONS]"));
    assert.ok(inp.includes("[END]"));
  });

  test("LPS 単位指定が出力される", () => {
    const inp = buildInp(simpleNetwork);
    assert.ok(/UNITS\s+LPS/.test(inp), "LPS 指定が見つからない");
  });

  test("H-W 摩擦損失式が指定される", () => {
    const inp = buildInp(simpleNetwork);
    assert.ok(/HEADLOSS\s+H-W/.test(inp), "H-W 指定が見つからない");
  });

  test("管径は mm 単位で出力される（0.3m → 300mm）", () => {
    const inp = buildInp(simpleNetwork);
    // P1 の直径 300 が含まれる
    assert.ok(/P1.+300/.test(inp), `INP に '300' が見つからない: ${inp.slice(0, 500)}`);
  });

  test("需要は L/s 単位で出力される（0.05 m³/s → 50 L/s）", () => {
    const inp = buildInp(simpleNetwork);
    // J2 行に "50" が含まれる
    const j2Match = inp.match(/J2\t[\d.]+\t([\d.]+)/);
    if (!j2Match) {
      throw new Error("J2 行が見つからない");
    }
    const demand_lps = parseFloat(j2Match[1]!);
    assert.ok(Math.abs(demand_lps - 50) < 1e-3, `demand_lps = ${demand_lps}`);
  });
});

// ─── EPANET vs TS native impl 数値比較 ────────────────────────────────────────

describe("calcSteadyNetworkEpanet — TS native impl との数値一致", () => {
  test("単一管路: 流量・水頭が一致（許容差 1%）", async () => {
    const tsResult = calcSteadyNetwork(trivialNetwork);
    const epResult = await calcSteadyNetworkEpanet(trivialNetwork);

    assert.equal(epResult.pipeResults.length, 1);
    const tsPipe = tsResult.pipeResults[0]!;
    const epPipe = epResult.pipeResults[0]!;

    // 流量: 0.03 m³/s
    const flowDiff = Math.abs(epPipe.flow - tsPipe.flow);
    assert.ok(flowDiff / Math.abs(tsPipe.flow) < 0.01,
      `流量差 ${flowDiff} (TS=${tsPipe.flow}, EP=${epPipe.flow})`);

    // 流速
    const velDiff = Math.abs(epPipe.velocity - tsPipe.velocity);
    assert.ok(velDiff / Math.abs(tsPipe.velocity) < 0.02,
      `流速差 ${velDiff} (TS=${tsPipe.velocity}, EP=${epPipe.velocity})`);

    // 摩擦損失水頭
    const lossDiff = Math.abs(epPipe.frictionLoss - tsPipe.frictionLoss);
    assert.ok(lossDiff / Math.abs(tsPipe.frictionLoss) < 0.05,
      `摩擦損失差 ${lossDiff} (TS=${tsPipe.frictionLoss}, EP=${epPipe.frictionLoss})`);
  });

  test("3節点樹枝状網: 全管路の流量が一致（許容差 1%）", async () => {
    const tsResult = calcSteadyNetwork(simpleNetwork);
    const epResult = await calcSteadyNetworkEpanet(simpleNetwork);

    assert.equal(epResult.pipeResults.length, tsResult.pipeResults.length);

    for (const tsPipe of tsResult.pipeResults) {
      const epPipe = epResult.pipeResults.find(p => p.pipeId === tsPipe.pipeId);
      if (!epPipe) {
        throw new Error(`管路 ${tsPipe.pipeId} が EPANET 結果にない`);
      }

      const flowDiff = Math.abs(epPipe.flow - tsPipe.flow);
      assert.ok(flowDiff / Math.max(Math.abs(tsPipe.flow), 1e-6) < 0.01,
        `${tsPipe.pipeId} 流量差 ${flowDiff} (TS=${tsPipe.flow}, EP=${epPipe.flow})`);
    }
  });

  test("3節点樹枝状網: 節点水頭が一致（許容差 0.1m）", async () => {
    const tsResult = calcSteadyNetwork(simpleNetwork);
    const epResult = await calcSteadyNetworkEpanet(simpleNetwork);

    for (const tsNode of tsResult.nodeResults) {
      const epNode = epResult.nodeResults.find(n => n.nodeId === tsNode.nodeId);
      if (!epNode) {
        throw new Error(`節点 ${tsNode.nodeId} が EPANET 結果にない`);
      }

      const headDiff = Math.abs(epNode.head - tsNode.head);
      assert.ok(headDiff < 0.1,
        `${tsNode.nodeId} 水頭差 ${headDiff} m (TS=${tsNode.head}, EP=${epNode.head})`);
    }
  });

  test("reservoir 未指定時はエラー警告", async () => {
    const noReservoir: SteadyNetworkInput = {
      pipes: [{ id: "P1", upstreamNodeId: "A", downstreamNodeId: "B", innerDiameter: 0.2, length: 100, roughnessC: 130 }],
      nodes: [
        { id: "A", elevation: 0, type: "junction" },
        { id: "B", elevation: 0, type: "demand", demand: 0.01 },
      ],
    };
    const result = await calcSteadyNetworkEpanet(noReservoir);
    assert.ok(result.warnings.length > 0);
    assert.equal(result.pipeResults.length, 0);
  });
});
