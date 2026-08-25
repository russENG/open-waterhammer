import type {
  LongitudinalHydraulicInput,
  MeasurementPoint,
  Node,
  NodeType,
  Pipe,
  PipeType,
} from "./types.js";
import type { SteadyNetworkInput } from "./steady-network.js";

export const CANONICAL_HYDRAULIC_MODEL_VERSION = 1 as const;

export type CanonicalModelSource = "excel" | "gis" | "web" | "legacy";
export type CanonicalIssueSeverity = "error" | "warning";

export interface CanonicalCoordinate {
  x: number;
  y: number;
  z?: number;
}

export interface CanonicalNode {
  id: string;
  name?: string;
  kind: NodeType;
  elevation: number;
  boundaryHead?: number;
  coordinate?: CanonicalCoordinate;
}

export interface CanonicalPipe {
  id: string;
  name?: string;
  fromNodeId: string;
  toNodeId: string;
  material: PipeType;
  innerDiameter: number;
  wallThickness: number;
  length: number;
  roughnessC: number;
  youngsModulus?: number;
  restraintCoefficient?: number;
  centerline?: CanonicalCoordinate[];
}

export interface CanonicalMeasurementPoint {
  id: string;
  name?: string;
  sequence: number;
  pipeId?: string;
  nodeId?: string;
  linkStatus: "linked" | "unresolved";
  distanceAlongPipe?: number;
  horizontalDistanceFromPrevious: number;
  slopeLengthFromPrevious: number;
  groundElevation: number;
  pipeCenterElevation: number;
  bendLossCoefficient: number;
  valveLossCoefficient: number;
  branchLossCoefficient: number;
  otherMinorLossHead?: number;
}

/**
 * 解析上、流量と管路諸元を一組として扱える最小区間。
 * 管種・管径・粗度の正本は pipeId が参照する CanonicalPipe に置き、
 * ここにはシナリオ入力としての設計流量だけを保持する。
 */
export interface CanonicalHydraulicUnit {
  id: string;
  pipeId: string;
  fromDistance: number;
  toDistance: number;
  measurementPointIds: string[];
  designFlow?: number;
}

export interface CanonicalHydraulicModel {
  schema: "open-waterhammer/hydraulic-model";
  version: typeof CANONICAL_HYDRAULIC_MODEL_VERSION;
  source: CanonicalModelSource;
  crs?: string;
  nodes: CanonicalNode[];
  pipes: CanonicalPipe[];
  measurementPoints: CanonicalMeasurementPoint[];
  hydraulicUnits: CanonicalHydraulicUnit[];
}

export interface CanonicalModelIssue {
  severity: CanonicalIssueSeverity;
  code:
    | "UNKNOWN_PIPE"
    | "UNKNOWN_NODE"
    | "POINT_PIPE_INFERRED"
    | "POINT_PIPE_UNRESOLVED"
    | "POINT_DISTANCE_OUT_OF_RANGE"
    | "DUPLICATE_DIAMETER_IGNORED"
    | "DUPLICATE_ROUGHNESS_IGNORED";
  entityId: string;
  message: string;
}

export interface BuildCanonicalHydraulicModelInput {
  source: CanonicalModelSource;
  crs?: string;
  nodes: Node[];
  pipes: Pipe[];
  measurementPoints: MeasurementPoint[];
}

export interface CanonicalAdapterResult<T> {
  value?: T;
  issues: CanonicalModelIssue[];
}

function optional<T>(value: T | undefined, key: string): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}

function pipeForCumulativeDistance(pipes: CanonicalPipe[], distance: number): {
  pipe?: CanonicalPipe;
  distanceAlongPipe?: number;
} {
  let start = 0;
  for (const pipe of pipes) {
    const end = start + pipe.length;
    if (distance <= end + 1e-9) return { pipe, distanceAlongPipe: Math.max(0, distance - start) };
    start = end;
  }
  return {};
}

function buildHydraulicUnits(
  pipes: CanonicalPipe[],
  points: CanonicalMeasurementPoint[],
  sourcePoints: MeasurementPoint[],
): CanonicalHydraulicUnit[] {
  const flowByPoint = new Map(sourcePoints.map((point) => [point.id, point.flowRate]));
  const result: CanonicalHydraulicUnit[] = [];
  for (const pipe of pipes) {
    const linked = points
      .filter((point) => point.pipeId === pipe.id && point.distanceAlongPipe !== undefined)
      .sort((left, right) => left.distanceAlongPipe! - right.distanceAlongPipe!);
    if (linked.length === 0) {
      result.push({ id: `${pipe.id}:U01`, pipeId: pipe.id, fromDistance: 0, toDistance: pipe.length, measurementPointIds: [] });
      continue;
    }
    let fromDistance = 0;
    let currentFlow = flowByPoint.get(linked[0]!.id);
    let memberIds: string[] = [];
    let unitNumber = 1;
    for (const point of linked) {
      const nextFlow = flowByPoint.get(point.id);
      if (memberIds.length > 0 && nextFlow !== currentFlow) {
        const boundary = point.distanceAlongPipe!;
        result.push({
          id: `${pipe.id}:U${String(unitNumber).padStart(2, "0")}`,
          pipeId: pipe.id,
          fromDistance,
          toDistance: boundary,
          measurementPointIds: memberIds,
          ...optional(currentFlow, "designFlow"),
        } as CanonicalHydraulicUnit);
        fromDistance = boundary;
        memberIds = [];
        currentFlow = nextFlow;
        unitNumber += 1;
      }
      memberIds.push(point.id);
    }
    result.push({
      id: `${pipe.id}:U${String(unitNumber).padStart(2, "0")}`,
      pipeId: pipe.id,
      fromDistance,
      toDistance: pipe.length,
      measurementPointIds: memberIds,
      ...optional(currentFlow, "designFlow"),
    } as CanonicalHydraulicUnit);
  }
  return result;
}

/** Excel/Web入力を同じ水理モデルへ正規化する。旧測点の管路参照は可能な範囲で補完する。 */
export function buildCanonicalHydraulicModel(input: BuildCanonicalHydraulicModelInput): {
  model: CanonicalHydraulicModel;
  issues: CanonicalModelIssue[];
} {
  const issues: CanonicalModelIssue[] = [];
  const nodes: CanonicalNode[] = input.nodes.map((node) => ({
    id: node.id,
    ...optional(node.name, "name"),
    kind: node.nodeType,
    elevation: node.elevation,
    ...optional(node.hydraulicGrade, "boundaryHead"),
  } as CanonicalNode));
  const pipes: CanonicalPipe[] = input.pipes.map((pipe) => ({
    id: pipe.id,
    ...optional(pipe.name, "name"),
    fromNodeId: pipe.startNodeId,
    toNodeId: pipe.endNodeId,
    material: pipe.pipeType,
    innerDiameter: pipe.innerDiameter,
    wallThickness: pipe.wallThickness,
    length: pipe.length,
    roughnessC: pipe.roughnessCoeff,
    ...optional(pipe.youngsModulus, "youngsModulus"),
    ...optional(pipe.c1Coeff, "restraintCoefficient"),
  } as CanonicalPipe));
  const pipeById = new Map(pipes.map((pipe) => [pipe.id, pipe]));
  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const pipe of pipes) {
    if (!nodeIds.has(pipe.fromNodeId)) issues.push({ severity: "error", code: "UNKNOWN_NODE", entityId: pipe.id, message: `管路 ${pipe.id} の始点節点 ${pipe.fromNodeId} が存在しません。` });
    if (!nodeIds.has(pipe.toNodeId)) issues.push({ severity: "error", code: "UNKNOWN_NODE", entityId: pipe.id, message: `管路 ${pipe.id} の終点節点 ${pipe.toNodeId} が存在しません。` });
  }

  let cumulativeDistance = 0;
  const measurementPoints = input.measurementPoints.map((point, sequence): CanonicalMeasurementPoint => {
    cumulativeDistance += point.pipeLength;
    let pipe = point.pipeId ? pipeById.get(point.pipeId) : undefined;
    let distanceAlongPipe = point.distanceAlongPipe;
    if (point.pipeId && !pipe) issues.push({ severity: "error", code: "UNKNOWN_PIPE", entityId: point.id, message: `測点 ${point.id} が参照する管路 ${point.pipeId} が存在しません。` });
    if (!pipe && !point.pipeId) {
      const inferred = pipeForCumulativeDistance(pipes, cumulativeDistance);
      pipe = inferred.pipe;
      distanceAlongPipe ??= inferred.distanceAlongPipe;
      if (pipe) issues.push({ severity: "warning", code: "POINT_PIPE_INFERRED", entityId: point.id, message: `測点 ${point.id} の管路参照を取込順と管長から ${pipe.id} と補完しました。` });
    }
    if (!pipe) issues.push({ severity: "error", code: "POINT_PIPE_UNRESOLVED", entityId: point.id, message: `測点 ${point.id} を管路に対応付けできません。` });
    if (pipe && distanceAlongPipe !== undefined && (distanceAlongPipe < 0 || distanceAlongPipe > pipe.length + 1e-9)) {
      issues.push({ severity: "error", code: "POINT_DISTANCE_OUT_OF_RANGE", entityId: point.id, message: `測点 ${point.id} の管路起点からの距離が管路 ${pipe.id} の範囲外です。` });
    }
    if (pipe && Math.abs(point.diameter - pipe.innerDiameter) > 1e-9) issues.push({ severity: "warning", code: "DUPLICATE_DIAMETER_IGNORED", entityId: point.id, message: `測点 ${point.id} の管径は正本である管路 ${pipe.id} の管径と一致しないため、管路値を使います。` });
    if (pipe && Math.abs(point.roughnessC - pipe.roughnessC) > 1e-9) issues.push({ severity: "warning", code: "DUPLICATE_ROUGHNESS_IGNORED", entityId: point.id, message: `測点 ${point.id} の粗度は正本である管路 ${pipe.id} と一致しないため、管路値を使います。` });
    const linkedNodeId = point.nodeId && nodeIds.has(point.nodeId) ? point.nodeId : undefined;
    if (point.nodeId && !linkedNodeId) issues.push({ severity: "error", code: "UNKNOWN_NODE", entityId: point.id, message: `測点 ${point.id} が参照する節点 ${point.nodeId} が存在しません。` });
    return {
      id: point.id,
      ...optional(point.name, "name"),
      sequence,
      ...optional(pipe?.id, "pipeId"),
      ...optional(linkedNodeId, "nodeId"),
      linkStatus: pipe ? "linked" : "unresolved",
      ...optional(distanceAlongPipe, "distanceAlongPipe"),
      horizontalDistanceFromPrevious: point.horizontalDistance,
      slopeLengthFromPrevious: point.pipeLength,
      groundElevation: point.groundLevel,
      pipeCenterElevation: point.pipeCenterHeight,
      bendLossCoefficient: point.bendLossCoeff,
      valveLossCoefficient: point.valveLossCoeff,
      branchLossCoefficient: point.branchLossCoeff,
      ...optional(point.otherLoss, "otherMinorLossHead"),
    } as CanonicalMeasurementPoint;
  });

  return {
    model: {
      schema: "open-waterhammer/hydraulic-model",
      version: CANONICAL_HYDRAULIC_MODEL_VERSION,
      source: input.source,
      ...optional(input.crs, "crs"),
      nodes,
      pipes,
      measurementPoints,
      hydraulicUnits: buildHydraulicUnits(pipes, measurementPoints, input.measurementPoints),
    } as CanonicalHydraulicModel,
    issues,
  };
}

function nodeTypeForSteady(kind: NodeType): "reservoir" | "junction" {
  return kind === "reservoir" ? "reservoir" : "junction";
}

/** 正準モデルから定常管路網入力を作る。 */
export function canonicalToSteadyNetwork(model: CanonicalHydraulicModel): CanonicalAdapterResult<SteadyNetworkInput> {
  const issues: CanonicalModelIssue[] = [];
  const nodeIds = new Set(model.nodes.map((node) => node.id));
  for (const pipe of model.pipes) {
    if (!nodeIds.has(pipe.fromNodeId) || !nodeIds.has(pipe.toNodeId)) issues.push({ severity: "error", code: "UNKNOWN_NODE", entityId: pipe.id, message: `管路 ${pipe.id} の接続節点が不足しています。` });
  }
  if (issues.some(({ severity }) => severity === "error")) return { issues };
  return {
    value: {
      pipes: model.pipes.map((pipe) => ({ id: pipe.id, upstreamNodeId: pipe.fromNodeId, downstreamNodeId: pipe.toNodeId, innerDiameter: pipe.innerDiameter, length: pipe.length, roughnessC: pipe.roughnessC })),
      nodes: model.nodes.map((node) => ({ id: node.id, elevation: node.elevation, type: nodeTypeForSteady(node.kind), ...optional(node.boundaryHead, "head") })) as SteadyNetworkInput["nodes"],
    },
    issues,
  };
}

function unitAt(model: CanonicalHydraulicModel, pipeId: string, distance: number | undefined): CanonicalHydraulicUnit | undefined {
  return model.hydraulicUnits.find((unit) => unit.pipeId === pipeId && (distance === undefined || (distance >= unit.fromDistance && distance <= unit.toDistance + 1e-9)));
}

/** 正準モデルから縦断水理入力を導出する。管径と粗度は必ず管路の正本値を使う。 */
export function canonicalToLongitudinalInput(model: CanonicalHydraulicModel, staticWaterLevel: number): CanonicalAdapterResult<LongitudinalHydraulicInput> {
  const issues: CanonicalModelIssue[] = [];
  const pipeById = new Map(model.pipes.map((pipe) => [pipe.id, pipe]));
  const points: MeasurementPoint[] = [];
  for (const point of [...model.measurementPoints].sort((left, right) => left.sequence - right.sequence)) {
    const pipe = point.pipeId ? pipeById.get(point.pipeId) : undefined;
    if (!pipe) {
      issues.push({ severity: "error", code: "POINT_PIPE_UNRESOLVED", entityId: point.id, message: `測点 ${point.id} を縦断計算用の管路に対応付けできません。` });
      continue;
    }
    const unit = unitAt(model, pipe.id, point.distanceAlongPipe);
    points.push({
      id: point.id,
      ...optional(point.name, "name"),
      pipeId: pipe.id,
      ...optional(point.nodeId, "nodeId"),
      ...optional(point.distanceAlongPipe, "distanceAlongPipe"),
      horizontalDistance: point.horizontalDistanceFromPrevious,
      groundLevel: point.groundElevation,
      pipeCenterHeight: point.pipeCenterElevation,
      pipeLength: point.slopeLengthFromPrevious,
      flowRate: unit?.designFlow ?? 0,
      diameter: pipe.innerDiameter,
      roughnessC: pipe.roughnessC,
      bendLossCoeff: point.bendLossCoefficient,
      valveLossCoeff: point.valveLossCoefficient,
      branchLossCoeff: point.branchLossCoefficient,
      ...optional(point.otherMinorLossHead, "otherLoss"),
    } as MeasurementPoint);
  }
  if (issues.some(({ severity }) => severity === "error")) return { issues };
  return { value: { points, staticWaterLevel }, issues };
}
