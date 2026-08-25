import type { JsonValue } from "@open-waterhammer/contracts";
import {
  calcSteadyNetworkEpanet,
  type SteadyNetworkInput,
  type SteadyNetworkResult,
} from "@open-waterhammer/epanet-adapter";

import type { CalculationExecutor, EngineExecutionContext } from "./types.js";

type JsonObject = Record<string, JsonValue>;

function object(value: JsonValue | undefined, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} がありません`);
  }
  return value;
}

function number(value: JsonValue | undefined, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} は有限の数値で指定してください`);
  }
  return value;
}

function text(value: JsonValue | undefined, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} がありません`);
  }
  return value;
}

/**
 * MOC の物理管路と境界条件から、初期定常状態を解くための EPANET 入力を作る。
 * EPANET のリンクは MOC の内部格子ではなく、分割前の物理管路と一対一に対応する。
 */
export function buildEpanetInitialInput(model: JsonValue): SteadyNetworkInput {
  const root = object(model, "非定常計算入力");
  const network = object(root.network, "非定常管路網");
  if (!Array.isArray(network.pipes) || network.pipes.length === 0) {
    throw new Error("非定常管路網の管路がありません");
  }
  const boundaries = object(network.nodes, "非定常管路網の節点");
  const pipeSpecs = network.pipes.map((value, index) => {
    const spec = object(value, `管路 ${index + 1}`);
    const pipe = object(spec.pipe, `管路 ${index + 1} の諸元`);
    return {
      id: text(spec.id, `管路 ${index + 1} のID`),
      upstreamNodeId: text(spec.upstreamNodeId, `管路 ${index + 1} の上流節点ID`),
      downstreamNodeId: text(spec.downstreamNodeId, `管路 ${index + 1} の下流節点ID`),
      innerDiameter: number(pipe.innerDiameter, `管路 ${index + 1} の内径`),
      length: number(pipe.length, `管路 ${index + 1} の延長`),
      roughnessC: number(pipe.roughnessCoeff, `管路 ${index + 1} の粗度係数`),
      ...(typeof pipe.minorLossCoeff === "number" ? { minorLossCoeff: pipe.minorLossCoeff } : {}),
    };
  });

  const nodeIds = new Set(pipeSpecs.flatMap((pipe) => [pipe.upstreamNodeId, pipe.downstreamNodeId]));
  const nodes: SteadyNetworkInput["nodes"] = [...nodeIds].map((id) => {
    const boundaryValue = boundaries[id];
    const boundary = boundaryValue && typeof boundaryValue === "object" && !Array.isArray(boundaryValue)
      ? boundaryValue
      : {};
    const elevation = typeof boundary.elevation === "number" ? boundary.elevation : 0;
    if (boundary.type === "reservoir") {
      return { id, elevation, type: "reservoir" as const, head: number(boundary.head, `${id} の貯水槽水頭`) };
    }
    const demand = (boundary.type === "valve" || boundary.type === "pressure_reducing_valve")
      && typeof boundary.Q0 === "number"
      ? boundary.Q0
      : 0;
    return { id, elevation, type: "demand" as const, demand };
  });

  if (!nodes.some((node) => node.type === "reservoir")) {
    throw new Error("EPANET初期定常計算には、少なくとも1つの貯水槽境界が必要です");
  }
  return {
    caseName: typeof root.caseName === "string" ? `${root.caseName} 初期定常状態` : "MOC初期定常状態",
    pipes: pipeSpecs,
    nodes,
  };
}

/** EPANET の管路流量・節点水頭を MOC の初期条件へ埋め込む。 */
export function applyEpanetInitialState(model: JsonValue, steady: SteadyNetworkResult): JsonValue {
  const root = structuredClone(object(model, "非定常計算入力"));
  const network = object(root.network, "非定常管路網");
  if (!Array.isArray(network.pipes)) throw new Error("非定常管路網の管路がありません");
  const nodes = object(network.nodes, "非定常管路網の節点");
  const flows = new Map(steady.pipeResults.map((result) => [result.pipeId, result.flow]));
  const heads = Object.fromEntries(steady.nodeResults.map((result) => [result.nodeId, result.head]));

  network.pipes = network.pipes.map((value, index) => {
    const spec = object(value, `管路 ${index + 1}`);
    const id = text(spec.id, `管路 ${index + 1} のID`);
    const flow = flows.get(id);
    if (flow === undefined) throw new Error(`${id}: EPANET初期流量を取得できませんでした`);
    return { ...spec, initialFlow: flow };
  });
  for (const [nodeId, head] of Object.entries(heads)) {
    const boundaryValue = nodes[nodeId];
    if (!boundaryValue || typeof boundaryValue !== "object" || Array.isArray(boundaryValue)) continue;
    if (boundaryValue.type === "valve") {
      const incoming = (network.pipes as JsonValue[]).find((value) => {
        const spec = object(value, "管路");
        return spec.downstreamNodeId === nodeId;
      });
      const incomingId = incoming && typeof incoming === "object" && !Array.isArray(incoming)
        ? incoming.id
        : undefined;
      nodes[nodeId] = {
        ...boundaryValue,
        H0v: head,
        ...(typeof incomingId === "string" && flows.has(incomingId) ? { Q0: flows.get(incomingId)! } : {}),
      };
    }
  }
  const options = root.options && typeof root.options === "object" && !Array.isArray(root.options)
    ? { ...root.options }
    : {};
  delete options.initialFlow;
  root.options = { ...options, initialNodeHeads: heads };
  root.network = network;
  return root;
}

export function createEpanetInitializedMocExecutor(
  mocExecutor: CalculationExecutor,
  solve: (input: SteadyNetworkInput) => Promise<SteadyNetworkResult> = calcSteadyNetworkEpanet,
): CalculationExecutor {
  return async (context: EngineExecutionContext) => {
    const steady = await solve(buildEpanetInitialInput(context.caseSnapshot.modelSnapshot));
    const engineError = steady.warnings.find((warning) => warning.startsWith("EPANET solveH エラー:"));
    if (engineError) throw new Error(engineError);
    if (steady.pipeResults.length === 0 || steady.nodeResults.length === 0) {
      throw new Error(steady.warnings[0] ?? "EPANET初期定常計算の結果がありません");
    }
    const initialized = applyEpanetInitialState(context.caseSnapshot.modelSnapshot, steady);
    const output = await mocExecutor({
      ...context,
      caseSnapshot: { ...context.caseSnapshot, modelSnapshot: initialized },
    });
    return {
      ...output,
      engine: `epanet-js -> ${output.engine}`,
      method: `steady-network-epanet -> ${output.method}`,
      // Python が見るモデルにはEPANET結果を内部付加しているが、計算記録の正本は
      // 利用者が渡した変換前入力。付加後モデルは numericParameters に保持する。
      inputHash: context.calculationInputHash,
      warnings: [
        "初期定常状態はEPANETで計算し、管路流量と節点水頭を特性曲線法へ引き継ぎました。EPANETリンクは物理管路であり、MOC内部格子とは別です。",
        ...steady.warnings,
        ...(output.warnings ?? []),
      ],
    };
  };
}
