/**
 * EPANET アダプタ — 樹枝状管路網の定常水理計算を epanet-js (WASM) に委譲する。
 *
 * Stage 6（2026-05-10 着手）:
 *   メモリ「Python 移行」§計画 — 定常流のみ EPANET (epanet-js, WASM) に委譲。
 *   それ以外（MOC・防護工・ポンプ過渡）は Python core を継続使用。
 *
 * 単一の入出力契約: `@open-waterhammer/core` の `SteadyNetworkInput` /
 * `SteadyNetworkResult` をそのまま受け渡しすることで、UI 側からは TS native
 * 実装と差し替え可能にする。
 *
 * 単位系:
 *   - 入力 (Pipe.length [m], innerDiameter [m], roughnessC [-], demand [m³/s], head [m])
 *   - EPANET INP 内では LPS（流量 [L/s]・管径 [mm]・長さ [m]・水頭 [m]）に変換
 *   - 結果は再び m³/s / m / m/s に戻して返す
 */

import { Project, Workspace } from "epanet-js";
import type {
  SteadyNetworkInput,
  SteadyNetworkResult,
  NetworkPipeResult,
  NetworkNodeResult,
  NetworkPipeDef,
  NetworkNodeDef,
} from "@open-waterhammer/core";
import { headToMpa, GRAVITY } from "@open-waterhammer/core";

// ─── EPANET プロパティ列挙 ───────────────────────────────────────────────────
//
// epanet-js v0.8.0 の `dist/src/enum/NodeProperty.d.ts` /
// `dist/src/enum/LinkProperty.d.ts` と同値（TypeScript の `export *` が
// default export を伝播しない仕様で `import { NodeProperty }` が解決
// できないため、ここで再宣言する。値は EPANET 2 ToolKit の正準）。

const NodeProperty = {
  Elevation: 0,
  BaseDemand: 1,
  Demand: 9,
  Head: 10,
  Pressure: 11,
} as const;

const LinkProperty = {
  Diameter: 0,
  Length: 1,
  Roughness: 2,
  MinorLoss: 3,
  Flow: 8,
  Velocity: 9,
  Headloss: 10,
} as const;

// ─── 単位変換 ────────────────────────────────────────────────────────────────

const M3S_TO_LPS = 1000; // m³/s → L/s
const M_TO_MM = 1000; // m → mm

// ─── INP ビルダー ────────────────────────────────────────────────────────────

/** ID にスペース・タブ・特殊文字が含まれないかチェックして引用する */
function safeId(id: string): string {
  // EPANET ID は最大 31 文字、スペース不可。簡易にエスケープ
  return id.replace(/[\s;]+/g, "_").slice(0, 31);
}

/**
 * `SteadyNetworkInput` を EPANET INP テキストに変換する。
 *
 * 単位系: LPS（流量 L/s, 管径 mm, 長さ m, 水頭 m, ヘーゼン-ウィリアムズ C）
 * 摩擦損失式: H-W（土地改良基準と整合）
 */
export function buildInp(input: SteadyNetworkInput): string {
  const lines: string[] = [];

  lines.push("[TITLE]");
  lines.push(input.caseName ?? "OpenWaterhammer Steady");
  lines.push("");

  // [JUNCTIONS]: demand と junction を統合
  lines.push("[JUNCTIONS]");
  lines.push(";ID\tElev\tDemand");
  for (const n of input.nodes) {
    if (n.type === "reservoir") continue;
    const demand_lps = (n.demand ?? 0) * M3S_TO_LPS;
    lines.push(`${safeId(n.id)}\t${n.elevation}\t${demand_lps}`);
  }
  lines.push("");

  // [RESERVOIRS]
  lines.push("[RESERVOIRS]");
  lines.push(";ID\tHead");
  for (const n of input.nodes) {
    if (n.type !== "reservoir") continue;
    if (n.head === undefined) {
      throw new Error(`reservoir ${n.id} に head が指定されていません`);
    }
    lines.push(`${safeId(n.id)}\t${n.head}`);
  }
  lines.push("");

  // [PIPES]
  lines.push("[PIPES]");
  lines.push(";ID\tNode1\tNode2\tLength\tDiameter\tRoughness\tMinorLoss\tStatus");
  for (const p of input.pipes) {
    const D_mm = p.innerDiameter * M_TO_MM;
    const minor = p.minorLossCoeff ?? 0;
    lines.push(
      `${safeId(p.id)}\t${safeId(p.upstreamNodeId)}\t${safeId(p.downstreamNodeId)}\t` +
      `${p.length}\t${D_mm}\t${p.roughnessC}\t${minor}\tOPEN`,
    );
  }
  lines.push("");

  // [OPTIONS]
  lines.push("[OPTIONS]");
  lines.push("UNITS\t\t\tLPS");
  lines.push("HEADLOSS\t\tH-W");
  lines.push("SPECIFIC GRAVITY\t1.0");
  lines.push("VISCOSITY\t\t1.0");
  lines.push("TRIALS\t\t\t40");
  lines.push("ACCURACY\t\t0.001");
  lines.push("UNBALANCED\t\tCONTINUE\t10");
  lines.push("DEMAND MULTIPLIER\t1.0");
  lines.push("");

  // [REPORT]
  lines.push("[REPORT]");
  lines.push("STATUS\t\tNo");
  lines.push("SUMMARY\t\tNo");
  lines.push("");

  // [TIMES]: 定常計算なので 1 ステップ
  lines.push("[TIMES]");
  lines.push("DURATION\t\t0:00");
  lines.push("HYDRAULIC TIMESTEP\t1:00");
  lines.push("");

  lines.push("[END]");
  return lines.join("\n");
}

// ─── メイン計算関数 ──────────────────────────────────────────────────────────

/**
 * 樹枝状管路網の定常水理計算を epanet-js (WASM) で実行する。
 *
 * `calcSteadyNetwork` (TS native impl) と同じ I/O 契約。
 * 数値結果は H-W 式の同等性により近似一致するが、EPANET は
 * Newton-Raphson 反復で全体収束を保証するため、ループ・複雑な
 * 圧力依存需要に対しても TS native impl より頑健。
 */
export async function calcSteadyNetworkEpanet(
  input: SteadyNetworkInput,
): Promise<SteadyNetworkResult> {
  const caseName = input.caseName ?? "定常";
  const warnings: string[] = [];

  if (input.pipes.length === 0) {
    return {
      caseName,
      pipeResults: [],
      nodeResults: [],
      maxVelocity: 0,
      maxPressureHead: 0,
      warnings: ["管路がありません"],
    };
  }

  const reservoirs = input.nodes.filter(n => n.type === "reservoir");
  if (reservoirs.length === 0) {
    return {
      caseName,
      pipeResults: [],
      nodeResults: [],
      maxVelocity: 0,
      maxPressureHead: 0,
      warnings: ["reservoir ノードがありません"],
    };
  }

  // INP 構築
  const inp = buildInp(input);

  // epanet-js 初期化
  const ws = new Workspace();
  await ws.loadModule();
  const model = new Project(ws);

  // 仮想 FS に INP を書き込み、open → solveH
  ws.writeFile("network.inp", inp);
  try {
    model.open("network.inp", "report.rpt", "out.bin");
    model.solveH();
  } catch (e) {
    return {
      caseName,
      pipeResults: [],
      nodeResults: [],
      maxVelocity: 0,
      maxPressureHead: 0,
      warnings: [`EPANET solveH エラー: ${e}`],
    };
  }

  // 節点結果取得
  const nodeResults: NetworkNodeResult[] = [];
  let maxPressureHead = 0;
  for (const n of input.nodes) {
    const id = safeId(n.id);
    let nodeIdx: number;
    try {
      nodeIdx = model.getNodeIndex(id);
    } catch {
      warnings.push(`${n.id}: EPANET 内に節点が見つかりません`);
      continue;
    }
    const head = model.getNodeValue(nodeIdx, NodeProperty.Head);
    const pressureHead = head - n.elevation;
    nodeResults.push({
      nodeId: n.id,
      head,
      hydraulicGradeLine: head,
      pressureHead,
      pressureMpa: headToMpa(pressureHead),
    });
    if (pressureHead > maxPressureHead) maxPressureHead = pressureHead;
    if (pressureHead < 0 && n.type !== "reservoir") {
      warnings.push(
        `${n.id}: 動水頭 ${pressureHead.toFixed(2)} m が負圧（動水位が標高を下回る）`,
      );
    }
  }

  // 管路結果取得
  const pipeResults: NetworkPipeResult[] = [];
  let maxVelocity = 0;
  for (const p of input.pipes) {
    const id = safeId(p.id);
    let linkIdx: number;
    try {
      linkIdx = model.getLinkIndex(id);
    } catch {
      warnings.push(`${p.id}: EPANET 内に管路が見つかりません`);
      continue;
    }
    const flow_lps = model.getLinkValue(linkIdx, LinkProperty.Flow);
    const flow_m3s = flow_lps / M3S_TO_LPS;
    const velocity = model.getLinkValue(linkIdx, LinkProperty.Velocity);
    const headLoss = model.getLinkValue(linkIdx, LinkProperty.Headloss);
    const A = Math.PI * p.innerDiameter * p.innerDiameter / 4;
    const velocityHead = velocity * velocity / (2 * GRAVITY);
    // EPANET HEADLOSS は摩擦+局部損失の合計。簡易分離: minor = Σf · hv、friction = total - minor
    const minor = (p.minorLossCoeff ?? 0) * velocityHead;
    const friction = Math.max(0, headLoss - minor);
    const I = friction / p.length;

    pipeResults.push({
      pipeId: p.id,
      flow: flow_m3s,
      velocity,
      velocityHead,
      frictionLoss: friction,
      minorLoss: minor,
      totalLoss: headLoss,
      hydraulicGradient: I,
    });
    if (velocity > maxVelocity) maxVelocity = velocity;

    // 推奨流速範囲チェック（TS native impl と整合）
    if (velocity > 0 && velocity < 0.3) {
      warnings.push(`${p.id}: 流速 ${velocity.toFixed(2)} m/s が低い`);
    }
    if (velocity > 3.0) {
      warnings.push(`${p.id}: 流速 ${velocity.toFixed(2)} m/s が許容流速 3.0 m/s を超過`);
    }
    // A は使うかも知れないので算出だけ
    void A;
  }

  // 後始末
  try {
    model.close();
  } catch {
    // close エラーは結果に影響しないので無視
  }

  return {
    caseName,
    pipeResults,
    nodeResults,
    maxVelocity,
    maxPressureHead,
    warnings,
  };
}

// 型再エクスポート（呼び出し側の利便のため）
export type {
  SteadyNetworkInput,
  SteadyNetworkResult,
  NetworkPipeResult,
  NetworkNodeResult,
  NetworkPipeDef,
  NetworkNodeDef,
};
