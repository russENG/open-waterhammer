import { describe, expect, test } from 'vitest'

import {
  createBasemapLayer,
  exportFeaturesToWgs84,
  transformLocalCoordinateToWgs84,
  validateLocalTransform,
  registerSupportedProjections,
  transformGeometryToWgs84,
  transformCoordinate,
} from '../projections'

describe('GIS projections and offline basemap policy', () => {
  test('round-trips WGS84 through Web Mercator and a JGD2011 plane rectangular zone', () => {
    registerSupportedProjections()
    const tokyo: [number, number] = [139.6917, 35.6895]
    for (const crs of ['EPSG:3857', 'EPSG:6677']) {
      const projected = transformCoordinate(tokyo, 'EPSG:4326', crs)
      const restored = transformCoordinate(projected, crs, 'EPSG:4326')
      expect(restored[0]).toBeCloseTo(tokyo[0], 5)
      expect(restored[1]).toBeCloseTo(tokyo[1], 5)
    }
  })

  test('registers every JGD2011 plane rectangular zone I through XIX', () => {
    const definitions = registerSupportedProjections()
    expect(definitions.filter((code) => /^EPSG:66(6[9]|7\d|8[0-7])$/.test(code))).toHaveLength(19)
  })

  test('basemap OFF creates no remote tile layer or source', () => {
    expect(createBasemapLayer(false)).toBeNull()
    expect(createBasemapLayer(true)).not.toBeNull()
  })

  test('local XY cannot be exported as WGS84 without an explicit transform', () => {
    const draft = [{ id: 'N-1', coordinate: [100, 200] as [number, number] }]
    expect(() => exportFeaturesToWgs84(draft, 'LOCAL:XY')).toThrow(/座標変換を設定/)
    expect(exportFeaturesToWgs84(draft, 'LOCAL:XY', ([x, y]) => [139 + x / 100000, 35 + y / 100000]))
      .toEqual([{ id: 'N-1', coordinate: [139.001, 35.002] }])
  })

  test('registers an explicit persisted Local XY Proj4 definition for rendering and export', () => {
    const definition = { proj4: '+proj=tmerc +lat_0=35 +lon_0=139 +k=1 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs +type=crs' }
    expect(validateLocalTransform(definition)).toEqual({ valid: true })
    expect(transformLocalCoordinateToWgs84([0, 0], definition)).toEqual([
      expect.closeTo(139, 6),
      expect.closeTo(35, 6),
    ])
    expect(validateLocalTransform({ proj4: '' }).valid).toBe(false)
    expect(() => transformLocalCoordinateToWgs84([0, 0], { proj4: 'not-a-proj4-definition' })).toThrow(/Local XY transform/i)
  })

  test('exports Point and LineString GeoJSON coordinates to WGS84', () => {
    const point = transformCoordinate([139.7, 35.6], 'EPSG:4326', 'EPSG:6677')
    const lineEnd = transformCoordinate([139.71, 35.61], 'EPSG:4326', 'EPSG:6677')

    expect(transformGeometryToWgs84({ type: 'Point', coordinates: point }, 'EPSG:6677').coordinates)
      .toEqual(expect.arrayContaining([expect.closeTo(139.7, 5), expect.closeTo(35.6, 5)]))
    const exported = transformGeometryToWgs84({ type: 'LineString', coordinates: [point, lineEnd] }, 'EPSG:6677')
    expect(exported.coordinates).toEqual([
      [expect.closeTo(139.7, 5), expect.closeTo(35.6, 5)],
      [expect.closeTo(139.71, 5), expect.closeTo(35.61, 5)],
    ])
  })
})
