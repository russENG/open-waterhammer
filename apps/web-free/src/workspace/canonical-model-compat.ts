import type { Case, JsonValue } from '@open-waterhammer/contracts'
import {
  buildCanonicalHydraulicModel,
  type CanonicalHydraulicModel,
  type MeasurementPoint,
  type Node,
  type NodeType,
  type Pipe,
  type PipeType,
} from '@open-waterhammer/core'

import { mergeDraftGeometryIntoCanonicalModel, type GeoJsonGeometry, type HydraulicDraft } from '../gis/import-model'

type JsonRecord = Record<string, JsonValue>
type PipeSeed = Partial<Pipe> & Pick<Pipe, 'id'>

const PIPE_TYPES = new Set<PipeType>(['steel', 'ductile_iron', 'rcp', 'cpcp', 'upvc', 'pe2', 'pe3_pe100', 'wdpe', 'grp_fw1', 'grp_fw2', 'grp_fw3', 'grp_fw4', 'grp_fw5', 'gfpe'])
const NODE_TYPES = new Set<NodeType>(['reservoir', 'junction', 'tank', 'pump_node', 'valve_node'])

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function canonicalFromSnapshot(snapshot: JsonRecord): CanonicalHydraulicModel | undefined {
  const value = record(snapshot.canonicalModel)
  if (!value) return undefined
  const candidate = value as unknown as Partial<CanonicalHydraulicModel>
  return candidate.schema === 'open-waterhammer/hydraulic-model'
    && candidate.version === 1
    && Array.isArray(candidate.nodes)
    && Array.isArray(candidate.pipes)
    && Array.isArray(candidate.measurementPoints)
    && Array.isArray(candidate.hydraulicUnits)
    ? candidate as CanonicalHydraulicModel
    : undefined
}

function pipeType(value: unknown): PipeType | undefined {
  return typeof value === 'string' && PIPE_TYPES.has(value as PipeType) ? value as PipeType : undefined
}

function nodeType(value: unknown): NodeType {
  if (typeof value === 'string' && NODE_TYPES.has(value as NodeType)) return value as NodeType
  if (value === 'demand') return 'junction'
  return 'junction'
}

function measurementPoint(value: unknown, index: number): MeasurementPoint | undefined {
  const item = record(value)
  const id = text(item?.id)
  if (!item || !id) return undefined
  const horizontalDistance = number(item.horizontalDistance)
  const pipeLength = number(item.pipeLength)
  return {
    id,
    ...(text(item.name) ? { name: text(item.name) } : {}),
    ...(text(item.pipeId) ? { pipeId: text(item.pipeId) } : {}),
    ...(text(item.nodeId) ? { nodeId: text(item.nodeId) } : {}),
    ...(number(item.distanceAlongPipe) === undefined ? {} : { distanceAlongPipe: number(item.distanceAlongPipe) }),
    horizontalDistance: horizontalDistance ?? (index === 0 ? 0 : Number.NaN),
    groundLevel: number(item.groundLevel) ?? Number.NaN,
    pipeCenterHeight: number(item.pipeCenterHeight) ?? Number.NaN,
    pipeLength: pipeLength ?? Math.max(horizontalDistance ?? 0, 0),
    flowRate: number(item.flowRate) ?? 0,
    diameter: number(item.diameter) ?? 0,
    roughnessC: number(item.roughnessC) ?? 130,
    bendLossCoeff: number(item.bendLossCoeff) ?? 0,
    valveLossCoeff: number(item.valveLossCoeff) ?? 0,
    branchLossCoeff: number(item.branchLossCoeff) ?? 0,
    ...(number(item.otherLoss) === undefined ? {} : { otherLoss: number(item.otherLoss) }),
  }
}

function fullPipeSeed(value: unknown): PipeSeed | undefined {
  const item = record(value)
  const id = text(item?.id)
  if (!item || !id) return undefined
  return {
    id,
    ...(text(item.name) ? { name: text(item.name) } : {}),
    ...(text(item.startNodeId) ? { startNodeId: text(item.startNodeId) } : {}),
    ...(text(item.endNodeId) ? { endNodeId: text(item.endNodeId) } : {}),
    ...(pipeType(item.pipeType) ? { pipeType: pipeType(item.pipeType) } : {}),
    ...(number(item.innerDiameter) === undefined ? {} : { innerDiameter: number(item.innerDiameter) }),
    ...(number(item.wallThickness) === undefined ? {} : { wallThickness: number(item.wallThickness) }),
    ...(number(item.length) === undefined ? {} : { length: number(item.length) }),
    ...(number(item.roughnessCoeff) === undefined ? {} : { roughnessCoeff: number(item.roughnessCoeff) }),
    ...(number(item.youngsModulus) === undefined ? {} : { youngsModulus: number(item.youngsModulus) }),
    ...(number(item.c1Coeff) === undefined ? {} : { c1Coeff: number(item.c1Coeff) }),
  } as PipeSeed
}

function networkPipeSeed(value: unknown): PipeSeed | undefined {
  const item = record(value)
  const id = text(item?.id)
  if (!item || !id) return undefined
  return {
    id,
    ...(text(item.upstreamNodeId) ? { startNodeId: text(item.upstreamNodeId) } : {}),
    ...(text(item.downstreamNodeId) ? { endNodeId: text(item.downstreamNodeId) } : {}),
    ...(number(item.innerDiameter) === undefined ? {} : { innerDiameter: number(item.innerDiameter) }),
    ...(number(item.length) === undefined ? {} : { length: number(item.length) }),
    ...(number(item.roughnessC) === undefined ? {} : { roughnessCoeff: number(item.roughnessC) }),
  } as PipeSeed
}

function mergePipeSeed(target: Map<string, PipeSeed>, seed: PipeSeed | undefined) {
  if (seed) target.set(seed.id, { ...target.get(seed.id), ...seed })
}

function nodesFromNetwork(network: JsonRecord | undefined): Node[] {
  if (!Array.isArray(network?.nodes)) return []
  return network.nodes.flatMap((value) => {
    const item = record(value)
    const id = text(item?.id)
    if (!item || !id) return []
    const hydraulicGrade = number(item.hydraulicGrade) ?? number(item.head)
    return [{
      id,
      elevation: number(item.elevation) ?? 0,
      nodeType: nodeType(item.nodeType ?? item.type),
      ...(hydraulicGrade === undefined ? {} : { hydraulicGrade }),
    } as Node]
  })
}

function modelFromWorkbook(snapshot: JsonRecord): CanonicalHydraulicModel | undefined {
  const workbook = record(snapshot.excelImport)
  if (!workbook || !Array.isArray(workbook.nodes) || !Array.isArray(workbook.pipes) || !Array.isArray(workbook.measurementPoints)) return undefined
  if (workbook.measurementPoints.length === 0) return undefined
  try {
    return buildCanonicalHydraulicModel({
      source: 'legacy',
      nodes: workbook.nodes as unknown as Node[],
      pipes: workbook.pipes as unknown as Pipe[],
      measurementPoints: workbook.measurementPoints as unknown as MeasurementPoint[],
    }).model
  } catch {
    return undefined
  }
}

function modelFromRunInputs(snapshot: JsonRecord): CanonicalHydraulicModel | undefined {
  const runInputs = record(snapshot.runInputs)
  const longitudinal = record(runInputs?.longitudinal_hydraulics)
  const points = Array.isArray(longitudinal?.points)
    ? longitudinal.points.map(measurementPoint).filter((point): point is MeasurementPoint => point !== undefined)
    : []
  if (points.length === 0) return undefined

  const network = record(runInputs?.steady_network_python) ?? record(runInputs?.steady_network_epanet)
  const pipeSeeds = new Map<string, PipeSeed>()
  if (Array.isArray(network?.pipes)) for (const value of network.pipes) mergePipeSeed(pipeSeeds, networkPipeSeed(value))
  for (const value of [
    record(runInputs?.wave_speed)?.pipe,
    record(runInputs?.joukowsky_allievi)?.pipe,
    record(runInputs?.transient_single_pipe)?.pipe,
    record(runInputs?.transient_pump)?.pipe,
  ]) mergePipeSeed(pipeSeeds, fullPipeSeed(value))

  const pointsByPipe = new Map<string, MeasurementPoint[]>()
  for (const point of points) {
    if (!point.pipeId) continue
    pointsByPipe.set(point.pipeId, [...(pointsByPipe.get(point.pipeId) ?? []), point])
    if (!pipeSeeds.has(point.pipeId)) pipeSeeds.set(point.pipeId, { id: point.pipeId })
  }

  const pipes = [...pipeSeeds.values()].map((seed): Pipe => {
    const pipePoints = pointsByPipe.get(seed.id) ?? []
    const ordered = [...pipePoints].sort((left, right) => (left.distanceAlongPipe ?? 0) - (right.distanceAlongPipe ?? 0))
    const inferredLength = Math.max(
      ...pipePoints.map((point) => point.distanceAlongPipe ?? 0),
      pipePoints.reduce((sum, point) => sum + Math.max(point.pipeLength, 0), 0),
      1,
    )
    return {
      id: seed.id,
      ...(seed.name ? { name: seed.name } : {}),
      startNodeId: seed.startNodeId ?? ordered.find(({ nodeId }) => nodeId)?.nodeId ?? `${seed.id}:UPSTREAM`,
      endNodeId: seed.endNodeId ?? [...ordered].reverse().find(({ nodeId }) => nodeId)?.nodeId ?? `${seed.id}:DOWNSTREAM`,
      pipeType: seed.pipeType ?? 'ductile_iron',
      innerDiameter: seed.innerDiameter && seed.innerDiameter > 0 ? seed.innerDiameter : pipePoints.find(({ diameter }) => diameter > 0)?.diameter ?? 1,
      wallThickness: seed.wallThickness ?? 0,
      length: seed.length && seed.length > 0 ? seed.length : inferredLength,
      roughnessCoeff: seed.roughnessCoeff ?? pipePoints[0]?.roughnessC ?? 130,
      ...(seed.youngsModulus === undefined ? {} : { youngsModulus: seed.youngsModulus }),
      ...(seed.c1Coeff === undefined ? {} : { c1Coeff: seed.c1Coeff }),
    }
  })
  if (pipes.length === 0) return undefined

  const nodes = new Map(nodesFromNetwork(network).map((node) => [node.id, node]))
  for (const pipe of pipes) {
    if (!nodes.has(pipe.startNodeId)) nodes.set(pipe.startNodeId, { id: pipe.startNodeId, elevation: 0, nodeType: 'junction' })
    if (!nodes.has(pipe.endNodeId)) nodes.set(pipe.endNodeId, { id: pipe.endNodeId, elevation: 0, nodeType: 'junction' })
  }
  for (const point of points) {
    if (point.nodeId && !nodes.has(point.nodeId)) nodes.set(point.nodeId, { id: point.nodeId, elevation: Number.isFinite(point.pipeCenterHeight) ? point.pipeCenterHeight : 0, nodeType: 'junction' })
  }
  return buildCanonicalHydraulicModel({ source: 'legacy', nodes: [...nodes.values()], pipes, measurementPoints: points }).model
}

function hydraulicDraft(value: unknown): HydraulicDraft | undefined {
  const item = record(value)
  const id = text(item?.id)
  const sourceFeatureId = text(item?.sourceFeatureId)
  const kind = item?.kind
  if (!item || !id || !sourceFeatureId || (kind !== 'node' && kind !== 'pipe' && kind !== 'invalid')) return undefined
  const geometry = record(item.geometry)
  return {
    sourceFeatureId,
    id,
    kind,
    geometry: geometry && typeof geometry.type === 'string' ? geometry as unknown as GeoJsonGeometry : null,
    properties: record(item.properties) ?? {},
    errors: Array.isArray(item.errors) ? item.errors.filter((error): error is string => typeof error === 'string') : [],
  }
}

function withLegacyGeometry(model: CanonicalHydraulicModel, snapshot: JsonRecord): CanonicalHydraulicModel {
  const drafts = Array.isArray(snapshot.geoDrafts)
    ? snapshot.geoDrafts.map(hydraulicDraft).filter((draft): draft is HydraulicDraft => draft !== undefined)
    : []
  const sourceCrs = text(snapshot.geoSourceCrs)
  return drafts.length && sourceCrs ? mergeDraftGeometryIntoCanonicalModel(model, drafts, sourceCrs).model : model
}

/**
 * 新しい正準モデルを優先しつつ、旧プロジェクトでは保存済みExcelまたは解析入力から
 * 表示専用モデルを非破壊で復元する。復元結果は保存データへ書き戻さない。
 */
export function resolveCanonicalHydraulicModel(caseRecord: Case): CanonicalHydraulicModel | undefined {
  const snapshot = record(caseRecord.modelSnapshot)
  if (!snapshot) return undefined
  const canonical = canonicalFromSnapshot(snapshot)
  if (canonical) return canonical
  const legacy = modelFromWorkbook(snapshot) ?? modelFromRunInputs(snapshot)
  return legacy ? withLegacyGeometry(legacy, snapshot) : undefined
}
