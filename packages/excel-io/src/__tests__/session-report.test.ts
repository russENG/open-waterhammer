/**
 * セッションレポート出力テスト
 *
 * 要旨 §3.3, §5.4: 条件追跡情報を含むExcel出力
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { generateSessionReport } from "../session-report.js";
import {
  createSession,
  recordChange,
  diffSessions,
  summarizeMocResult,
} from "@open-waterhammer/core";
import type { CalculationSession, MocResult } from "@open-waterhammer/core";

function makeTestSession(): CalculationSession {
  const s = createSession({
    name: "テストセッション",
    pipes: [{
      id: "p1", startNodeId: "R", endNodeId: "V",
      pipeType: "ductile_iron", innerDiameter: 0.3, wallThickness: 0.008,
      length: 1000, roughnessCoeff: 130,
    }],
    measurementPoints: [{
      id: "PT1", horizontalDistance: 0, groundLevel: 100, pipeCenterHeight: 98.5,
      pipeLength: 500, flowRate: 0.1, diameter: 0.3, roughnessC: 130,
      bendLossCoeff: 0, valveLossCoeff: 0, branchLossCoeff: 0,
    }],
    description: "検証用テストセッション",
  });
  return s;
}

function makeTestMocSummary(): CalculationSession["mocSummary"] {
  return {
    dt: 0.01,
    tMax: 10,
    pipeEnvelopes: {
      seg_0: { Hmax: [110, 108, 106], Hmin: [90, 88, 86], waveSpeed: 1100, vibrationPeriod: 3.6 },
    },
    nodeExtremes: {
      node_0: { maxH: 110, minH: 90 },
      node_1: { maxH: 105, minH: 85 },
    },
  };
}

describe("generateSessionReport", () => {
  test("基本出力: 4シートが生成される", () => {
    const session = makeTestSession();
    Object.assign(session, { mocSummary: makeTestMocSummary() });

    const buf = generateSessionReport({ session });
    assert.ok(buf);
    assert.ok(buf.length > 0);

    const wb = XLSX.read(buf, { type: "buffer" });
    assert.ok(wb.SheetNames.includes("入力条件表"));
    assert.ok(wb.SheetNames.includes("計算条件表"));
    assert.ok(wb.SheetNames.includes("結果整理表"));
    assert.ok(wb.SheetNames.includes("変更履歴"));
    assert.equal(wb.SheetNames.length, 4);
  });

  test("比較セッション指定時: 5シート（ケース比較追加）", () => {
    const sessA = makeTestSession();
    Object.assign(sessA, { mocSummary: makeTestMocSummary() });
    const sessB = createSession({ name: "比較ケース" });
    Object.assign(sessB, { mocSummary: makeTestMocSummary() });

    const diffs = diffSessions(sessA, sessB);
    const buf = generateSessionReport({
      session: sessA,
      compareSession: sessB,
      diffs,
    });

    const wb = XLSX.read(buf, { type: "buffer" });
    assert.equal(wb.SheetNames.length, 5);
    assert.ok(wb.SheetNames.includes("ケース比較"));
  });

  test("入力条件表に管路データが含まれる", () => {
    const session = makeTestSession();
    const buf = generateSessionReport({ session });
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets["入力条件表"]!;
    const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
    const flat = data.flat().map(String);
    assert.ok(flat.some(v => v.includes("p1")), "管路IDが含まれる");
    assert.ok(flat.some(v => v.includes("PT1")), "測点IDが含まれる");
  });

  test("結果整理表にMOC包絡線が含まれる", () => {
    const session = makeTestSession();
    Object.assign(session, { mocSummary: makeTestMocSummary() });

    const buf = generateSessionReport({ session });
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets["結果整理表"]!;
    const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
    const flat = data.flat().map(String);
    assert.ok(flat.some(v => v.includes("seg_0")), "管路IDが含まれる");
    assert.ok(flat.some(v => v.includes("110")), "Hmaxが含まれる");
  });

  test("変更履歴に記録が含まれる", () => {
    let session = makeTestSession();
    session = recordChange(session, {
      category: "input",
      field: "pipe.diameter",
      oldValue: "0.300",
      newValue: "0.400",
      description: "管径変更",
    });

    const buf = generateSessionReport({ session });
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets["変更履歴"]!;
    const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
    const flat = data.flat().map(String);
    assert.ok(flat.some(v => v.includes("管径変更")), "変更説明が含まれる");
    assert.ok(flat.some(v => v.includes("pipe.diameter")), "フィールドパスが含まれる");
  });
});
