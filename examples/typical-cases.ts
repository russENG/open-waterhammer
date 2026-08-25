/**
 * 実務でありそうな条件による最小データ例
 *
 * 農業用パイプラインの水撃圧検討で典型的に出てくる場面を、
 * **管路 1〜3 本の最小構成**で組み、定常計算 → 非定常計算（MOC）→ 耐圧判定
 * まで一気通貫で走らせる。計算エンジンが実務条件で妥当な数値を返すかを
 * 確認するためのもの。
 *
 * 実行:
 *   npx tsx examples/typical-cases.ts
 *
 * 各ケースは物理的な整合性（NaN が出ない・流速や波速が妥当範囲・防護工が
 * 効いている）を自己チェックし、1 件でも外れたら終了コード 1 で終わる。
 *
 * ⚠ 呼び圧力（許容圧力）・GD²・エアチャンバ容量は例示のための仮定値であり、
 *   実際の設計では採用する製品・規格の値を確認すること。
 */

import {
  GRAVITY,
  calcSteadyNetwork,
  calcVibrationPeriod,
  calcWaveSpeed,
  determineClosureType,
  headToMpa,
  joukowsky,
  judgeDesignPressure,
  runMoc,
  type BoundaryCondition,
  type MocNetwork,
  type MocResult,
  type Pipe,
} from "../packages/core/src/index.js";

// ═══════════════════════════════════════════════════════════════════════════════
// 共通ヘルパー
// ═══════════════════════════════════════════════════════════════════════════════

const problems: string[] = [];
const findings: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) problems.push(message);
}

function area(D: number): number {
  return Math.PI * D * D / 4;
}

function fmt(v: number, digits = 2): string {
  return Number.isFinite(v) ? v.toFixed(digits) : "NaN";
}

const CLOSURE_LABEL: Record<string, string> = {
  rapid: "急閉そく",
  slow: "緩閉そく",
  numerical_required: "数値解析要",
};

/**
 * 全管路の Courant 誤差が小さくなる計算区間数の組を選ぶ。
 *
 * MOC は全管路で共通の Δt を使うため、Δx = a·Δt が全管路で同時に成り立つ
 * 分割数を選ぶ必要がある（技術書 §8.4.2(2)）。実務では管路長・波速が揃わないので、
 * Δx を実務目安 50〜200 m に収めつつ Courant 誤差が許容内になる組を探索し、
 * 誤差が同等なら Δx が目安の中央（100 m）に近い方を選ぶ。
 */
function pickReaches(
  pipes: { length: number; waveSpeed: number }[],
  opts: { dxMin?: number; dxMax?: number; dxTarget?: number } = {},
): { reaches: number[]; courantErr: number; dt: number; dxMin: number } {
  // まず実務目安 50〜200 m で探し、見つからなければ段階的に下限を下げる
  const floors = opts.dxMin !== undefined ? [opts.dxMin] : [50, 35, 20];
  for (const dxMin of floors) {
    const found = searchReaches(pipes, dxMin, opts.dxMax ?? 200, opts.dxTarget ?? 100);
    if (found && found.courantErr < 0.01) return { ...found, dxMin };
  }
  const last = searchReaches(pipes, floors[floors.length - 1]!, opts.dxMax ?? 200, opts.dxTarget ?? 100);
  if (last) return { ...last, dxMin: floors[floors.length - 1]! };
  throw new Error("Courant 条件を満たす計算区間数の組が見つかりません");
}

function searchReaches(
  pipes: { length: number; waveSpeed: number }[],
  dxMin: number,
  dxMax: number,
  dxTarget: number,
): { reaches: number[]; courantErr: number; dt: number } | null {
  let best: { reaches: number[]; err: number; dt: number; rank: [number, number] } | null = null;
  const first = pipes[0]!;

  for (let n0 = 1; n0 <= 800; n0++) {
    const dt = first.length / (first.waveSpeed * n0);
    const reaches = pipes.map(p => Math.max(1, Math.round(p.length / (p.waveSpeed * dt))));
    let err = 0;
    let dxPenalty = 0;
    let ok = true;
    for (let i = 0; i < pipes.length; i++) {
      const dx = pipes[i]!.length / reaches[i]!;
      if (dx > dxMax || dx < dxMin) { ok = false; break; }
      err = Math.max(err, Math.abs(dx - pipes[i]!.waveSpeed * dt) / (pipes[i]!.waveSpeed * dt));
      dxPenalty = Math.max(dxPenalty, Math.abs(dx - dxTarget));
    }
    if (!ok) continue;
    // Courant 誤差 0.5% 以下は実用上等価とみなし、Δx が目安中央に近い方を優先する
    const rank: [number, number] = err <= 0.005 ? [0, dxPenalty] : [1, err];
    if (best === null || rank[0] < best.rank[0] || (rank[0] === best.rank[0] && rank[1] < best.rank[1])) {
      best = { reaches, err, dt, rank };
    }
  }
  return best === null ? null : { reaches: best.reaches, courantErr: best.err, dt: best.dt };
}

/** 単一管路の定常損失 [m]（摩擦 + 局部） */
function steadyLoss(D: number, L: number, C: number, Q: number, minorLossCoeff = 0): number {
  return calcSteadyNetwork({
    pipes: [{ id: "p", upstreamNodeId: "U", downstreamNodeId: "D", innerDiameter: D, length: L, roughnessC: C, minorLossCoeff }],
    nodes: [
      { id: "U", elevation: 0, type: "reservoir", head: 1000 },
      { id: "D", elevation: 0, type: "demand", demand: Q },
    ],
  }).pipeResults[0]!.totalLoss;
}

interface CaseReport { id: string; title: string; lines: string[] }
const reports: CaseReport[] = [];

/**
 * 管路に沿って設計水圧が最大になる地点を探して耐圧判定する。
 * 管中心高は上流端・下流端の標高を直線補間したものとする。
 */
function judgeAlongPipe(
  result: MocResult,
  pipeId: string,
  upEl: number,
  dnEl: number,
  staticHead: number,
  allowableMpa: number,
  lines: string[],
): void {
  const p = result.pipes[pipeId]!;
  const N = p.nReaches;
  const centerAt = (i: number) => upEl + (dnEl - upEl) * i / N;

  let worstIdx = 0;
  let worstMpa = -Infinity;
  let minGauge = Infinity;
  let minGaugeIdx = 0;
  for (let i = 0; i <= N; i++) {
    const mpa = headToMpa(p.Hmax[i]! - centerAt(i));
    if (mpa > worstMpa) { worstMpa = mpa; worstIdx = i; }
    const gauge = p.Hmin[i]! - centerAt(i);
    if (gauge < minGauge) { minGauge = gauge; minGaugeIdx = i; }
    check(Number.isFinite(p.Hmax[i]!) && Number.isFinite(p.Hmin[i]!), `${pipeId}: 格子点 ${i} の水頭が NaN`);
  }

  const dx = p.dx;
  const surgeHead = p.Hmax[worstIdx]! - staticHead;
  const judgement = judgeDesignPressure(worstMpa, allowableMpa);

  lines.push(
    `  設計水圧が最大になる地点: 上流端から ${fmt(worstIdx * dx, 0)} m（管中心 EL.${fmt(centerAt(worstIdx))}）`,
    `    Hmax=${fmt(p.Hmax[worstIdx]!)} m → 設計水圧 ${fmt(worstMpa, 3)} MPa / 許容 ${fmt(allowableMpa, 3)} MPa`
    + `  → ${judgement.status.toUpperCase()}`,
    `    ${judgement.message}`,
    `  最小動水頭: ${fmt(minGauge)} m（上流端から ${fmt(minGaugeIdx * dx, 0)} m、管中心 EL.${fmt(centerAt(minGaugeIdx))}）`
    + (minGauge < 0 ? "  → 負圧発生。技術書 §8.3 の防護工検討が必要" : "  → 負圧なし"),
  );
  void surgeHead;
}

/** 管路諸元を 1 行で表示 */
function pipeLine(pipe: Pipe, a: number, Q: number): string {
  const V = Q / area(pipe.innerDiameter);
  return `  ${pipe.name ?? pipe.id}: ${pipe.pipeType} φ${(pipe.innerDiameter * 1000).toFixed(0)}mm × t${(pipe.wallThickness * 1000).toFixed(1)}mm × L=${pipe.length}m`
    + `  C=${pipe.roughnessCoeff}  Q=${fmt(Q, 4)} m³/s (V=${fmt(V)} m/s)  a=${fmt(a, 0)} m/s  2L/a=${fmt(2 * pipe.length / a)} s`;
}

/** ダクタイル鋳鉄管の呼び圧力（例示のための仮定値） */
const DCIP_ALLOWABLE_MPA = 0.75;
/** 硬質塩ビ管 VP の呼び圧力（例示のための仮定値） */
const VP_ALLOWABLE_MPA = 0.75;

// ═══════════════════════════════════════════════════════════════════════════════
// ケース A — 定常: 樹枝状配水網（取水工 → 幹線 → 分水工 → 支線 2 本）
// ═══════════════════════════════════════════════════════════════════════════════

{
  const lines: string[] = [];
  const result = calcSteadyNetwork({
    caseName: "A. 樹枝状配水網の定常計算",
    pipes: [
      { id: "幹線", upstreamNodeId: "取水工", downstreamNodeId: "分水工", innerDiameter: 0.300, length: 800, roughnessC: 130, minorLossCoeff: 1.5 },
      { id: "支線1", upstreamNodeId: "分水工", downstreamNodeId: "給水栓1", innerDiameter: 0.250, length: 450, roughnessC: 130, minorLossCoeff: 2.0 },
      { id: "支線2", upstreamNodeId: "分水工", downstreamNodeId: "給水栓2", innerDiameter: 0.200, length: 300, roughnessC: 130, minorLossCoeff: 2.0 },
    ],
    nodes: [
      { id: "取水工", elevation: 82.0, type: "reservoir", head: 85.0 },
      { id: "分水工", elevation: 62.0, type: "junction" },
      { id: "給水栓1", elevation: 45.0, type: "demand", demand: 0.060 },
      { id: "給水栓2", elevation: 50.0, type: "demand", demand: 0.030 },
    ],
  });

  lines.push("  取水工 EL.82.0（水位 EL.85.0） → 分水工 EL.62.0 → 給水栓1 EL.45.0 / 給水栓2 EL.50.0");
  lines.push("  管路");
  for (const p of result.pipeResults) {
    lines.push(
      `    ${p.pipeId.padEnd(4)}: Q=${fmt(p.flow, 4)} m³/s  V=${fmt(p.velocity)} m/s`
      + `  hf=${fmt(p.frictionLoss)} m  局部=${fmt(p.minorLoss)} m  I=${fmt(p.hydraulicGradient * 1000, 2)} ‰`,
    );
    check(p.velocity > 0.3 && p.velocity < 3.0, `A: ${p.pipeId} の流速 ${fmt(p.velocity)} m/s が実務レンジ外`);
  }
  lines.push("  節点");
  for (const n of result.nodeResults) {
    lines.push(
      `    ${n.nodeId.padEnd(5)}: 動水位 EL.${fmt(n.hydraulicGradeLine)}  動水頭=${fmt(n.pressureHead)} m`
      + `  水圧=${fmt(n.pressureMpa, 3)} MPa`,
    );
    check(n.pressureHead >= 0, `A: ${n.nodeId} が負圧`);
  }
  // 連続条件の確認
  const qMain = result.pipeResults.find(p => p.pipeId === "幹線")!.flow;
  const qBranch = result.pipeResults.filter(p => p.pipeId !== "幹線").reduce((s, p) => s + p.flow, 0);
  lines.push(`  連続条件: 幹線 ${fmt(qMain, 4)} = 支線計 ${fmt(qBranch, 4)} m³/s`);
  lines.push(`  最大流速 ${fmt(result.maxVelocity)} m/s / 最大動水頭 ${fmt(result.maxPressureHead)} m`);
  lines.push(`  warnings: ${result.warnings.length === 0 ? "なし" : JSON.stringify(result.warnings)}`);
  check(Math.abs(qMain - qBranch) < 1e-12, "A: 連続条件が成立していない");
  reports.push({ id: "A", title: "定常 — 樹枝状配水網（幹線 φ300 + 支線 φ250/φ200）", lines });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ケース B / C — 幹線末端制水弁の閉そく（自然圧送）
//
// ファームポンドから自然圧で送水する幹線の末端に制水弁がある構成。
// B: 電動弁が 1 秒で閉じてしまった場合（急閉そく）
// C: 同じ弁を 15 秒かけて閉じた場合（緩閉そく＝対策後）
// ═══════════════════════════════════════════════════════════════════════════════

const MAIN_PIPE: Pipe = {
  id: "幹線", name: "第1号幹線",
  startNodeId: "ファームポンド", endNodeId: "制水弁",
  pipeType: "ductile_iron", innerDiameter: 0.300, wallThickness: 0.0066,
  length: 800, roughnessCoeff: 130,
};
const MAIN_A = calcWaveSpeed(MAIN_PIPE);
const MAIN_V0 = 1.5;
const MAIN_Q = MAIN_V0 * area(MAIN_PIPE.innerDiameter);
const MAIN_POND_WL = 85.0;    // ファームポンド水位 EL.[m]
const MAIN_POND_EL = 82.0;    // ポンド底付近の管中心 EL.[m]
const MAIN_VALVE_EL = 40.0;   // 制水弁 標高 EL.[m]

for (const [caseId, closeTime, note] of [
  ["B", 1.0, "電動弁が 1 秒で全閉（急閉そく）"],
  ["C", 15.0, "同じ弁を 15 秒かけて全閉（対策後）"],
] as const) {
  const lines: string[] = [];
  const hf = steadyLoss(MAIN_PIPE.innerDiameter, MAIN_PIPE.length, MAIN_PIPE.roughnessCoeff, MAIN_Q);
  const grid = pickReaches([{ length: MAIN_PIPE.length, waveSpeed: MAIN_A }]);
  const nReaches = grid.reaches[0]!;

  const result = runMoc({
    pipes: [{
      id: "幹線", pipe: MAIN_PIPE, waveSpeed: MAIN_A, nReaches,
      upstreamNodeId: "ファームポンド", downstreamNodeId: "制水弁", initialFlow: MAIN_Q,
    }],
    nodes: {
      "ファームポンド": { type: "reservoir", head: MAIN_POND_WL },
      "制水弁": { type: "valve", Q0: MAIN_Q, H0v: MAIN_POND_WL - hf, closeTime, operation: "close" },
    },
  }, { tMax: Math.max(30, closeTime * 3), initialFlow: MAIN_Q });

  const closure = determineClosureType(closeTime, MAIN_PIPE.length, MAIN_A);

  lines.push(`  ${note}`);
  lines.push(pipeLine(MAIN_PIPE, MAIN_A, MAIN_Q));
  lines.push(`  ポンド水位 EL.${fmt(MAIN_POND_WL, 1)} / 弁標高 EL.${fmt(MAIN_VALVE_EL, 1)} → 弁位置の静水頭 ${fmt(MAIN_POND_WL - MAIN_VALVE_EL, 1)} m`);
  lines.push(`  定常損失 hf=${fmt(hf)} m → 通水時の弁前動水位 EL.${fmt(MAIN_POND_WL - hf)}`);
  lines.push(
    `  閉そく時間 tν=${fmt(closeTime, 1)} s → 区分「${CLOSURE_LABEL[closure.closureType]}」`
    + `（α=tν/(4L/a)=${fmt(closure.alpha, 3)}、2L/a=${fmt(2 * MAIN_PIPE.length / MAIN_A)} s、4L/a=${fmt(calcVibrationPeriod(MAIN_PIPE.length, MAIN_A))} s）`,
  );
  lines.push(`  計算格子 N=${nReaches}（Δx=${fmt(MAIN_PIPE.length / nReaches, 1)} m、Δt=${fmt(result.dt, 4)} s、Courant誤差=${fmt(grid.courantErr * 100, 2)}%）`);
  lines.push(`  参考 ジューコフスキー ΔH=aV₀/g=${fmt(joukowsky(MAIN_A, -MAIN_V0))} m`);

  const p = result.pipes["幹線"]!;
  lines.push(`  弁直上流: Hmax=${fmt(p.Hmax[nReaches]!)} m  Hmin=${fmt(p.Hmin[nReaches]!)} m  水撃圧上昇=${fmt(p.Hmax[nReaches]! - MAIN_POND_WL)} m`);
  judgeAlongPipe(result, "幹線", MAIN_POND_EL, MAIN_VALVE_EL, MAIN_POND_WL, DCIP_ALLOWABLE_MPA, lines);
  if (result.warnings?.length) lines.push(`  warnings: ${JSON.stringify(result.warnings)}`);

  check(MAIN_A > 1000 && MAIN_A < 1300, `${caseId}: ダクタイル鋳鉄管の波速 ${fmt(MAIN_A, 0)} m/s が妥当範囲外`);
  check(closure.closureType === (caseId === "B" ? "rapid" : "slow"), `${caseId}: 閉そく区分の判定が想定と違う`);
  reports.push({
    id: caseId,
    title: `非定常 — 幹線末端制水弁 tν=${fmt(closeTime, 1)}s（DCIP φ300 × L=800m、V₀=1.5 m/s）`,
    lines,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ケース D — 支線給水栓の急閉（硬質塩ビ管）
//
// 樹脂管は波速が小さく、同じ流速でも水撃圧が大幅に小さくなることを確認する。
// ═══════════════════════════════════════════════════════════════════════════════

{
  const lines: string[] = [];
  const pipe: Pipe = {
    id: "支線", name: "支線（VP）",
    startNodeId: "分水工", endNodeId: "給水栓",
    pipeType: "upvc", innerDiameter: 0.150, wallThickness: 0.0065,
    length: 400, roughnessCoeff: 130,
  };
  const a = calcWaveSpeed(pipe);
  const V0 = 1.0;
  const Q = V0 * area(pipe.innerDiameter);
  const tankWl = 62.0, tankEl = 62.0, outletEl = 45.0;
  const closeTime = 0.5;

  const hf = steadyLoss(pipe.innerDiameter, pipe.length, pipe.roughnessCoeff, Q);
  const grid = pickReaches([{ length: pipe.length, waveSpeed: a }]);
  const nReaches = grid.reaches[0]!;
  const result = runMoc({
    pipes: [{ id: "支線", pipe, waveSpeed: a, nReaches, upstreamNodeId: "分水工", downstreamNodeId: "給水栓", initialFlow: Q }],
    nodes: {
      "分水工": { type: "reservoir", head: tankWl },
      "給水栓": { type: "valve", Q0: Q, H0v: tankWl - hf, closeTime, operation: "close" },
    },
  }, { tMax: 20, initialFlow: Q });

  const closure = determineClosureType(closeTime, pipe.length, a);
  lines.push("  給水栓を 0.5 秒で急に閉じた場合");
  lines.push(pipeLine(pipe, a, Q));
  lines.push(`  分水工水位 EL.${fmt(tankWl, 1)} / 給水栓 EL.${fmt(outletEl, 1)} → 静水頭 ${fmt(tankWl - outletEl, 1)} m`);
  lines.push(`  閉そく区分「${CLOSURE_LABEL[closure.closureType]}」（α=${fmt(closure.alpha, 3)}、2L/a=${fmt(2 * pipe.length / a)} s）`);
  lines.push(`  計算格子 N=${nReaches}（Δx=${fmt(pipe.length / nReaches, 1)} m、Δt=${fmt(result.dt, 4)} s）`);
  lines.push(
    `  参考 ジューコフスキー ΔH=${fmt(joukowsky(a, -V0))} m`
    + `（同じ V₀=1.0 でもダクタイル鋳鉄管 a=${fmt(MAIN_A, 0)} m/s なら ${fmt(joukowsky(MAIN_A, -1.0))} m）`,
  );
  const p = result.pipes["支線"]!;
  lines.push(`  給水栓: Hmax=${fmt(p.Hmax[nReaches]!)} m  Hmin=${fmt(p.Hmin[nReaches]!)} m  水撃圧上昇=${fmt(p.Hmax[nReaches]! - tankWl)} m`);
  judgeAlongPipe(result, "支線", tankEl, outletEl, tankWl, VP_ALLOWABLE_MPA, lines);

  check(a > 250 && a < 600, `D: 硬質塩ビ管の波速 ${fmt(a, 0)} m/s が妥当範囲外`);
  check(a < MAIN_A, "D: 樹脂管の波速が鋳鉄管を上回っている");
  reports.push({ id: "D", title: "非定常 — 支線給水栓の急閉（VP φ150 × L=400m、V₀=1.0 m/s）", lines });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ケース E / F — 揚水機場の停電（ポンプ急停止）と防護工
//
// 揚水機場から高区配水池へ押し上げる圧送管。停電でポンプが急停止すると
// 下降波が先に立つため、管路途中の負圧が問題になる。
// ═══════════════════════════════════════════════════════════════════════════════

const PUMP_PIPE: Pipe = {
  id: "圧送管", name: "揚水機場 圧送管",
  startNodeId: "ポンプ", endNodeId: "配水池",
  pipeType: "ductile_iron", innerDiameter: 0.250, wallThickness: 0.0060,
  length: 1500, roughnessCoeff: 130,
};
const PUMP_A = calcWaveSpeed(PUMP_PIPE);
const PUMP_Q = 0.075;
const PUMP_SUCTION_EL = 20.0;
const PUMP_TANK_EL = 68.0;
const PUMP_HF = steadyLoss(PUMP_PIPE.innerDiameter, PUMP_PIPE.length, PUMP_PIPE.roughnessCoeff, PUMP_Q, 3.0);
const PUMP_HEAD = (PUMP_TANK_EL - PUMP_SUCTION_EL) + PUMP_HF; // 全揚程 = 実揚程 + 損失
const PUMP_GRID = pickReaches([{ length: PUMP_PIPE.length, waveSpeed: PUMP_A }]);
const PUMP_N = PUMP_GRID.reaches[0]!;

const PUMP_BC: BoundaryCondition = {
  type: "pump", Q0: PUMP_Q, H0: PUMP_SUCTION_EL + PUMP_HEAD,
  GD2: 12.0, N0: 1450, eta0: 0.80, shutdownTime: 0, mode: "trip", checkValve: true,
};

function runPumpTrip(midDevice?: BoundaryCondition): MocResult {
  // 防護工は吐出直後（ポンプから 100 m）に置く。midDevice 未指定なら単純な接続点。
  const network: MocNetwork = {
    pipes: [
      { id: "圧送管", pipe: PUMP_PIPE, waveSpeed: PUMP_A, nReaches: PUMP_N, upstreamNodeId: "ポンプ", downstreamNodeId: "配水池", initialFlow: PUMP_Q },
    ],
    nodes: { "ポンプ": PUMP_BC, "配水池": { type: "reservoir", head: PUMP_TANK_EL } },
  };
  void midDevice;
  return runMoc(network, { tMax: 60, initialFlow: PUMP_Q });
}

{
  const lines: string[] = [];
  const result = runPumpTrip();
  const p = result.pipes["圧送管"]!;

  lines.push("  停電によりポンプが急停止（GD²=12.0 N·m²、N₀=1450 min⁻¹、逆止弁あり）");
  lines.push(pipeLine(PUMP_PIPE, PUMP_A, PUMP_Q));
  lines.push(`  吸水槽 EL.${fmt(PUMP_SUCTION_EL, 1)} → 高区配水池 EL.${fmt(PUMP_TANK_EL, 1)}（実揚程 ${fmt(PUMP_TANK_EL - PUMP_SUCTION_EL, 1)} m）`);
  lines.push(`  定常損失（摩擦+局部 Σf=3.0）=${fmt(PUMP_HF)} m → 全揚程 ${fmt(PUMP_HEAD)} m`);
  lines.push(`  計算格子 N=${PUMP_N}（Δx=${fmt(PUMP_PIPE.length / PUMP_N, 1)} m、Δt=${fmt(result.dt, 4)} s）`);
  lines.push(`  管路全体: Hmax=${fmt(Math.max(...p.Hmax))} m  Hmin=${fmt(Math.min(...p.Hmin))} m`);
  judgeAlongPipe(result, "圧送管", PUMP_SUCTION_EL, PUMP_TANK_EL, PUMP_TANK_EL, DCIP_ALLOWABLE_MPA, lines);

  const nSeries = result.nodes["ポンプ"]?.N;
  if (nSeries?.length) {
    lines.push(`  ポンプ回転速度: ${fmt(nSeries[0]!.N, 0)} → ${fmt(nSeries[nSeries.length - 1]!.N, 0)} min⁻¹`);
    check(nSeries[nSeries.length - 1]!.N < nSeries[0]!.N, "E: ポンプ回転速度が低下していない");
  }
  reports.push({ id: "E", title: "非定常 — 揚水機場の停電（DCIP φ250 × L=1500m、防護工なし）", lines });
}

// ── F: 防護工を「管路の途中（インライン）」に置こうとした場合 ──────────────────
//
// 実務でエアチャンバ・調圧水槽・吸気弁・減圧弁を設置する位置は、いずれも
// 管路の途中（流入管と流出管の両方がある節点）である。ところが本ソルバーは
// これらの境界条件を「流入管 1 本の末端」としてしか解いておらず、流出管の
// 流量が 0 に固定される。結果として防護工が完全閉そくとして働いてしまう。
{
  const lines: string[] = [];
  const mkSeg = (id: string, L: number, N: number, from: string, to: string) => ({
    id,
    pipe: { ...PUMP_PIPE, id, name: id, length: L } as Pipe,
    waveSpeed: PUMP_A, nReaches: N, upstreamNodeId: from, downstreamNodeId: to, initialFlow: PUMP_Q,
  });
  // 吐出から 100 m の位置に防護工を置く（100 m + 1400 m に分割）
  const segs = [
    { length: 100, waveSpeed: PUMP_A },
    { length: 1400, waveSpeed: PUMP_A },
  ];
  const grid = pickReaches(segs, { dxMin: 20, dxMax: 200, dxTarget: 100 });

  function runWithMidNode(device?: BoundaryCondition): MocResult {
    const nodes: Record<string, BoundaryCondition> = {
      "ポンプ": PUMP_BC,
      "配水池": { type: "reservoir", head: PUMP_TANK_EL },
    };
    if (device) nodes["防護工"] = device;
    return runMoc({
      pipes: [
        mkSeg("吐出管", 100, grid.reaches[0]!, "ポンプ", "防護工"),
        mkSeg("圧送管", 1400, grid.reaches[1]!, "防護工", "配水池"),
      ],
      nodes,
    }, { tMax: 60, initialFlow: PUMP_Q });
  }

  const none = runWithMidNode();
  const withAc = runWithMidNode({ type: "air_chamber", V_air0: 1.2, H_air0: PUMP_SUCTION_EL + PUMP_HEAD, polytropicIndex: 1.2 });

  const mainNone = none.pipes["圧送管"]!;
  const mainAc = withAc.pipes["圧送管"]!;
  const qNone = mainNone.snapshots.slice(0, 5).map(s => s.Q[0]!.toFixed(5)).join(", ");
  const qAc = mainAc.snapshots.slice(0, 5).map(s => s.Q[0]!.toFixed(5)).join(", ");

  lines.push("  ケース E の吐出から 100 m の位置にエアチャンバ（V_air0=1.2 m³、m=1.2）を設置");
  lines.push(`  計算格子 N=[${grid.reaches.join(", ")}]（Δt=${fmt(none.dt, 4)} s、Courant誤差=${fmt(grid.courantErr * 100, 2)}%）`);
  lines.push("");
  lines.push("  ▼ 防護工を置かず単純な接続点にした場合（＝ケース E 相当）");
  lines.push(`    圧送管 上流端 Q（先頭5点）: ${qNone} m³/s`);
  lines.push(`    圧送管 Hmax=${fmt(Math.max(...mainNone.Hmax))} m  Hmin=${fmt(Math.min(...mainNone.Hmin))} m`);
  lines.push("");
  lines.push("  ▼ 同じ位置にエアチャンバを置いた場合");
  lines.push(`    圧送管 上流端 Q（先頭5点）: ${qAc} m³/s`);
  lines.push(`    圧送管 Hmax=${fmt(Math.max(...mainAc.Hmax))} m  Hmin=${fmt(Math.min(...mainAc.Hmin))} m`);

  const acQ = mainAc.snapshots.slice(1, 6).map(s => s.Q[0]!);
  const blocked = acQ.every(q => Math.abs(q) < 1e-12);
  if (blocked) {
    lines.push("");
    lines.push("  ⚠ エアチャンバ設置後、下流側（圧送管）の流量が 1 ステップ目から厳密に 0 になっている。");
    lines.push("    これは物理現象ではなく、moc.ts の境界条件処理が air_chamber を");
    lines.push("    「流入管 1 本の末端」としてしか解かず、流出管の流量を 0 のまま残すため。");
    lines.push("    防護工が完全閉そくとして働き、下流管が水源から切り離される。");
    lines.push("    → 現状 air_chamber / surge_tank / air_release_valve / pressure_reducing_valve は");
    lines.push("      管路末端にしか設置できない。実務の設置位置（管路途中）では使えない。");
    findings.push(
      "moc.ts: air_chamber / surge_tank / air_release_valve / pressure_reducing_valve を"
      + "管路途中（流入管+流出管のある節点）に置くと、流出管の流量が 0 に固定される。"
      + "既存テストはいずれも管路末端配置しか検証していない。",
    );
  }

  // 末端配置なら防護工モデル自体は正しく動く、という対照を示す
  const deadEnd = runMoc({
    pipes: [{ id: "圧送管", pipe: PUMP_PIPE, waveSpeed: PUMP_A, nReaches: PUMP_N, upstreamNodeId: "ポンプ", downstreamNodeId: "末端", initialFlow: PUMP_Q }],
    nodes: { "ポンプ": PUMP_BC, "末端": { type: "dead_end" } },
  }, { tMax: 60, initialFlow: PUMP_Q });
  const acEnd = runMoc({
    pipes: [{ id: "圧送管", pipe: PUMP_PIPE, waveSpeed: PUMP_A, nReaches: PUMP_N, upstreamNodeId: "ポンプ", downstreamNodeId: "末端", initialFlow: PUMP_Q }],
    nodes: {
      "ポンプ": PUMP_BC,
      "末端": { type: "air_chamber", V_air0: 1.2, H_air0: PUMP_SUCTION_EL + PUMP_HEAD, polytropicIndex: 1.2 },
    },
  }, { tMax: 60, initialFlow: PUMP_Q });
  const minDead = Math.min(...deadEnd.pipes["圧送管"]!.Hmin);
  const minAcEnd = Math.min(...acEnd.pipes["圧送管"]!.Hmin);
  const vs = acEnd.nodes["末端"]?.V_air?.map(s => s.V) ?? [];

  lines.push("");
  lines.push("  ▼ 対照: 管路末端（行き止まり位置）にエアチャンバを置いた場合＝現状サポートされる配置");
  lines.push(`    行き止まりのまま:     管路最小水頭 ${fmt(minDead)} m`);
  lines.push(`    エアチャンバ設置後:   管路最小水頭 ${fmt(minAcEnd)} m（${fmt(minAcEnd - minDead)} m の改善）`);
  if (vs.length) {
    lines.push(`    空気容積: 初期 ${fmt(vs[0]!, 3)} → 最小 ${fmt(Math.min(...vs), 3)} / 最大 ${fmt(Math.max(...vs), 3)} m³`);
    check(Math.max(...vs) - Math.min(...vs) > 1e-6, "F: 末端配置でも空気容積が変化していない");
  }
  check(minAcEnd > minDead, "F: 末端配置のエアチャンバで最小水頭が改善していない");

  reports.push({ id: "F", title: "非定常 — 防護工（エアチャンバ）の設置位置と効果", lines });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ケース G — T字分岐で片方の支線バルブを閉じる
// ═══════════════════════════════════════════════════════════════════════════════

{
  const lines: string[] = [];
  const mk = (id: string, D: number, t: number, L: number, from: string, to: string): Pipe => ({
    id, name: id, startNodeId: from, endNodeId: to,
    pipeType: "ductile_iron", innerDiameter: D, wallThickness: t, length: L, roughnessCoeff: 130,
  });
  const main = mk("幹線", 0.300, 0.0066, 900, "取水工", "分水工");
  const brA = mk("支線A", 0.200, 0.0060, 600, "分水工", "バルブA");
  const brB = mk("支線B", 0.150, 0.0055, 400, "分水工", "バルブB");
  const aMain = calcWaveSpeed(main), aA = calcWaveSpeed(brA), aB = calcWaveSpeed(brB);

  const QA = 0.045, QB = 0.020, QM = QA + QB;
  const headSource = 85.0;
  const hfMain = steadyLoss(main.innerDiameter, main.length, main.roughnessCoeff, QM);
  const hfA = steadyLoss(brA.innerDiameter, brA.length, brA.roughnessCoeff, QA);
  const hfB = steadyLoss(brB.innerDiameter, brB.length, brB.roughnessCoeff, QB);

  const grid = pickReaches([
    { length: main.length, waveSpeed: aMain },
    { length: brA.length, waveSpeed: aA },
    { length: brB.length, waveSpeed: aB },
  ]);
  const [nM, nA, nB] = grid.reaches as [number, number, number];

  const result = runMoc({
    pipes: [
      { id: "幹線", pipe: main, waveSpeed: aMain, nReaches: nM, upstreamNodeId: "取水工", downstreamNodeId: "分水工", initialFlow: QM },
      { id: "支線A", pipe: brA, waveSpeed: aA, nReaches: nA, upstreamNodeId: "分水工", downstreamNodeId: "バルブA", initialFlow: QA },
      { id: "支線B", pipe: brB, waveSpeed: aB, nReaches: nB, upstreamNodeId: "分水工", downstreamNodeId: "バルブB", initialFlow: QB },
    ],
    nodes: {
      "取水工": { type: "reservoir", head: headSource },
      // 支線A のバルブだけを 2 秒で閉じる。支線B は開いたまま。
      "バルブA": { type: "valve", Q0: QA, H0v: headSource - hfMain - hfA, closeTime: 2.0, operation: "close" },
      "バルブB": { type: "valve", Q0: QB, H0v: headSource - hfMain - hfB, closeTime: 1e9, operation: "close" },
    },
  }, { tMax: 30 });

  lines.push("  支線A のバルブだけを 2 秒で全閉（支線B は開いたまま）");
  lines.push(pipeLine(main, aMain, QM));
  lines.push(pipeLine(brA, aA, QA));
  lines.push(pipeLine(brB, aB, QB));
  lines.push(`  計算格子 N=[${grid.reaches.join(", ")}]（Δt=${fmt(result.dt, 4)} s、Courant誤差=${fmt(grid.courantErr * 100, 2)}%）`);
  if (grid.dxMin < 50) {
    lines.push(
      `  ※ Δx≥50 m（実務目安）では全 3 管路の Courant 誤差を 1% 以内に収められないため、`
      + `下限を ${grid.dxMin} m まで下げた。管路長 900/600/400 m と波速 ${fmt(aMain, 0)}/${fmt(aA, 0)}/${fmt(aB, 0)} m/s の比が`,
      `    整数分割で揃わないことによる。分岐管路では「Δx 50〜200 m」と「共通 Δt」が両立しない場面が普通に出る。`,
    );
    findings.push(
      "分岐管路では実務目安 Δx=50〜200 m と共通 Δt（Courant 誤差 1% 以内）が両立しないことがある。"
      + "ケース G（φ300×900m / φ200×600m / φ150×400m）では Δx≈41〜44 m まで細かくする必要があった。",
    );
  }
  for (const pipeId of ["幹線", "支線A", "支線B"]) {
    const p = result.pipes[pipeId]!;
    lines.push(
      `  ${pipeId}: Hmax=${fmt(Math.max(...p.Hmax))} m  Hmin=${fmt(Math.min(...p.Hmin))} m`
      + `  Δx=${fmt(p.dx, 1)} m  （定常 ${fmt(p.H_steady[0]!)}→${fmt(p.H_steady[p.nReaches]!)} m）`,
    );
  }
  const jSeries = result.nodes["分水工"]!.H.map(s => s.H);
  lines.push(`  分水工（分岐点）: ${fmt(Math.min(...jSeries))} 〜 ${fmt(Math.max(...jSeries))} m`);
  const vbSeries = result.nodes["バルブB"]!.H.map(s => s.H);
  lines.push(
    `  開いたままの バルブB: ${fmt(Math.min(...vbSeries))} 〜 ${fmt(Math.max(...vbSeries))} m`
    + ` → 操作していない支線にも ${fmt(Math.max(...vbSeries) - vbSeries[0]!)} m の圧力上昇が伝わる`,
  );
  if (result.warnings?.length) {
    lines.push(`  warnings: ${result.warnings.length} 件（いずれも Δx が実務目安 50 m 未満である旨の注意）`);
  }

  check(Math.max(...vbSeries) > vbSeries[0]!, "G: 開いたままの支線に水撃圧が伝わっていない");
  check(grid.courantErr < 0.01, `G: Courant 誤差 ${fmt(grid.courantErr * 100, 2)}% が許容 1% を超過`);
  reports.push({ id: "G", title: "非定常 — T字分岐で片方の支線バルブを閉じる（幹線 φ300 + 支線 φ200/φ150）", lines });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 出力
// ═══════════════════════════════════════════════════════════════════════════════

console.log("═".repeat(100));
console.log("実務条件による最小データ例 — 計算結果");
console.log(`重力加速度 g = ${GRAVITY} m/s²（技術書準拠）`);
console.log("═".repeat(100));

for (const r of reports) {
  console.log(`\n【ケース ${r.id}】${r.title}`);
  console.log("─".repeat(100));
  for (const line of r.lines) console.log(line);
}

console.log(`\n${"═".repeat(100)}`);
if (findings.length > 0) {
  console.log("実行中に見つかった実装上の問題:");
  for (const f of findings) console.log(`  ! ${f}`);
  console.log("");
}
if (problems.length === 0) {
  console.log("自己チェック: 全ケース 妥当（NaN なし・流速レンジ内・波速レンジ内・閉そく区分一致・防護効果あり）");
} else {
  console.log(`自己チェック: ${problems.length} 件の問題`);
  for (const p of problems) console.log(`  ✖ ${p}`);
  process.exitCode = 1;
}
