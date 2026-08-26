/**
 * 管路網定常水理計算
 *
 * 要旨 §3.1: 定常計算部で分岐・合流を含む管路網の水理条件を整理し、
 *            非定常解析の初期条件を与える。
 *
 * 対象: 樹枝状管路網（ループなし）
 *   - 農業用パイプラインで一般的な配水系統
 *   - 貯水槽（固定水頭）+ 分岐 + 末端需要
 *   - Hazen-Williams 式による摩擦損失
 *
 * 解法:
 *   1. 需要の逆伝播: 末端→上流に流量を集約（連続条件）
 *   2. 水頭の順伝播: 上流→下流に損失を累積
 */

import { GRAVITY, headToMpa } from "./formulas.js";

// ─── 入力型 ──────────────────────────────────────────────────────────────────

/** 管路網定常計算の管路定義 */
export interface NetworkPipeDef {
  /** 管路ID */
  id: string;
  /** 上流ノードID */
  upstreamNodeId: string;
  /** 下流ノードID */
  downstreamNodeId: string;
  /** 内径 D [m] */
  innerDiameter: number;
  /** 管路延長 L [m] */
  length: number;
  /** 粗度係数 C (Hazen-Williams) */
  roughnessC: number;
  /** 局部損失係数の合計 Σf [-]（省略時0） */
  minorLossCoeff?: number;
}

/** 管路網定常計算のノード定義 */
export interface NetworkNodeDef {
  /** ノードID */
  id: string;
  /** 標高 [m]（管中心高） */
  elevation: number;
  /** ノード種別 */
  type: "reservoir" | "demand" | "junction";
  /** 固定水頭 [m]（reservoir のみ） */
  head?: number;
  /** 需要流量 [m³/s]（demand のみ、正=取水） */
  demand?: number;
}

/** 管路網定常計算の入力 */
export interface SteadyNetworkInput {
  pipes: NetworkPipeDef[];
  nodes: NetworkNodeDef[];
  /** ケース名 */
  caseName?: string;
}

// ─── 出力型 ──────────────────────────────────────────────────────────────────

/** 管路ごとの定常計算結果 */
export interface NetworkPipeResult {
  pipeId: string;
  /** 流量 Q [m³/s] */
  flow: number;
  /** 流速 V [m/s] */
  velocity: number;
  /** 速度水頭 hv [m] */
  velocityHead: number;
  /** 摩擦損失水頭 hf [m] */
  frictionLoss: number;
  /** 局部損失水頭 [m] */
  minorLoss: number;
  /** 全損失水頭 [m] */
  totalLoss: number;
  /** 動水勾配 I [-] */
  hydraulicGradient: number;
}

/** ノードごとの定常計算結果 */
export interface NetworkNodeResult {
  nodeId: string;
  /** 水頭 H [m]（=エネルギー標高、速度水頭を含む） */
  head: number;
  /** 動水位 [m]（= head - 速度水頭、近似的に head と同値） */
  hydraulicGradeLine: number;
  /** 動水頭 [m]（= HGL - 標高） */
  pressureHead: number;
  /** 静水圧 [MPa] */
  pressureMpa: number;
}

/** 管路網定常計算の結果 */
export interface SteadyNetworkResult {
  caseName: string;
  pipeResults: NetworkPipeResult[];
  nodeResults: NetworkNodeResult[];
  /** 最大流速 [m/s] */
  maxVelocity: number;
  /** 最大動水頭 [m] */
  maxPressureHead: number;
  warnings: string[];
}

// ─── ヘルパー ────────────────────────────────────────────────────────────────

/** Hazen-Williams 式で摩擦損失水頭を算定 */
function hazenWilliamsLoss(D: number, C: number, Q: number, L: number): {
  velocity: number;
  velocityHead: number;
  hydraulicGradient: number;
  frictionLoss: number;
} {
  const A = Math.PI * D * D / 4;
  const V = Math.abs(Q) / A;
  const velocityHead = V * V / (2 * GRAVITY);
  if (V < 1e-12) {
    return { velocity: 0, velocityHead: 0, hydraulicGradient: 0, frictionLoss: 0 };
  }
  const R = D / 4;
  // Hazen-Williams 式（技術書 式7.2.2）: V = 0.849·C·R^0.63·I^0.54
  const I = Math.pow(V / (0.849 * C * Math.pow(R, 0.63)), 1 / 0.54);
  const hf = I * L;
  return { velocity: V, velocityHead, hydraulicGradient: I, frictionLoss: hf };
}

/** 適用範囲外のトポロジ（ループ・複数貯水槽）を検出して警告文を返す */
function detectOutOfScopeTopology(
  pipes: NetworkPipeDef[],
  reservoirs: NetworkNodeDef[],
  visited: Set<string>,
  parentPipe: Map<string, string>,
): string[] {
  const warnings: string[] = [];

  // BFS の親管として使われず、かつ両端が到達済みの管路 = 閉路を構成する余分な辺
  const usedPipeIds = new Set(parentPipe.values());
  const excluded = pipes.filter(
    p => !usedPipeIds.has(p.id)
      && visited.has(p.upstreamNodeId)
      && visited.has(p.downstreamNodeId),
  );

  if (excluded.length > 0) {
    warnings.push(
      `閉路（ループまたは複数貯水槽の並行流入）を検出しました: ${excluded.map(p => p.id).join(", ")}。`
      + `本ソルバーは樹枝状管路網（ループなし・単一貯水槽）専用のため、これらの管路は計算から除外され、`
      + `結果は実際の流量配分・水頭と一致しません。ループを含む管路網は EPANET 経路で計算してください。`,
    );
  }

  if (reservoirs.length > 1) {
    warnings.push(
      `reservoir ノードが ${reservoirs.length} 個あります（${reservoirs.map(r => r.id).join(", ")}）。`
      + `本ソルバーは各ノードへ最初に到達した経路だけを解くため、2 つ目以降の貯水槽からの流入は`
      + `無視されます。複数の水源を持つ管路網は EPANET 経路で計算してください。`,
    );
  }

  return warnings;
}

// ─── メイン計算 ──────────────────────────────────────────────────────────────

/**
 * 樹枝状管路網の定常水理計算
 *
 * 前提:
 *   - reservoir ノードが1つ以上存在（固定水頭の起点）
 *   - ループなし（樹枝状）
 *   - 各 demand ノードの需要流量は既知
 *
 * 前提を外れた入力（ループ・複数貯水槽）は例外にせず `warnings` で報告する。
 * 本ソルバーは閉路を構成する管路を計算から除外するため、その場合の結果は
 * 実際の流量配分と一致しない。EPANET 経路（`calcSteadyNetworkEpanet`）を使うこと。
 *
 * reservoir が 1 つも無い場合は空の結果と警告を返す（例外は投げない）。
 */
export function calcSteadyNetwork(input: SteadyNetworkInput): SteadyNetworkResult {
  const { pipes, nodes } = input;
  const caseName = input.caseName ?? "定常";
  const warnings: string[] = [];

  // ノード・管路のマップ作成
  const nodeMap = new Map<string, NetworkNodeDef>();
  for (const n of nodes) nodeMap.set(n.id, n);

  const reservoirs = nodes.filter(n => n.type === "reservoir");
  if (reservoirs.length === 0) {
    return { caseName, pipeResults: [], nodeResults: [], maxVelocity: 0, maxPressureHead: 0, warnings: ["reservoir ノードがありません"] };
  }

  // 隣接リスト: nodeId → [{pipeId, neighborId, direction}]
  const adj = new Map<string, { pipeId: string; neighborId: string; isDownstream: boolean }[]>();
  for (const p of pipes) {
    if (!adj.has(p.upstreamNodeId)) adj.set(p.upstreamNodeId, []);
    if (!adj.has(p.downstreamNodeId)) adj.set(p.downstreamNodeId, []);
    adj.get(p.upstreamNodeId)!.push({ pipeId: p.id, neighborId: p.downstreamNodeId, isDownstream: true });
    adj.get(p.downstreamNodeId)!.push({ pipeId: p.id, neighborId: p.upstreamNodeId, isDownstream: false });
  }

  const pipeMap = new Map<string, NetworkPipeDef>();
  for (const p of pipes) pipeMap.set(p.id, p);

  // Step 1: 需要の逆伝播（BFS: 末端→上流）
  // 管路流量 = 下流側の全需要の合計
  const pipeFlows = new Map<string, number>();
  const nodeHead = new Map<string, number>();

  // BFS で樹枝状のトポロジカル順序を求める（reservoir を根とする）
  const visited = new Set<string>();
  const topoOrder: string[] = []; // 根→葉の順
  const parentPipe = new Map<string, string>(); // nodeId → pipeId（親からの管路）

  const queue: string[] = [];
  for (const r of reservoirs) {
    queue.push(r.id);
    visited.add(r.id);
    nodeHead.set(r.id, r.head ?? 0);
  }

  while (queue.length > 0) {
    const curr = queue.shift()!;
    topoOrder.push(curr);
    const neighbors = adj.get(curr) ?? [];
    for (const { pipeId, neighborId } of neighbors) {
      if (visited.has(neighborId)) continue;
      visited.add(neighborId);
      parentPipe.set(neighborId, pipeId);
      queue.push(neighborId);
    }
  }

  // 未到達ノードの警告
  for (const n of nodes) {
    if (!visited.has(n.id)) {
      warnings.push(`${n.id}: reservoir から到達できません`);
    }
  }

  // 適用範囲の検証: 樹枝状（ループなし）・単一貯水槽の前提を外れていないか
  //
  // BFS は各ノードへ最初に到達した管路だけを親管として採用する。両端とも到達済み
  // なのに親管として使われなかった管路は、閉路（環状ループ、または 2 つ目以降の
  // 貯水槽からの流入経路）を構成する余分な辺である。本ソルバーはこれらを計算から
  // 除外するため、結果は実際の流量配分と一致しない。
  warnings.push(...detectOutOfScopeTopology(pipes, reservoirs, visited, parentPipe));

  // 逆順（葉→根）で需要を積み上げ
  //
  // 需要は reservoir 以外の全ノードから集計する（技術書 §7 の節点需要）。
  // reservoir は無限水源なので EPANET 同様 demand を無視する。
  // 集計対象は EPANET アダプタの buildInp() が [JUNCTIONS] に書き出す範囲と一致させる。
  const subtreeDemand = new Map<string, number>();
  for (const n of nodes) {
    const def = nodeMap.get(n.id);
    subtreeDemand.set(n.id, def?.type === "reservoir" ? 0 : (def?.demand ?? 0));
  }

  for (let i = topoOrder.length - 1; i >= 0; i--) {
    const curr = topoOrder[i]!;
    const neighbors = adj.get(curr) ?? [];
    for (const { pipeId, neighborId, isDownstream } of neighbors) {
      // 子ノード（currから見てreservoirから遠い方向）
      if (isDownstream && visited.has(neighborId) && parentPipe.get(neighborId) === pipeId) {
        const childDemand = subtreeDemand.get(neighborId) ?? 0;
        subtreeDemand.set(curr, (subtreeDemand.get(curr) ?? 0) + childDemand);
        pipeFlows.set(pipeId, childDemand);
      }
    }
  }

  // Step 2: 水頭の順伝播（根→葉、トポロジカル順序）
  const pipeResults: NetworkPipeResult[] = [];

  for (const curr of topoOrder) {
    const neighbors = adj.get(curr) ?? [];
    for (const { pipeId, neighborId, isDownstream } of neighbors) {
      if (!isDownstream) continue;
      if (parentPipe.get(neighborId) !== pipeId) continue;

      const pipe = pipeMap.get(pipeId)!;
      const Q = pipeFlows.get(pipeId) ?? 0;
      const { velocity, velocityHead, hydraulicGradient, frictionLoss } = hazenWilliamsLoss(
        pipe.innerDiameter, pipe.roughnessC, Q, pipe.length,
      );
      const minorLossCoeff = pipe.minorLossCoeff ?? 0;
      const minorLoss = minorLossCoeff * velocityHead;
      const totalLoss = frictionLoss + minorLoss;

      const upHead = nodeHead.get(curr) ?? 0;
      const downHead = upHead - totalLoss;
      nodeHead.set(neighborId, downHead);

      pipeResults.push({
        pipeId: pipe.id,
        flow: Q,
        velocity,
        velocityHead,
        frictionLoss,
        minorLoss,
        totalLoss,
        hydraulicGradient,
      });

      // 流速警告
      if (velocity > 0 && velocity < 0.3) {
        warnings.push(`${pipe.id}: 流速 ${velocity.toFixed(2)} m/s が低い`);
      }
      if (velocity > 3.0) {
        warnings.push(`${pipe.id}: 流速 ${velocity.toFixed(2)} m/s が許容流速 3.0 m/s を超過`);
      }
    }
  }

  // Step 3: ノード結果の算出
  const nodeResults: NetworkNodeResult[] = [];
  let maxVelocity = 0;
  let maxPressureHead = 0;

  for (const n of nodes) {
    const H = nodeHead.get(n.id);
    if (H === undefined) continue;
    const elev = n.elevation;
    const pressureHead = H - elev;
    const pressureMpa = headToMpa(pressureHead);

    nodeResults.push({
      nodeId: n.id,
      head: H,
      hydraulicGradeLine: H,
      pressureHead,
      pressureMpa,
    });

    maxPressureHead = Math.max(maxPressureHead, pressureHead);

    if (pressureHead < 0) {
      warnings.push(`${n.id}: 動水頭 ${pressureHead.toFixed(2)} m が負圧（動水位が標高を下回る）`);
    }
  }

  for (const pr of pipeResults) {
    maxVelocity = Math.max(maxVelocity, pr.velocity);
  }

  return { caseName, pipeResults, nodeResults, maxVelocity, maxPressureHead, warnings };
}
