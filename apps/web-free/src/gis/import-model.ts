export interface GeoJsonGeometry {
  type: string
  coordinates: unknown
}

export interface GeoJsonFeature {
  type: 'Feature'
  id?: string | number
  properties: Record<string, unknown> | null
  geometry: GeoJsonGeometry | null
}

export interface GeoJsonFeatureCollection {
  type: 'FeatureCollection'
  features: GeoJsonFeature[]
}

export interface AttributeMapping {
  sourceCrs: string
  node: { id?: string; elevation?: string }
  pipe: { id?: string; startNodeId?: string; endNodeId?: string; innerDiameter?: string }
}

export interface HydraulicDraft {
  sourceFeatureId: string
  kind: 'node' | 'pipe' | 'invalid'
  id: string
  geometry: GeoJsonGeometry | null
  properties: Record<string, unknown>
  errors: string[]
}

function mapped(properties: Record<string, unknown>, key: string | undefined): unknown {
  return key ? properties[key] : undefined
}

function textValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
}

function isFiniteHydraulicNumber(value: unknown): boolean {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return false
  return Number.isFinite(Number(value))
}

export function importGeoJsonDrafts(
  collection: GeoJsonFeatureCollection,
  mapping: AttributeMapping,
): HydraulicDraft[] {
  if (!mapping.sourceCrs.trim()) throw new Error('読み込み元の座標系を指定してください')
  const mappedKeys = [mapping.node.id, mapping.node.elevation, mapping.pipe.id, mapping.pipe.startNodeId, mapping.pipe.endNodeId, mapping.pipe.innerDiameter]
  if (mappedKeys.some((key) => typeof key !== 'string' || key.trim() === '')) {
    throw new Error('節点と管路の属性割り当てを指定してください')
  }
  return collection.features.map((feature, index) => {
    const properties = feature.properties ?? {}
    const sourceFeatureId = String(feature.id ?? `feature-${index + 1}`)
    if (!feature.geometry) {
      return { sourceFeatureId, kind: 'invalid', id: String(mapped(properties, mapping.node.id) ?? sourceFeatureId), geometry: null, properties, errors: ['Geometry がありません。'] }
    }
    if (feature.geometry.type === 'Point') {
      const id = textValue(mapped(properties, mapping.node.id))
      const elevation = mapped(properties, mapping.node.elevation)
      return {
        sourceFeatureId,
        kind: 'node',
        id,
        geometry: feature.geometry,
        properties: { elevation },
        errors: [
          ...(!id ? ['節点IDが未入力です。'] : []),
          ...(!isFiniteHydraulicNumber(elevation) ? ['節点標高が数値ではありません。'] : []),
        ],
      }
    }
    if (feature.geometry.type === 'LineString') {
      const id = textValue(mapped(properties, mapping.pipe.id))
      const startNodeId = textValue(mapped(properties, mapping.pipe.startNodeId))
      const endNodeId = textValue(mapped(properties, mapping.pipe.endNodeId))
      const innerDiameter = mapped(properties, mapping.pipe.innerDiameter)
      return {
        sourceFeatureId,
        kind: 'pipe',
        id,
        geometry: feature.geometry,
        properties: { startNodeId, endNodeId, innerDiameter },
        errors: [
          ...(!id ? ['管路IDが未入力です。'] : []),
          ...(!startNodeId ? ['接続元が未入力です。'] : []),
          ...(!endNodeId ? ['接続先が未入力です。'] : []),
          ...(!isFiniteHydraulicNumber(innerDiameter) || Number(innerDiameter) <= 0 ? ['内径は0より大きい数値が必要です。'] : []),
        ],
      }
    }
    return { sourceFeatureId, kind: 'invalid', id: sourceFeatureId, geometry: feature.geometry, properties, errors: [`未対応の Geometry: ${feature.geometry.type}`] }
  })
}

export function validateHydraulicDrafts(drafts: HydraulicDraft[]): {
  canRun: boolean
  errorsByFeature: Record<string, string[]>
} {
  const nodeIds = new Set(drafts.filter(({ kind, id }) => kind === 'node' && Boolean(id.trim())).map(({ id }) => id))
  const hasPipe = drafts.some(({ kind }) => kind === 'pipe')
  const errorsByFeature: Record<string, string[]> = {}
  for (const draft of drafts) {
    const errors = [...draft.errors]
    if (draft.kind === 'node') {
      if (!draft.id.trim()) errors.push('節点IDが未入力です。')
      if (!isFiniteHydraulicNumber(draft.properties.elevation)) errors.push('節点標高が数値ではありません。')
    }
    if (draft.kind === 'pipe') {
      const start = textValue(draft.properties.startNodeId)
      const end = textValue(draft.properties.endNodeId)
      if (!draft.id.trim()) errors.push('管路IDが未入力です。')
      if (!start) errors.push('接続元が未入力です。')
      else if (!nodeIds.has(start)) errors.push(`接続元 ${start} が見つかりません。`)
      if (!end) errors.push('接続先が未入力です。')
      else if (!nodeIds.has(end)) errors.push(`接続先 ${end} が見つかりません。`)
      if (!isFiniteHydraulicNumber(draft.properties.innerDiameter) || Number(draft.properties.innerDiameter) <= 0) errors.push('内径は0より大きい数値が必要です。')
    }
    if (errors.length) errorsByFeature[draft.sourceFeatureId] = [...new Set(errors)]
  }
  return { canRun: nodeIds.size > 0 && hasPipe && Object.keys(errorsByFeature).length === 0, errorsByFeature }
}

export interface CanonicalGeometryIssue {
  entityId: string
  message: string
}

function coordinate(value: unknown): CanonicalCoordinate | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined
  const x = Number(value[0])
  const y = Number(value[1])
  const z = value.length > 2 ? Number(value[2]) : undefined
  if (!Number.isFinite(x) || !Number.isFinite(y) || (z !== undefined && !Number.isFinite(z))) return undefined
  return z === undefined ? { x, y } : { x, y, z }
}

/**
 * GISの形状をIDで正準水理モデルに重ねる。水理諸元は変更しない。
 * GIS側にしかない要素は、必須諸元が揃うまで編集中データのまま保持する。
 */
export function mergeDraftGeometryIntoCanonicalModel(
  model: CanonicalHydraulicModel,
  drafts: HydraulicDraft[],
  sourceCrs: string,
): { model: CanonicalHydraulicModel; issues: CanonicalGeometryIssue[] } {
  const issues: CanonicalGeometryIssue[] = []
  const nodeGeometry = new Map<string, CanonicalCoordinate>()
  const pipeGeometry = new Map<string, CanonicalCoordinate[]>()
  const nodeIds = new Set(model.nodes.map(({ id }) => id))
  const pipeIds = new Set(model.pipes.map(({ id }) => id))

  for (const draft of drafts) {
    if (draft.errors.length > 0) continue
    if (draft.kind === 'node') {
      if (!nodeIds.has(draft.id)) {
        issues.push({ entityId: draft.id, message: `GIS節点 ${draft.id} は正準モデルにないため、形状を編集中データにのみ保持しました。` })
        continue
      }
      const parsed = coordinate(draft.geometry?.coordinates)
      if (parsed) nodeGeometry.set(draft.id, parsed)
    }
    if (draft.kind === 'pipe') {
      if (!pipeIds.has(draft.id)) {
        issues.push({ entityId: draft.id, message: `GIS管路 ${draft.id} は正準モデルにないため、形状を編集中データにのみ保持しました。` })
        continue
      }
      const parsed = Array.isArray(draft.geometry?.coordinates)
        ? draft.geometry.coordinates.map(coordinate).filter((item): item is CanonicalCoordinate => item !== undefined)
        : []
      if (parsed.length >= 2) pipeGeometry.set(draft.id, parsed)
    }
  }

  return {
    model: {
      ...model,
      crs: sourceCrs,
      nodes: model.nodes.map((node) => nodeGeometry.has(node.id) ? { ...node, coordinate: nodeGeometry.get(node.id)! } : node),
      pipes: model.pipes.map((pipe) => pipeGeometry.has(pipe.id) ? { ...pipe, centerline: pipeGeometry.get(pipe.id)! } : pipe),
    },
    issues,
  }
}
import type { CanonicalCoordinate, CanonicalHydraulicModel } from '@open-waterhammer/core'
