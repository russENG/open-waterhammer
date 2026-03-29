/**
 * MOC 汎用エンジン テスト
 *
 * 検証:
 *   1. 単一管路バルブ閉そく（ジューコフスキー整合性）
 *   2. 閉そく時間延長で水撃圧低下
 *   3. 出力構造の正確性
 *   4. ポンプ急停止シナリオ
 *   5. 複数管路直列
 *   6. runMocSinglePipe 便利 API（旧互換）
 *   7. GD² ポンプモデル
 *   8. エアチャンバ BC
 *   9. サージタンク BC
 *  10. 吸気弁 BC
 *  11. 減圧バルブ BC
 *  12. T字分岐（3管路ジャンクション）
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  runMoc,
  runMocSinglePipe,
  runMocPumpTrip,
} from "../moc.js";
import { calcWaveSpeed, joukowsky, GRAVITY } from "../formulas.js";
import type { Pipe } from "../types.js";
import type { MocNetwork } from "../moc.js";

// ── テスト用パイプ ─────────────────────────────────────────────────────────────

const PIPE_DI_300: Pipe = {
  id: "p1",
  startNodeId: "N1",
  endNodeId: "N2",
  pipeType: "ductile_iron",
  innerDiameter: 0.300,
  wallThickness: 0.007,
  length: 500,
  roughnessCoeff: 130,
};

const V0 = 1.0;
const H0 = 30.0;
const a = calcWaveSpeed(PIPE_DI_300);
const A = Math.PI * 0.3 * 0.3 / 4;
const Q0 = V0 * A;

// ── ヘルパー ──────────────────────────────────────────────────────────────────

function singlePipeNetwork(closeTime: number, operation: "close" | "open" = "close"): MocNetwork {
  const f = 0.02;
  const hf = f * 500 * V0 * V0 / (2 * GRAVITY * 0.3);
  const HR = H0 + hf;
  return {
    pipes: [{ id: "pipe_0", pipe: PIPE_DI_300, waveSpeed: a, nReaches: 10,
              upstreamNodeId: "up", downstreamNodeId: "dn" }],
    nodes: {
      up: { type: "reservoir", head: HR },
      dn: { type: "valve", Q0, H0v: H0, closeTime, operation },
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════

describe("単一管路バルブ閉 — ジューコフスキー整合性", () => {
  const r = runMoc(singlePipeNetwork(0));  // 瞬時閉
  const pipe0 = r.pipes["pipe_0"]!;
  const dnH   = r.nodes["dn"]!.H;
  const Hmax_dn = Math.max(...dnH.map((p) => p.H));

  const dH_joukowsky = joukowsky(a, -V0);

  test("ΔH_joukowsky > 0", () => {
    assert.ok(dH_joukowsky > 0);
  });

  test("MOC Hmax ≈ H0 + ΔH_joukowsky（±10%）", () => {
    const expected = H0 + dH_joukowsky;
    const err = Math.abs(Hmax_dn - expected) / expected;
    assert.ok(err < 0.10, `Hmax=${Hmax_dn.toFixed(1)}, expected≈${expected.toFixed(1)}, err=${(err*100).toFixed(1)}%`);
  });

  test("Hmax[N] > H0（包絡線に上昇あり）", () => {
    assert.ok(pipe0.Hmax[10]! > H0);
  });

  test("Hmin[N] <= H0（反射波で低下）", () => {
    assert.ok(pipe0.Hmin[10]! <= H0);
  });
});

describe("閉そく時間延長で水撃圧低下", () => {
  const T0 = (4 * 500) / a;
  const r_instant = runMoc(singlePipeNetwork(0));
  const r_slow    = runMoc(singlePipeNetwork(T0 * 2));

  const Hmax_inst = Math.max(...r_instant.nodes["dn"]!.H.map((p) => p.H));
  const Hmax_slow = Math.max(...r_slow.nodes["dn"]!.H.map((p) => p.H));

  test("緩閉そく Hmax < 瞬時閉 Hmax", () => {
    assert.ok(Hmax_slow < Hmax_inst,
      `slow=${Hmax_slow.toFixed(1)}, instant=${Hmax_inst.toFixed(1)}`);
  });
});

describe("出力構造", () => {
  const r = runMoc(singlePipeNetwork(0));

  test("pipes['pipe_0'] が存在", () => {
    assert.ok(r.pipes["pipe_0"] !== undefined);
  });

  test("nodes['up'], nodes['dn'] が存在", () => {
    assert.ok(r.nodes["up"] !== undefined);
    assert.ok(r.nodes["dn"] !== undefined);
  });

  test("スナップショットの節点数 = N+1 = 11", () => {
    for (const snap of r.pipes["pipe_0"]!.snapshots) {
      assert.equal(snap.H.length, 11);
    }
  });

  test("Hmax の長さ = 11", () => {
    assert.equal(r.pipes["pipe_0"]!.Hmax.length, 11);
  });

  test("dt = dx / waveSpeed", () => {
    const ph = r.pipes["pipe_0"]!;
    const expected = ph.dx / ph.waveSpeed;
    assert.ok(Math.abs(r.dt - expected) < 1e-12);
  });

  test("下流端水頭時系列 length >= 100", () => {
    assert.ok(r.nodes["dn"]!.H.length >= 100);
  });
});

describe("runMocSinglePipe（便利 API）", () => {
  const r = runMocSinglePipe({
    pipe: PIPE_DI_300,
    waveSpeed: a,
    initialVelocity: V0,
    initialDownstreamHead: H0,
    closeTime: 0,
    nReaches: 10,
  });

  test("pipe_0 が存在", () => {
    assert.ok(r.pipes["pipe_0"] !== undefined);
  });

  test("下流端水頭が上昇している（瞬時閉）", () => {
    const Hmax = Math.max(...r.nodes["downstream"]!.H.map((p) => p.H));
    assert.ok(Hmax > H0);
  });
});

describe("ポンプ急停止 — runMocPumpTrip", () => {
  const r = runMocPumpTrip({
    pipe: PIPE_DI_300,
    waveSpeed: a,
    Q0,
    pumpHead: 50,
    shutdownTime: 1.0,
    checkValve: true,
    nReaches: 10,
  });

  test("クラッシュしない", () => {
    assert.ok(r.pipes["pipe_0"] !== undefined);
  });

  test("下流端（行き止まり）水頭が存在する", () => {
    assert.ok(r.nodes["dead_end_node"]!.H.length > 0);
  });

  test("ポンプ停止後に負圧が発生している可能性（Hmin < ポンプ揚程）", () => {
    const Hmin = Math.min(...r.nodes["pump_node"]!.H.map((p) => p.H));
    assert.ok(Hmin < 50);
  });
});

describe("複数管路直列", () => {
  // pipe1(300m) → junction → pipe2(200m) → valve
  const PIPE2: Pipe = { ...PIPE_DI_300, id: "p2", length: 200 };
  const a2 = calcWaveSpeed(PIPE2);
  const hf1 = 0.02 * 500 * V0 * V0 / (2 * GRAVITY * 0.3);
  const hf2 = 0.02 * 200 * V0 * V0 / (2 * GRAVITY * 0.3);
  const HR = H0 + hf1 + hf2;

  const network: MocNetwork = {
    pipes: [
      { id: "pipe_1", pipe: PIPE_DI_300, waveSpeed: a,  nReaches: 10, upstreamNodeId: "res",      downstreamNodeId: "junction" },
      { id: "pipe_2", pipe: PIPE2,       waveSpeed: a2, nReaches: 10, upstreamNodeId: "junction", downstreamNodeId: "valve"    },
    ],
    nodes: {
      res:      { type: "reservoir", head: HR },
      valve:    { type: "valve", Q0, H0v: H0, closeTime: 0 },
      junction: { type: "reservoir", head: H0 + hf2 }, // dummy（内部ジャンクションとして自動処理）
    },
  };

  // junction ノードは engines が連続条件で解くため、nodes の定義は上書きされる
  const r = runMoc(network, { initialFlow: Q0 });

  test("pipe_1, pipe_2 の結果が存在", () => {
    assert.ok(r.pipes["pipe_1"] !== undefined);
    assert.ok(r.pipes["pipe_2"] !== undefined);
  });

  test("valve 端水頭が上昇している（閉そく）", () => {
    const Hmax = Math.max(...r.nodes["valve"]!.H.map((p) => p.H));
    assert.ok(Hmax > H0, `Hmax=${Hmax.toFixed(1)}`);
  });
});

describe("V0=0（摩擦なし）でもクラッシュしない", () => {
  test("V0=0 で正常終了", () => {
    assert.doesNotThrow(() => {
      runMocSinglePipe({
        pipe: PIPE_DI_300,
        waveSpeed: a,
        initialVelocity: 0,
        initialDownstreamHead: H0,
        closeTime: 0,
        nReaches: 10,
      });
    });
  });
});

// ── GD² ポンプモデル ──────────────────────────────────────────────────────────

describe("GD² ポンプ急停止モデル", () => {
  // 典型的な農業用ポンプ: N0=1450rpm, GD²=500 N·m², Q0=0.075 m³/s, H0=50 m, η=0.80
  const r = runMocPumpTrip({
    pipe: PIPE_DI_300,
    waveSpeed: a,
    Q0,
    pumpHead: 50,
    Hs: 60,
    GD2: 500,
    N0: 1450,
    eta0: 0.80,
    shutdownTime: 0,
    checkValve: true,
    nReaches: 10,
  });

  test("クラッシュしない", () => {
    assert.ok(r.pipes["pipe_0"] !== undefined);
  });

  test("ポンプ節点の回転速度時系列が記録されている", () => {
    assert.ok(r.nodes["pump_node"]!.N !== undefined);
    assert.ok(r.nodes["pump_node"]!.N!.length > 0);
  });

  test("停止後に回転速度が低下している", () => {
    const Ns = r.nodes["pump_node"]!.N!;
    const N_last = Ns[Ns.length - 1]!.N;
    assert.ok(N_last < 1450, `N_last=${N_last.toFixed(0)}`);
  });

  test("停止後に負圧が発生している可能性（Hmin < H0）", () => {
    const Hmin = Math.min(...r.nodes["pump_node"]!.H.map((p) => p.H));
    assert.ok(Hmin < 50);
  });
});

// ── エアチャンバ BC ───────────────────────────────────────────────────────────

describe("エアチャンバ BC — 負圧抑制", () => {
  // 同じポンプ急停止シナリオにエアチャンバを追加
  // エアチャンバを下流端に配置（dead_end の代わり）
  const H0_pump = 50;
  const r_no_ac = runMocPumpTrip({
    pipe: PIPE_DI_300, waveSpeed: a, Q0, pumpHead: H0_pump,
    shutdownTime: 0, checkValve: true, nReaches: 10,
  });

  const r_with_ac = runMoc({
    pipes: [{ id: "pipe_0", pipe: PIPE_DI_300, waveSpeed: a, nReaches: 10,
              upstreamNodeId: "pump", downstreamNodeId: "ac" }],
    nodes: {
      pump: { type: "pump", Q0, H0: H0_pump, shutdownTime: 0, checkValve: true },
      ac: { type: "air_chamber", V_air0: 0.5, H_air0: H0_pump, polytropicIndex: 1.2 },
    },
  }, { initialFlow: Q0 });

  test("エアチャンバあり: クラッシュしない", () => {
    assert.ok(r_with_ac.pipes["pipe_0"] !== undefined);
  });

  test("エアチャンバあり: V_air 時系列が記録されている", () => {
    assert.ok(r_with_ac.nodes["ac"]!.V_air !== undefined);
    assert.ok(r_with_ac.nodes["ac"]!.V_air!.length > 0);
  });

  test("エアチャンバあり: 下流端 Hmin が dead_end より高い（負圧抑制）", () => {
    // AC なし: dead_end での Hmin
    const Hmin_de = Math.min(...r_no_ac.nodes["dead_end_node"]!.H.map((p) => p.H));
    // AC あり: air_chamber 端での Hmin
    const Hmin_ac = Math.min(...r_with_ac.nodes["ac"]!.H.map((p) => p.H));
    assert.ok(Hmin_ac > Hmin_de,
      `Hmin_ac=${Hmin_ac.toFixed(1)}, Hmin_de=${Hmin_de.toFixed(1)}`);
  });
});

// ── サージタンク BC ───────────────────────────────────────────────────────────

describe("サージタンク BC", () => {
  // 貯水槽 → 管路 → サージタンク（調圧水槽）
  const f_hw = 0.02;
  const hf = f_hw * 500 * V0 * V0 / (2 * GRAVITY * 0.3);
  const HR = H0 + hf;
  const r = runMoc({
    pipes: [{ id: "pipe_0", pipe: PIPE_DI_300, waveSpeed: a, nReaches: 10,
              upstreamNodeId: "res", downstreamNodeId: "st" }],
    nodes: {
      res: { type: "reservoir", head: HR },
      st: { type: "surge_tank", tankArea: 5.0, initialLevel: H0, datum: 0 },
    },
  }, { initialFlow: Q0 });

  test("クラッシュしない", () => {
    assert.ok(r.pipes["pipe_0"] !== undefined);
  });

  test("サージタンク水位時系列が記録されている", () => {
    assert.ok(r.nodes["st"]!.z !== undefined);
    assert.ok(r.nodes["st"]!.z!.length > 0);
  });

  test("水位が変動している（サージング）", () => {
    const zs = r.nodes["st"]!.z!.map((p) => p.z);
    const zMax = Math.max(...zs);
    const zMin = Math.min(...zs);
    assert.ok(zMax - zMin > 0.01, `zMax=${zMax.toFixed(3)}, zMin=${zMin.toFixed(3)}`);
  });
});

// ── 吸気弁 BC ────────────────────────────────────────────────────────────────

describe("吸気弁 BC — 負圧防止", () => {
  // ポンプ急停止後、末端に吸気弁がある場合
  const r_with_av = runMoc({
    pipes: [{ id: "pipe_0", pipe: PIPE_DI_300, waveSpeed: a, nReaches: 10,
              upstreamNodeId: "pump", downstreamNodeId: "av" }],
    nodes: {
      pump: { type: "pump", Q0, H0: 50, shutdownTime: 0, checkValve: true },
      av: { type: "air_release_valve", atmosphericHead: 10.33 },
    },
  }, { initialFlow: Q0 });

  test("クラッシュしない", () => {
    assert.ok(r_with_av.pipes["pipe_0"] !== undefined);
  });

  test("吸気弁端水頭が大気圧以上に維持される（最小値 ≥ 0）", () => {
    const Hmin = Math.min(...r_with_av.nodes["av"]!.H.map((p) => p.H));
    assert.ok(Hmin >= 0, `Hmin=${Hmin.toFixed(2)}`);
  });
});

// ── 減圧バルブ BC ─────────────────────────────────────────────────────────────

describe("減圧バルブ（PRV）BC", () => {
  // 貯水槽（高圧） → 管路 → PRV（下流側を H_set=20m に維持）
  const r = runMoc({
    pipes: [{ id: "pipe_0", pipe: PIPE_DI_300, waveSpeed: a, nReaches: 10,
              upstreamNodeId: "res", downstreamNodeId: "prv" }],
    nodes: {
      res: { type: "reservoir", head: 50 },
      prv: { type: "pressure_reducing_valve", setHead: 20, Q0 },
    },
  }, { initialFlow: Q0 });

  test("クラッシュしない", () => {
    assert.ok(r.pipes["pipe_0"] !== undefined);
  });

  test("PRV 端水頭が設定圧付近に収束している", () => {
    const H_prv = r.nodes["prv"]!.H;
    // 定常後（後半部）の平均水頭が設定圧に近い
    const H_tail = H_prv.slice(-50).map((p) => p.H);
    const H_avg = H_tail.reduce((s, h) => s + h, 0) / H_tail.length;
    assert.ok(Math.abs(H_avg - 20) < 5, `H_avg=${H_avg.toFixed(1)}, expected≈20`);
  });
});

// ── T字分岐（3管路ジャンクション）─────────────────────────────────────────────

describe("T字分岐 — 3管路ジャンクション", () => {
  // 貯水槽 → pipe1 → junction → pipe2 → valve1
  //                          ↓
  //                          pipe3 → valve2
  const PIPE2: Pipe = { ...PIPE_DI_300, id: "p2" };
  const PIPE3: Pipe = { ...PIPE_DI_300, id: "p3" };
  const a2 = calcWaveSpeed(PIPE2);
  const a3 = calcWaveSpeed(PIPE3);
  const Q_branch = Q0 / 2; // 分岐後は半流量

  const r = runMoc({
    pipes: [
      { id: "pipe_1", pipe: PIPE_DI_300, waveSpeed: a,  nReaches: 10,
        upstreamNodeId: "res", downstreamNodeId: "junction" },
      { id: "pipe_2", pipe: PIPE2, waveSpeed: a2, nReaches: 10,
        upstreamNodeId: "junction", downstreamNodeId: "valve1", initialFlow: Q_branch },
      { id: "pipe_3", pipe: PIPE3, waveSpeed: a3, nReaches: 10,
        upstreamNodeId: "junction", downstreamNodeId: "valve2", initialFlow: Q_branch },
    ],
    nodes: {
      res:     { type: "reservoir", head: 50 },
      valve1:  { type: "valve", Q0: Q_branch, H0v: H0, closeTime: 0 },
      valve2:  { type: "valve", Q0: Q_branch, H0v: H0, closeTime: 0 },
    },
  }, { initialFlow: Q0 });

  test("pipe_1, pipe_2, pipe_3 の結果が存在", () => {
    assert.ok(r.pipes["pipe_1"] !== undefined);
    assert.ok(r.pipes["pipe_2"] !== undefined);
    assert.ok(r.pipes["pipe_3"] !== undefined);
  });

  test("分岐点ノードの水頭時系列が記録されている", () => {
    assert.ok(r.nodes["junction"] !== undefined);
    assert.ok(r.nodes["junction"]!.H.length > 0);
  });

  test("両バルブ端で水頭が上昇している", () => {
    const Hmax1 = Math.max(...r.nodes["valve1"]!.H.map((p) => p.H));
    const Hmax2 = Math.max(...r.nodes["valve2"]!.H.map((p) => p.H));
    assert.ok(Hmax1 > H0, `Hmax1=${Hmax1.toFixed(1)}`);
    assert.ok(Hmax2 > H0, `Hmax2=${Hmax2.toFixed(1)}`);
  });
});
