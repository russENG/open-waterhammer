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
