/**
 * 基礎式ユニットテスト
 * 出典: 土地改良設計基準パイプライン技術書 第8章
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  calcWaveSpeed,
  calcVibrationPeriod,
  determineClosureType,
  joukowsky,
  calcAllieviK1,
  allieviClose,
  allieviOpen,
  calcEquivalentLength,
  headToMpa,
  mpaToHead,
  GRAVITY,
} from "../formulas.js";
import type { Pipe } from "../types.js";

// ─── テスト用パイプ定義 ──────────────────────────────────────────────────────

/** ダクタイル鋳鉄管 φ300mm × t7mm × L=500m（デモケース01と同条件） */
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

/** 硬質塩ビ管 φ200mm × t8mm × L=300m */
const PIPE_UPVC_200: Pipe = {
  id: "p2",
  startNodeId: "N1",
  endNodeId: "N2",
  pipeType: "upvc",
  innerDiameter: 0.200,
  wallThickness: 0.008,
  length: 300,
  roughnessCoeff: 130,
};

// ─── 波速計算 ────────────────────────────────────────────────────────────────

describe("calcWaveSpeed", () => {
  test("ダクタイル鋳鉄管 φ300mm の波速はおよそ 1050〜1150 m/s の範囲内", () => {
    const a = calcWaveSpeed(PIPE_DI_300);
    assert.ok(a > 1050 && a < 1150, `波速 = ${a.toFixed(1)} m/s`);
  });

  test("硬質塩ビ管は鋳鉄管より波速が低い（Eₛが小さいため）", () => {
    const a_di = calcWaveSpeed(PIPE_DI_300);
    const a_pvc = calcWaveSpeed(PIPE_UPVC_200);
    assert.ok(a_pvc < a_di, `DI: ${a_di.toFixed(0)}, PVC: ${a_pvc.toFixed(0)}`);
  });

  test("ヤング係数を直接指定した場合は管種テーブルより優先される", () => {
    const pipe: Pipe = { ...PIPE_DI_300, youngsModulus: 200e6 }; // 鋼管と同じ値
    const a_override = calcWaveSpeed(pipe);
    const a_di = calcWaveSpeed(PIPE_DI_300);
    assert.ok(a_override > a_di, "鋼管Eₛ指定時は鋳鉄管より波速が高い");
  });

  test("埋設状況係数 C₁ を小さくすると波速が上昇する", () => {
    const a_default = calcWaveSpeed(PIPE_DI_300);
    const a_small_c1 = calcWaveSpeed({ ...PIPE_DI_300, c1Coeff: 0.5 });
    assert.ok(a_small_c1 > a_default);
  });
});

// ─── 圧力振動周期 ────────────────────────────────────────────────────────────

describe("calcVibrationPeriod", () => {
  test("T₀ = 4L/a", () => {
    const a = 1100;
    const L = 500;
    const T0 = calcVibrationPeriod(L, a);
    assert.ok(Math.abs(T0 - (4 * L) / a) < 1e-10);
  });
});

// ─── 急/緩閉そく判定 ─────────────────────────────────────────────────────────

describe("determineClosureType", () => {
  test("tν ≦ 2L/a → 急閉そく", () => {
    // L=500, a≈1100 → 2L/a ≈ 0.91s → tν=0.5s は急閉そく
    const { closureType } = determineClosureType(0.5, 500, 1100);
    assert.equal(closureType, "rapid");
  });

  test("tν > 2L/a かつ tν > L/300 → 緩閉そく", () => {
    // L=500, a=1100 → 2L/a≈0.91, L/300≈1.67 → tν=10s は緩閉そく
    const { closureType } = determineClosureType(10, 500, 1100);
    assert.equal(closureType, "slow");
  });

  test("tν > 2L/a かつ tν ≦ L/300 → numerical_required", () => {
    // L=500, a=1100 → 2L/a≈0.91s, L/300≈1.67s → tν=1.5s は中間域
    const { closureType } = determineClosureType(1.5, 500, 1100);
    assert.equal(closureType, "numerical_required");
  });

  test("α値 = tν / (2L/a)", () => {
    const a = 1000, L = 500, tv = 2.0;
    const { alpha } = determineClosureType(tv, L, a);
    const expected = tv / ((2 * L) / a);
    assert.ok(Math.abs(alpha - expected) < 1e-10);
  });
});

// ─── ジューコフスキーの式 ─────────────────────────────────────────────────────

describe("joukowsky", () => {
  test("閉操作 (ΔV=-V₀) で正の水撃圧上昇", () => {
    // V₀=1.0m/s, a=1100m/s → ΔH ≈ 112m
    const dH = joukowsky(1100, -1.0);
    assert.ok(dH > 0, `ΔH = ${dH.toFixed(1)} m`);
    assert.ok(Math.abs(dH - 1100 / GRAVITY) < 0.1);
  });

  test("開操作 (ΔV=+V₀) で負の圧力（低下）", () => {
    const dH = joukowsky(1100, 1.0);
    assert.ok(dH < 0);
  });

  test("流速変化ゼロなら水撃圧もゼロ", () => {
    assert.ok(joukowsky(1100, 0) === 0); // -0 === 0 は true
  });
});

// ─── アリエビの近似式 ─────────────────────────────────────────────────────────

describe("allievi", () => {
  test("K₁ > 0 のとき Hmax_close > H₀", () => {
    const H0 = 30, L = 500, V = 1.0, tv = 10, g = GRAVITY;
    const k1 = calcAllieviK1(L, V, H0, tv);
    const hmax = allieviClose(H0, k1);
    assert.ok(hmax > H0, `Hmax=${hmax.toFixed(1)} > H₀=${H0}`);
  });

  test("Hmax_open は負値（圧力低下）", () => {
    const H0 = 30, L = 500, V = 1.0, tv = 10;
    const k1 = calcAllieviK1(L, V, H0, tv);
    const hmax_open = allieviOpen(H0, k1);
    assert.ok(hmax_open < 0);
  });

  test("閉そく時間を延ばすと K₁ が減り水撃圧が下がる", () => {
    const H0 = 30, L = 500, V = 1.0;
    const k1_short = calcAllieviK1(L, V, H0, 5);
    const k1_long = calcAllieviK1(L, V, H0, 20);
    assert.ok(k1_short > k1_long);
    assert.ok(allieviClose(H0, k1_short) > allieviClose(H0, k1_long));
  });
});

// ─── 等価管路長 ───────────────────────────────────────────────────────────────

describe("calcEquivalentLength", () => {
  test("単一区間はそのまま", () => {
    const L = calcEquivalentLength([{ length: 100, area: 0.07 }]);
    assert.ok(Math.abs(L - 100) < 1e-10);
  });

  test("同断面2区間は合計延長", () => {
    const L = calcEquivalentLength([
      { length: 100, area: 0.07 },
      { length: 200, area: 0.07 },
    ]);
    assert.ok(Math.abs(L - 300) < 1e-10);
  });

  test("断面積が半分の区間は等価長が2倍になる", () => {
    // A₂ = A₁/2 → L₂の等価 = L₂ × (A₁/A₂) = L₂ × 2
    const L = calcEquivalentLength([
      { length: 100, area: 0.1 },
      { length: 100, area: 0.05 },
    ]);
    assert.ok(Math.abs(L - 300) < 1e-10, `L = ${L}`);
  });

  test("空配列は 0", () => {
    assert.equal(calcEquivalentLength([]), 0);
  });
});

// ─── 単位変換 ────────────────────────────────────────────────────────────────

describe("unit conversion", () => {
  test("headToMpa → mpaToHead は往復変換で元に戻る", () => {
    const head = 100;
    assert.ok(Math.abs(mpaToHead(headToMpa(head)) - head) < 1e-9);
  });

  test("100m水頭 ≈ 0.98 MPa", () => {
    const mpa = headToMpa(100);
    assert.ok(Math.abs(mpa - 0.98) < 0.001);
  });
});
