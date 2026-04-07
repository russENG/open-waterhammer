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
  const I = Math.pow(V / (0.84935 * C * Math.pow(R, 0.63)), 1 / 0.54);
  const hf = I * L;
  return { velocity: V, velocityHead, hydraulicGradient: I, frictionLoss: hf };
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
 * @throws {Error} ループ検出時、reservoir 未指定時
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

  // 逆順（葉→根）で需要を積み上げ
  const subtreeDemand = new Map<string, number>();
  for (const n of nodes) {
    const def = nodeMap.get(n.id);
    subtreeDemand.set(n.id, def?.type === "demand" ? (def.demand ?? 0) : 0);
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
