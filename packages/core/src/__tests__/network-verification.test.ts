/**
 * 実務的な検証事例（要旨 §4.1, §5.2 対応）
 *
 * 農業用パイプラインで想定される代表的な管路網条件を設定し、
 * 分岐・合流を含む系統での水撃圧解析が安定的に実行でき、
 * 設計判断に必要な結果を得られることを確認する。
 *
 * 検証項目:
 *   1. 圧力時系列応答が安定的に算定できること
 *   2. 最大・最小圧力の発生位置および値を把握できること
 *   3. 圧力包絡線を用いて設計上の着目区間を整理できること
 *   4. 条件変更時に再計算と結果比較を容易に行えること
 *   5. 設計条件と判断根拠の追跡性が確保されること
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { runMoc } from "../moc.js";
import type { MocNetwork, MocResult, BoundaryCondition } from "../moc.js";
import { calcWaveSpeed } from "../formulas.js";
import type { Pipe } from "../types.js";
import {
  createSession,
  recordChange,
  diffSessions,
  summarizeMocResult,
} from "../session.js";

// ═══════════════════════════════════════════════════════════════════════════════
// 検証ケース1: T字分岐管路（貯水槽→幹線→分岐→支線2系統）
//
// 想定: 農業用配水幹線から2方向に分岐する系統。
//   貯水槽(H=80m) → 幹線φ400×800m → 分岐点 → 支線A φ300×500m → バルブA
//                                              → 支線B φ250×600m → バルブB
//
// バルブAを2秒で閉鎖した場合の水撃圧伝播を検証する。
// ═══════════════════════════════════════════════════════════════════════════════

const MAIN_PIPE: Pipe = {
  id: "main",
  startNodeId: "reservoir",
  endNodeId: "junction",
  pipeType: "ductile_iron",
  innerDiameter: 0.4,
  wallThickness: 0.009,
  length: 800,
  roughnessCoeff: 130,
};

const BRANCH_A: Pipe = {
  id: "branch_a",
  startNodeId: "junction",
  endNodeId: "valve_a",
  pipeType: "ductile_iron",
  innerDiameter: 0.3,
  wallThickness: 0.008,
  length: 500,
  roughnessCoeff: 130,
};

const BRANCH_B: Pipe = {
  id: "branch_b",
  startNodeId: "junction",
  endNodeId: "valve_b",
  pipeType: "ductile_iron",
  innerDiameter: 0.25,
  wallThickness: 0.0075,
  length: 600,
  roughnessCoeff: 130,
};

function buildTJunctionNetwork(opts?: {
  valveACloseTime?: number;
  valveBCloseTime?: number;
  reservoirHead?: number;
}): MocNetwork {
  const HR = opts?.reservoirHead ?? 80;
  const tcA = opts?.valveACloseTime ?? 2.0;
  const tcB = opts?.valveBCloseTime ?? 999; // 実質開放
  const Q_A = 0.10; // 支線A初期流量
  const Q_B = 0.06; // 支線B初期流量

  return {
    pipes: [
      {
        id: "main",
        pipe: MAIN_PIPE,
        waveSpeed: calcWaveSpeed(MAIN_PIPE),
        nReaches: 10,
        upstreamNodeId: "reservoir",
        downstreamNodeId: "junction",
        initialFlow: Q_A + Q_B,
      },
      {
        id: "branch_a",
        pipe: BRANCH_A,
        waveSpeed: calcWaveSpeed(BRANCH_A),
        nReaches: 10,
        upstreamNodeId: "junction",
        downstreamNodeId: "valve_a",
        initialFlow: Q_A,
      },
      {
        id: "branch_b",
        pipe: BRANCH_B,
        waveSpeed: calcWaveSpeed(BRANCH_B),
        nReaches: 10,
        upstreamNodeId: "junction",
        downstreamNodeId: "valve_b",
        initialFlow: Q_B,
      },
    ],
    nodes: {
      reservoir: { type: "reservoir", head: HR } as BoundaryCondition,
      valve_a: { type: "valve", Q0: Q_A, H0v: 60, closeTime: tcA, operation: "close" } as BoundaryCondition,
      valve_b: { type: "valve", Q0: Q_B, H0v: 55, closeTime: tcB, operation: "close" } as BoundaryCondition,
    },
  };
}

// ─── テスト ──────────────────────────────────────────────────────────────────

describe("検証ケース1: T字分岐管路 — バルブA閉鎖", () => {
  const network = buildTJunctionNetwork({ valveACloseTime: 2.0 });
  const result = runMoc(network, { tMax: 20 });

  test("MOC実行が正常完了する", () => {
    assert.ok(result);
    assert.ok(result.dt > 0);
    assert.equal(Object.keys(result.pipes).length, 3);
    assert.equal(Object.keys(result.nodes).length, 4); // reservoir, junction, valve_a, valve_b
  });

  test("各管路の包絡線が物理的に妥当（Hmax > H_steady > Hmin）", () => {
    for (const [id, pr] of Object.entries(result.pipes)) {
      const hMax = Math.max(...pr.Hmax);
      const hMin = Math.min(...pr.Hmin);
      const hSteady = pr.H_steady[0]!; // 上流端の定常水頭
      assert.ok(hMax >= hSteady, `${id}: Hmax(${hMax}) should >= H_steady(${hSteady})`);
      assert.ok(hMin <= hSteady, `${id}: Hmin(${hMin}) should <= H_steady(${hSteady})`);
    }
  });

  test("バルブA側で水撃圧が最も大きい", () => {
    const hmaxA = Math.max(...result.pipes["branch_a"]!.Hmax);
    const hmaxB = Math.max(...result.pipes["branch_b"]!.Hmax);
    const hmaxMain = Math.max(...result.pipes["main"]!.Hmax);
    // 閉鎖側（branch_a）が最大水頭
    assert.ok(hmaxA > hmaxB, `閉鎖側Hmax(${hmaxA}) > 開放側Hmax(${hmaxB})`);
    assert.ok(hmaxA > hmaxMain, `閉鎖側Hmax(${hmaxA}) > 幹線Hmax(${hmaxMain})`);
  });

  test("水撃圧が貯水槽水頭を超過する（設計上の注意点）", () => {
    const hmaxA = Math.max(...result.pipes["branch_a"]!.Hmax);
    assert.ok(hmaxA > 80, `branch_a Hmax(${hmaxA}) should exceed reservoir head(80)`);
  });

  test("分岐点（junction）の水頭時系列が記録されている", () => {
    const jNode = result.nodes["junction"];
    assert.ok(jNode);
    assert.ok(jNode.H.length > 10);
  });

  test("各ノードの最大・最小水頭が抽出できる", () => {
    for (const [id, node] of Object.entries(result.nodes)) {
      const heads = node.H.map(h => h.H);
      const max = Math.max(...heads);
      const min = Math.min(...heads);
      assert.ok(isFinite(max), `${id} maxH is finite`);
      assert.ok(isFinite(min), `${id} minH is finite`);
      assert.ok(max >= min, `${id} max >= min`);
    }
  });

  test("振動周期が管路長と波速から妥当な範囲", () => {
    for (const [id, pr] of Object.entries(result.pipes)) {
      // T0 = 4L/a, 想定 0.5s〜5s の範囲
      assert.ok(pr.vibrationPeriod > 0.1, `${id}: T0(${pr.vibrationPeriod}) > 0.1`);
      assert.ok(pr.vibrationPeriod < 10, `${id}: T0(${pr.vibrationPeriod}) < 10`);
    }
  });
});

describe("検証ケース2: 条件変更による再計算と結果比較", () => {
  // ケースA: バルブA閉鎖時間 2.0秒
  const netA = buildTJunctionNetwork({ valveACloseTime: 2.0 });
  const resA = runMoc(netA, { tMax: 20 });

  // ケースB: バルブA閉鎖時間 5.0秒（緩閉そく）
  const netB = buildTJunctionNetwork({ valveACloseTime: 5.0 });
  const resB = runMoc(netB, { tMax: 20 });

  test("緩閉そくにより最大水頭が低減する", () => {
    const hmaxFast = Math.max(...resA.pipes["branch_a"]!.Hmax);
    const hmaxSlow = Math.max(...resB.pipes["branch_a"]!.Hmax);
    assert.ok(
      hmaxSlow < hmaxFast,
      `緩閉そくHmax(${hmaxSlow.toFixed(2)}) < 急閉そくHmax(${hmaxFast.toFixed(2)})`,
    );
  });

  test("幹線側でも圧力低減効果が確認される", () => {
    const hmaxMainFast = Math.max(...resA.pipes["main"]!.Hmax);
    const hmaxMainSlow = Math.max(...resB.pipes["main"]!.Hmax);
    assert.ok(
      hmaxMainSlow <= hmaxMainFast,
      `幹線: 緩閉そくHmax(${hmaxMainSlow.toFixed(2)}) <= 急閉そくHmax(${hmaxMainFast.toFixed(2)})`,
    );
  });

  test("セッション差分で条件変更が検出される", () => {
    const sessA = createSession({ name: "バルブA閉鎖 2.0s" });
    sessA.mocSummary = summarizeMocResult(resA);

    const sessB = createSession({ name: "バルブA閉鎖 5.0s" });
    sessB.mocSummary = summarizeMocResult(resB);

    const diffs = diffSessions(sessA, sessB);
    const nameDiff = diffs.find(d => d.field === "name");
    assert.ok(nameDiff?.changed, "セッション名の差異が検出される");

    // 管路結果の差異が検出される
    const pipeMaxDiff = diffs.find(d => d.field === "pipe.branch_a.Hmax");
    assert.ok(pipeMaxDiff?.changed, "branch_a Hmaxの差異が検出される");
  });

  test("サマリーに全管路の包絡線が含まれる", () => {
    const summary = summarizeMocResult(resA);
    assert.ok(summary.pipeEnvelopes["main"]);
    assert.ok(summary.pipeEnvelopes["branch_a"]);
    assert.ok(summary.pipeEnvelopes["branch_b"]);
    assert.equal(Object.keys(summary.pipeEnvelopes).length, 3);
  });

  test("サマリーに全ノードの極値が含まれる", () => {
    const summary = summarizeMocResult(resA);
    assert.ok(summary.nodeExtremes["reservoir"]);
    assert.ok(summary.nodeExtremes["junction"]);
    assert.ok(summary.nodeExtremes["valve_a"]);
    assert.ok(summary.nodeExtremes["valve_b"]);
  });
});

describe("検証ケース3: 条件追跡性の確認", () => {
  test("変更履歴が正しく記録される", () => {
    let session = createSession({ name: "初期検討" });
    assert.equal(session.changes.length, 1);

    session = recordChange(session, {
      category: "input",
      field: "valveA.closeTime",
      oldValue: "2.0",
      newValue: "5.0",
      description: "バルブA閉鎖時間を延長（水撃圧低減のため）",
    });
    assert.equal(session.changes.length, 2);

    session = recordChange(session, {
      category: "moc",
      field: "tMax",
      oldValue: "20",
      newValue: "30",
      description: "シミュレーション時間を延長（定常復帰確認のため）",
    });
    assert.equal(session.changes.length, 3);

    // 変更履歴から設計判断の経緯を追跡可能
    const inputChanges = session.changes.filter(c => c.category === "input");
    assert.equal(inputChanges.length, 1);
    assert.equal(inputChanges[0]!.field, "valveA.closeTime");

    const mocChanges = session.changes.filter(c => c.category === "moc");
    assert.equal(mocChanges.length, 1);
  });

  test("MOC結果サマリーと条件を一体保存できる", () => {
    const network = buildTJunctionNetwork();
    const result = runMoc(network, { tMax: 20 });

    let session = createSession({ name: "T字分岐検証" });
    session.mocNetwork = network;
    session.mocOptions = { tMax: 20 };
    session.mocSummary = summarizeMocResult(result);

    // 保存データから設計条件を再確認可能
    assert.equal(session.mocNetwork.pipes.length, 3);
    assert.equal(session.mocSummary.tMax, 20);
    assert.ok(session.mocSummary.pipeEnvelopes["branch_a"]);

    // 後日の再点検: 最大水頭が許容内圧を超えていないか確認
    const maxH = Math.max(...session.mocSummary.pipeEnvelopes["branch_a"]!.Hmax);
    assert.ok(maxH > 0, `保存されたHmax(${maxH.toFixed(2)})から設計判断を再確認可能`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 検証ケース4: ポンプ停止 + T字分岐
//
// 想定: ポンプ圧送系統で急停止した場合。
//   ポンプ(H=50m) → 幹線φ400×800m → 分岐点 → 支線A φ300×500m → 行き止まり
//                                              → 支線B φ250×600m → 行き止まり
// ═══════════════════════════════════════════════════════════════════════════════

describe("検証ケース4: ポンプ停止 + T字分岐", () => {
  const Q_total = 0.16;
  const Q_A = 0.10;
  const Q_B = 0.06;

  const network: MocNetwork = {
    pipes: [
      {
        id: "main",
        pipe: MAIN_PIPE,
        waveSpeed: calcWaveSpeed(MAIN_PIPE),
        nReaches: 10,
        upstreamNodeId: "pump",
        downstreamNodeId: "junction",
        initialFlow: Q_total,
      },
      {
        id: "branch_a",
        pipe: { ...BRANCH_A, startNodeId: "junction", endNodeId: "dead_a" },
        waveSpeed: calcWaveSpeed(BRANCH_A),
        nReaches: 10,
        upstreamNodeId: "junction",
        downstreamNodeId: "dead_a",
        initialFlow: Q_A,
      },
      {
        id: "branch_b",
        pipe: { ...BRANCH_B, startNodeId: "junction", endNodeId: "dead_b" },
        waveSpeed: calcWaveSpeed(BRANCH_B),
        nReaches: 10,
        upstreamNodeId: "junction",
        downstreamNodeId: "dead_b",
        initialFlow: Q_B,
      },
    ],
    nodes: {
      pump: {
        type: "pump",
        Q0: Q_total,
        H0: 50,
        shutdownTime: 0,
        mode: "trip",
      } as BoundaryCondition,
      dead_a: { type: "dead_end" } as BoundaryCondition,
      dead_b: { type: "dead_end" } as BoundaryCondition,
    },
  };

  const result = runMoc(network, { tMax: 15 });

  test("ポンプ停止 + 分岐管路でMOCが正常完了する", () => {
    assert.ok(result);
    assert.equal(Object.keys(result.pipes).length, 3);
  });

  test("ポンプ停止により負圧（水頭低下）が発生する", () => {
    // ポンプ停止時は水頭が低下する傾向
    const hminMain = Math.min(...result.pipes["main"]!.Hmin);
    const hSteadyStart = result.pipes["main"]!.H_steady[0]!;
    assert.ok(
      hminMain < hSteadyStart,
      `幹線Hmin(${hminMain.toFixed(2)}) < 定常水頭(${hSteadyStart.toFixed(2)})`,
    );
  });

  test("行き止まり端で圧力反射が確認される", () => {
    const deadANode = result.nodes["dead_a"];
    assert.ok(deadANode);
    const heads = deadANode.H.map(h => h.H);
    const range = Math.max(...heads) - Math.min(...heads);
    // 行き止まりでは全反射するため圧力変動が大きい
    assert.ok(range > 1, `dead_a 水頭変動幅(${range.toFixed(2)}) > 1m`);
  });
});
