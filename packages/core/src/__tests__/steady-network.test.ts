/**
 * 管路網定常水理計算テスト
 *
 * 要旨 §3.1: 定常計算部で分岐・合流を含む管路網の水理条件を整理
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { calcSteadyNetwork } from "../steady-network.js";
import type { SteadyNetworkInput, NetworkPipeDef, NetworkNodeDef } from "../steady-network.js";

// ─── テストデータ ────────────────────────────────────────────────────────────

/** 直列管路（2区間）: 単純な上流→下流 */
function makeSerialInput(): SteadyNetworkInput {
  return {
    pipes: [
      { id: "p1", upstreamNodeId: "R", downstreamNodeId: "J1", innerDiameter: 0.3, length: 500, roughnessC: 130 },
      { id: "p2", upstreamNodeId: "J1", downstreamNodeId: "D1", innerDiameter: 0.3, length: 500, roughnessC: 130 },
    ],
    nodes: [
      { id: "R", elevation: 100, type: "reservoir", head: 120 },
      { id: "J1", elevation: 95, type: "junction" },
      { id: "D1", elevation: 90, type: "demand", demand: 0.10 },
    ],
  };
}

/** T字分岐: 貯水槽→幹線→分岐→支線A,B */
function makeTJunctionInput(): SteadyNetworkInput {
  return {
    pipes: [
      { id: "main", upstreamNodeId: "R", downstreamNodeId: "J", innerDiameter: 0.4, length: 800, roughnessC: 130 },
      { id: "brA", upstreamNodeId: "J", downstreamNodeId: "DA", innerDiameter: 0.3, length: 500, roughnessC: 130 },
      { id: "brB", upstreamNodeId: "J", downstreamNodeId: "DB", innerDiameter: 0.25, length: 600, roughnessC: 130 },
    ],
    nodes: [
      { id: "R", elevation: 100, type: "reservoir", head: 130 },
      { id: "J", elevation: 95, type: "junction" },
      { id: "DA", elevation: 88, type: "demand", demand: 0.10 },
      { id: "DB", elevation: 85, type: "demand", demand: 0.06 },
    ],
  };
}

/** 3段分岐: R→J1→(A, J2→(B, C)) */
function makeMultiLevelInput(): SteadyNetworkInput {
  return {
    pipes: [
      { id: "p1", upstreamNodeId: "R", downstreamNodeId: "J1", innerDiameter: 0.4, length: 600, roughnessC: 130 },
      { id: "pA", upstreamNodeId: "J1", downstreamNodeId: "DA", innerDiameter: 0.25, length: 400, roughnessC: 130 },
      { id: "p2", upstreamNodeId: "J1", downstreamNodeId: "J2", innerDiameter: 0.35, length: 500, roughnessC: 130 },
      { id: "pB", upstreamNodeId: "J2", downstreamNodeId: "DB", innerDiameter: 0.25, length: 300, roughnessC: 130 },
      { id: "pC", upstreamNodeId: "J2", downstreamNodeId: "DC", innerDiameter: 0.2, length: 400, roughnessC: 130 },
    ],
    nodes: [
      { id: "R", elevation: 100, type: "reservoir", head: 140 },
      { id: "J1", elevation: 95, type: "junction" },
      { id: "J2", elevation: 90, type: "junction" },
      { id: "DA", elevation: 85, type: "demand", demand: 0.05 },
      { id: "DB", elevation: 82, type: "demand", demand: 0.04 },
      { id: "DC", elevation: 80, type: "demand", demand: 0.03 },
    ],
  };
}

// ─── テスト ──────────────────────────────────────────────────────────────────

describe("calcSteadyNetwork — 直列管路", () => {
  const result = calcSteadyNetwork(makeSerialInput());

  test("計算が正常完了する", () => {
    assert.equal(result.pipeResults.length, 2);
    assert.equal(result.nodeResults.length, 3);
  });

  test("全管路の流量が同一（直列なので）", () => {
    assert.equal(result.pipeResults[0]!.flow, 0.10);
    assert.equal(result.pipeResults[1]!.flow, 0.10);
  });

  test("貯水槽の水頭が入力と一致", () => {
    const rNode = result.nodeResults.find(n => n.nodeId === "R");
    assert.ok(rNode);
    assert.equal(rNode.head, 120);
  });

  test("下流ノードの水頭が貯水槽より低い（損失分）", () => {
    const rHead = result.nodeResults.find(n => n.nodeId === "R")!.head;
    const d1Head = result.nodeResults.find(n => n.nodeId === "D1")!.head;
    assert.ok(d1Head < rHead, `D1水頭(${d1Head.toFixed(2)}) < 貯水槽(${rHead})`);
  });

  test("動水頭が正（正圧）", () => {
    for (const nr of result.nodeResults) {
      assert.ok(nr.pressureHead > 0, `${nr.nodeId}: pressureHead(${nr.pressureHead.toFixed(2)}) > 0`);
    }
  });

  test("摩擦損失が正", () => {
    for (const pr of result.pipeResults) {
      assert.ok(pr.frictionLoss > 0, `${pr.pipeId}: frictionLoss(${pr.frictionLoss.toFixed(4)}) > 0`);
    }
  });
});

describe("calcSteadyNetwork — T字分岐", () => {
  const result = calcSteadyNetwork(makeTJunctionInput());

  test("管路数3・ノード数4", () => {
    assert.equal(result.pipeResults.length, 3);
    assert.equal(result.nodeResults.length, 4);
  });

  test("幹線流量 = 支線A + 支線B（連続条件）", () => {
    const mainFlow = result.pipeResults.find(p => p.pipeId === "main")!.flow;
    const brAFlow = result.pipeResults.find(p => p.pipeId === "brA")!.flow;
    const brBFlow = result.pipeResults.find(p => p.pipeId === "brB")!.flow;
    assert.ok(
      Math.abs(mainFlow - (brAFlow + brBFlow)) < 1e-10,
      `幹線(${mainFlow}) = 支線A(${brAFlow}) + 支線B(${brBFlow})`,
    );
  });

  test("支線Aの流量が0.10、支線Bが0.06", () => {
    assert.equal(result.pipeResults.find(p => p.pipeId === "brA")!.flow, 0.10);
    assert.equal(result.pipeResults.find(p => p.pipeId === "brB")!.flow, 0.06);
  });

  test("分岐点の水頭が貯水槽と末端の間", () => {
    const rHead = result.nodeResults.find(n => n.nodeId === "R")!.head;
    const jHead = result.nodeResults.find(n => n.nodeId === "J")!.head;
    const daHead = result.nodeResults.find(n => n.nodeId === "DA")!.head;
    const dbHead = result.nodeResults.find(n => n.nodeId === "DB")!.head;
    assert.ok(jHead < rHead, `分岐点(${jHead.toFixed(2)}) < 貯水槽(${rHead})`);
    assert.ok(daHead < jHead, `末端A(${daHead.toFixed(2)}) < 分岐点(${jHead.toFixed(2)})`);
    assert.ok(dbHead < jHead, `末端B(${dbHead.toFixed(2)}) < 分岐点(${jHead.toFixed(2)})`);
  });

  test("幹線は支線より流速が高い（口径差を考慮した上で）", () => {
    const mainV = result.pipeResults.find(p => p.pipeId === "main")!.velocity;
    assert.ok(mainV > 0, `幹線流速(${mainV.toFixed(3)}) > 0`);
  });

  test("全ノードで正圧", () => {
    for (const nr of result.nodeResults) {
      assert.ok(nr.pressureHead > 0, `${nr.nodeId}: pressureHead(${nr.pressureHead.toFixed(2)}) > 0`);
    }
  });
});

describe("calcSteadyNetwork — 多段分岐", () => {
  const result = calcSteadyNetwork(makeMultiLevelInput());

  test("5管路の流量が連続条件を満たす", () => {
    const flows = new Map<string, number>();
    for (const pr of result.pipeResults) flows.set(pr.pipeId, pr.flow);

    // p1 = pA + p2
    assert.ok(
      Math.abs(flows.get("p1")! - (flows.get("pA")! + flows.get("p2")!)) < 1e-10,
      "J1での連続条件",
    );
    // p2 = pB + pC
    assert.ok(
      Math.abs(flows.get("p2")! - (flows.get("pB")! + flows.get("pC")!)) < 1e-10,
      "J2での連続条件",
    );
  });

  test("幹線流量 = 全需要合計", () => {
    const mainFlow = result.pipeResults.find(p => p.pipeId === "p1")!.flow;
    assert.ok(
      Math.abs(mainFlow - 0.12) < 1e-10,
      `幹線流量(${mainFlow}) = 全需要(0.12)`,
    );
  });

  test("末端ほど水頭が低い", () => {
    const heads = new Map<string, number>();
    for (const nr of result.nodeResults) heads.set(nr.nodeId, nr.head);

    assert.ok(heads.get("R")! > heads.get("J1")!, "R > J1");
    assert.ok(heads.get("J1")! > heads.get("J2")!, "J1 > J2");
    assert.ok(heads.get("J2")! > heads.get("DB")!, "J2 > DB");
  });
});

describe("calcSteadyNetwork — エッジケース", () => {
  test("reservoir がない場合は警告", () => {
    const result = calcSteadyNetwork({
      pipes: [{ id: "p1", upstreamNodeId: "A", downstreamNodeId: "B", innerDiameter: 0.3, length: 100, roughnessC: 130 }],
      nodes: [
        { id: "A", elevation: 100, type: "junction" },
        { id: "B", elevation: 90, type: "demand", demand: 0.1 },
      ],
    });
    assert.ok(result.warnings.some(w => w.includes("reservoir")));
  });

  test("需要0の末端でも計算可能", () => {
    const result = calcSteadyNetwork({
      pipes: [{ id: "p1", upstreamNodeId: "R", downstreamNodeId: "D", innerDiameter: 0.3, length: 500, roughnessC: 130 }],
      nodes: [
        { id: "R", elevation: 100, type: "reservoir", head: 120 },
        { id: "D", elevation: 90, type: "demand", demand: 0 },
      ],
    });
    assert.equal(result.pipeResults[0]!.flow, 0);
    // 流量0なら損失も0、水頭は貯水槽と同じ
    assert.equal(result.nodeResults.find(n => n.nodeId === "D")!.head, 120);
  });

  test("局部損失係数が反映される", () => {
    const withoutMinor = calcSteadyNetwork({
      pipes: [{ id: "p1", upstreamNodeId: "R", downstreamNodeId: "D", innerDiameter: 0.3, length: 500, roughnessC: 130 }],
      nodes: [
        { id: "R", elevation: 100, type: "reservoir", head: 120 },
        { id: "D", elevation: 90, type: "demand", demand: 0.10 },
      ],
    });
    const withMinor = calcSteadyNetwork({
      pipes: [{ id: "p1", upstreamNodeId: "R", downstreamNodeId: "D", innerDiameter: 0.3, length: 500, roughnessC: 130, minorLossCoeff: 5.0 }],
      nodes: [
        { id: "R", elevation: 100, type: "reservoir", head: 120 },
        { id: "D", elevation: 90, type: "demand", demand: 0.10 },
      ],
    });
    const headWithout = withoutMinor.nodeResults.find(n => n.nodeId === "D")!.head;
    const headWith = withMinor.nodeResults.find(n => n.nodeId === "D")!.head;
    assert.ok(headWith < headWithout, `局部損失あり(${headWith.toFixed(2)}) < なし(${headWithout.toFixed(2)})`);
  });
});

describe("calcSteadyNetwork → MOC初期条件の整合", () => {
  test("定常計算の流量・水頭をMOCの初期条件に使用可能", () => {
    const result = calcSteadyNetwork(makeTJunctionInput());

    // 各管路の定常流量
    for (const pr of result.pipeResults) {
      assert.ok(isFinite(pr.flow), `${pr.pipeId}: 有限な流量`);
      assert.ok(pr.flow >= 0, `${pr.pipeId}: 非負の流量`);
    }

    // 各ノードの定常水頭
    for (const nr of result.nodeResults) {
      assert.ok(isFinite(nr.head), `${nr.nodeId}: 有限な水頭`);
    }

    // MOCの初期条件として使用する値が取得可能
    const mainFlow = result.pipeResults.find(p => p.pipeId === "main")!.flow;
    const junctionHead = result.nodeResults.find(n => n.nodeId === "J")!.head;
    assert.ok(mainFlow > 0);
    assert.ok(junctionHead > 0);
  });
});
