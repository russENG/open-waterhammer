/**
 * 計算セッション管理テスト
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  createSession,
  recordChange,
  diffSessions,
  summarizeMocResult,
} from "../session.js";
import type { CalculationSession } from "../session.js";
import type { MocResult, MocPipeResult, MocNodeResult } from "../moc.js";

describe("createSession", () => {
  test("新規セッションが作成される", () => {
    const s = createSession({ name: "テスト案件" });
    assert.ok(s.id);
    assert.equal(s.name, "テスト案件");
    assert.ok(s.createdAt);
    assert.equal(s.pipes.length, 0);
    assert.equal(s.measurementPoints.length, 0);
    assert.equal(s.changes.length, 1);
    assert.equal(s.changes[0]!.category, "meta");
  });

  test("管路データ付きで作成できる", () => {
    const s = createSession({
      name: "既存管路",
      pipes: [{ id: "p1", startNodeId: "a", endNodeId: "b", pipeType: "ductile_iron", innerDiameter: 0.3, wallThickness: 0.008, length: 1000, roughnessCoeff: 130 }],
    });
    assert.equal(s.pipes.length, 1);
  });
});

describe("recordChange", () => {
  test("変更が記録される", () => {
    const s = createSession({ name: "テスト" });
    const s2 = recordChange(s, {
      category: "input",
      field: "measurementPoints[0].diameter",
      oldValue: "0.300",
      newValue: "0.400",
      description: "管径変更",
    });
    assert.equal(s2.changes.length, 2);
    assert.equal(s2.changes[1]!.field, "measurementPoints[0].diameter");
    assert.ok(s2.updatedAt); // タイムスタンプが設定されている
  });

  test("元のセッションは変更されない（イミュータブル）", () => {
    const s = createSession({ name: "テスト" });
    const origChanges = s.changes.length;
    recordChange(s, { category: "meta", field: "name", description: "テスト" });
    assert.equal(s.changes.length, origChanges);
  });
});

describe("diffSessions", () => {
  test("同一セッション同士は差分なし", () => {
    const s = createSession({ name: "A" });
    const diffs = diffSessions(s, s);
    const changed = diffs.filter(d => d.changed);
    assert.equal(changed.length, 0);
  });

  test("名前の変更が検出される", () => {
    const a = createSession({ name: "ケースA" });
    const b = createSession({ name: "ケースB" });
    const diffs = diffSessions(a, b);
    const nameDiff = diffs.find(d => d.field === "name");
    assert.ok(nameDiff);
    assert.equal(nameDiff.changed, true);
    assert.equal(nameDiff.valueA, "ケースA");
    assert.equal(nameDiff.valueB, "ケースB");
  });

  test("定常計算の結果差が検出される", () => {
    const a = createSession({ name: "A" });
    a.steadyInput = { points: [], staticWaterLevel: 100 };
    a.steadyResult = { caseName: "A", staticWaterLevel: 100, pointResults: [], maxVelocity: 1.5, maxDesignPressure: 0.8, warnings: [] };

    const b = createSession({ name: "A" });
    b.steadyInput = { points: [], staticWaterLevel: 105 };
    b.steadyResult = { caseName: "A", staticWaterLevel: 105, pointResults: [], maxVelocity: 1.8, maxDesignPressure: 1.0, warnings: [] };

    const diffs = diffSessions(a, b);
    const swlDiff = diffs.find(d => d.field === "staticWaterLevel");
    assert.ok(swlDiff);
    assert.equal(swlDiff.changed, true);

    const velDiff = diffs.find(d => d.field === "maxVelocity");
    assert.ok(velDiff);
    assert.equal(velDiff.changed, true);
  });
});

describe("summarizeMocResult", () => {
  test("MOC結果をサマリーに変換できる", () => {
    const mockResult: MocResult = {
      dt: 0.01,
      tMax: 10,
      pipes: {
        seg_0: {
          waveSpeed: 1100,
          dx: 100,
          nReaches: 10,
          vibrationPeriod: 3.6,
          H_steady: [100, 99, 98, 97, 96, 95, 94, 93, 92, 91, 90],
          Hmax: [110, 109, 108, 107, 106, 105, 104, 103, 102, 101, 100],
          Hmin: [90, 89, 88, 87, 86, 85, 84, 83, 82, 81, 80],
          snapshots: [],
        },
      },
      nodes: {
        node_0: { H: [{ t: 0, H: 100 }, { t: 1, H: 110 }, { t: 2, H: 95 }] },
        node_1: { H: [{ t: 0, H: 90 }, { t: 1, H: 100 }, { t: 2, H: 80 }] },
      },
    };
    const summary = summarizeMocResult(mockResult);
    assert.equal(summary.dt, 0.01);
    assert.equal(summary.tMax, 10);
    assert.ok(summary.pipeEnvelopes["seg_0"]);
    assert.deepEqual(summary.pipeEnvelopes["seg_0"]!.Hmax, mockResult.pipes["seg_0"]!.Hmax);
    assert.equal(summary.nodeExtremes["node_0"]!.maxH, 110);
    assert.equal(summary.nodeExtremes["node_1"]!.minH, 80);
  });
});
