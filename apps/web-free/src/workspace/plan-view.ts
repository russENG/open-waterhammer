import type { Case, JsonValue } from '@open-waterhammer/contracts'
import type { CanonicalCoordinate, CanonicalHydraulicModel, NodeType } from '@open-waterhammer/core'

export type PlanMode = 'real-coordinates' | 'schematic'
export type PlanElementStatus = 'valid' | 'disconnected' | 'isolated' | 'missing'

export interface PlanPoint {
  x: number
  y: number
}

export interface PlanNode {
  id: string
  name?: string
  kind: NodeType
  elevation?: number
  point: PlanPoint
  status: PlanElementStatus
}

export interface PlanPipe {
  id: string
  name?: string
  fromNodeId: string
  toNodeId: string
  innerDiameter?: number
  points: PlanPoint[]
  status: Extract<PlanElementStatus, 'valid' | 'disconnected' | 'missing'>
}

export interface PlanIssue {
  code: 'MISSING_NODE' | 'ISOLATED_NODE' | 'DISCONNECTED_NETWORK'
  entityId: string
  message: string
}

export interface PlanDiagram {
  mode: PlanMode
  crs?: string
  width: number
  height: number
  nodes: PlanNode[]
  pipes: PlanPipe[]
  issues: PlanIssue[]
}

interface WorkingNode {
  id: string
  name?: string
  kind: NodeType
  elevation?: number
  coordinate?: CanonicalCoordinate
  missing: boolean
}

function record(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, JsonValue> : undefined
}

function modelFromCase(caseRecord: Case): CanonicalHydraulicModel | undefined {
  const value = record(caseRecord.modelSnapshot)?.canonicalModel
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const candidate = value as unknown as Partial<CanonicalHydraulicModel>
  if (candidate.schema !== 'open-waterhammer/hydraulic-model' || candidate.version !== 1 || !Array.isArray(candidate.nodes) || !Array.isArray(candidate.pipes)) return undefined
  return candidate as CanonicalHydraulicModel
}

function finiteCoordinate(value: CanonicalCoordinate | undefined): value is CanonicalCoordinate {
  return value !== undefined && Number.isFinite(value.x) && Number.isFinite(value.y)
}

function validCenterline(value: CanonicalCoordinate[] | undefined): value is CanonicalCoordinate[] {
  return Array.isArray(value) && value.length >= 2 && value.every(finiteCoordinate)
}

function normalizeCoordinates(coordinates: CanonicalCoordinate[], width: number, height: number): PlanPoint[] {
  const padding = 56
  const xs = coordinates.map(({ x }) => x)
  const ys = coordinates.map(({ y }) => y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const rangeX = Math.max(maxX - minX, 1e-9)
  const rangeY = Math.max(maxY - minY, 1e-9)
  const scale = Math.min((width - padding * 2) / rangeX, (height - padding * 2) / rangeY)
  const contentWidth = rangeX * scale
  const contentHeight = rangeY * scale
  const offsetX = (width - contentWidth) / 2
  const offsetY = (height - contentHeight) / 2
  return coordinates.map(({ x, y }) => ({
    x: offsetX + (x - minX) * scale,
    y: height - offsetY - (y - minY) * scale,
  }))
}

function connectedComponents(nodes: WorkingNode[], pipes: CanonicalHydraulicModel['pipes']): string[][] {
  const adjacency = new Map(nodes.map(({ id }) => [id, new Set<string>()]))
  for (const pipe of pipes) {
    adjacency.get(pipe.fromNodeId)?.add(pipe.toNodeId)
    adjacency.get(pipe.toNodeId)?.add(pipe.fromNodeId)
  }
  const seen = new Set<string>()
  const components: string[][] = []
  for (const id of [...adjacency.keys()].sort()) {
    if (seen.has(id)) continue
    const component: string[] = []
    const queue = [id]
    seen.add(id)
    while (queue.length) {
      const current = queue.shift()!
      component.push(current)
      for (const neighbor of [...(adjacency.get(current) ?? [])].sort()) {
        if (seen.has(neighbor)) continue
        seen.add(neighbor)
        queue.push(neighbor)
      }
    }
    components.push(component)
  }
  return components
}

function schematicPositions(nodes: WorkingNode[], pipes: CanonicalHydraulicModel['pipes'], components: string[][]): {
  points: Map<string, PlanPoint>
  width: number
  height: number
} {
  const outgoing = new Map(nodes.map(({ id }) => [id, [] as string[]]))
  const indegree = new Map(nodes.map(({ id }) => [id, 0]))
  for (const pipe of pipes) {
    if (!outgoing.has(pipe.fromNodeId) || !outgoing.has(pipe.toNodeId)) continue
    outgoing.get(pipe.fromNodeId)!.push(pipe.toNodeId)
    indegree.set(pipe.toNodeId, (indegree.get(pipe.toNodeId) ?? 0) + 1)
  }
  const points = new Map<string, PlanPoint>()
  let componentTop = 36
  let largestDepth = 0
  for (const component of components) {
    const member = new Set(component)
    const roots = component.filter((id) => (indegree.get(id) ?? 0) === 0).sort()
    const depth = new Map<string, number>()
    const queue = (roots.length ? roots : [component[0]!]).map((id) => ({ id, depth: 0 }))
    while (queue.length) {
      const next = queue.shift()!
      if (depth.has(next.id)) continue
      depth.set(next.id, next.depth)
      for (const child of [...(outgoing.get(next.id) ?? [])].filter((id) => member.has(id)).sort()) queue.push({ id: child, depth: next.depth + 1 })
    }
    for (const id of component) {
      if (depth.has(id)) continue
      const neighbors = pipes.flatMap((pipe) => pipe.fromNodeId === id ? [pipe.toNodeId] : pipe.toNodeId === id ? [pipe.fromNodeId] : []).filter((neighbor) => member.has(neighbor))
      const linkedDepth = neighbors.map((neighbor) => depth.get(neighbor)).find((value) => value !== undefined)
      depth.set(id, linkedDepth === undefined ? 0 : linkedDepth + 1)
    }
    const layers = new Map<number, string[]>()
    for (const id of component) {
      const value = depth.get(id) ?? 0
      layers.set(value, [...(layers.get(value) ?? []), id].sort())
      largestDepth = Math.max(largestDepth, value)
    }
    const maxLayerSize = Math.max(...[...layers.values()].map(({ length }) => length))
    const componentHeight = Math.max(150, maxLayerSize * 92)
    for (const [layer, ids] of layers) {
      ids.forEach((id, index) => points.set(id, {
        x: 72 + layer * 210,
        y: componentTop + componentHeight * (index + 1) / (ids.length + 1),
      }))
    }
    componentTop += componentHeight + 44
  }
  return { points, width: Math.max(520, 144 + largestDepth * 210), height: Math.max(260, componentTop - 8) }
}

function buildWorkingNodes(model: CanonicalHydraulicModel): WorkingNode[] {
  const result: WorkingNode[] = model.nodes.map((node) => ({ ...node, missing: false }))
  const ids = new Set(result.map(({ id }) => id))
  for (const pipe of model.pipes) {
    for (const id of [pipe.fromNodeId, pipe.toNodeId]) {
      if (ids.has(id)) continue
      ids.add(id)
      result.push({ id, kind: 'junction', missing: true })
    }
  }
  return result
}

function statusMaps(nodes: WorkingNode[], pipes: CanonicalHydraulicModel['pipes'], components: string[][]): {
  nodeStatus: Map<string, PlanElementStatus>
  issues: PlanIssue[]
} {
  const degree = new Map(nodes.map(({ id }) => [id, 0]))
  for (const pipe of pipes) {
    if (degree.has(pipe.fromNodeId)) degree.set(pipe.fromNodeId, degree.get(pipe.fromNodeId)! + 1)
    if (degree.has(pipe.toNodeId)) degree.set(pipe.toNodeId, degree.get(pipe.toNodeId)! + 1)
  }
  const primaryIndex = components.reduce((best, component, index) => component.length > components[best]!.length ? index : best, 0)
  const componentIndex = new Map<string, number>()
  components.forEach((component, index) => component.forEach((id) => componentIndex.set(id, index)))
  const issues: PlanIssue[] = []
  const nodeStatus = new Map<string, PlanElementStatus>()
  for (const node of nodes) {
    if (node.missing) {
      nodeStatus.set(node.id, 'missing')
      issues.push({ code: 'MISSING_NODE', entityId: node.id, message: `管路が参照する節点 ${node.id} が正準モデルにありません。` })
    } else if ((degree.get(node.id) ?? 0) === 0) {
      nodeStatus.set(node.id, 'isolated')
      issues.push({ code: 'ISOLATED_NODE', entityId: node.id, message: `節点 ${node.id} は管路に接続されていません。` })
    } else if (componentIndex.get(node.id) !== primaryIndex) {
      nodeStatus.set(node.id, 'disconnected')
    } else {
      nodeStatus.set(node.id, 'valid')
    }
  }
  components.forEach((component, index) => {
    if (index === primaryIndex || component.every((id) => (degree.get(id) ?? 0) === 0)) return
    issues.push({ code: 'DISCONNECTED_NETWORK', entityId: component[0]!, message: `${component.length}節点の管路群が主な管路網から分離しています。` })
  })
  return { nodeStatus, issues }
}

export function derivePlanDiagramFromModel(model: CanonicalHydraulicModel): PlanDiagram | undefined {
  if (model.nodes.length === 0 && model.pipes.length === 0) return undefined
  const workingNodes = buildWorkingNodes(model)
  const components = connectedComponents(workingNodes, model.pipes)
  const { nodeStatus, issues } = statusMaps(workingNodes, model.pipes, components)
  const useRealCoordinates = workingNodes.every((node) => !node.missing && finiteCoordinate(node.coordinate))

  if (useRealCoordinates) {
    const width = 760
    const height = 420
    const sourceCoordinates = [
      ...workingNodes.map((node) => node.coordinate!),
      ...model.pipes.flatMap((pipe) => validCenterline(pipe.centerline) ? pipe.centerline : []),
    ]
    const normalized = normalizeCoordinates(sourceCoordinates, width, height)
    const nodePoints = new Map(workingNodes.map((node, index) => [node.id, normalized[index]!]))
    let centerlineOffset = workingNodes.length
    const pipes: PlanPipe[] = model.pipes.map((pipe) => {
      const missing = nodeStatus.get(pipe.fromNodeId) === 'missing' || nodeStatus.get(pipe.toNodeId) === 'missing'
      const centerlineLength = validCenterline(pipe.centerline) ? pipe.centerline.length : 0
      const points = centerlineLength
        ? normalized.slice(centerlineOffset, centerlineOffset += centerlineLength)
        : [nodePoints.get(pipe.fromNodeId)!, nodePoints.get(pipe.toNodeId)!]
      return {
        id: pipe.id,
        ...(pipe.name === undefined ? {} : { name: pipe.name }),
        fromNodeId: pipe.fromNodeId,
        toNodeId: pipe.toNodeId,
        innerDiameter: pipe.innerDiameter,
        points,
        status: missing ? 'missing' : nodeStatus.get(pipe.fromNodeId) === 'disconnected' || nodeStatus.get(pipe.toNodeId) === 'disconnected' ? 'disconnected' : 'valid',
      }
    })
    return {
      mode: 'real-coordinates',
      ...(model.crs === undefined ? {} : { crs: model.crs }),
      width,
      height,
      nodes: workingNodes.map((node) => ({
        id: node.id,
        ...(node.name === undefined ? {} : { name: node.name }),
        kind: node.kind,
        ...(node.elevation === undefined ? {} : { elevation: node.elevation }),
        point: nodePoints.get(node.id)!,
        status: nodeStatus.get(node.id)!,
      })),
      pipes,
      issues,
    }
  }

  const layout = schematicPositions(workingNodes, model.pipes, components)
  return {
    mode: 'schematic',
    ...(model.crs === undefined ? {} : { crs: model.crs }),
    width: layout.width,
    height: layout.height,
    nodes: workingNodes.map((node) => ({
      id: node.id,
      ...(node.name === undefined ? {} : { name: node.name }),
      kind: node.kind,
      ...(node.elevation === undefined ? {} : { elevation: node.elevation }),
      point: layout.points.get(node.id)!,
      status: nodeStatus.get(node.id)!,
    })),
    pipes: model.pipes.map((pipe) => {
      const missing = nodeStatus.get(pipe.fromNodeId) === 'missing' || nodeStatus.get(pipe.toNodeId) === 'missing'
      return {
        id: pipe.id,
        ...(pipe.name === undefined ? {} : { name: pipe.name }),
        fromNodeId: pipe.fromNodeId,
        toNodeId: pipe.toNodeId,
        innerDiameter: pipe.innerDiameter,
        points: [layout.points.get(pipe.fromNodeId)!, layout.points.get(pipe.toNodeId)!],
        status: missing ? 'missing' : nodeStatus.get(pipe.fromNodeId) === 'disconnected' || nodeStatus.get(pipe.toNodeId) === 'disconnected' ? 'disconnected' : 'valid',
      }
    }),
    issues,
  }
}

/** Excel・GeoJSON・Web入力の由来を見ず、比較案に保存した正準水理モデルだけから描画データを作る。 */
export function derivePlanDiagram(caseRecord: Case): PlanDiagram | undefined {
  const model = modelFromCase(caseRecord)
  return model ? derivePlanDiagramFromModel(model) : undefined
}
