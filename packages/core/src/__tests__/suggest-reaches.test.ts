/**
 * suggestReaches — 計算区間数の自動提案（issue #49）
 *
 * MOC は全管路で共通の Δt を使うため、Δx = a·Δt が全管路で同時に成り立つ
 * 分割数を選ぶ必要がある（技術書 §8.4.2(2)）。本テストは提案された分割数が
 *   - 実務目安 Δx = 50〜200 m に収まる（収まらない場合は理由を返す）
 *   - Courant 誤差が許容内
 *   - 実際に runMoc で例外なく完走する
 * ことを検証する。
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  MOC_GRID_SPACING_MAX,
  MOC_GRID_SPACING_RECOMMENDED_MIN,
  runMoc,
  suggestReaches,
  type MocPipeSegment,
  type ReachCandidatePipe,
} from "../moc.js";
import { calcWaveSpeed } from "../formulas.js";
import type { Pipe } from "../types.js";

/** 提案された格子の Courant 誤差を独立に検算する */
function courantErrorOf(pipes: ReachCandidatePipe[], reaches: number[], dt: number): number {
  let err = 0;
  for (let i = 0; i < pipes.length; i++) {
    const dx = pipes[i]!.length / reaches[i]!;
    err = Math.max(err, Math.abs(dx - pipes[i]!.waveSpeed * dt) / (pipes[i]!.waveSpeed * dt));
  }
  return err;
}

describe("suggestReaches — 単一管路", () => {
  const pipes: ReachCandidatePipe[] = [{ length: 800, waveSpeed: 1135 }];
  const g = suggestReaches(pipes);

  test("Courant 誤差が厳密に 0（単一管路では常に成立する）", () => {
    assert.ok(g.courantError < 1e-12, `courantError=${g.courantError}`);
  });

  test("Δx が実務目安 50〜200 m に収まる", () => {
    const dx = 800 / g.reaches[0]!;
    assert.ok(dx >= MOC_GRID_SPACING_RECOMMENDED_MIN && dx <= MOC_GRID_SPACING_MAX, `Δx=${dx}`);
  });

  test("Δx が目標 125 m にもっとも近い分割を選ぶ", () => {
    // 800 m の候補: N=4→200, 5→160, 6→133.3, 7→114.3, 8→100 … 既定目標 (50+200)/2 = 125
    const dx = 800 / g.reaches[0]!;
    for (let n = 4; n <= 16; n++) {
      const cand = 800 / n;
      if (cand < MOC_GRID_SPACING_RECOMMENDED_MIN || cand > MOC_GRID_SPACING_MAX) continue;
      assert.ok(Math.abs(dx - 125) <= Math.abs(cand - 125) + 1e-9,
        `選択 Δx=${dx.toFixed(1)} より Δx=${cand.toFixed(1)} の方が目標に近い`);
    }
  });

  test("Δt = Δx / a が成立する", () => {
    assert.ok(Math.abs(g.dt - (800 / g.reaches[0]!) / 1135) < 1e-12);
  });

  test("実務目安に収まるので警告は出ない", () => {
    assert.deepEqual(g.warnings, []);
    assert.equal(g.dxMin, MOC_GRID_SPACING_RECOMMENDED_MIN);
  });
});

describe("suggestReaches — 直列 2 管路（波速が異なる）", () => {
  const pipes: ReachCandidatePipe[] = [
    { length: 1200, waveSpeed: 1000 },
    { length: 800, waveSpeed: 800 },
  ];
  const g = suggestReaches(pipes);

  test("Courant 誤差が既定許容 1% 以内", () => {
    assert.ok(g.courantError <= 0.01, `courantError=${(g.courantError * 100).toFixed(3)}%`);
  });

  test("返された reaches / dt から独立に検算しても一致する", () => {
    const err = courantErrorOf(pipes, g.reaches, g.dt);
    assert.ok(Math.abs(err - g.courantError) < 1e-12, `独立検算=${err}, 返り値=${g.courantError}`);
  });

  test("全管路の Δx が実務目安に収まる", () => {
    for (let i = 0; i < pipes.length; i++) {
      const dx = pipes[i]!.length / g.reaches[i]!;
      assert.ok(dx >= g.dxMin && dx <= MOC_GRID_SPACING_MAX, `pipe${i} Δx=${dx}`);
    }
  });
});

describe("suggestReaches — 分岐 3 管路（実務目安と両立しないケース）", () => {
  // examples/typical-cases.ts ケース G の諸元。
  // Δx ≥ 50 m ではどの組み合わせでも Courant 誤差が収まらない。
  const brA: Pipe = {
    id: "a", startNodeId: "J", endNodeId: "VA", pipeType: "ductile_iron",
    innerDiameter: 0.200, wallThickness: 0.0060, length: 600, roughnessCoeff: 130,
  };
  const pipes: ReachCandidatePipe[] = [
    { length: 900, waveSpeed: 1135 },
    { length: 600, waveSpeed: calcWaveSpeed(brA) },
    { length: 400, waveSpeed: 1228 },
  ];
  const g = suggestReaches(pipes);

  test("Δx の下限が実務目安 50 m より下げられる", () => {
    assert.ok(g.dxMin < MOC_GRID_SPACING_RECOMMENDED_MIN, `dxMin=${g.dxMin}`);
  });

  test("下げた理由が warnings で説明される", () => {
    assert.equal(g.warnings.length, 1, JSON.stringify(g.warnings));
    assert.match(g.warnings[0]!, /実務目安の下限 50 m/);
    assert.match(g.warnings[0]!, /Courant 誤差/);
    assert.match(g.warnings[0]!, /§8\.4\.2\(2\)/);
  });

  test("Courant 誤差は許容 1% 以内に収まる", () => {
    assert.ok(g.courantError <= 0.01, `courantError=${(g.courantError * 100).toFixed(3)}%`);
  });

  test("提案された格子で runMoc が例外なく完走する", () => {
    const mk = (id: string, D: number, t: number, L: number, from: string, to: string): Pipe => ({
      id, startNodeId: from, endNodeId: to,
      pipeType: "ductile_iron", innerDiameter: D, wallThickness: t, length: L, roughnessCoeff: 130,
    });
    const segs: MocPipeSegment[] = [
      { id: "main", pipe: mk("main", 0.30, 0.0066, 900, "R", "J"), waveSpeed: pipes[0]!.waveSpeed, nReaches: g.reaches[0]!, upstreamNodeId: "R", downstreamNodeId: "J", initialFlow: 0.065 },
      { id: "brA", pipe: brA, waveSpeed: pipes[1]!.waveSpeed, nReaches: g.reaches[1]!, upstreamNodeId: "J", downstreamNodeId: "VA", initialFlow: 0.045 },
      { id: "brB", pipe: mk("brB", 0.15, 0.0055, 400, "J", "VB"), waveSpeed: pipes[2]!.waveSpeed, nReaches: g.reaches[2]!, upstreamNodeId: "J", downstreamNodeId: "VB", initialFlow: 0.020 },
    ];
    const res = runMoc({
      pipes: segs,
      nodes: {
        R: { type: "reservoir", head: 85 },
        VA: { type: "valve", Q0: 0.045, H0v: 76, closeTime: 2.0 },
        VB: { type: "valve", Q0: 0.020, H0v: 78, closeTime: 1e9 },
      },
    }, { tMax: 20 });
    // 提案どおりの分割数が dt 整合化で変更されない（＝格子として整合している）
    for (const [i, id] of ["main", "brA", "brB"].entries()) {
      assert.equal(res.pipes[id]!.nReaches, g.reaches[i]!, `${id} の分割数が整合化で変わった`);
    }
    assert.ok(Math.abs(res.dt - g.dt) < 1e-12, `dt=${res.dt} vs 提案 ${g.dt}`);
  });
});

describe("suggestReaches — オプション", () => {
  const pipes: ReachCandidatePipe[] = [{ length: 1500, waveSpeed: 1152 }];

  test("dxTarget を指定すると、その値にもっとも近い Δx を選ぶ", () => {
    const coarse = suggestReaches(pipes, { dxTarget: 190 });
    const fine = suggestReaches(pipes, { dxTarget: 55 });
    assert.ok(1500 / coarse.reaches[0]! > 1500 / fine.reaches[0]!,
      `coarse Δx=${1500 / coarse.reaches[0]!}, fine Δx=${1500 / fine.reaches[0]!}`);
  });

  test("dxMin を明示すると段階的な引き下げをしない", () => {
    const g = suggestReaches(pipes, { dxMin: 100 });
    assert.equal(g.dxMin, 100);
    assert.ok(1500 / g.reaches[0]! >= 100);
  });

  test("dxMax を超える組しか無い場合はエラーになる", () => {
    assert.throws(
      () => suggestReaches([{ length: 30, waveSpeed: 1000 }], { dxMin: 50, dxMax: 200 }),
      /計算区間数の組が見つかりません/,
    );
  });

  test("管路が 0 本ならエラー", () => {
    assert.throws(() => suggestReaches([]), /管路が 0 本です/);
  });

  test("延長・波速が非正ならエラー", () => {
    assert.throws(() => suggestReaches([{ length: 0, waveSpeed: 1000 }]), /正の値/);
    assert.throws(() => suggestReaches([{ length: 100, waveSpeed: -1 }]), /正の値/);
  });
});
