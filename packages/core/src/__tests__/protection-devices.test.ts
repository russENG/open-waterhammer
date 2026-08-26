/**
 * 防護工の境界条件 — 管路末端／管路途中（インライン）配置（issue #47）
 *
 * エアチャンバ・調圧水槽・吸気弁・減圧弁は、実務ではいずれも**管路の途中**に
 * 設置する。従来の実装はこれらを「流入管 1 本の末端」としてしか解いておらず、
 * インライン配置では流出管の流量が 0 に固定され、防護工が完全閉そくとして
 * 働いてしまっていた。
 *
 * 本ファイルは以下を検証する。
 *   D1  インライン配置で下流管の流量が 0 にならない
 *   D2  節点の連続条件 ΣQ_in − ΣQ_out = Q_dev が数値的に成立する
 *   D3  装置の状態量（空気容積・タンク水位）が変化する
 *   D4  防護効果（Hmax 低下・Hmin 上昇）が現れる
 *   D5  減圧弁は下流側を設定圧に保ち、上流側と異なる水頭を持つ
 *   D6  管路末端配置でも同じソルバーで整合が取れる（既存挙動の維持）
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { runMoc, type BoundaryCondition, type MocResult } from "../moc.js";
import { calcWaveSpeed } from "../formulas.js";
import type { Pipe } from "../types.js";

// ═══════════════════════════════════════════════════════════════════════════════
// 共通の系: 貯水槽 ─700m─ M ─700m─ バルブ（2 秒で閉）
// M に各種防護工を置く。tMax は saveEvery=1（毎ステップ記録）になるよう選ぶ。
// ═══════════════════════════════════════════════════════════════════════════════

function mk(id: string, L: number): Pipe {
  return {
    id, startNodeId: "a", endNodeId: "b", pipeType: "ductile_iron",
    innerDiameter: 0.25, wallThickness: 0.006, length: L, roughnessCoeff: 130,
  };
}

const A_WAVE = calcWaveSpeed(mk("x", 100));
const Q0 = 0.05;
const T_MAX = 15;

function runInline(device?: BoundaryCondition): MocResult {
  const nodes: Record<string, BoundaryCondition> = {
    R: { type: "reservoir", head: 100 },
    V: { type: "valve", Q0, H0v: 90, closeTime: 2, operation: "close" },
  };
  if (device) nodes["M"] = device;
  return runMoc({
    pipes: [
      { id: "up", pipe: mk("up", 700), waveSpeed: A_WAVE, nReaches: 7, upstreamNodeId: "R", downstreamNodeId: "M", initialFlow: Q0 },
      { id: "dn", pipe: mk("dn", 700), waveSpeed: A_WAVE, nReaches: 7, upstreamNodeId: "M", downstreamNodeId: "V", initialFlow: Q0 },
    ],
    nodes,
  }, { tMax: T_MAX, initialFlow: Q0 });
}

/** 節点 M における流入・流出流量の時系列 */
function nodeFlows(res: MocResult): { qin: number[]; qout: number[]; t: number[] } {
  const up = res.pipes["up"]!, dn = res.pipes["dn"]!;
  return {
    qin: up.snapshots.map(s => s.Q[up.nReaches]!),
    qout: dn.snapshots.map(s => s.Q[0]!),
    t: up.snapshots.map(s => s.t),
  };
}

const AIR_CHAMBER: BoundaryCondition = { type: "air_chamber", V_air0: 0.5, H_air0: 95, polytropicIndex: 1.2 };
const SURGE_TANK: BoundaryCondition = { type: "surge_tank", tankArea: 3.0, initialLevel: 95, datum: 0 };
const AIR_VALVE: BoundaryCondition = { type: "air_release_valve", atmosphericHead: 10.33 };
const PRV: BoundaryCondition = { type: "pressure_reducing_valve", setHead: 60, Q0 };

const DEVICES: [string, BoundaryCondition][] = [
  ["エアチャンバ", AIR_CHAMBER],
  ["調圧水槽", SURGE_TANK],
  ["吸気弁", AIR_VALVE],
  ["減圧弁", PRV],
];

// ─────────────────────────────────────────────────────────────────────────────
// D1 インライン配置で下流管が遮断されない
// ─────────────────────────────────────────────────────────────────────────────

describe("D1 防護工をインライン配置しても下流管が遮断されない", () => {
  for (const [name, bc] of DEVICES) {
    test(`${name}: 下流管の流量が初期ステップから 0 に固定されない`, () => {
      const { qout } = nodeFlows(runInline(bc));
      const early = qout.slice(1, 6);
      assert.ok(early.some(q => Math.abs(q) > 1e-6),
        `${name}: 下流管の流量が全て 0（= 完全閉そくとして働いている）: ${early.join(", ")}`);
    });
  }

  test("防護工なしの場合と初期の下流流量が同程度である（吸気弁は非作動なので一致）", () => {
    const base = nodeFlows(runInline()).qout;
    const av = nodeFlows(runInline(AIR_VALVE)).qout;
    // 吸気弁は節点水頭が大気圧を下回らない限り作動しないので、素の接合点と一致する
    for (let k = 0; k < base.length; k++) {
      assert.ok(Math.abs(base[k]! - av[k]!) < 1e-12, `k=${k}: ${base[k]} vs ${av[k]}`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D2 節点の連続条件
// ─────────────────────────────────────────────────────────────────────────────

describe("D2 節点の連続条件 ΣQ_in − ΣQ_out = Q_dev", () => {
  test("エアチャンバ: Q_in − Q_out = (V_prev − V_new)/Δt", () => {
    const res = runInline(AIR_CHAMBER);
    const { qin, qout } = nodeFlows(res);
    const v = res.nodes["M"]!.V_air!.map(s => s.V);
    assert.equal(v.length, qin.length, "空気容積と流量の記録点数が揃っていない");
    let maxErr = 0;
    for (let k = 1; k < v.length; k++) {
      const qDev = (v[k - 1]! - v[k]!) / res.dt;
      maxErr = Math.max(maxErr, Math.abs((qin[k]! - qout[k]!) - qDev));
    }
    assert.ok(maxErr < 1e-9, `連続条件の不釣り合い 最大 ${maxErr.toExponential(3)} m³/s`);
  });

  test("調圧水槽: Q_in − Q_out = A_s·(z_new − z_prev)/Δt", () => {
    const res = runInline(SURGE_TANK);
    const { qin, qout } = nodeFlows(res);
    const z = res.nodes["M"]!.z!.map(s => s.z);
    assert.equal(z.length, qin.length);
    let maxErr = 0;
    for (let k = 1; k < z.length; k++) {
      const qDev = 3.0 * (z[k]! - z[k - 1]!) / res.dt;
      maxErr = Math.max(maxErr, Math.abs((qin[k]! - qout[k]!) - qDev));
    }
    assert.ok(maxErr < 1e-9, `連続条件の不釣り合い 最大 ${maxErr.toExponential(3)} m³/s`);
  });

  test("吸気弁（非作動）と減圧弁（通常制御）は Q_in = Q_out（装置流量なし）", () => {
    for (const [name, bc] of [["吸気弁", AIR_VALVE], ["減圧弁", PRV]] as const) {
      const { qin, qout } = nodeFlows(runInline(bc));
      let maxErr = 0;
      for (let k = 0; k < qin.length; k++) maxErr = Math.max(maxErr, Math.abs(qin[k]! - qout[k]!));
      assert.ok(maxErr < 1e-9, `${name}: Q_in ≠ Q_out（最大差 ${maxErr.toExponential(3)}）`);
    }
  });

  test("防護工なしの接合点でも Q_in = Q_out（対照）", () => {
    const { qin, qout } = nodeFlows(runInline());
    let maxErr = 0;
    for (let k = 0; k < qin.length; k++) maxErr = Math.max(maxErr, Math.abs(qin[k]! - qout[k]!));
    assert.ok(maxErr < 1e-12, `最大差 ${maxErr.toExponential(3)}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D3 装置の状態量が変化する
// ─────────────────────────────────────────────────────────────────────────────

describe("D3 インライン配置でも装置の状態量が応答する", () => {
  test("エアチャンバ: 空気容積が圧縮・膨張の両方向に動く", () => {
    const v = runInline(AIR_CHAMBER).nodes["M"]!.V_air!.map(s => s.V);
    assert.ok(Math.min(...v) < v[0]! - 1e-6, `圧縮していない（最小 ${Math.min(...v)}）`);
    assert.ok(Math.max(...v) > v[0]! + 1e-6, `膨張していない（最大 ${Math.max(...v)}）`);
  });

  test("エアチャンバ: 空気容積が下限（初期の 2%）を割らない", () => {
    const v = runInline(AIR_CHAMBER).nodes["M"]!.V_air!.map(s => s.V);
    assert.ok(Math.min(...v) >= 0.5 * 0.02 - 1e-12, `最小 ${Math.min(...v)}`);
  });

  test("調圧水槽: 水位が変動する", () => {
    const z = runInline(SURGE_TANK).nodes["M"]!.z!.map(s => s.z);
    assert.ok(Math.max(...z) - Math.min(...z) > 1e-3, `変動幅 ${Math.max(...z) - Math.min(...z)}`);
  });

  test("エアチャンバ: 節点水頭がポリトロープ気体則と整合する", () => {
    const res = runInline(AIR_CHAMBER);
    const v = res.nodes["M"]!.V_air!.map(s => s.V);
    const h = res.nodes["M"]!.H;
    // H·V^m = H_a0·V_a0^m
    const ref = 95 * Math.pow(0.5, 1.2);
    let maxRel = 0;
    for (let k = 1; k < v.length; k++) {
      const hk = h.find(p => Math.abs(p.t - res.nodes["M"]!.V_air![k]!.t) < 1e-12)!.H;
      maxRel = Math.max(maxRel, Math.abs(hk * Math.pow(v[k]!, 1.2) / ref - 1));
    }
    assert.ok(maxRel < 1e-6, `気体則からのずれ 最大 ${(maxRel * 100).toFixed(6)}%`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D4 防護効果
// ─────────────────────────────────────────────────────────────────────────────

describe("D4 インライン配置の防護工が水撃圧を低減する", () => {
  const base = runInline().pipes["dn"]!;
  const baseMax = Math.max(...base.Hmax);
  const baseMin = Math.min(...base.Hmin);

  for (const [name, bc] of [["エアチャンバ", AIR_CHAMBER], ["調圧水槽", SURGE_TANK]] as const) {
    test(`${name}: 下流管の最大水頭が下がる`, () => {
      const hmax = Math.max(...runInline(bc).pipes["dn"]!.Hmax);
      assert.ok(hmax < baseMax, `${name} Hmax=${hmax.toFixed(2)} ≧ 防護なし ${baseMax.toFixed(2)}`);
    });

    test(`${name}: 下流管の最小水頭が上がる（負圧が緩和される）`, () => {
      const hmin = Math.min(...runInline(bc).pipes["dn"]!.Hmin);
      assert.ok(hmin > baseMin, `${name} Hmin=${hmin.toFixed(2)} ≦ 防護なし ${baseMin.toFixed(2)}`);
    });
  }

  test("防護なしでは負圧が発生する条件を選んでいる", () => {
    assert.ok(baseMin < 0, `防護なし Hmin=${baseMin.toFixed(2)} m`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D5 減圧弁
// ─────────────────────────────────────────────────────────────────────────────

describe("D5 減圧弁は上流側と下流側で異なる水頭を持つ", () => {
  const res = runInline(PRV);

  test("下流管の先頭水頭が設定圧 60 m に保たれる", () => {
    const h0 = res.pipes["dn"]!.snapshots.map(s => s.H[0]!);
    // 弁が閉じて流量が無くなるまでは設定圧を維持する
    const controlled = h0.filter((_, k) => res.pipes["dn"]!.snapshots[k]!.Q[0]! > 1e-6);
    assert.ok(controlled.length > 10, "制御中のステップが少なすぎる");
    for (const h of controlled) {
      assert.ok(Math.abs(h - 60) < 1e-9, `下流側水頭=${h.toFixed(6)} m（設定 60 m）`);
    }
  });

  test("上流側の水頭は設定圧より高い（減圧している）", () => {
    const upEnd = res.pipes["up"]!;
    const hUp = upEnd.snapshots.map(s => s.H[upEnd.nReaches]!);
    const q = res.pipes["dn"]!.snapshots.map(s => s.Q[0]!);
    let controlledCount = 0;
    for (let k = 0; k < hUp.length; k++) {
      if (q[k]! <= 1e-6) continue;
      controlledCount++;
      assert.ok(hUp[k]! >= 60 - 1e-9, `k=${k}: 上流側 ${hUp[k]!.toFixed(3)} < 設定 60`);
    }
    assert.ok(controlledCount > 10);
  });

  test("下流管の最大水頭が設定圧近傍に抑えられる（防護なしとの比較）", () => {
    const baseMax = Math.max(...runInline().pipes["dn"]!.Hmax);
    const prvMax = Math.max(...res.pipes["dn"]!.Hmax);
    assert.ok(prvMax < baseMax, `PRV Hmax=${prvMax.toFixed(2)} ≧ 防護なし ${baseMax.toFixed(2)}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D6 管路末端配置（既存挙動の維持）
// ─────────────────────────────────────────────────────────────────────────────

describe("D6 管路末端配置でも同じソルバーで整合が取れる", () => {
  function runTerminus(device: BoundaryCondition): MocResult {
    return runMoc({
      pipes: [{
        id: "p", pipe: mk("p", 700), waveSpeed: A_WAVE, nReaches: 7,
        upstreamNodeId: "R", downstreamNodeId: "M", initialFlow: Q0,
      }],
      nodes: { R: { type: "reservoir", head: 100 }, M: device },
    }, { tMax: T_MAX, initialFlow: Q0 });
  }

  test("末端エアチャンバ: Q_in = (V_prev − V_new)/Δt（流出管が無い特殊ケース）", () => {
    const res = runTerminus(AIR_CHAMBER);
    const p = res.pipes["p"]!;
    const qin = p.snapshots.map(s => s.Q[p.nReaches]!);
    const v = res.nodes["M"]!.V_air!.map(s => s.V);
    let maxErr = 0;
    for (let k = 1; k < v.length; k++) {
      maxErr = Math.max(maxErr, Math.abs(qin[k]! - (v[k - 1]! - v[k]!) / res.dt));
    }
    assert.ok(maxErr < 1e-9, `不釣り合い 最大 ${maxErr.toExponential(3)}`);
  });

  test("末端調圧水槽: Q_in = A_s·(z_new − z_prev)/Δt", () => {
    const res = runTerminus(SURGE_TANK);
    const p = res.pipes["p"]!;
    const qin = p.snapshots.map(s => s.Q[p.nReaches]!);
    const z = res.nodes["M"]!.z!.map(s => s.z);
    let maxErr = 0;
    for (let k = 1; k < z.length; k++) {
      maxErr = Math.max(maxErr, Math.abs(qin[k]! - 3.0 * (z[k]! - z[k - 1]!) / res.dt));
    }
    assert.ok(maxErr < 1e-9, `不釣り合い 最大 ${maxErr.toExponential(3)}`);
  });

  test("末端吸気弁: 節点水頭が大気圧水頭を下回らない", () => {
    const res = runTerminus(AIR_VALVE);
    const h = res.nodes["M"]!.H.map(s => s.H);
    assert.ok(Math.min(...h) >= 10.33 - 1e-9, `最小 ${Math.min(...h).toFixed(4)} m`);
  });

  test("末端減圧弁: 節点水頭が設定圧に保たれる", () => {
    const res = runTerminus(PRV);
    const h = res.nodes["M"]!.H.map(s => s.H);
    for (const v of h.slice(1)) assert.ok(Math.abs(v - 60) < 1e-9, `${v}`);
  });
});
