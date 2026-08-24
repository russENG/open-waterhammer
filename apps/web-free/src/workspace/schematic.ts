import type { Case, JsonValue } from '@open-waterhammer/contracts'

import type { HydraulicDraft } from '../gis/import-model'

export interface SchematicNode {
  id: string
  elevation?: number
}

export interface SchematicPipe {
  id?: string
  diameter?: number
  length?: number
}

export interface DerivedSchematic {
  upstream: SchematicNode
  downstream: SchematicNode
  pipe: SchematicPipe
}

function record(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, JsonValue> : undefined
}

function number(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function text(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** ノード標高: geoDrafts に取り込まれた地物属性 (properties.elevation) から補完する。 */
function geoDraftElevations(modelSnapshot: Record<string, JsonValue> | undefined): Map<string, number> {
  const elevations = new Map<string, number>()
  const drafts = modelSnapshot?.geoDrafts
  if (!Array.isArray(drafts)) return elevations
  for (const draft of drafts as unknown as HydraulicDraft[]) {
    if (!draft || draft.kind !== 'node' || typeof draft.id !== 'string') continue
    const elevation = draft.properties?.elevation
    if (typeof elevation === 'number' && Number.isFinite(elevation)) elevations.set(draft.id, elevation)
  }
  return elevations
}

function fromNetwork(network: Record<string, JsonValue> | undefined, geoElevations: Map<string, number>): DerivedSchematic | undefined {
  const pipes = network?.pipes
  const pipe = Array.isArray(pipes) ? record(pipes[0]) : undefined
  if (!pipe) return undefined
  const upstreamId = text(pipe.upstreamNodeId)
  const downstreamId = text(pipe.downstreamNodeId)
  if (!upstreamId || !downstreamId) return undefined

  const nodes = Array.isArray(network?.nodes) ? network.nodes : []
  const nodeElevation = (id: string) => {
    const match = nodes.map(record).find((node) => node && text(node.id) === id)
    return number(match?.elevation) ?? geoElevations.get(id)
  }
  return {
    upstream: { id: upstreamId, elevation: nodeElevation(upstreamId) },
    downstream: { id: downstreamId, elevation: nodeElevation(downstreamId) },
    pipe: { id: text(pipe.id), diameter: number(pipe.innerDiameter), length: number(pipe.length) },
  }
}

function fromSinglePipe(pipe: Record<string, JsonValue> | undefined, geoElevations: Map<string, number>): DerivedSchematic | undefined {
  if (!pipe) return undefined
  const id = text(pipe.id)
  const diameter = number(pipe.innerDiameter)
  const length = number(pipe.length)
  const upstreamId = text(pipe.startNodeId)
  const downstreamId = text(pipe.endNodeId)
  if (id === undefined && diameter === undefined && length === undefined && upstreamId === undefined && downstreamId === undefined) return undefined

  return {
    upstream: { id: upstreamId ?? 'upstream', elevation: upstreamId ? geoElevations.get(upstreamId) : undefined },
    downstream: { id: downstreamId ?? 'downstream', elevation: downstreamId ? geoElevations.get(downstreamId) : undefined },
    pipe: { id, diameter, length },
  }
}

function fromSteadySinglePipe(input: Record<string, JsonValue> | undefined): DerivedSchematic | undefined {
  if (!input) return undefined
  const diameter = number(input.innerDiameter)
  const length = number(input.length)
  const upstreamElevation = number(input.upstreamElevation)
  const downstreamElevation = number(input.downstreamElevation)
  if (diameter === undefined && length === undefined && upstreamElevation === undefined && downstreamElevation === undefined) return undefined

  return {
    upstream: { id: 'upstream', elevation: upstreamElevation },
    downstream: { id: 'downstream', elevation: downstreamElevation },
    pipe: { diameter, length },
  }
}

/**
 * Case の modelSnapshot.runInputs から、Overview の模式図に必要な最小限の
 * 上流/下流ノード（id・標高）と管路（id・口径・延長）を導出する。
 *
 * 優先順位: steady_network_python（節点・管路の配列）→ wave_speed（単一管路）
 * → steady_single_pipe（単一管路・標高のみ）。標高は geoDrafts のノード属性
 * （properties.elevation）で補完する。利用できる入力が無ければ undefined。
 */
export function deriveSchematic(caseRecord: Case): DerivedSchematic | undefined {
  const modelSnapshot = record(caseRecord.modelSnapshot)
  const runInputs = record(modelSnapshot?.runInputs)
  const geoElevations = geoDraftElevations(modelSnapshot)

  const network = fromNetwork(record(runInputs?.steady_network_python), geoElevations)
  if (network) return network

  const waveSpeedPipe = record(record(runInputs?.wave_speed)?.pipe)
  const waveSpeed = fromSinglePipe(waveSpeedPipe, geoElevations)
  if (waveSpeed) return waveSpeed

  return fromSteadySinglePipe(record(runInputs?.steady_single_pipe))
}
