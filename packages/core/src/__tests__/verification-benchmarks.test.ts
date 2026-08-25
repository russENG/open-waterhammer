/**
 * 検証ベンチマーク — 解析解・厳密解との突き合わせ
 *
 * 既存の moc.test.ts / steady-network.test.ts / network-verification.test.ts は
 * 「クラッシュしない」「相対的に増える/減る」といった挙動テストが中心である。
 * 本ファイルはそれとは別に、**独立に導出できる解析解と数値を突き合わせる**
 * ことで計算実装そのものの正しさを検証する（V&V: Verification & Validation）。
 *
 * ── 定常計算 ────────────────────────────────────────────────────────────────
 *   S1  ヘーゼン・ウィリアムス式の閉形式（EPANET SI 係数式）との一致
 *   S2  直列管路のエネルギー収支 H_R − H_end = Σ損失
 *   S3  樹枝状網の連続条件 Q_幹線 = Σ Q_末端需要
 *   S4  局部損失 Σf·v²/2g の閉形式一致
 *   S5  【適用限界】樹枝状・単一貯水槽・demand ノード前提を外れた入力の挙動
 *
 * ── 非定常計算（MOC）─────────────────────────────────────────────────────────
 *   T1  ジューコフスキーの式（瞬時閉・摩擦なし）ΔH = a·V₀/g
 *   T2  格子収束性（N を増やしても解が収束する）
 *   T3  圧力波の周期 4L/a と位相
 *   T4  定常保持（バルブ操作がなければ定常解を厳密に維持する）
 *   T5  分岐点の連続条件 ΣQ_in = ΣQ_out と節点水頭の一意性
 *   T6  断面変化点の透過係数 2B₁/(B₁+B₂)
 *   T7  アリエビ連鎖式（摩擦なし緩閉そくの厳密解）との一致
 *   T8  摩擦による減衰が単調であること（エネルギー散逸の符号）
 *   T9  CFL 条件 Δt = Δx/a
 *   T10 【適用限界】負圧は 0 m でクランプされる（水柱分離モデルなし）
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { runMoc, runMocSinglePipe, type MocNetwork } from "../moc.js";
import { calcSteadyNetwork } from "../steady-network.js";
import { GRAVITY, joukowsky } from "../formulas.js";
import type { Pipe } from "../types.js";

// ═══════════════════════════════════════════════════════════════════════════════
// 解析解ヘルパー（実装とは独立に、教科書の式から直接書き下したもの）
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * ヘーゼン・ウィリアムス式の閉形式（SI 単位・EPANET が内部で使う係数形）
 *   hf = 10.67 · L · Q^1.852 / (C^1.852 · D^4.871)
 *
 * `steady-network.ts` は V = 0.849·C·R^0.63·I^0.54 を I について解く形で
 * 実装しており、指数 1/0.54 = 1.85185… と 1.852 の差だけずれる（≈0.07%）。
 */
function hazenWilliamsClosedForm(L: number, Q: number, C: number, D: number): number {
  return (10.67 * L * Math.pow(Q, 1.852)) / (Math.pow(C, 1.852) * Math.pow(D, 4.871));
}

/**
 * アリエビ連鎖式（interlocking equations）— 摩擦なし単一管路（貯水槽→バルブ）の**厳密解**
 *
 *   h_i + h_{i-1} = 2 + 2ρ(τ_{i-1}√h_{i-1} − τ_i√h_i)
 *   ρ = a·V₀/(2·g·H₀),  h = H/H₀,  h₀ = 1, τ₀ = 1
 *
 * t_i = i·(2L/a) におけるバルブ端水頭比 h を返す。MOC の緩閉そく解はこれに
 * 一致しなければならない（Allievi 1903 / Wylie & Streeter §3）。
 *
 * 実装メモ: x = √h_i と置くと x² + 2ρτ_i·x − K = 0（K = 2 + 2ρτ_{i-1}√h_{i-1} − h_{i-1}）。
 */
function allieviChain(rho: number, taus: number[]): number[] {
  const h: number[] = [1];
  for (let i = 1; i < taus.length; i++) {
    const hPrev = h[i - 1]!;
    const K = 2 + 2 * rho * (taus[i - 1]! * Math.sqrt(hPrev)) - hPrev;
    const b = 2 * rho * taus[i]!;
    const x = (-b + Math.sqrt(b * b + 4 * Math.max(K, 0))) / 2;
    h.push(x * x);
  }
  return h;
}

/** 相対誤差 [%] */
function relErrPct(actual: number, reference: number): number {
  return (actual / reference - 1) * 100;
}

// ═══════════════════════════════════════════════════════════════════════════════
// S. 定常計算の検証
// ═══════════════════════════════════════════════════════════════════════════════

/** 単一管路（貯水槽 → 需要端）の定常計算 */
function singlePipeSteady(D: number, L: number, C: number, Q: number, minorLossCoeff?: number) {
  return calcSteadyNetwork({
    pipes: [{
      id: "p1", upstreamNodeId: "R", downstreamNodeId: "D",
      innerDiameter: D, length: L, roughnessC: C,
      ...(minorLossCoeff !== undefined && { minorLossCoeff }),
    }],
    nodes: [
      { id: "R", elevation: 0, type: "reservoir", head: 100 },
      { id: "D", elevation: 0, type: "demand", demand: Q },
    ],
  });
}

describe("S1 定常: ヘーゼン・ウィリアムス式が閉形式と一致する", () => {
  const cases: { D: number; L: number; C: number; Q: number }[] = [
    { D: 0.30, L: 1000, C: 130, Q: 0.10 },
    { D: 0.40, L: 500, C: 110, Q: 0.20 },
    { D: 0.20, L: 2000, C: 150, Q: 0.03 },
    { D: 0.60, L: 3000, C: 100, Q: 0.50 },
  ];

  for (const { D, L, C, Q } of cases) {
    test(`φ${D * 1000}mm L=${L}m C=${C} Q=${Q}m³/s の摩擦損失が閉形式と 0.5% 以内`, () => {
      const hf = singlePipeSteady(D, L, C, Q).pipeResults[0]!.frictionLoss;
      const ref = hazenWilliamsClosedForm(L, Q, C, D);
      const err = Math.abs(relErrPct(hf, ref));
      assert.ok(err < 0.5, `hf=${hf.toFixed(4)} m, 閉形式=${ref.toFixed(4)} m, 誤差=${err.toFixed(3)}%`);
    });
  }

  test("流量 2 倍で摩擦損失が 2^1.852 倍になる（H-W の指数則）", () => {
    const hf1 = singlePipeSteady(0.3, 1000, 130, 0.05).pipeResults[0]!.frictionLoss;
    const hf2 = singlePipeSteady(0.3, 1000, 130, 0.10).pipeResults[0]!.frictionLoss;
    const err = Math.abs(relErrPct(hf2 / hf1, Math.pow(2, 1.852)));
    assert.ok(err < 0.5, `比=${(hf2 / hf1).toFixed(4)}, 理論=${Math.pow(2, 1.852).toFixed(4)}, 誤差=${err.toFixed(3)}%`);
  });

  test("流速 V = Q/A が厳密に成立する", () => {
    const D = 0.35, Q = 0.12;
    const V = singlePipeSteady(D, 800, 130, Q).pipeResults[0]!.velocity;
    const ref = Q / (Math.PI * D * D / 4);
    assert.ok(Math.abs(V - ref) < 1e-12, `V=${V}, Q/A=${ref}`);
  });
});

describe("S2 定常: 直列管路のエネルギー収支", () => {
  const result = calcSteadyNetwork({
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
  });

  test("H_貯水槽 − H_末端 = Σ全損失（丸め誤差以内）", () => {
    const hR = result.nodeResults.find(n => n.nodeId === "R")!.head;
    const hD = result.nodeResults.find(n => n.nodeId === "D")!.head;
    const sumLoss = result.pipeResults.reduce((s, p) => s + p.totalLoss, 0);
    assert.ok(Math.abs((hR - hD) - sumLoss) < 1e-9, `ΔH=${(hR - hD).toFixed(9)}, Σ損失=${sumLoss.toFixed(9)}`);
  });

  test("各管路の摩擦損失が個別に閉形式と 0.5% 以内で一致する", () => {
    const defs = [
      { id: "p1", D: 0.40, L: 600 }, { id: "p2", D: 0.30, L: 500 }, { id: "p3", D: 0.25, L: 400 },
    ];
    for (const { id, D, L } of defs) {
      const pr = result.pipeResults.find(p => p.pipeId === id)!;
      const ref = hazenWilliamsClosedForm(L, pr.flow, 130, D);
      const err = Math.abs(relErrPct(pr.frictionLoss, ref));
      assert.ok(err < 0.5, `${id}: hf=${pr.frictionLoss.toFixed(4)}, 閉形式=${ref.toFixed(4)}, 誤差=${err.toFixed(3)}%`);
    }
  });

  test("動水頭 = 水頭 − 標高 が厳密に成立する", () => {
    const elev: Record<string, number> = { R: 0, N1: 10, N2: 15, D: 20 };
    for (const n of result.nodeResults) {
      assert.ok(Math.abs(n.pressureHead - (n.head - elev[n.nodeId]!)) < 1e-12, `${n.nodeId}`);
    }
  });
});

describe("S3 定常: 樹枝状網の連続条件", () => {
  const demands = { D1: 0.040, D2: 0.025, D3: 0.015 };
  const result = calcSteadyNetwork({
    pipes: [
      { id: "main", upstreamNodeId: "R", downstreamNodeId: "J1", innerDiameter: 0.35, length: 900, roughnessC: 130 },
      { id: "b1", upstreamNodeId: "J1", downstreamNodeId: "D1", innerDiameter: 0.25, length: 400, roughnessC: 130 },
      { id: "b2", upstreamNodeId: "J1", downstreamNodeId: "J2", innerDiameter: 0.25, length: 300, roughnessC: 130 },
      { id: "b3", upstreamNodeId: "J2", downstreamNodeId: "D2", innerDiameter: 0.20, length: 350, roughnessC: 130 },
      { id: "b4", upstreamNodeId: "J2", downstreamNodeId: "D3", innerDiameter: 0.15, length: 250, roughnessC: 130 },
    ],
    nodes: [
      { id: "R", elevation: 0, type: "reservoir", head: 110 },
      { id: "J1", elevation: 5, type: "junction" },
      { id: "J2", elevation: 8, type: "junction" },
      { id: "D1", elevation: 12, type: "demand", demand: demands.D1 },
      { id: "D2", elevation: 15, type: "demand", demand: demands.D2 },
      { id: "D3", elevation: 14, type: "demand", demand: demands.D3 },
    ],
  });
  const flow = (id: string) => result.pipeResults.find(p => p.pipeId === id)!.flow;

  test("幹線流量 = 全需要合計", () => {
    const total = demands.D1 + demands.D2 + demands.D3;
    assert.ok(Math.abs(flow("main") - total) < 1e-12, `main=${flow("main")}, Σ需要=${total}`);
  });

  test("J1 の連続条件: Q_main = Q_b1 + Q_b2", () => {
    assert.ok(Math.abs(flow("main") - flow("b1") - flow("b2")) < 1e-12);
  });

  test("J2 の連続条件: Q_b2 = Q_b3 + Q_b4", () => {
    assert.ok(Math.abs(flow("b2") - flow("b3") - flow("b4")) < 1e-12);
  });

  test("各末端の水頭 = 貯水槽水頭 − 経路上の損失合計", () => {
    const hR = result.nodeResults.find(n => n.nodeId === "R")!.head;
    const loss = (id: string) => result.pipeResults.find(p => p.pipeId === id)!.totalLoss;
    const paths: Record<string, string[]> = {
      D1: ["main", "b1"], D2: ["main", "b2", "b3"], D3: ["main", "b2", "b4"],
    };
    for (const [nodeId, path] of Object.entries(paths)) {
      const expected = hR - path.reduce((s, id) => s + loss(id), 0);
      const actual = result.nodeResults.find(n => n.nodeId === nodeId)!.head;
      assert.ok(Math.abs(actual - expected) < 1e-9, `${nodeId}: ${actual} vs ${expected}`);
    }
  });
});

describe("S4 定常: 局部損失が Σf·v²/2g と一致する", () => {
  test("Σf=5 の局部損失が閉形式と一致する", () => {
    const D = 0.30, Q = 0.10, K = 5;
    const pr = singlePipeSteady(D, 1000, 130, Q, K).pipeResults[0]!;
    const V = Q / (Math.PI * D * D / 4);
    const ref = K * V * V / (2 * GRAVITY);
    assert.ok(Math.abs(pr.minorLoss - ref) < 1e-12, `minorLoss=${pr.minorLoss}, 閉形式=${ref}`);
  });

  test("Σf 未指定なら局部損失は 0", () => {
    assert.equal(singlePipeSteady(0.3, 1000, 130, 0.1).pipeResults[0]!.minorLoss, 0);
  });

  test("全損失 = 摩擦損失 + 局部損失", () => {
    const pr = singlePipeSteady(0.3, 1000, 130, 0.1, 3).pipeResults[0]!;
    assert.ok(Math.abs(pr.totalLoss - (pr.frictionLoss + pr.minorLoss)) < 1e-12);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S5 適用限界の検証
//
// `calcSteadyNetwork` は「樹枝状・単一貯水槽・需要は type:"demand" ノードのみ」を
// 前提とする。前提を外れた入力では別の系統を解いた答えを返すため、
// **閉路（ループ・複数貯水槽）は warnings で通知する**（例外は投げない）。
// 正しい値は EPANET と突き合わせた
// packages/epanet-adapter/src/__tests__/steady-verification.test.ts を参照。
//
// ⚠ 数値そのものを固定している assert は特性化テスト（characterization test）である。
//    ソルバーがループを解けるようになったら失敗するので、期待値を書き換えること。
// ─────────────────────────────────────────────────────────────────────────────

describe("S5 定常【適用限界】前提を外れた入力", () => {
  test("ループ（環状）網: 並列管が計算から除外され、警告で通知される", () => {
    const r = calcSteadyNetwork({
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
    });
    // 入力は管路 4 本だが結果は 3 本しか返らない（p3 が欠落）
    assert.equal(r.pipeResults.length, 3, "ループ管 p3 が欠落していない = 実装が改善された");
    assert.equal(r.pipeResults.find(p => p.pipeId === "p3"), undefined);
    // 分流されず p2 に全量が載る（EPANET は 0.0444 / 0.0356 に分流する）
    assert.ok(Math.abs(r.pipeResults.find(p => p.pipeId === "p2")!.flow - 0.08) < 1e-12);
    // 末端水頭は EPANET の 95.21 m に対し 92.46 m（-2.75 m の過小評価）
    const hD = r.nodeResults.find(n => n.nodeId === "D")!.head;
    assert.ok(Math.abs(hD - 92.46) < 0.05, `H_D=${hD.toFixed(2)} m（EPANET 厳密解は 95.21 m）`);
    // 結果は誤っているが、閉路検出の警告で利用者に通知される
    assert.equal(r.warnings.length, 1, `warnings=${JSON.stringify(r.warnings)}`);
    assert.match(r.warnings[0]!, /閉路（ループまたは複数貯水槽の並行流入）を検出しました: p3。/);
    assert.match(r.warnings[0]!, /EPANET 経路で計算してください/);
  });

  test("ループ検出は樹枝状網では誤検知しない", () => {
    const r = calcSteadyNetwork({
      pipes: [
        { id: "p1", upstreamNodeId: "R", downstreamNodeId: "J", innerDiameter: 0.30, length: 500, roughnessC: 130 },
        { id: "p2", upstreamNodeId: "J", downstreamNodeId: "D1", innerDiameter: 0.25, length: 400, roughnessC: 130 },
        { id: "p3", upstreamNodeId: "J", downstreamNodeId: "D2", innerDiameter: 0.25, length: 600, roughnessC: 130 },
      ],
      nodes: [
        { id: "R", elevation: 0, type: "reservoir", head: 100 },
        { id: "J", elevation: 0, type: "junction" },
        { id: "D1", elevation: 0, type: "demand", demand: 0.05 },
        { id: "D2", elevation: 0, type: "demand", demand: 0.03 },
      ],
    });
    assert.equal(r.pipeResults.length, 3);
    assert.equal(r.warnings.filter(w => w.includes("閉路")).length, 0, JSON.stringify(r.warnings));
  });

  test("到達不能ノードに繋がる管路は閉路として誤報告しない", () => {
    const r = calcSteadyNetwork({
      pipes: [
        { id: "p1", upstreamNodeId: "R", downstreamNodeId: "D1", innerDiameter: 0.30, length: 500, roughnessC: 130 },
        // 貯水槽から切り離された島
        { id: "p2", upstreamNodeId: "X1", downstreamNodeId: "X2", innerDiameter: 0.25, length: 400, roughnessC: 130 },
      ],
      nodes: [
        { id: "R", elevation: 0, type: "reservoir", head: 100 },
        { id: "D1", elevation: 0, type: "demand", demand: 0.05 },
        { id: "X1", elevation: 0, type: "junction" },
        { id: "X2", elevation: 0, type: "demand", demand: 0.01 },
      ],
    });
    assert.equal(r.warnings.filter(w => w.includes("閉路")).length, 0, JSON.stringify(r.warnings));
    assert.equal(r.warnings.filter(w => w.includes("到達できません")).length, 2, JSON.stringify(r.warnings));
  });

  test('【未対応】type:"junction" ノードの demand は依然として黙って無視される', () => {
    const r = calcSteadyNetwork({
      pipes: [
        { id: "p1", upstreamNodeId: "R", downstreamNodeId: "J", innerDiameter: 0.30, length: 500, roughnessC: 130 },
        { id: "p2", upstreamNodeId: "J", downstreamNodeId: "D", innerDiameter: 0.25, length: 400, roughnessC: 130 },
      ],
      nodes: [
        { id: "R", elevation: 0, type: "reservoir", head: 100 },
        { id: "J", elevation: 0, type: "junction", demand: 0.05 },
        { id: "D", elevation: 0, type: "demand", demand: 0.05 },
      ],
    });
    // 上流管の流量は 0.10 であるべきだが 0.05 になる
    assert.ok(Math.abs(r.pipeResults.find(p => p.pipeId === "p1")!.flow - 0.05) < 1e-12,
      "junction の demand が集計された = 実装が改善された");
    // 結果として節点水頭が危険側（高め）に出る（EPANET 厳密解は 96.79 m）
    const hJ = r.nodeResults.find(n => n.nodeId === "J")!.head;
    assert.ok(Math.abs(hJ - 99.11) < 0.05, `H_J=${hJ.toFixed(2)} m（EPANET 厳密解は 96.79 m）`);
    // トポロジは樹枝状なので閉路検出には掛からず、警告なしのまま誤答する
    assert.deepEqual(r.warnings, [], "junction の demand に警告が実装された = 実装が改善された");
  });

  test("貯水槽が 2 つあると 2 つ目からの流入が無視され、警告で通知される", () => {
    const r = calcSteadyNetwork({
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
    });
    // p2 が結果に現れない（EPANET は R2 へ -0.0238 m³/s の逆流を出す）
    assert.equal(r.pipeResults.find(p => p.pipeId === "p2"), undefined,
      "2 つ目の貯水槽が扱われた = 実装が改善された");
    const hJ = r.nodeResults.find(n => n.nodeId === "J")!.head;
    assert.ok(Math.abs(hJ - 96.78) < 0.05, `H_J=${hJ.toFixed(2)} m（EPANET 厳密解は 95.23 m）`);
    // 除外された管路と、貯水槽が複数ある事実の両方を通知する
    assert.equal(r.warnings.length, 2, `warnings=${JSON.stringify(r.warnings)}`);
    assert.match(r.warnings[0]!, /閉路（ループまたは複数貯水槽の並行流入）を検出しました: p2。/);
    assert.match(r.warnings[1]!, /reservoir ノードが 2 個あります（R1, R2）。/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T. 非定常計算（MOC）の検証
// ═══════════════════════════════════════════════════════════════════════════════

/** 検証用の基準管路 φ500 × L=1200 m（a を外から与えるので管厚は形式的） */
const BENCH_PIPE: Pipe = {
  id: "bench", startNodeId: "upstream", endNodeId: "downstream",
  pipeType: "steel", innerDiameter: 0.5, wallThickness: 0.010,
  length: 1200, roughnessCoeff: 130,
};
/** 摩擦を無視するための実質無限大の粗度係数（解析解と比較する場合に使う） */
const FRICTIONLESS_C = 1e6;

const A_WAVE = 1000;   // 波速 a [m/s]
const V0 = 1.0;        // 初期流速 [m/s]
const H0 = 100;        // バルブ端初期水頭 [m]
const T_ROUND = 2 * BENCH_PIPE.length / A_WAVE;  // 圧力波往復時間 2L/a = 2.4 s
const T_PERIOD = 2 * T_ROUND;                    // 振動周期 4L/a = 4.8 s

function frictionlessValveClose(closeTime: number, nReaches: number, tMax: number) {
  return runMocSinglePipe({
    pipe: { ...BENCH_PIPE, roughnessCoeff: FRICTIONLESS_C },
    waveSpeed: A_WAVE, initialVelocity: V0, initialDownstreamHead: H0,
    closeTime, nReaches, tMax,
  });
}

describe("T1 非定常: ジューコフスキーの式との一致（瞬時閉・摩擦なし）", () => {
  const N = 40;
  const res = frictionlessValveClose(0, N, 4 * T_PERIOD);
  const p = res.pipes["pipe_0"]!;
  const dHTheory = joukowsky(A_WAVE, -V0); // = a·V₀/g

  test("理論値 ΔH = a·V₀/g が正しく評価できる", () => {
    assert.ok(Math.abs(dHTheory - A_WAVE * V0 / GRAVITY) < 1e-12);
  });

  test("バルブ端の最大水頭上昇が ΔH = a·V₀/g と 1% 以内で一致する", () => {
    const dH = p.Hmax[N]! - H0;
    const err = Math.abs(relErrPct(dH, dHTheory));
    assert.ok(err < 1.0, `MOC ΔH=${dH.toFixed(2)} m, 理論=${dHTheory.toFixed(2)} m, 誤差=${err.toFixed(2)}%`);
  });

  test("貯水槽端では水頭が変化しない（定水頭境界）", () => {
    assert.ok(Math.abs(p.Hmax[0]! - p.H_steady[0]!) < 1e-9);
    assert.ok(Math.abs(p.Hmin[0]! - p.H_steady[0]!) < 1e-9);
  });

  test("閉そく直後の圧力上昇は矩形波（0 < t < 2L/a で一定）", () => {
    const series = res.nodes["downstream"]!.H;
    const front = series.filter(s => s.t > 0.15 * T_ROUND && s.t < 0.85 * T_ROUND).map(s => s.H);
    const spread = Math.max(...front) - Math.min(...front);
    assert.ok(spread < 0.02 * dHTheory, `矩形波の平坦部のばらつき=${spread.toFixed(3)} m`);
  });
});

describe("T2 非定常: 格子収束性", () => {
  const results = [10, 20, 40, 80].map(N => ({
    N, dH: frictionlessValveClose(0, N, 4 * T_PERIOD).pipes["pipe_0"]!.Hmax[N]! - H0,
  }));
  const dHTheory = joukowsky(A_WAVE, -V0);

  test("すべての分割数で理論値と 1% 以内", () => {
    for (const { N, dH } of results) {
      const err = Math.abs(relErrPct(dH, dHTheory));
      assert.ok(err < 1.0, `N=${N}: ΔH=${dH.toFixed(3)}, 誤差=${err.toFixed(3)}%`);
    }
  });

  test("分割数を 8 倍にしても解の変化が 0.1% 未満（収束している）", () => {
    const coarse = results[0]!.dH, fine = results[3]!.dH;
    const err = Math.abs(relErrPct(fine, coarse));
    assert.ok(err < 0.1, `N=10 → N=80 の変化=${err.toFixed(4)}%`);
  });
});

describe("T3 非定常: 圧力波の周期 4L/a と位相", () => {
  const N = 40;
  const res = frictionlessValveClose(0, N, 2.5 * T_PERIOD);
  const series = res.nodes["downstream"]!.H;
  const at = (t: number) => series.reduce((b, c) => (Math.abs(c.t - t) < Math.abs(b.t - t) ? c : b)).H;

  test("T0（振動周期）= 4L/a が結果に記録されている", () => {
    assert.ok(Math.abs(res.pipes["pipe_0"]!.vibrationPeriod - T_PERIOD) < 1e-9);
  });

  test("t = 0.25T / 1.25T / 2.25T は高圧相（H > H₀）", () => {
    for (const k of [0.25, 1.25, 2.25]) {
      assert.ok(at(k * T_PERIOD) > H0 + 1, `t=${k}T: H=${at(k * T_PERIOD).toFixed(2)}`);
    }
  });

  test("t = 0.75T / 1.75T は低圧相（H < H₀）", () => {
    for (const k of [0.75, 1.75]) {
      assert.ok(at(k * T_PERIOD) < H0 - 1, `t=${k}T: H=${at(k * T_PERIOD).toFixed(2)}`);
    }
  });

  test("1 周期後の水頭が元の位相に戻る（摩擦なしなので 2% 以内）", () => {
    const err = Math.abs(at(0.25 * T_PERIOD) - at(1.25 * T_PERIOD));
    assert.ok(err < 0.02 * (at(0.25 * T_PERIOD) - H0), `1周期のずれ=${err.toFixed(3)} m`);
  });
});

describe("T4 非定常: 定常保持（操作がなければ定常解を厳密に維持する）", () => {
  const D = 0.5, L = 1200, C = 130;
  const A = Math.PI * D * D / 4;
  const Q0 = V0 * A;
  const steady = calcSteadyNetwork({
    pipes: [{ id: "p", upstreamNodeId: "R", downstreamNodeId: "D", innerDiameter: D, length: L, roughnessC: C }],
    nodes: [
      { id: "R", elevation: 0, type: "reservoir", head: 100 },
      { id: "D", elevation: 0, type: "demand", demand: Q0 },
    ],
  });
  const hf = steady.pipeResults[0]!.frictionLoss;

  const net: MocNetwork = {
    pipes: [{
      id: "p1", pipe: { ...BENCH_PIPE, innerDiameter: D, length: L, roughnessCoeff: C },
      waveSpeed: A_WAVE, nReaches: 12, upstreamNodeId: "R", downstreamNodeId: "V", initialFlow: Q0,
    }],
    // closeTime を十分長くとることで τ ≒ 1（操作なし）とする
    nodes: { R: { type: "reservoir", head: 100 }, V: { type: "valve", Q0, H0v: 100 - hf, closeTime: 1e9 } },
  };
  const res = runMoc(net, { tMax: 30 });
  const p = res.pipes["p1"]!;

  test("MOC の定常初期条件が定常計算の摩擦損失と 1% 以内で一致する", () => {
    const hfMoc = p.H_steady[0]! - p.H_steady[12]!;
    const err = Math.abs(relErrPct(hfMoc, hf));
    assert.ok(err < 1.0, `MOC hf=${hfMoc.toFixed(4)} m, 定常計算 hf=${hf.toFixed(4)} m, 誤差=${err.toFixed(3)}%`);
  });

  test("30 秒間、全格子点で水頭が定常値から動かない", () => {
    for (let i = 0; i <= 12; i++) {
      assert.ok(Math.abs(p.Hmax[i]! - p.H_steady[i]!) < 1e-6, `i=${i} Hmax がドリフト`);
      assert.ok(Math.abs(p.Hmin[i]! - p.H_steady[i]!) < 1e-6, `i=${i} Hmin がドリフト`);
    }
  });

  test("バルブ端の水頭時系列の変動幅が 1e-6 m 未満", () => {
    const hs = res.nodes["V"]!.H.map(s => s.H);
    assert.ok(Math.max(...hs) - Math.min(...hs) < 1e-6);
  });
});

describe("T5 非定常: 分岐点の連続条件と節点水頭の一意性", () => {
  const mk = (D: number, L: number): Pipe => ({ ...BENCH_PIPE, innerDiameter: D, length: L });
  const net: MocNetwork = {
    pipes: [
      { id: "m", pipe: mk(0.40, 800), waveSpeed: A_WAVE, nReaches: 8, upstreamNodeId: "R", downstreamNodeId: "J", initialFlow: 0.16 },
      { id: "a", pipe: mk(0.30, 600), waveSpeed: A_WAVE, nReaches: 6, upstreamNodeId: "J", downstreamNodeId: "VA", initialFlow: 0.10 },
      { id: "b", pipe: mk(0.25, 400), waveSpeed: A_WAVE, nReaches: 4, upstreamNodeId: "J", downstreamNodeId: "VB", initialFlow: 0.06 },
    ],
    nodes: {
      R: { type: "reservoir", head: 100 },
      VA: { type: "valve", Q0: 0.10, H0v: 90, closeTime: 2 },
      VB: { type: "valve", Q0: 0.06, H0v: 92, closeTime: 1e9 },
    },
  };
  const res = runMoc(net, { tMax: 12 });
  const m = res.pipes["m"]!, pa = res.pipes["a"]!, pb = res.pipes["b"]!;

  test("全スナップショットで ΣQ_in = ΣQ_out（1e-12 以内）", () => {
    let maxErr = 0;
    for (let k = 0; k < m.snapshots.length; k++) {
      const err = Math.abs(m.snapshots[k]!.Q[m.nReaches]! - pa.snapshots[k]!.Q[0]! - pb.snapshots[k]!.Q[0]!);
      maxErr = Math.max(maxErr, err);
    }
    assert.ok(maxErr < 1e-12, `分岐点の流量不釣り合い 最大 ${maxErr.toExponential(3)} m³/s`);
  });

  test("分岐点に接続する 3 管路の端点水頭が完全に一致する", () => {
    let maxErr = 0;
    for (let k = 0; k < m.snapshots.length; k++) {
      const h = m.snapshots[k]!.H[m.nReaches]!;
      maxErr = Math.max(maxErr, Math.abs(h - pa.snapshots[k]!.H[0]!), Math.abs(h - pb.snapshots[k]!.H[0]!));
    }
    assert.ok(maxErr < 1e-12, `分岐点の水頭不一致 最大 ${maxErr.toExponential(3)} m`);
  });

  test("開いたままのバルブ B にも水撃圧が伝播する（分岐を跨ぐ）", () => {
    assert.ok(pb.Hmax[pb.nReaches]! > 92 + 1, `H_VB,max=${pb.Hmax[pb.nReaches]!.toFixed(2)} m`);
  });
});

describe("T6 非定常: 断面変化点の透過係数 2B₁/(B₁+B₂)", () => {
  // 摩擦なし・上流 φ500 / 下流 φ300 の直列 2 管路、下流端で瞬時閉。
  // 下流管で立った ΔH = a·V₀/g が接合部に到達すると、上流管へは
  // 透過係数 2B₁/(B₁+B₂) 倍で伝わる（B = a/(g·A) は特性インピーダンス）。
  const D1 = 0.5, D2 = 0.3, L1 = 1000, L2 = 600, V2 = 1.0;
  const A1 = Math.PI * D1 * D1 / 4, A2 = Math.PI * D2 * D2 / 4;
  const Q0 = V2 * A2;
  const B1 = A_WAVE / (GRAVITY * A1), B2 = A_WAVE / (GRAVITY * A2);
  const mk = (D: number, L: number): Pipe => ({ ...BENCH_PIPE, innerDiameter: D, length: L, roughnessCoeff: FRICTIONLESS_C });

  const res = runMoc({
    pipes: [
      { id: "up", pipe: mk(D1, L1), waveSpeed: A_WAVE, nReaches: 10, upstreamNodeId: "R", downstreamNodeId: "C", initialFlow: Q0 },
      { id: "dn", pipe: mk(D2, L2), waveSpeed: A_WAVE, nReaches: 6, upstreamNodeId: "C", downstreamNodeId: "V", initialFlow: Q0 },
    ],
    nodes: { R: { type: "reservoir", head: H0 }, V: { type: "valve", Q0, H0v: H0, closeTime: 0 } },
  }, { tMax: 2.0 });

  const dHJoukowsky = A_WAVE * V2 / GRAVITY;
  const tArrive = L2 / A_WAVE;

  test("バルブ端の ΔH がジューコフスキー値と 1% 以内", () => {
    const hv = res.nodes["V"]!.H.filter(s => s.t < tArrive).map(s => s.H);
    const err = Math.abs(relErrPct(Math.max(...hv) - H0, dHJoukowsky));
    assert.ok(err < 1.0, `ΔH_valve=${(Math.max(...hv) - H0).toFixed(2)}, 理論=${dHJoukowsky.toFixed(2)}, 誤差=${err.toFixed(2)}%`);
  });

  test("接合部の ΔH が透過係数 2B₁/(B₁+B₂) 倍と 2% 以内で一致する", () => {
    const transmit = 2 * B1 / (B1 + B2);
    const window = res.nodes["C"]!.H.filter(s => s.t > tArrive + 0.05 && s.t < tArrive + 0.40).map(s => s.H);
    const dHc = Math.max(...window) - H0;
    const ref = dHJoukowsky * transmit;
    const err = Math.abs(relErrPct(dHc, ref));
    assert.ok(err < 2.0, `ΔH_C=${dHc.toFixed(2)} m, 理論=${ref.toFixed(2)} m（透過係数=${transmit.toFixed(4)}）, 誤差=${err.toFixed(2)}%`);
  });

  test("縮小管（B₂ > B₁）では接合部の ΔH がバルブ端より小さい", () => {
    assert.ok(B2 > B1);
    const dHc = Math.max(...res.nodes["C"]!.H.map(s => s.H)) - H0;
    assert.ok(dHc < dHJoukowsky, `ΔH_C=${dHc.toFixed(2)} < ΔH_joukowsky=${dHJoukowsky.toFixed(2)}`);
  });
});

describe("T7 非定常: アリエビ連鎖式（緩閉そくの厳密解）との一致", () => {
  const rho = A_WAVE * V0 / (2 * GRAVITY * H0); // 管路特性値 ρ = a·V₀/(2gH₀)

  // 閉そく時間を 2L/a の整数倍にとると、連鎖式の格子時刻と MOC の記録時刻が揃う
  for (const nT of [2, 4, 6, 10]) {
    const tc = nT * T_ROUND;
    const nSteps = nT + 4;
    const taus = Array.from({ length: nSteps + 1 }, (_, i) => Math.max(0, 1 - (i * T_ROUND) / tc));
    const hTheory = allieviChain(rho, taus);

    const N = 60;
    const res = frictionlessValveClose(tc, N, nSteps * T_ROUND);
    const hMoc = res.pipes["pipe_0"]!.Hmax[N]! / H0;

    test(`tν = ${nT}×(2L/a) = ${tc.toFixed(1)} s: 最大水頭比が厳密解と 0.5% 以内`, () => {
      const ref = Math.max(...hTheory);
      const err = Math.abs(relErrPct(hMoc, ref));
      assert.ok(err < 0.5,
        `MOC h_max=${hMoc.toFixed(4)}, アリエビ連鎖式=${ref.toFixed(4)}, 誤差=${err.toFixed(3)}%`);
    });

    test(`tν = ${nT}×(2L/a): 各 2L/a 時点の水頭比が厳密解と 1% 以内`, () => {
      const series = res.nodes["downstream"]!.H;
      const at = (t: number) => series.reduce((b, c) => (Math.abs(c.t - t) < Math.abs(b.t - t) ? c : b)).H / H0;
      for (let i = 1; i < hTheory.length; i++) {
        const err = Math.abs(relErrPct(at(i * T_ROUND), hTheory[i]!));
        assert.ok(err < 1.0,
          `i=${i} (t=${(i * T_ROUND).toFixed(1)}s): MOC=${at(i * T_ROUND).toFixed(4)}, 厳密解=${hTheory[i]!.toFixed(4)}, 誤差=${err.toFixed(3)}%`);
      }
    });
  }

  test("tν = 2L/a（急閉そくの境界）ではジューコフスキー値に一致する", () => {
    const N = 60;
    const res = frictionlessValveClose(T_ROUND, N, 4 * T_PERIOD);
    const dH = res.pipes["pipe_0"]!.Hmax[N]! - H0;
    const err = Math.abs(relErrPct(dH, joukowsky(A_WAVE, -V0)));
    assert.ok(err < 2.0, `ΔH=${dH.toFixed(2)} m, ジューコフスキー=${joukowsky(A_WAVE, -V0).toFixed(2)} m, 誤差=${err.toFixed(2)}%`);
  });

  test("閉そく時間を延ばすと最大水頭が単調に減少する", () => {
    const N = 60;
    const peaks = [2, 4, 6, 10].map(nT =>
      frictionlessValveClose(nT * T_ROUND, N, (nT + 4) * T_ROUND).pipes["pipe_0"]!.Hmax[N]!);
    for (let i = 1; i < peaks.length; i++) {
      assert.ok(peaks[i]! < peaks[i - 1]!, `tν の増加で Hmax が下がらない: ${peaks.map(v => v.toFixed(2)).join(" -> ")}`);
    }
  });
});

describe("T8 非定常: 摩擦による減衰（エネルギー散逸の符号）", () => {
  const N = 40;
  const res = runMocSinglePipe({
    pipe: BENCH_PIPE, waveSpeed: A_WAVE, initialVelocity: V0,
    initialDownstreamHead: H0, closeTime: 0, nReaches: N, tMax: 10 * T_PERIOD,
  });
  const series = res.nodes["downstream"]!.H;

  /** 各周期の振幅（最大 − 最小） */
  const amplitudes = Array.from({ length: 10 }, (_, c) => {
    const win = series.filter(s => s.t >= c * T_PERIOD && s.t < (c + 1) * T_PERIOD).map(s => s.H);
    return win.length >= 4 ? Math.max(...win) - Math.min(...win) : Number.NaN;
  }).filter(v => Number.isFinite(v));

  test("10 周期分の振幅が取得できる", () => {
    assert.ok(amplitudes.length >= 8, `取得できた周期数=${amplitudes.length}`);
  });

  test("振幅が周期ごとに単調減少する（増幅しない＝数値的に安定）", () => {
    for (let i = 1; i < amplitudes.length; i++) {
      assert.ok(amplitudes[i]! <= amplitudes[i - 1]! + 1e-9,
        `${i} 周期目で振幅が増加: ${amplitudes.map(v => v.toFixed(2)).join(" -> ")}`);
    }
  });

  test("10 周期後に振幅が初期の 80% 以下まで減衰する", () => {
    const last = amplitudes[amplitudes.length - 1]!;
    assert.ok(last < 0.8 * amplitudes[0]!, `初期=${amplitudes[0]!.toFixed(2)} → 最終=${last.toFixed(2)}`);
  });

  test("粗度係数 C を大きくすると減衰が小さくなる（摩擦が原因であることの対照）", () => {
    const f = frictionlessValveClose(0, N, 10 * T_PERIOD);
    const s = f.nodes["downstream"]!.H;
    const amp = (c: number) => {
      const w = s.filter(x => x.t >= c * T_PERIOD && x.t < (c + 1) * T_PERIOD).map(x => x.H);
      return Math.max(...w) - Math.min(...w);
    };
    const ratioSmooth = amp(9) / amp(0);
    const ratioRough = amplitudes[amplitudes.length - 1]! / amplitudes[0]!;
    assert.ok(ratioSmooth > ratioRough,
      `C=1e6 の残存率=${ratioSmooth.toFixed(3)} が C=130 の ${ratioRough.toFixed(3)} 以下`);
  });

  // 【実装特性】localDarcyF は等価ダルシー係数を max(0.005, min(…, 0.15)) で
  // 挟み込み、さらに |V| < 1e-4 では f = 0.02 を返す。このため粗度係数 C を
  // どれだけ大きくしても摩擦は完全には消えず、残留減衰が残る。
  // 解析解（摩擦なし）と比較する際は 1〜2% 程度の系統誤差として見込む必要がある。
  test("【実装特性】C→∞ でも摩擦係数の下限により残留減衰がある", () => {
    const f = frictionlessValveClose(0, N, 10 * T_PERIOD);
    const s = f.nodes["downstream"]!.H;
    const amp = (c: number) => {
      const w = s.filter(x => x.t >= c * T_PERIOD && x.t < (c + 1) * T_PERIOD).map(x => x.H);
      return Math.max(...w) - Math.min(...w);
    };
    const ratio = amp(9) / amp(0);
    assert.ok(ratio < 1.0, `C=1e6 で全く減衰しない = 実装が変わった（残存率=${ratio.toFixed(4)}）`);
    assert.ok(ratio > 0.85, `C=1e6 の 10 周期後残存率=${ratio.toFixed(4)}（現状 ≈0.905）`);
  });
});

describe("T9 非定常: CFL 条件 Δt = Δx/a", () => {
  const res = runMoc({
    pipes: [
      { id: "p1", pipe: { ...BENCH_PIPE, length: 1200 }, waveSpeed: 1000, nReaches: 12, upstreamNodeId: "R", downstreamNodeId: "J", initialFlow: 0.1 },
      { id: "p2", pipe: { ...BENCH_PIPE, length: 800, innerDiameter: 0.3 }, waveSpeed: 800, nReaches: 10, upstreamNodeId: "J", downstreamNodeId: "V", initialFlow: 0.1 },
    ],
    nodes: { R: { type: "reservoir", head: 100 }, V: { type: "valve", Q0: 0.1, H0v: 95, closeTime: 1.5 } },
  }, { tMax: 8 });

  test("全管路で Δx / (a·Δt) ≒ 1 が成立する（誤差 5% 以内）", () => {
    for (const [id, p] of Object.entries(res.pipes)) {
      const cfl = p.dx / (p.waveSpeed * res.dt);
      assert.ok(Math.abs(cfl - 1) < 0.05, `${id}: Δx/(a·Δt)=${cfl.toFixed(4)}`);
    }
  });

  test("Δx = L / nReaches が成立する", () => {
    assert.ok(Math.abs(res.pipes["p1"]!.dx - 1200 / res.pipes["p1"]!.nReaches) < 1e-9);
    assert.ok(Math.abs(res.pipes["p2"]!.dx - 800 / res.pipes["p2"]!.nReaches) < 1e-9);
  });

  test("共通 Δt は各管路の素の Δt の最小値以下", () => {
    assert.ok(res.dt <= 1200 / (1000 * 12) + 1e-12);
    assert.ok(res.dt <= 800 / (800 * 10) + 1e-12);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 適用限界の特性化テスト
// ─────────────────────────────────────────────────────────────────────────────

describe("T10 非定常【適用限界】境界節点の負圧が 0 m で打ち切られる", () => {
  // 摩擦なし・瞬時閉では理論上 Hmin = H₀ − a·V₀/g = 100 − 102.04 = −2.04 m。
  // 本ソルバーは水柱分離（キャビテーション）モデルを持たず、さらに境界条件
  // ソルバー（バルブ・行き止まり・ポンプ等）が Math.max(…, 0) で水頭を 0 m 以上に
  // 丸めるため、下降側の水撃圧が**過小評価（危険側）**になる。
  // 内部格子点にはクランプがないため負値自体は現れるが、境界の打ち切りが
  // 特性線を通じて内部にも伝わり、理論値までは下がらない。
  // → 負圧が想定される系では §8.3 の防護工検討が別途必要（README「適用限界」参照）。
  const N = 40;
  const res = frictionlessValveClose(0, N, 4 * T_PERIOD);
  const p = res.pipes["pipe_0"]!;
  const hTheoryMin = H0 - joukowsky(A_WAVE, -V0); // = −2.04 m

  test("理論上の最小水頭は負になる条件を選んでいる", () => {
    assert.ok(hTheoryMin < 0, `理論 Hmin=${hTheoryMin.toFixed(2)} m`);
  });

  test("バルブ節点（境界）の Hmin はちょうど 0 m で打ち切られる", () => {
    assert.ok(Math.abs(p.Hmin[N]!) < 1e-9,
      `Hmin[valve]=${p.Hmin[N]!.toFixed(6)} m — 0 でない = 実装が変わった`);
  });

  test("内部格子点は負値になるが、理論値の半分にも届かない", () => {
    const interiorMin = Math.min(...p.Hmin.slice(1, N));
    assert.ok(interiorMin < 0, `内部 Hmin=${interiorMin.toFixed(4)} m（負値が出ない = 実装が変わった）`);
    assert.ok(interiorMin > hTheoryMin / 2,
      `内部 Hmin=${interiorMin.toFixed(4)} m（理論=${hTheoryMin.toFixed(2)} m。現状 ≈-0.40 m まで打ち切られる）`);
  });

  test("初期水頭が十分高くクランプが働かない場合は、下降側も理論値と 2% 以内で一致する", () => {
    const res2 = runMocSinglePipe({
      pipe: { ...BENCH_PIPE, roughnessCoeff: FRICTIONLESS_C },
      waveSpeed: A_WAVE, initialVelocity: V0, initialDownstreamHead: 300,
      closeTime: 0, nReaches: N, tMax: T_PERIOD,
    });
    const p2 = res2.pipes["pipe_0"]!;
    const dHDown = 300 - p2.Hmin[N]!;
    const err = Math.abs(relErrPct(dHDown, joukowsky(A_WAVE, -V0)));
    // 残差 1.2% は T8 の「摩擦係数の下限」による系統誤差
    assert.ok(err < 2.0,
      `ΔH_下降=${dHDown.toFixed(2)} m, 理論=${joukowsky(A_WAVE, -V0).toFixed(2)} m, 誤差=${err.toFixed(2)}%`);
  });
});
