/**
 * EPANET 定常計算の検証ベンチマーク
 *
 * 既存の epanet.test.ts は INP 生成の構造確認と TS ネイティブ実装との
 * 数値一致確認が中心である。本ファイルは
 *
 *   E1  ヘーゼン・ウィリアムス式の閉形式との一致（EPANET 単体の正しさ）
 *   E2  局部損失 Σf·v²/2g の閉形式との一致
 *   E3  節点のエネルギー収支 H_上流 − H_下流 = 損失
 *   E4  ループ（環状）網: 分流・並列枝の損失一致・連続条件
 *   E5  複数貯水槽: 連続条件と逆流の符号
 *   E6  樹枝状網での TS ネイティブ実装との一致（適用範囲内なら一致する）
 *   E7  【要注意】適用範囲外では TS ネイティブ実装と乖離する
 *
 * を検証する。E7 は「どちらのエンジンを選ぶかで結果が変わる」条件を明示的に
 * 記録するためのもので、正しい側は EPANET（Newton-Raphson 全体収束）である。
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { calcSteadyNetwork, GRAVITY } from "@open-waterhammer/core";
import type { SteadyNetworkInput, SteadyNetworkResult } from "@open-waterhammer/core";

import { calcSteadyNetworkEpanet } from "../index.js";

// ═══════════════════════════════════════════════════════════════════════════════
// ヘルパー
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * ヘーゼン・ウィリアムス式の閉形式（SI 単位）
 *   hf = 10.67 · L · Q^1.852 / (C^1.852 · D^4.871)
 */
function hazenWilliamsClosedForm(L: number, Q: number, C: number, D: number): number {
  return (10.67 * L * Math.pow(Q, 1.852)) / (Math.pow(C, 1.852) * Math.pow(D, 4.871));
}

function relErrPct(actual: number, reference: number): number {
  return (actual / reference - 1) * 100;
}

const pipeOf = (r: SteadyNetworkResult, id: string) =>
  r.pipeResults.find(p => p.pipeId === id);
const nodeOf = (r: SteadyNetworkResult, id: string) =>
  r.nodeResults.find(n => n.nodeId === id);

/** 単一管路（貯水槽 → 需要端）の入力 */
function singlePipeInput(
  D: number, L: number, C: number, Q: number, minorLossCoeff?: number,
): SteadyNetworkInput {
  return {
    pipes: [{
      id: "p1", upstreamNodeId: "R", downstreamNodeId: "D",
      innerDiameter: D, length: L, roughnessC: C,
      ...(minorLossCoeff !== undefined && { minorLossCoeff }),
    }],
    nodes: [
      { id: "R", elevation: 0, type: "reservoir", head: 100 },
      { id: "D", elevation: 0, type: "demand", demand: Q },
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// E1 ヘーゼン・ウィリアムス式の閉形式との一致
// ═══════════════════════════════════════════════════════════════════════════════

describe("E1 EPANET の摩擦損失が H-W 閉形式と一致する", () => {
  const cases = [
    { D: 0.30, L: 1000, C: 130, Q: 0.10 },
    { D: 0.40, L: 500, C: 110, Q: 0.20 },
    { D: 0.20, L: 2000, C: 150, Q: 0.03 },
    { D: 0.60, L: 3000, C: 100, Q: 0.50 },
  ];

  for (const { D, L, C, Q } of cases) {
    test(`φ${D * 1000}mm L=${L}m C=${C} Q=${Q}m³/s が閉形式と 0.5% 以内`, async () => {
      const r = await calcSteadyNetworkEpanet(singlePipeInput(D, L, C, Q));
      const hf = pipeOf(r, "p1")!.frictionLoss;
      const ref = hazenWilliamsClosedForm(L, Q, C, D);
      const err = Math.abs(relErrPct(hf, ref));
      assert.ok(err < 0.5, `EPANET hf=${hf.toFixed(4)} m, 閉形式=${ref.toFixed(4)} m, 誤差=${err.toFixed(3)}%`);
    });
  }

  test("流量 2 倍で摩擦損失が 2^1.852 倍になる（H-W の指数則）", async () => {
    const r1 = await calcSteadyNetworkEpanet(singlePipeInput(0.3, 1000, 130, 0.05));
    const r2 = await calcSteadyNetworkEpanet(singlePipeInput(0.3, 1000, 130, 0.10));
    const ratio = pipeOf(r2, "p1")!.frictionLoss / pipeOf(r1, "p1")!.frictionLoss;
    const err = Math.abs(relErrPct(ratio, Math.pow(2, 1.852)));
    assert.ok(err < 0.5, `比=${ratio.toFixed(4)}, 理論=${Math.pow(2, 1.852).toFixed(4)}, 誤差=${err.toFixed(3)}%`);
  });

  test("流速 V = Q/A が 0.5% 以内で成立する", async () => {
    const D = 0.35, Q = 0.12;
    const r = await calcSteadyNetworkEpanet(singlePipeInput(D, 800, 130, Q));
    const ref = Q / (Math.PI * D * D / 4);
    const err = Math.abs(relErrPct(pipeOf(r, "p1")!.velocity, ref));
    assert.ok(err < 0.5, `V=${pipeOf(r, "p1")!.velocity.toFixed(4)}, Q/A=${ref.toFixed(4)}, 誤差=${err.toFixed(3)}%`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// E2 局部損失
// ═══════════════════════════════════════════════════════════════════════════════

describe("E2 EPANET の局部損失が Σf·v²/2g と一致する", () => {
  // 契約の確認: NetworkPipeResult では
  //   totalLoss    = 摩擦損失 + 局部損失（EPANET の EN_HEADLOSS そのもの）
  //   frictionLoss = 摩擦損失のみ（アダプタが Σf·hv を差し引いて分離する）
  // TS ネイティブ実装と同じ意味づけになっている。
  const D = 0.30, Q = 0.10, L = 1000, C = 130, K = 5;
  const V = Q / (Math.PI * D * D / 4);

  test("totalLoss が 摩擦 + Σf·v²/2g の閉形式と 0.5% 以内", async () => {
    const r = await calcSteadyNetworkEpanet(singlePipeInput(D, L, C, Q, K));
    // EPANET は g = 9.81 で局部損失を評価する（core の GRAVITY = 9.8 とは別）
    const ref = hazenWilliamsClosedForm(L, Q, C, D) + K * V * V / (2 * 9.81);
    const err = Math.abs(relErrPct(pipeOf(r, "p1")!.totalLoss, ref));
    assert.ok(err < 0.5, `EPANET totalLoss=${pipeOf(r, "p1")!.totalLoss.toFixed(4)} m, 閉形式=${ref.toFixed(4)} m, 誤差=${err.toFixed(3)}%`);
  });

  test("frictionLoss は局部損失を含まず、純摩擦の閉形式と 0.5% 以内", async () => {
    const r = await calcSteadyNetworkEpanet(singlePipeInput(D, L, C, Q, K));
    const ref = hazenWilliamsClosedForm(L, Q, C, D);
    const err = Math.abs(relErrPct(pipeOf(r, "p1")!.frictionLoss, ref));
    assert.ok(err < 0.5, `frictionLoss=${pipeOf(r, "p1")!.frictionLoss.toFixed(4)} m, 純摩擦の閉形式=${ref.toFixed(4)} m, 誤差=${err.toFixed(3)}%`);
  });

  test("totalLoss = frictionLoss + minorLoss", async () => {
    const r = await calcSteadyNetworkEpanet(singlePipeInput(D, L, C, Q, K));
    const p = pipeOf(r, "p1")!;
    assert.ok(Math.abs(p.totalLoss - (p.frictionLoss + p.minorLoss)) < 1e-9);
  });

  test("Σf を与えると全損失が増え、摩擦損失は変わらない", async () => {
    const without = pipeOf(await calcSteadyNetworkEpanet(singlePipeInput(D, L, C, Q)), "p1")!;
    const wit = pipeOf(await calcSteadyNetworkEpanet(singlePipeInput(D, L, C, Q, K)), "p1")!;
    assert.ok(wit.totalLoss > without.totalLoss,
      `Σf あり=${wit.totalLoss.toFixed(4)} m, なし=${without.totalLoss.toFixed(4)} m`);
    assert.ok(Math.abs(relErrPct(wit.frictionLoss, without.frictionLoss)) < 0.1);
  });

  test("摩擦/局部の分離に使う g の差（9.8 vs 9.81）は全損失の 0.2% 未満", async () => {
    const diff = Math.abs(K * V * V / (2 * GRAVITY) - K * V * V / (2 * 9.81));
    const p = pipeOf(await calcSteadyNetworkEpanet(singlePipeInput(D, L, C, Q, K)), "p1")!;
    assert.ok(diff / p.totalLoss < 0.002, `差=${diff.toFixed(5)} m / 全損失=${p.totalLoss.toFixed(4)} m`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// E3 エネルギー収支
// ═══════════════════════════════════════════════════════════════════════════════

describe("E3 EPANET の節点水頭がエネルギー収支を満たす", () => {
  const input: SteadyNetworkInput = {
    pipes: [
      { id: "p1", upstreamNodeId: "R", downstreamNodeId: "N1", innerDiameter: 0.40, length: 600, roughnessC: 130 },
      { id: "p2", upstreamNodeId: "N1", downstreamNodeId: "N2", innerDiameter: 0.30, length: 500, roughnessC: 130, minorLossCoeff: 2 },
      { id: "p3", upstreamNodeId: "N2", downstreamNodeId: "D", innerDiameter: 0.25, length: 400, roughnessC: 130 },
    ],
    nodes: [
      { id: "R", elevation: 0, type: "reservoir", head: 120 },
      { id: "N1", elevation: 10, type: "junction" },
      { id: "N2", elevation: 15, type: "junction" },
      { id: "D", elevation: 20, type: "demand", demand: 0.08 },
    ],
  };

  test("H_貯水槽 − H_末端 = Σ損失（0.01 m 以内）", async () => {
    const r = await calcSteadyNetworkEpanet(input);
    const drop = nodeOf(r, "R")!.head - nodeOf(r, "D")!.head;
    const sumLoss = r.pipeResults.reduce((s, p) => s + p.totalLoss, 0);
    assert.ok(Math.abs(drop - sumLoss) < 0.01, `ΔH=${drop.toFixed(4)} m, Σ損失=${sumLoss.toFixed(4)} m`);
  });

  test("各管路で H_上流 − H_下流 = その管路の全損失（0.01 m 以内）", async () => {
    const r = await calcSteadyNetworkEpanet(input);
    const pairs = [["p1", "R", "N1"], ["p2", "N1", "N2"], ["p3", "N2", "D"]] as const;
    for (const [pid, up, dn] of pairs) {
      const d = nodeOf(r, up)!.head - nodeOf(r, dn)!.head;
      assert.ok(Math.abs(d - pipeOf(r, pid)!.totalLoss) < 0.01,
        `${pid}: ΔH=${d.toFixed(4)} m, 全損失=${pipeOf(r, pid)!.totalLoss.toFixed(4)} m`);
    }
  });

  test("動水頭 = 水頭 − 標高", async () => {
    const r = await calcSteadyNetworkEpanet(input);
    const elev: Record<string, number> = { R: 0, N1: 10, N2: 15, D: 20 };
    for (const n of r.nodeResults) {
      assert.ok(Math.abs(n.pressureHead - (n.head - elev[n.nodeId]!)) < 1e-9, `${n.nodeId}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// E4 ループ（環状）網
// ═══════════════════════════════════════════════════════════════════════════════

const LOOP_INPUT: SteadyNetworkInput = {
  pipes: [
    { id: "p1", upstreamNodeId: "R", downstreamNodeId: "J1", innerDiameter: 0.30, length: 500, roughnessC: 130 },
    { id: "p2", upstreamNodeId: "J1", downstreamNodeId: "J2", innerDiameter: 0.25, length: 400, roughnessC: 130 },
    { id: "p3", upstreamNodeId: "J1", downstreamNodeId: "J2", innerDiameter: 0.25, length: 600, roughnessC: 130 },
    { id: "p4", upstreamNodeId: "J2", downstreamNodeId: "D", innerDiameter: 0.30, length: 300, roughnessC: 130 },
  ],
  nodes: [
    { id: "R", elevation: 0, type: "reservoir", head: 100 },
    { id: "J1", elevation: 0, type: "junction" },
    { id: "J2", elevation: 0, type: "junction" },
    { id: "D", elevation: 0, type: "demand", demand: 0.08 },
  ],
};

describe("E4 EPANET がループ（環状）網を正しく解く", () => {
  test("全 4 管路の結果が返る", async () => {
    const r = await calcSteadyNetworkEpanet(LOOP_INPUT);
    assert.equal(r.pipeResults.length, 4);
    assert.deepEqual(r.warnings, []);
  });

  test("並列 2 枝の連続条件 Q_p2 + Q_p3 = Q_p1 = 需要（0.1% 以内）", async () => {
    const r = await calcSteadyNetworkEpanet(LOOP_INPUT);
    const sum = pipeOf(r, "p2")!.flow + pipeOf(r, "p3")!.flow;
    assert.ok(Math.abs(relErrPct(sum, 0.08)) < 0.1, `Q_p2+Q_p3=${sum.toFixed(5)} m³/s`);
    assert.ok(Math.abs(relErrPct(pipeOf(r, "p1")!.flow, 0.08)) < 0.1);
  });

  test("並列 2 枝の損失が等しい（ループのエネルギー収支 Σhf = 0）", async () => {
    const r = await calcSteadyNetworkEpanet(LOOP_INPUT);
    const h2 = pipeOf(r, "p2")!.frictionLoss, h3 = pipeOf(r, "p3")!.frictionLoss;
    assert.ok(Math.abs(h2 - h3) < 0.01, `hf(p2)=${h2.toFixed(4)} m, hf(p3)=${h3.toFixed(4)} m`);
  });

  test("短い枝（L=400m）の方が流量が多い", async () => {
    const r = await calcSteadyNetworkEpanet(LOOP_INPUT);
    assert.ok(pipeOf(r, "p2")!.flow > pipeOf(r, "p3")!.flow,
      `Q_p2=${pipeOf(r, "p2")!.flow.toFixed(5)}, Q_p3=${pipeOf(r, "p3")!.flow.toFixed(5)}`);
  });

  test("分流比が H-W 閉形式から解いた理論値と 1% 以内で一致する", async () => {
    // 並列枝は hf が等しい: k2·Q2^1.852 = k3·Q3^1.852、k ∝ L（D, C 共通）
    // → Q2/Q3 = (L3/L2)^(1/1.852)
    const r = await calcSteadyNetworkEpanet(LOOP_INPUT);
    const ratio = pipeOf(r, "p2")!.flow / pipeOf(r, "p3")!.flow;
    const ref = Math.pow(600 / 400, 1 / 1.852);
    const err = Math.abs(relErrPct(ratio, ref));
    assert.ok(err < 1.0, `Q2/Q3=${ratio.toFixed(4)}, 理論=${ref.toFixed(4)}, 誤差=${err.toFixed(3)}%`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// E5 複数貯水槽
// ═══════════════════════════════════════════════════════════════════════════════

const TWO_RESERVOIR_INPUT: SteadyNetworkInput = {
  pipes: [
    { id: "p1", upstreamNodeId: "R1", downstreamNodeId: "J", innerDiameter: 0.30, length: 500, roughnessC: 130 },
    { id: "p2", upstreamNodeId: "R2", downstreamNodeId: "J", innerDiameter: 0.30, length: 500, roughnessC: 130 },
    { id: "p3", upstreamNodeId: "J", downstreamNodeId: "D", innerDiameter: 0.30, length: 300, roughnessC: 130 },
  ],
  nodes: [
    { id: "R1", elevation: 0, type: "reservoir", head: 100 },
    { id: "R2", elevation: 0, type: "reservoir", head: 95 },
    { id: "J", elevation: 0, type: "junction" },
    { id: "D", elevation: 0, type: "demand", demand: 0.10 },
  ],
};

describe("E5 EPANET が複数貯水槽を正しく解く", () => {
  test("全 3 管路の結果が返る", async () => {
    const r = await calcSteadyNetworkEpanet(TWO_RESERVOIR_INPUT);
    assert.equal(r.pipeResults.length, 3);
  });

  test("接合点 J の連続条件 Q_p1 + Q_p2 = Q_p3（0.1% 以内）", async () => {
    const r = await calcSteadyNetworkEpanet(TWO_RESERVOIR_INPUT);
    const sum = pipeOf(r, "p1")!.flow + pipeOf(r, "p2")!.flow;
    assert.ok(Math.abs(relErrPct(sum, pipeOf(r, "p3")!.flow)) < 0.1,
      `Q_p1+Q_p2=${sum.toFixed(5)}, Q_p3=${pipeOf(r, "p3")!.flow.toFixed(5)}`);
  });

  test("接合点水頭が低い方の貯水槽より高くなり、p2 は逆流（負の流量）になる", async () => {
    const r = await calcSteadyNetworkEpanet(TWO_RESERVOIR_INPUT);
    const hJ = nodeOf(r, "J")!.head;
    assert.ok(hJ > 95, `H_J=${hJ.toFixed(3)} m > H_R2=95 m`);
    assert.ok(pipeOf(r, "p2")!.flow < 0, `Q_p2=${pipeOf(r, "p2")!.flow.toFixed(5)} m³/s（R2 へ流れ込む）`);
  });

  test("各枝のエネルギー収支 |H_R − H_J| = hf（0.01 m 以内）", async () => {
    const r = await calcSteadyNetworkEpanet(TWO_RESERVOIR_INPUT);
    const hJ = nodeOf(r, "J")!.head;
    for (const [pid, rid] of [["p1", "R1"], ["p2", "R2"]] as const) {
      const d = Math.abs(nodeOf(r, rid)!.head - hJ);
      assert.ok(Math.abs(d - pipeOf(r, pid)!.frictionLoss) < 0.01,
        `${pid}: |ΔH|=${d.toFixed(4)} m, hf=${pipeOf(r, pid)!.frictionLoss.toFixed(4)} m`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// E6 適用範囲内での 2 エンジン一致
// ═══════════════════════════════════════════════════════════════════════════════

describe("E6 樹枝状網では EPANET と TS ネイティブ実装が一致する", () => {
  const TREE_INPUT: SteadyNetworkInput = {
    pipes: [
      { id: "main", upstreamNodeId: "R", downstreamNodeId: "J1", innerDiameter: 0.35, length: 900, roughnessC: 130, minorLossCoeff: 1.5 },
      { id: "b1", upstreamNodeId: "J1", downstreamNodeId: "D1", innerDiameter: 0.25, length: 400, roughnessC: 130 },
      { id: "b2", upstreamNodeId: "J1", downstreamNodeId: "J2", innerDiameter: 0.25, length: 300, roughnessC: 130 },
      { id: "b3", upstreamNodeId: "J2", downstreamNodeId: "D2", innerDiameter: 0.20, length: 350, roughnessC: 130 },
      { id: "b4", upstreamNodeId: "J2", downstreamNodeId: "D3", innerDiameter: 0.15, length: 250, roughnessC: 130 },
    ],
    nodes: [
      { id: "R", elevation: 0, type: "reservoir", head: 110 },
      { id: "J1", elevation: 5, type: "junction" },
      { id: "J2", elevation: 8, type: "junction" },
      { id: "D1", elevation: 12, type: "demand", demand: 0.040 },
      { id: "D2", elevation: 15, type: "demand", demand: 0.025 },
      { id: "D3", elevation: 14, type: "demand", demand: 0.015 },
    ],
  };

  test("全管路の流量が 0.1% 以内で一致する", async () => {
    const ep = await calcSteadyNetworkEpanet(TREE_INPUT);
    const ts = calcSteadyNetwork(TREE_INPUT);
    for (const p of ts.pipeResults) {
      const e = pipeOf(ep, p.pipeId)!;
      assert.ok(Math.abs(relErrPct(e.flow, p.flow)) < 0.1,
        `${p.pipeId}: EPANET=${e.flow.toFixed(6)}, TS=${p.flow.toFixed(6)}`);
    }
  });

  test("全節点の水頭が 0.05 m 以内で一致する", async () => {
    const ep = await calcSteadyNetworkEpanet(TREE_INPUT);
    const ts = calcSteadyNetwork(TREE_INPUT);
    for (const n of ts.nodeResults) {
      const e = nodeOf(ep, n.nodeId)!;
      assert.ok(Math.abs(e.head - n.head) < 0.05,
        `${n.nodeId}: EPANET=${e.head.toFixed(4)} m, TS=${n.head.toFixed(4)} m, 差=${(e.head - n.head).toFixed(4)} m`);
    }
  });

  test("最大流速が 1% 以内で一致する", async () => {
    const ep = await calcSteadyNetworkEpanet(TREE_INPUT);
    const ts = calcSteadyNetwork(TREE_INPUT);
    assert.ok(Math.abs(relErrPct(ep.maxVelocity, ts.maxVelocity)) < 1.0,
      `EPANET=${ep.maxVelocity.toFixed(4)} m/s, TS=${ts.maxVelocity.toFixed(4)} m/s`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// E7 適用範囲外での乖離（エンジン選択で結果が変わる条件）
//
// TS ネイティブ実装（`calcSteadyNetwork` / core-py `calc_steady_network`）は
// 「樹枝状・単一貯水槽・需要は type:"demand" ノードのみ」を前提とし、前提を
// 外れた入力に対して例外も警告も返さない。以下はその乖離を数値で記録する。
// 正しいのは EPANET 側。
// ═══════════════════════════════════════════════════════════════════════════════

describe("E7【要注意】適用範囲外では 2 エンジンの結果が乖離する", () => {
  test("ループ網: TS は管路 1 本を落とし、末端水頭が 2.7 m 過小になる", async () => {
    const ep = await calcSteadyNetworkEpanet(LOOP_INPUT);
    const ts = calcSteadyNetwork(LOOP_INPUT);
    assert.equal(ep.pipeResults.length, 4);
    assert.equal(ts.pipeResults.length, 3, "TS がループ管を扱えるようになった = 実装が改善された");
    const diff = nodeOf(ep, "D")!.head - nodeOf(ts, "D")!.head;
    assert.ok(diff > 2.5 && diff < 3.0,
      `H_D の差 = ${diff.toFixed(3)} m（EPANET=${nodeOf(ep, "D")!.head.toFixed(2)}, TS=${nodeOf(ts, "D")!.head.toFixed(2)}）`);
    // EPANET は正しく解くので無警告。TS は閉路検出で乖離を通知する
    assert.deepEqual(ep.warnings, []);
    assert.equal(ts.warnings.length, 1, `TS warnings=${JSON.stringify(ts.warnings)}`);
    assert.match(ts.warnings[0]!, /閉路（ループまたは複数貯水槽の並行流入）を検出しました: p3。/);
  });

  test('type:"junction" の demand: TS は無視して水頭を 2.3 m 高く（危険側に）出す', async () => {
    const input: SteadyNetworkInput = {
      pipes: [
        { id: "p1", upstreamNodeId: "R", downstreamNodeId: "J", innerDiameter: 0.30, length: 500, roughnessC: 130 },
        { id: "p2", upstreamNodeId: "J", downstreamNodeId: "D", innerDiameter: 0.25, length: 400, roughnessC: 130 },
      ],
      nodes: [
        { id: "R", elevation: 0, type: "reservoir", head: 100 },
        { id: "J", elevation: 0, type: "junction", demand: 0.05 },
        { id: "D", elevation: 0, type: "demand", demand: 0.05 },
      ],
    };
    const ep = await calcSteadyNetworkEpanet(input);
    const ts = calcSteadyNetwork(input);
    // EPANET は上流管に 0.10 を流す。TS は 0.05 のみ
    assert.ok(Math.abs(relErrPct(pipeOf(ep, "p1")!.flow, 0.10)) < 0.1,
      `EPANET Q_p1=${pipeOf(ep, "p1")!.flow.toFixed(5)}`);
    assert.ok(Math.abs(pipeOf(ts, "p1")!.flow - 0.05) < 1e-12,
      "TS が junction の demand を集計するようになった = 実装が改善された");
    const diff = nodeOf(ts, "J")!.head - nodeOf(ep, "J")!.head;
    assert.ok(diff > 2.0 && diff < 2.6,
      `H_J の差 = ${diff.toFixed(3)} m（TS の方が高い = 危険側）`);
  });

  test("複数貯水槽: TS は 2 つ目の貯水槽を落とし、接合点水頭が 1.5 m 高く出る", async () => {
    const ep = await calcSteadyNetworkEpanet(TWO_RESERVOIR_INPUT);
    const ts = calcSteadyNetwork(TWO_RESERVOIR_INPUT);
    assert.equal(pipeOf(ts, "p2"), undefined, "TS が 2 つ目の貯水槽を扱えるようになった = 実装が改善された");
    const diff = nodeOf(ts, "J")!.head - nodeOf(ep, "J")!.head;
    assert.ok(diff > 1.3 && diff < 1.8,
      `H_J の差 = ${diff.toFixed(3)} m（EPANET=${nodeOf(ep, "J")!.head.toFixed(2)}, TS=${nodeOf(ts, "J")!.head.toFixed(2)}）`);
    // TS は除外管路と複数貯水槽の両方を警告する
    assert.equal(ts.warnings.length, 2, `TS warnings=${JSON.stringify(ts.warnings)}`);
    assert.match(ts.warnings[1]!, /reservoir ノードが 2 個あります/);
  });
});
