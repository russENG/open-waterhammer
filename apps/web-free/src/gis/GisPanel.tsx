import GeoJSON from 'ol/format/GeoJSON'
import Map from 'ol/Map'
import View from 'ol/View'
import VectorLayer from 'ol/layer/Vector'
import { fromLonLat } from 'ol/proj'
import VectorSource from 'ol/source/Vector'
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style'
import { useEffect, useRef, useState } from 'react'
import 'ol/ol.css'

import type { Case } from '@open-waterhammer/contracts'
import type { LinkedFocus } from '../workspace/focus'
import { useWorkspace } from '../workspace/workspace-context'
import { importGeoJsonDrafts, validateHydraulicDrafts, type AttributeMapping, type GeoJsonFeatureCollection, type HydraulicDraft } from './import-model'
import {
  createBasemapLayer,
  registerSupportedProjections,
  transformGeometryToWgs84,
  transformLocalCoordinateToWgs84,
  validateLocalTransform,
  type LocalTransformDefinition,
} from './projections'

function storedDrafts(caseRecord: Case): HydraulicDraft[] {
  const root = caseRecord.modelSnapshot
  if (!root || typeof root !== 'object' || Array.isArray(root) || !Array.isArray(root.geoDrafts)) return []
  return root.geoDrafts as unknown as HydraulicDraft[]
}

function storedCrs(caseRecord: Case, fallback: string): string {
  const root = caseRecord.modelSnapshot
  return root && typeof root === 'object' && !Array.isArray(root) && typeof root.geoSourceCrs === 'string'
    ? root.geoSourceCrs : fallback
}

function storedLocalTransform(caseRecord: Case): LocalTransformDefinition {
  const root = caseRecord.modelSnapshot
  const value = root && typeof root === 'object' && !Array.isArray(root) ? root.geoLocalTransform : undefined
  return value && typeof value === 'object' && !Array.isArray(value) && typeof value.proj4 === 'string'
    ? { proj4: value.proj4 } : { proj4: '' }
}

const DEFAULT_MAPPING: AttributeMapping = {
  sourceCrs: 'EPSG:4326',
  node: { id: 'id', elevation: 'elevation' },
  pipe: { id: 'id', startNodeId: 'startNodeId', endNodeId: 'endNodeId', innerDiameter: 'innerDiameter' },
}

export function GisPanel({ caseRecord, projectCrs, locked, focus }: { caseRecord: Case; projectCrs: string; locked: boolean; focus?: LinkedFocus }) {
  const { saveGeoDrafts } = useWorkspace()
  const targetRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Map | null>(null)
  const [basemap, setBasemap] = useState(false)
  const [wizard, setWizard] = useState(false)
  const [mapping, setMapping] = useState(DEFAULT_MAPPING)
  const [fileText, setFileText] = useState('')
  const [drafts, setDrafts] = useState(() => storedDrafts(caseRecord))
  const [draftCrs, setDraftCrs] = useState(() => storedCrs(caseRecord, projectCrs))
  const [localTransform, setLocalTransform] = useState(() => storedLocalTransform(caseRecord))
  const [importError, setImportError] = useState<string | null>(null)
  const validation = validateHydraulicDrafts(drafts)
  const localValidation = draftCrs === 'LOCAL:XY' ? validateLocalTransform(localTransform) : { valid: true }

  useEffect(() => {
    registerSupportedProjections()
    if (!targetRef.current) return
    const vector = new VectorSource()
    const renderableDrafts = draftCrs === 'LOCAL:XY' && localValidation.valid
      ? drafts.map((draft) => ({ ...draft, geometry: draft.geometry ? transformGeometryToWgs84(draft.geometry, draftCrs, (coordinate) => transformLocalCoordinateToWgs84(coordinate, localTransform)) : null }))
      : drafts
    const geo = {
      type: 'FeatureCollection',
      features: renderableDrafts.flatMap((draft) => {
        if (!draft.geometry) return []
        return [{ type: 'Feature', id: draft.id, properties: { ...draft.properties, draftKind: draft.kind }, geometry: draft.geometry }]
      }),
    }
    const dataProjection = draftCrs === 'LOCAL:XY' ? 'EPSG:4326' : draftCrs
    if (geo.features.length && (draftCrs !== 'LOCAL:XY' || localValidation.valid)) vector.addFeatures(new GeoJSON().readFeatures(geo, { dataProjection, featureProjection: 'EPSG:3857' }))
    const defaultStyle = new Style({ stroke: new Stroke({ color: '#17324d', width: 4 }), image: new CircleStyle({ radius: 6, fill: new Fill({ color: '#f6f0df' }), stroke: new Stroke({ color: '#17324d', width: 3 }) }) })
    const focusStyle = new Style({ stroke: new Stroke({ color: '#d85628', width: 7 }), image: new CircleStyle({ radius: 9, fill: new Fill({ color: '#d85628' }), stroke: new Stroke({ color: '#fff8e8', width: 3 }) }) })
    const vectorLayer = new VectorLayer({ source: vector, style: defaultStyle })
    const layers = [vectorLayer]
    const remote = createBasemapLayer(basemap)
    if (remote) layers.unshift(remote as never)
    const map = new Map({
      target: targetRef.current,
      layers,
      view: new View({ center: fromLonLat([139.704, 35.682]), zoom: 14 }),
      controls: [],
    })
    const focusedFeature = focus ? vector.getFeatureById(focus.mapFeatureId) : null
    if (focusedFeature) {
      focusedFeature.setStyle(focusStyle)
      map.getView().fit(focusedFeature.getGeometry()!.getExtent(), { maxZoom: 18, padding: [80, 80, 80, 80], duration: 180 })
    }
    mapRef.current = map
    return () => { map.setTarget(undefined); mapRef.current = null }
  }, [basemap, draftCrs, drafts, focus, localTransform, localValidation.valid])

  async function importDrafts() {
    try {
      const collection = JSON.parse(fileText) as GeoJsonFeatureCollection
      const imported = importGeoJsonDrafts(collection, mapping)
      const persistedTransform = mapping.sourceCrs === 'LOCAL:XY' && validateLocalTransform(localTransform).valid
        ? localTransform : undefined
      await saveGeoDrafts(caseRecord.id, imported as unknown as import('@open-waterhammer/contracts').JsonValue, mapping.sourceCrs, persistedTransform)
      setDrafts(imported)
      setDraftCrs(mapping.sourceCrs)
      setImportError(null)
      setWizard(false)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error))
    }
  }

  function exportWgs84() {
    try {
      const collection = {
        type: 'FeatureCollection',
        crs: { type: 'name', properties: { name: 'EPSG:4326' } },
        features: drafts.filter((draft) => draft.geometry).map((draft) => ({
          type: 'Feature',
          id: draft.sourceFeatureId,
          properties: { id: draft.id, draftKind: draft.kind, ...draft.properties },
          geometry: transformGeometryToWgs84(draft.geometry!, draftCrs, draftCrs === 'LOCAL:XY' ? (coordinate) => transformLocalCoordinateToWgs84(coordinate, localTransform) : undefined),
        })),
      }
      const url = URL.createObjectURL(new Blob([JSON.stringify(collection, null, 2)], { type: 'application/geo+json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `${caseRecord.id}-wgs84.geojson`
      link.click()
      URL.revokeObjectURL(url)
      setImportError(null)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error))
    }
  }

  async function persistLocalTransform() {
    const checked = validateLocalTransform(localTransform)
    if (!checked.valid) {
      setImportError(checked.error ?? 'Local XY transform is invalid')
      return
    }
    await saveGeoDrafts(caseRecord.id, drafts as unknown as import('@open-waterhammer/contracts').JsonValue, draftCrs, localTransform)
    setImportError(null)
  }

  return <div className="panel-stack gis-panel">
    <div className="panel-title-row"><div><span className="eyebrow">MODEL LEDGER / 02</span><h1>Model＋GIS</h1><p>座標系と水理属性を明示して読み込み、未接続・不正要素も draft として保持します。</p></div><div className="panel-actions"><button onClick={exportWgs84}>Export WGS84</button><button className="primary-button" disabled={locked} onClick={() => setWizard(true)}>Import GeoJSON</button></div></div>
    <div className="gis-toolbar"><div className="crs-readout"><span>PROJECT / DATA CRS</span><strong>{projectCrs} / {draftCrs}</strong></div><label className="basemap-toggle"><input type="checkbox" checked={basemap} onChange={(event) => setBasemap(event.target.checked)} /><span>Basemap {basemap ? 'ON' : 'OFF'}</span><small>{basemap ? 'NETWORK ACCESS ENABLED' : 'NO REMOTE TILE SOURCE'}</small></label><span className={`validation-badge ${validation.canRun && localValidation.valid ? 'validation-badge--ok' : 'validation-badge--ng'}`}>{validation.canRun && localValidation.valid ? 'HYDRAULICS VALID' : 'RUN BLOCKED'}</span></div>
    {draftCrs === 'LOCAL:XY' && <section className="local-transform-control notebook-card"><div><span className="eyebrow">LOCAL XY → WGS84</span><h2>Explicit coordinate transform</h2><p>Proj4 定義を Case に保存し、同じ定義を地図表示と WGS84 出力に使用します。</p></div><label><span>Local XY Proj4 definition</span><textarea value={localTransform.proj4} onChange={(event) => setLocalTransform({ proj4: event.target.value })} disabled={locked} /></label><button onClick={() => void persistLocalTransform()} disabled={locked}>Save transform</button>{!localValidation.valid && <p className="form-error">{localValidation.error}</p>}</section>}
    <div className="gis-workspace"><div className="map-stage"><div ref={targetRef} className="ol-map" aria-label="Pipeline map" /><div className="map-grid-overlay" /><div className="north-arrow">N<span>↑</span></div>{focus && <div className="map-focus-chip">FOCUS · {focus.mapFeatureId}</div>}<div className="map-offline-note">BASEMAP {basemap ? 'ON · NETWORK' : 'OFF · LOCAL FEATURES ONLY'}</div></div><aside className="element-ledger"><div className="chart-heading"><div><span className="eyebrow">ELEMENTS</span><h2>Draft validation</h2></div><span>{drafts.length}</span></div><ol>{drafts.map((draft) => { const errors = validation.errorsByFeature[draft.sourceFeatureId] ?? []; return <li key={draft.sourceFeatureId} className={errors.length ? 'element-row element-row--invalid' : 'element-row'}><span>{draft.kind === 'node' ? '●' : draft.kind === 'pipe' ? '━' : '×'}</span><div><strong>{draft.id}</strong><small>{errors[0] ?? 'mapped / valid'}</small></div><b>{errors.length ? 'NG' : 'OK'}</b></li> })}</ol></aside></div>
    {importError && !wizard && <p className="form-error" role="alert">{importError}</p>}
    {wizard && <div className="modal-backdrop"><section className="modal-sheet import-wizard" role="dialog" aria-modal="true" aria-label="GeoJSON import wizard"><div className="modal-heading"><div><span className="eyebrow">IMPORT / STEP 1—3</span><h2>Coordinate & attribute mapping</h2></div><button className="icon-button" onClick={() => setWizard(false)} aria-label="Close import wizard">×</button></div><div className="wizard-steps"><span className="wizard-step wizard-step--active">01 SOURCE CRS</span><span className="wizard-step wizard-step--active">02 ATTRIBUTES</span><span className="wizard-step">03 VALIDATE</span></div><label><span>Source CRS — never inferred</span><select value={mapping.sourceCrs} onChange={(event) => setMapping({ ...mapping, sourceCrs: event.target.value })}><option>EPSG:4326</option><option>EPSG:3857</option>{Array.from({ length: 19 }, (_, index) => <option key={index}>EPSG:{6669 + index}</option>)}<option>LOCAL:XY</option></select></label>{mapping.sourceCrs === 'LOCAL:XY' && <label><span>Local XY Proj4 definition</span><textarea value={localTransform.proj4} onChange={(event) => setLocalTransform({ proj4: event.target.value })} placeholder="+proj=tmerc +lat_0=... +lon_0=... +units=m" /></label>}<div className="mapping-grid"><fieldset><legend>Node mapping</legend><label>ID<input value={mapping.node.id} onChange={(event) => setMapping({ ...mapping, node: { ...mapping.node, id: event.target.value } })} /></label><label>Elevation<input value={mapping.node.elevation} onChange={(event) => setMapping({ ...mapping, node: { ...mapping.node, elevation: event.target.value } })} /></label></fieldset><fieldset><legend>Pipe mapping</legend><label>ID<input value={mapping.pipe.id} onChange={(event) => setMapping({ ...mapping, pipe: { ...mapping.pipe, id: event.target.value } })} /></label><label>From node<input value={mapping.pipe.startNodeId} onChange={(event) => setMapping({ ...mapping, pipe: { ...mapping.pipe, startNodeId: event.target.value } })} /></label><label>To node<input value={mapping.pipe.endNodeId} onChange={(event) => setMapping({ ...mapping, pipe: { ...mapping.pipe, endNodeId: event.target.value } })} /></label><label>Inner diameter<input value={mapping.pipe.innerDiameter} onChange={(event) => setMapping({ ...mapping, pipe: { ...mapping.pipe, innerDiameter: event.target.value } })} /></label></fieldset></div><label><span>GeoJSON</span><textarea value={fileText} onChange={(event) => setFileText(event.target.value)} placeholder="Paste a FeatureCollection or choose a local file" /></label><input type="file" accept="application/geo+json,application/json,.geojson" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then(setFileText) }} />{importError && <p className="form-error" role="alert">{importError}</p>}<div className="modal-actions"><button onClick={() => setWizard(false)}>Cancel</button><button className="primary-button" onClick={() => void importDrafts()}>Import as drafts</button></div></section></div>}
  </div>
}
