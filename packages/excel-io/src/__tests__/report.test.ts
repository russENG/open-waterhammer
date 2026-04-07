/**
 * generateReport テスト
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { generateReport } from "../report.js";
import { parseWorkbook } from "../reader.js";
import type { SimpleFormulaResult } from "@open-waterhammer/core";
import type { WorkbookData, ProjectMeta } from "../types.js";

// ─── フィクスチャ ─────────────────────────────────────────────────────────────

const meta: ProjectMeta = {
  projectName: "レポートテスト案件",
  designer: "テスト設計者",
  standardId: "nochi_pipeline_2021",
  date: "2026-03-29",
};

const data: WorkbookData = {
  meta,
  pipes: [
    {
      id: "P-01", name: "幹線管路",
      startNodeId: "N-01", endNodeId: "N-02",
      pipeType: "ductile_iron",
      innerDiameter: 0.300, wallThickness: 0.007,
      length: 500, roughnessCoeff: 130,
    },
  ],
  nodes: [
    { id: "N-01", elevation: 50.0, nodeType: "reservoir", hydraulicGrade: 60.0 },
    { id: "N-02", elevation: 40.0, nodeType: "junction" },
  ],
  cases: [
    {
      id: "C-01", name: "急閉そく",
      operationType: "valve_close",
      targetFacilityId: "N-02",
      initialVelocity: 1.0,
      initialHead: 30.0,
    },
    {
      id: "C-02", name: "緩閉そく",
      operationType: "valve_close",
      targetFacilityId: "N-02",
      initialVelocity: 1.0,
      initialHead: 30.0,
    },
  ],
  measurementPoints: [],
};

const results: SimpleFormulaResult[] = [
  {
    caseId: "C-01",
    pipeId: "P-01",
    waveSpeed: { waveSpeed: 1098.5, vibrationPeriod: 1.820, alpha: 0.275 },
    closureType: "rapid",
    deltaH_joukowsky: 112.1,
    warnings: [],
  },
  {
    caseId: "C-02",
    pipeId: "P-01",
    waveSpeed: { waveSpeed: 1098.5, vibrationPeriod: 1.820, alpha: 5.495 },
    closureType: "slow",
    hmax_allievi_close: 58.7,
    hmax_allievi_open: -28.7,
    k1: 0.932,
    allieviApplicable: true,
    warnings: [],
  },
];

// ─── テスト ────────────────────────────────────────────────────────────────────

describe("generateReport", () => {
  const buf = generateReport({ meta, data, results, closeTimes: { "C-01": 0.5, "C-02": 10.0 } });

  test("Buffer が返る", () => {
    assert.ok(buf instanceof Buffer);
    assert.ok(buf.byteLength > 0);
  });

  test("xlsx として再読み込み可能（シート名確認）", async () => {
    const { default: XLSX } = await import("xlsx");
    const wb = XLSX.read(buf, { type: "buffer" });
    assert.ok(wb.SheetNames.includes("計算結果"), `sheets: ${wb.SheetNames}`);
    assert.ok(wb.SheetNames.includes("管路データ"), `sheets: ${wb.SheetNames}`);
    assert.ok(wb.SheetNames.includes("案件情報"), `sheets: ${wb.SheetNames}`);
  });

  test("計算結果シートに2ケース分のデータ行がある", async () => {
    const { default: XLSX } = await import("xlsx");
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets["計算結果"]!;
    // title=4行 + header=1行 + data=2行 → 7行
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown as unknown[][];
    assert.ok(rows.length >= 7, `rows.length = ${rows.length}`);
  });

  test("管路データシートに P-01 が存在", async () => {
    const { default: XLSX } = await import("xlsx");
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets["管路データ"]!;
    const rows = XLSX.utils.sheet_to_json<{ 管路ID?: string }>(ws);
    assert.ok(rows.some((r) => r["管路ID"] === "P-01"), JSON.stringify(rows[0]));
  });
});
