/**
 * E2E: generateTemplate → parseWorkbook ラウンドトリップ検証
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { generateTemplate } from "../template.js";
import { parseWorkbook } from "../reader.js";
import type { Pipe, Node, CalculationCase } from "@open-waterhammer/core";

// ─── テスト用フィクスチャ ─────────────────────────────────────────────────────

const testMeta = {
  projectName: "テスト案件",
  designer: "テスト設計者",
  standardId: "nochi_pipeline_2021",
};

const testPipes: Pipe[] = [
  {
    id: "P-01",
    name: "幹線管路",
    startNodeId: "N-01",
    endNodeId: "N-02",
    pipeType: "ductile_iron",
    innerDiameter: 0.300,
    wallThickness: 0.007,
    length: 500,
    roughnessCoeff: 130,
  },
  {
    id: "P-02",
    name: "支線管路",
    startNodeId: "N-02",
    endNodeId: "N-03",
    pipeType: "upvc",
    innerDiameter: 0.150,
    wallThickness: 0.0085,
    length: 200,
    roughnessCoeff: 140,
  },
];

const testNodes: Node[] = [
  { id: "N-01", name: "貯水槽", elevation: 50.0, nodeType: "reservoir", hydraulicGrade: 60.0 },
  { id: "N-02", name: "分岐点", elevation: 40.0, nodeType: "junction" },
  { id: "N-03", name: "末端バルブ", elevation: 35.0, nodeType: "valve_node" },
];

const testCases: CalculationCase[] = [
  {
    id: "C-01",
    name: "急閉そく",
    operationType: "valve_close",
    targetFacilityId: "N-03",
    initialVelocity: 1.0,
    initialHead: 30.0,
    description: "末端バルブ急閉（tν=0.5s）",
  },
  {
    id: "C-02",
    name: "緩閉そく",
    operationType: "valve_close",
    targetFacilityId: "N-03",
    initialVelocity: 1.0,
    initialHead: 30.0,
    description: "末端バルブ緩閉（tν=10s）",
  },
];

// ─── ラウンドトリップテスト ────────────────────────────────────────────────────

describe("Excel ラウンドトリップ（generateTemplate → parseWorkbook）", () => {
  // 1回だけ生成・パースして使い回す
  const buf = generateTemplate({ meta: testMeta, pipes: testPipes, nodes: testNodes, cases: testCases });
  const result = parseWorkbook(buf);

  test("パースエラーが 0 件", () => {
    assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
  });

  // ── meta ──────────────────────────────────────────────────────────────────

  describe("meta シート", () => {
    test("案件名が一致", () => {
      assert.equal(result.data.meta.projectName, testMeta.projectName);
    });
    test("設計者名が一致", () => {
      assert.equal(result.data.meta.designer, testMeta.designer);
    });
    test("基準IDが一致", () => {
      assert.equal(result.data.meta.standardId, testMeta.standardId);
    });
  });

  // ── pipes ─────────────────────────────────────────────────────────────────

  describe("管路データ", () => {
    test("管路数が一致", () => {
      assert.equal(result.data.pipes.length, testPipes.length);
    });

    test("P-01: id・管種・内径・管厚・延長が一致", () => {
      const p = result.data.pipes.find((x) => x.id === "P-01");
      assert.ok(p, "P-01 が見つからない");
      assert.equal(p.pipeType, "ductile_iron");
      assert.ok(Math.abs(p.innerDiameter - 0.300) < 1e-6, `innerDiameter=${p.innerDiameter}`);
      assert.ok(Math.abs(p.wallThickness - 0.007) < 1e-6, `wallThickness=${p.wallThickness}`);
      assert.ok(Math.abs(p.length - 500) < 1e-6, `length=${p.length}`);
      assert.equal(p.startNodeId, "N-01");
      assert.equal(p.endNodeId, "N-02");
    });

    test("P-02: 管種が upvc", () => {
      const p = result.data.pipes.find((x) => x.id === "P-02");
      assert.ok(p, "P-02 が見つからない");
      assert.equal(p.pipeType, "upvc");
    });
  });

  // ── nodes ─────────────────────────────────────────────────────────────────

  describe("節点データ", () => {
    test("節点数が一致", () => {
      assert.equal(result.data.nodes.length, testNodes.length);
    });

    test("N-01: 地盤高・節点種別・動水位が一致", () => {
      const n = result.data.nodes.find((x) => x.id === "N-01");
      assert.ok(n, "N-01 が見つからない");
      assert.equal(n.nodeType, "reservoir");
      assert.ok(Math.abs(n.elevation - 50.0) < 1e-6, `elevation=${n.elevation}`);
      assert.ok(n.hydraulicGrade !== undefined && Math.abs(n.hydraulicGrade - 60.0) < 1e-6);
    });

    test("N-02: 動水位は undefined（未入力）", () => {
      const n = result.data.nodes.find((x) => x.id === "N-02");
      assert.ok(n, "N-02 が見つからない");
      assert.equal(n.hydraulicGrade, undefined);
    });
  });

  // ── cases ─────────────────────────────────────────────────────────────────

  describe("ケース設定", () => {
    test("ケース数が一致", () => {
      assert.equal(result.data.cases.length, testCases.length);
    });

    test("C-01: 初期流速・初期水頭・操作種別が一致", () => {
      const c = result.data.cases.find((x) => x.id === "C-01");
      assert.ok(c, "C-01 が見つからない");
      assert.equal(c.operationType, "valve_close");
      assert.ok(Math.abs(c.initialVelocity - 1.0) < 1e-6);
      assert.ok(Math.abs(c.initialHead - 30.0) < 1e-6);
    });
  });
});

// ─── エラー検出テスト ────────────────────────────────────────────────────────

describe("parseWorkbook エラー検出", () => {
  test("空バッファを渡すとエラーが返る", () => {
    const result = parseWorkbook(new ArrayBuffer(0));
    assert.ok(result.errors.length > 0);
  });
});
