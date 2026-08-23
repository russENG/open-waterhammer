import { describe, expect, test } from 'vitest'

import { importGeoJsonDrafts, validateHydraulicDrafts } from '../import-model'

const geojson = {
  type: 'FeatureCollection' as const,
  features: [
    { type: 'Feature' as const, id: 'n1', properties: { code: 'N-1', elev: 12 }, geometry: { type: 'Point' as const, coordinates: [139.7, 35.6] } },
    { type: 'Feature' as const, id: 'p1', properties: { code: 'P-1', from: 'N-1', to: 'N-X', dia: 0.3 }, geometry: { type: 'LineString' as const, coordinates: [[139.7, 35.6], [139.71, 35.61]] } },
    { type: 'Feature' as const, id: 'bad', properties: { code: 'broken' }, geometry: null },
  ],
}

describe('GeoJSON import wizard model', () => {
  test('requires source CRS and explicit node/pipe attribute mapping instead of guessing', () => {
    expect(() => importGeoJsonDrafts(geojson, { sourceCrs: '', node: {}, pipe: {} })).toThrow(/source CRS/i)
    expect(() => importGeoJsonDrafts(geojson, { sourceCrs: 'EPSG:4326', node: {}, pipe: {} })).toThrow(/attribute mapping/i)
  })

  test('retains invalid and unconnected elements as drafts with element-level errors', () => {
    const imported = importGeoJsonDrafts(geojson, {
      sourceCrs: 'EPSG:4326',
      node: { id: 'code', elevation: 'elev' },
      pipe: { id: 'code', startNodeId: 'from', endNodeId: 'to', innerDiameter: 'dia' },
    })
    const validation = validateHydraulicDrafts(imported)

    expect(imported).toHaveLength(3)
    expect(validation.canRun).toBe(false)
    expect(validation.errorsByFeature['p1']).toContain('接続先 N-X が見つかりません。')
    expect(validation.errorsByFeature.bad).toContain('Geometry がありません。')
  })

  test('blocks hydraulics until at least one valid node and connected pipe are present', () => {
    const nodeOnly = importGeoJsonDrafts({ ...geojson, features: [geojson.features[0]!] }, {
      sourceCrs: 'EPSG:4326',
      node: { id: 'code', elevation: 'elev' },
      pipe: { id: 'code', startNodeId: 'from', endNodeId: 'to', innerDiameter: 'dia' },
    })
    expect(validateHydraulicDrafts(nodeOnly).canRun).toBe(false)
  })
})
