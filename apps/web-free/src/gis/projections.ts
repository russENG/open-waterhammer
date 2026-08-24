import TileLayer from 'ol/layer/Tile'
import { get as getProjection, transform } from 'ol/proj'
import { register } from 'ol/proj/proj4'
import XYZ from 'ol/source/XYZ'
import proj4 from 'proj4'

type Coordinate = [number, number]

export interface LocalTransformDefinition {
  proj4: string
}

const JGD2011_ZONES: Array<[number, number, number]> = [
  [33, 129.5, 6669], [33, 131, 6670], [36, 132.1666666667, 6671],
  [33, 133.5, 6672], [36, 134.3333333333, 6673], [36, 136, 6674],
  [36, 137.1666666667, 6675], [36, 138.5, 6676], [36, 139.8333333333, 6677],
  [40, 140.8333333333, 6678], [44, 140.25, 6679], [44, 142.25, 6680],
  [44, 144.25, 6681], [26, 142, 6682], [26, 127.5, 6683],
  [26, 124, 6684], [26, 131, 6685], [20, 136, 6686], [26, 154, 6687],
]

let registered = false

export function registerSupportedProjections(): string[] {
  if (!registered) {
    for (const [latitude, longitude, epsg] of JGD2011_ZONES) {
      proj4.defs(`EPSG:${epsg}`, `+proj=tmerc +lat_0=${latitude} +lon_0=${longitude} +k=0.9999 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs +type=crs`)
    }
    register(proj4)
    registered = true
  }
  return ['EPSG:4326', 'EPSG:3857', ...JGD2011_ZONES.map(([, , epsg]) => `EPSG:${epsg}`), 'LOCAL:XY']
}

export function transformCoordinate(coordinate: Coordinate, source: string, destination: string): Coordinate {
  registerSupportedProjections()
  if (source === 'LOCAL:XY' || destination === 'LOCAL:XY') {
    throw new Error('Local XY requires an explicit transform')
  }
  if (!getProjection(source) || !getProjection(destination)) throw new Error(`Unsupported CRS: ${source} → ${destination}`)
  return transform(coordinate, source, destination) as Coordinate
}

export function validateLocalTransform(definition: LocalTransformDefinition): { valid: boolean; error?: string } {
  if (!definition.proj4.trim()) return { valid: false, error: 'Local XY Proj4 definition is required' }
  try {
    proj4.defs('LOCAL:XY', definition.proj4)
    register(proj4)
    const probe = transform([0, 0], 'LOCAL:XY', 'EPSG:4326') as Coordinate
    if (!probe.every(Number.isFinite)) throw new Error('transform returned non-finite coordinates')
    return { valid: true }
  } catch (error) {
    return { valid: false, error: `Local XY transform is invalid: ${error instanceof Error ? error.message : String(error)}` }
  }
}

export function transformLocalCoordinateToWgs84(
  coordinate: Coordinate,
  definition: LocalTransformDefinition,
): Coordinate {
  const validation = validateLocalTransform(definition)
  if (!validation.valid) throw new Error(validation.error)
  return transform(coordinate, 'LOCAL:XY', 'EPSG:4326') as Coordinate
}

export function createBasemapLayer(enabled: boolean): TileLayer<XYZ> | null {
  if (!enabled) return null
  return new TileLayer({
    source: new XYZ({
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attributions: '© OpenStreetMap contributors',
      crossOrigin: 'anonymous',
    }),
  })
}

export function exportFeaturesToWgs84<T extends { coordinate: Coordinate }>(
  features: T[],
  sourceCrs: string,
  localTransform?: (coordinate: Coordinate) => Coordinate,
): T[] {
  if (sourceCrs === 'LOCAL:XY' && !localTransform) throw new Error('Local XY requires an explicit transform before WGS84 export')
  return features.map((feature) => ({
    ...feature,
    coordinate: sourceCrs === 'LOCAL:XY'
      ? localTransform!(feature.coordinate)
      : transformCoordinate(feature.coordinate, sourceCrs, 'EPSG:4326'),
  }))
}

type GeoJsonGeometry = { type: string; coordinates: unknown }

export function transformGeometryToWgs84(
  geometry: GeoJsonGeometry,
  sourceCrs: string,
  localTransform?: (coordinate: Coordinate) => Coordinate,
): GeoJsonGeometry {
  if (sourceCrs === 'LOCAL:XY' && !localTransform) {
    throw new Error('Local XY requires an explicit transform before WGS84 export')
  }
  const convert = (coordinates: unknown): unknown => {
    if (!Array.isArray(coordinates)) throw new Error(`Invalid ${geometry.type} coordinates`)
    if (coordinates.length >= 2 && typeof coordinates[0] === 'number' && typeof coordinates[1] === 'number') {
      const coordinate: Coordinate = [coordinates[0], coordinates[1]]
      return sourceCrs === 'LOCAL:XY'
        ? localTransform!(coordinate)
        : transformCoordinate(coordinate, sourceCrs, 'EPSG:4326')
    }
    return coordinates.map(convert)
  }
  return { ...geometry, coordinates: convert(geometry.coordinates) }
}
