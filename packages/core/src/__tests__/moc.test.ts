/**
 * 特性曲線法（MOC）ユニットテスト
 *
 * 検証方針:
 *   1. 瞬時閉そく → Hmax ≈ H0 + ΔH_joukowsky（±5%以内）
 *   2. 閉そく時間延長 → Hmax < 瞬時閉そく時の Hmax
 *   3. 出力構造の正確性（スナップショット数・節点数）
 *   4. 摩擦なし（V0=0）でも実行可能
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { runMoc } from "../moc.js";
import { calcWaveSpeed, joukowsky, GRAVITY } from "../formulas.js";
import type { Pipe } from "../types.js";

// ── テスト用パイプ（デモ01と同条件） ────────────────────────────────────────

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

const V0 = 1.0;   // m/s
const H0 = 30.0;  // m（バルブ端初期水頭）

const a = calcWaveSpeed(PIPE_DI_300); // ≈ 1098 m/s

// ── ヘルパー ─────────────────────────────────────────────────────────────────

function runInstantClose(): ReturnType<typeof runMoc> {
  return runMoc({
    pipe: PIPE_DI_300,
    waveSpeed: a,
    initialVelocity: V0,
    initialDownstreamHead: H0,
    closeTime: 0,   // 瞬時閉
    nReaches: 10,
  });
}

// ─── テスト ────────────────────────────────────────────────────────────────

describe("runMoc — 瞬時閉そく vs. ジューコフスキー整合性", () => {
  const r = runInstantClose();
  const deltaH_joukowsky = joukowsky(a, -V0); // ΔH > 0

  test("ΔH_joukowsky は正の値", () => {
    assert.ok(deltaH_joukowsky > 0, `ΔH = ${deltaH_joukowsky}`);
  });

  test("MOC Hmax_downstream ≈ H0 + ΔH_joukowsky（±10%）", () => {
    const Hmax = r.summary.Hmax_downstream;
    const expected = H0 + deltaH_joukowsky;
    const relErr = Math.abs(Hmax - expected) / expected;
    assert.ok(
      relErr < 0.10,
      `Hmax=${Hmax.toFixed(1)} m, expected≈${expected.toFixed(1)} m, err=${(relErr * 100).toFixed(1)}%`,
    );
  });

  test("MOC ΔHmax > 0（水頭上昇）", () => {
    assert.ok(r.summary.deltaHmax > 0);
  });
});

describe("runMoc — 閉そく時間延長で水撃圧低下", () => {
  const T0 = (4 * PIPE_DI_300.length) / a;

  const r_instant = runInstantClose();

  const r_slow = runMoc({
    pipe: PIPE_DI_300,
    waveSpeed: a,
    initialVelocity: V0,
    initialDownstreamHead: H0,
    closeTime: T0 * 2, // 緩閉（2T₀）
    nReaches: 10,
  });

  test("緩閉そく時の Hmax < 瞬時閉そく時の Hmax", () => {
    assert.ok(
      r_slow.summary.Hmax_downstream < r_instant.summary.Hmax_downstream,
      `slow=${r_slow.summary.Hmax_downstream.toFixed(1)}, instant=${r_instant.summary.Hmax_downstream.toFixed(1)}`,
    );
  });
});

describe("runMoc — 出力構造", () => {
  const N = 10;
  const r = runInstantClose();

  test("downstreamH の長さ = nSteps + 1", () => {
    // tMax = 3×T0 = 3×(4×500/a), dt = dx/a = 50/a
    // nSteps = ceil(tMax/dt) = ceil(3×4×500/a × a/50) = ceil(3×4×10) = 120
    assert.ok(r.downstreamH.length >= 100);
  });

  test("各スナップショットの節点数 = N+1", () => {
    for (const snap of r.snapshots) {
      assert.equal(snap.H.length, N + 1);
      assert.equal(snap.Q.length, N + 1);
    }
  });

  test("Hmax の長さ = N+1", () => {
    assert.equal(r.Hmax.length, N + 1);
    assert.equal(r.Hmin.length, N + 1);
  });

  test("summary.upstreamHead > summary.initialDownstreamHead（摩擦損失分）", () => {
    assert.ok(r.summary.upstreamHead > r.summary.initialDownstreamHead);
  });

  test("dt = dx / waveSpeed", () => {
    const expected = r.dx / r.summary.waveSpeed;
    assert.ok(Math.abs(r.dt - expected) < 1e-12, `dt=${r.dt}, dx/a=${expected}`);
  });
});

describe("runMoc — 零流速（摩擦なし）でも動作", () => {
  test("V0=0 でもクラッシュしない", () => {
    assert.doesNotThrow(() => {
      runMoc({
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

describe("runMoc — 包絡線", () => {
  test("Hmax[N] >= 初期水頭 H0（閉そく時は上流側でも圧力上昇）", () => {
    const r = runInstantClose();
    // 上流端（N=0）では圧力は変化しない（定水頭境界）が、
    // 下流端（N=N）では水頭上昇
    assert.ok(r.Hmax[r.nReaches]! > H0);
  });

  test("Hmin[N] <= 初期水頭 H0（反射波による圧力低下）", () => {
    const r = runInstantClose();
    assert.ok(r.Hmin[r.nReaches]! <= H0);
  });
});
