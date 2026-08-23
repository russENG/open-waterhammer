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

export function importGeoJsonDrafts(
  collection: GeoJsonFeatureCollection,
  mapping: AttributeMapping,
): HydraulicDraft[] {
  if (!mapping.sourceCrs.trim()) throw new Error('Source CRS is required')
  if (!mapping.node.id || !mapping.node.elevation || !mapping.pipe.id || !mapping.pipe.startNodeId || !mapping.pipe.endNodeId || !mapping.pipe.innerDiameter) {
    throw new Error('Explicit node and pipe attribute mapping is required')
  }
  return collection.features.map((feature, index) => {
    const properties = feature.properties ?? {}
    const sourceFeatureId = String(feature.id ?? `feature-${index + 1}`)
    if (!feature.geometry) {
      return { sourceFeatureId, kind: 'invalid', id: String(mapped(properties, mapping.node.id) ?? sourceFeatureId), geometry: null, properties, errors: ['Geometry がありません。'] }
    }
    if (feature.geometry.type === 'Point') {
      return {
        sourceFeatureId,
        kind: 'node',
        id: String(mapped(properties, mapping.node.id) ?? sourceFeatureId),
        geometry: feature.geometry,
        properties: { elevation: mapped(properties, mapping.node.elevation) },
        errors: [],
      }
    }
    if (feature.geometry.type === 'LineString') {
      return {
        sourceFeatureId,
        kind: 'pipe',
        id: String(mapped(properties, mapping.pipe.id) ?? sourceFeatureId),
        geometry: feature.geometry,
        properties: {
          startNodeId: mapped(properties, mapping.pipe.startNodeId),
          endNodeId: mapped(properties, mapping.pipe.endNodeId),
          innerDiameter: mapped(properties, mapping.pipe.innerDiameter),
        },
        errors: [],
      }
    }
    return { sourceFeatureId, kind: 'invalid', id: sourceFeatureId, geometry: feature.geometry, properties, errors: [`未対応の Geometry: ${feature.geometry.type}`] }
  })
}

export function validateHydraulicDrafts(drafts: HydraulicDraft[]): {
  canRun: boolean
  errorsByFeature: Record<string, string[]>
} {
  const nodeIds = new Set(drafts.filter(({ kind }) => kind === 'node').map(({ id }) => id))
  const hasPipe = drafts.some(({ kind }) => kind === 'pipe')
  const errorsByFeature: Record<string, string[]> = {}
  for (const draft of drafts) {
    const errors = [...draft.errors]
    if (draft.kind === 'node' && !Number.isFinite(Number(draft.properties.elevation))) errors.push('節点標高が数値ではありません。')
    if (draft.kind === 'pipe') {
      const start = String(draft.properties.startNodeId ?? '')
      const end = String(draft.properties.endNodeId ?? '')
      if (!nodeIds.has(start)) errors.push(`接続元 ${start || '（未設定）'} が見つかりません。`)
      if (!nodeIds.has(end)) errors.push(`接続先 ${end || '（未設定）'} が見つかりません。`)
      if (!(Number(draft.properties.innerDiameter) > 0)) errors.push('内径は0より大きい数値が必要です。')
    }
    if (errors.length) errorsByFeature[draft.sourceFeatureId] = errors
  }
  return { canRun: nodeIds.size > 0 && hasPipe && Object.keys(errorsByFeature).length === 0, errorsByFeature }
}
