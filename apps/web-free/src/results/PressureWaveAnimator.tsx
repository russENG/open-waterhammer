import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import type { Case, Run } from '@open-waterhammer/contracts'
import { headToMpa, type CanonicalHydraulicModel } from '@open-waterhammer/core'

import { resolveCanonicalHydraulicModel } from '../workspace/canonical-model-compat'
import type { LinkedFocus } from '../workspace/focus'
import { deriveLongitudinalProfile, type ProfilePoint } from '../workspace/longitudinal-profile'
import { derivePlanDiagram } from '../workspace/plan-view'
import {
  derivePressureWaveAnimation,
  pressureWaveColor,
  valueAtRatio,
  type PressureWaveAnimationData,
  type PressureWaveFrame,
} from './pressure-wave'
import './PressureWaveAnimator.css'

type DisplayMode = 'head' | 'pressure'

function focusFor(id: string, kind: 'pipe' | 'node'): LinkedFocus {
  return {
    targetRef: id,
    mapFeatureId: id,
    profileCursor: id,
    envelopeSeriesId: kind === 'pipe' ? id : '',
    timeSeriesId: id,
  }
}

function activate(event: KeyboardEvent<SVGGElement>, action: () => void) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  action()
}

function elevationByPipe(model: CanonicalHydraulicModel | undefined): Map<string, number> {
  const elevations = new Map<string, number[]>()
  for (const point of model?.measurementPoints ?? []) {
    if (!point.pipeId || typeof point.pipeCenterElevation !== 'number') continue
    const values = elevations.get(point.pipeId) ?? []
    values.push(point.pipeCenterElevation)
    elevations.set(point.pipeId, values)
  }
  const nodeElevation = new Map((model?.nodes ?? []).map((node) => [node.id, node.elevation]))
  for (const pipe of model?.pipes ?? []) {
    if (elevations.has(pipe.id)) continue
    const values = [nodeElevation.get(pipe.fromNodeId), nodeElevation.get(pipe.toNodeId)].filter((value): value is number => typeof value === 'number')
    if (values.length) elevations.set(pipe.id, values)
  }
  return new Map([...elevations].map(([id, values]) => [id, values.reduce((sum, value) => sum + value, 0) / values.length]))
}

function displayedPipeValue(frame: PressureWaveFrame, pipeId: string, mode: DisplayMode, pipeElevations: Map<string, number>): number | undefined {
  const value = frame.pipes[pipeId]?.average
  if (value === undefined) return undefined
  if (mode === 'head') return value
  const elevation = pipeElevations.get(pipeId)
  return elevation === undefined ? undefined : headToMpa(value - elevation)
}

function locationDistance(location: string | undefined): number | undefined {
  if (!location) return undefined
  const station = location.match(/(\d+)\+(\d+(?:\.\d+)?)/)
  const value = station ? Number(station[1]) * 1000 + Number(station[2]) : Number(location.match(/\d+(?:\.\d+)?/)?.[0])
  return Number.isFinite(value) ? value : undefined
}

function selectedSeries(animation: PressureWaveAnimationData, focus: LinkedFocus | undefined, pipeLengths: Map<string, number>): { id: string; kind: 'pipe' | 'node'; values: Array<number | undefined> } {
  const requested = focus?.timeSeriesId || focus?.mapFeatureId
  const nodeId = requested && animation.nodeIds.includes(requested) ? requested : undefined
  if (nodeId) return { id: nodeId, kind: 'node', values: animation.frames.map((frame) => frame.nodes[nodeId]) }
  const pipeId = requested && animation.pipeIds.includes(requested) ? requested : animation.pipeIds[0]!
  const location = locationDistance(focus?.location)
  const length = pipeLengths.get(pipeId) ?? 1
  const ratio = location !== undefined ? Math.max(0, Math.min(1, location / length)) : 0.5
  return { id: pipeId, kind: 'pipe', values: animation.frames.map((frame) => valueAtRatio(frame.pipes[pipeId]?.heads ?? [], ratio)) }
}

function profileValue(point: ProfilePoint, frame: PressureWaveFrame, mode: DisplayMode, pipeLengths: Map<string, number>): number | undefined {
  if (!point.pipeId) return undefined
  const heads = frame.pipes[point.pipeId]?.heads
  if (!heads) return undefined
  const length = pipeLengths.get(point.pipeId)
  const ratio = length && point.distanceAlongPipe !== undefined ? point.distanceAlongPipe / length : 0
  const head = valueAtRatio(heads, ratio)
  if (head === undefined) return undefined
  return mode === 'head' ? head : point.pipeCenterElevation === undefined ? undefined : headToMpa(head - point.pipeCenterElevation)
}

function linePath(points: Array<{ x: number; y?: number }>): string {
  let path = ''
  let connected = false
  for (const point of points) {
    if (point.y === undefined) {
      connected = false
      continue
    }
    path += `${connected ? ' L' : 'M'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
    connected = true
  }
  return path
}

function sparkline(values: Array<number | undefined>, index: number): { path: string; marker?: { x: number; y: number } } {
  const finite = values.filter((value): value is number => value !== undefined)
  if (!finite.length) return { path: '' }
  const minimum = Math.min(...finite)
  const maximum = Math.max(...finite)
  const range = Math.max(maximum - minimum, 1e-9)
  const x = (position: number) => values.length === 1 ? 10 : 10 + position / (values.length - 1) * 300
  const y = (value: number) => 82 - (value - minimum) / range * 64
  const points = values.map((value, position) => ({ x: x(position), ...(value === undefined ? {} : { y: y(value) }) }))
  const markerValue = values[index]
  return { path: linePath(points), ...(markerValue === undefined ? {} : { marker: { x: x(index), y: y(markerValue) } }) }
}

export function PressureWaveAnimator({ caseRecord, run, focus, onFocus }: {
  caseRecord: Case
  run: Run
  focus?: LinkedFocus
  onFocus(focus: LinkedFocus): void
}) {
  const animation = useMemo(() => derivePressureWaveAnimation(run), [run])
  const plan = useMemo(() => derivePlanDiagram(caseRecord), [caseRecord])
  const profile = useMemo(() => deriveLongitudinalProfile(caseRecord, [run], run.id), [caseRecord, run])
  const model = useMemo(() => resolveCanonicalHydraulicModel(caseRecord), [caseRecord])
  const pipeElevations = useMemo(() => elevationByPipe(model), [model])
  const pipeLengths = useMemo(() => new Map((model?.pipes ?? []).map((pipe) => [pipe.id, pipe.length])), [model])
  const [frameIndex, setFrameIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [mode, setMode] = useState<DisplayMode>('head')

  useEffect(() => {
    if (!playing || !animation || animation.frames.length < 2) return
    const current = animation.frames[frameIndex]!
    const nextIndex = frameIndex + 1
    const finished = nextIndex >= animation.frames.length
    const delay = finished ? 0 : Math.max(16, Math.min(1000, (animation.frames[nextIndex]!.time - current.time) * 1000 / speed))
    const timer = window.setTimeout(() => finished ? setPlaying(false) : setFrameIndex(nextIndex), delay)
    return () => window.clearTimeout(timer)
  }, [animation, frameIndex, playing, speed])

  if (!animation) return <div className="wave-empty"><span>∿</span><p>この保存済み計算結果には、再生できる管路内の時刻別水頭分布がありません。</p></div>
  const frame = animation.frames[Math.min(frameIndex, animation.frames.length - 1)]!
  const selectedRaw = selectedSeries(animation, focus, pipeLengths)
  const nodeElevation = model?.nodes.find(({ id }) => id === selectedRaw.id)?.elevation
  const selectedDatum = selectedRaw.kind === 'pipe' ? pipeElevations.get(selectedRaw.id) : nodeElevation
  const selected = {
    ...selectedRaw,
    values: selectedRaw.values.map((value) => value === undefined || mode === 'head' ? value : selectedDatum === undefined ? undefined : headToMpa(value - selectedDatum)),
  }
  const selectedValues = selected.values.filter((value): value is number => value !== undefined)
  const selectedCurrent = selected.values[frameIndex]
  const trace = sparkline(selected.values, frameIndex)
  const profileElevations = profile?.points.map((point) => point.pipeCenterElevation).filter((value): value is number => value !== undefined) ?? []
  const elevationMinimum = profileElevations.length ? Math.min(...profileElevations) : 0
  const elevationMaximum = profileElevations.length ? Math.max(...profileElevations) : 0
  const displayMinimum = mode === 'head' ? animation.minimumHead : headToMpa(animation.minimumHead - elevationMaximum)
  const displayMaximum = mode === 'head' ? animation.maximumHead : headToMpa(animation.maximumHead - elevationMinimum)
  const unitLabel = mode === 'head' ? '水頭 H (m)' : '圧力 P (MPa)'
  const unit = mode === 'head' ? 'm' : 'MPa'
  const profileValues = profile?.points.map((point) => profileValue(point, frame, mode, pipeLengths)) ?? []

  return <section className="pressure-wave" aria-label="圧力波アニメーション">
    <div className="wave-heading">
      <div><span className="eyebrow">保存済み計算結果の再生</span><h2>圧力波の伝播</h2></div>
      <output aria-live="polite">{playing ? '再生中' : '停止中'} · t = {frame.time.toFixed(3)} s</output>
    </div>
    <div className="wave-controls">
      <button type="button" className="primary-button" aria-label={playing ? '圧力波を一時停止' : '圧力波を再生'} onClick={() => {
        if (!playing && frameIndex >= animation.frames.length - 1) setFrameIndex(0)
        setPlaying((value) => !value)
      }}>{playing ? '一時停止' : '再生'}</button>
      <label className="wave-slider"><span>時刻</span><input type="range" min="0" max={animation.frames.length - 1} step="1" value={frameIndex} aria-label="圧力波の時刻" onChange={(event) => { setPlaying(false); setFrameIndex(Number(event.target.value)) }} /><b>{frame.time.toFixed(3)} s</b></label>
      <label><span>再生速度</span><select aria-label="圧力波の再生速度" value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>{[0.25, 0.5, 1, 2, 4].map((value) => <option key={value} value={value}>{value}×</option>)}</select></label>
      <label><span>表示量</span><select aria-label="圧力波の表示量" value={mode} onChange={(event) => setMode(event.target.value as DisplayMode)}><option value="head">水頭</option><option value="pressure">圧力</option></select></label>
    </div>
    <div className="wave-metrics" aria-label="圧力波の数値">
      <article><span>全時刻の最小</span><strong>{displayMinimum.toFixed(2)} {unit}</strong></article>
      <article><span>全時刻の最大</span><strong>{displayMaximum.toFixed(2)} {unit}</strong></article>
      <article><span>選択地点</span><strong>{selected.id} · {selectedCurrent?.toFixed(2) ?? '—'} {unit}</strong><small>最小 {selectedValues.length ? Math.min(...selectedValues).toFixed(2) : '—'} / 最大 {selectedValues.length ? Math.max(...selectedValues).toFixed(2) : '—'} {unit}</small></article>
    </div>
    <div className="wave-visual-grid">
      <article className="wave-plan-card">
        <div className="wave-subheading"><strong>{plan?.mode === 'real-coordinates' ? '平面図' : '模式図'}</strong><span>{unitLabel}</span></div>
        {plan ? <svg viewBox={`0 0 ${plan.width} ${plan.height}`} role="group" aria-label={`圧力波の${plan.mode === 'real-coordinates' ? '平面図' : '模式図'}、時刻${frame.time.toFixed(3)}秒`}>
          {plan.pipes.map((pipe) => {
            const value = displayedPipeValue(frame, pipe.id, mode, pipeElevations)
            const selectedPipe = focus?.mapFeatureId === pipe.id
            const action = () => onFocus(focusFor(pipe.id, 'pipe'))
            return <g key={pipe.id} className={`wave-plan-pipe${selectedPipe ? ' wave-selected' : ''}`} role="button" tabIndex={0} aria-pressed={selectedPipe} aria-label={`管路 ${pipe.id}、${unitLabel} ${value?.toFixed(2) ?? '記録なし'}`} onClick={action} onKeyDown={(event) => activate(event, action)}>
              <polyline points={pipe.points.map(({ x, y }) => `${x},${y}`).join(' ')} style={{ stroke: pressureWaveColor(value, displayMinimum, displayMaximum) }} />
              <text x={pipe.points.reduce((sum, point) => sum + point.x, 0) / pipe.points.length} y={pipe.points.reduce((sum, point) => sum + point.y, 0) / pipe.points.length - 9}>{pipe.id} · {value?.toFixed(1) ?? '—'}</text>
            </g>
          })}
          {plan.nodes.map((node) => {
            const head = frame.nodes[node.id]
            const value = head === undefined ? undefined : mode === 'head' ? head : node.elevation === undefined ? undefined : headToMpa(head - node.elevation)
            const selectedNode = focus?.mapFeatureId === node.id
            const action = () => onFocus(focusFor(node.id, 'node'))
            return <g key={node.id} className={`wave-plan-node${selectedNode ? ' wave-selected' : ''}`} role="button" tabIndex={0} aria-pressed={selectedNode} aria-label={`節点 ${node.id}、${unitLabel} ${value?.toFixed(2) ?? '記録なし'}`} onClick={action} onKeyDown={(event) => activate(event, action)}>
              <circle cx={node.point.x} cy={node.point.y} r="9" style={{ fill: pressureWaveColor(value, displayMinimum, displayMaximum) }} />
              <text x={node.point.x} y={node.point.y + 24}>{node.id}</text>
            </g>
          })}
        </svg> : <p>平面図に必要な正準モデルがありません。</p>}
      </article>
      <article className="wave-profile-card">
        <div className="wave-subheading"><strong>縦断図</strong><span>{unitLabel}</span></div>
        {profile?.points.length ? (() => {
          const width = 700
          const height = 260
          const left = 42
          const top = 28
          const plotWidth = width - 62
          const plotHeight = height - 62
          const maximumDistance = Math.max(...profile.points.map((point) => point.distance), 1)
          const range = Math.max(displayMaximum - displayMinimum, 1e-9)
          const x = (distance: number) => left + distance / maximumDistance * plotWidth
          const y = (value: number) => top + (displayMaximum - value) / range * plotHeight
          const dynamicPoints = profile.points.map((point, index) => ({ x: x(point.distance), ...(profileValues[index] === undefined ? {} : { y: y(profileValues[index]!) }) }))
          return <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`圧力波の縦断図、時刻${frame.time.toFixed(3)}秒`}>
            <line x1={left} x2={left + plotWidth} y1={top + plotHeight} y2={top + plotHeight} className="wave-axis" />
            <path d={linePath(dynamicPoints)} className="wave-profile-line" />
            {dynamicPoints.map((point, index) => point.y === undefined ? null : <g key={profile.points[index]!.id}><circle cx={point.x} cy={point.y} r="4" /><text x={point.x} y={height - 16}>{profile.points[index]!.id}</text></g>)}
            <text x={left} y={top - 8}>{displayMaximum.toFixed(1)} m</text><text x={left} y={top + plotHeight + 14}>{displayMinimum.toFixed(1)} m</text>
          </svg>
        })() : <p>縦断図に必要な測点データがありません。</p>}
      </article>
    </div>
    <div className="wave-bottom-row">
      <div className="wave-legend" aria-label="圧力波の色凡例"><span style={{ background: pressureWaveColor(displayMinimum, displayMinimum, displayMaximum) }} />最小 {displayMinimum.toFixed(2)} {unit}<i />最大 {displayMaximum.toFixed(2)} {unit}<span style={{ background: pressureWaveColor(displayMaximum, displayMinimum, displayMaximum) }} /></div>
      <div className="wave-trace"><strong>{selected.id} の時系列</strong><svg viewBox="0 0 320 96" role="img" aria-label={`${selected.id}の時系列、現在時刻${frame.time.toFixed(3)}秒`}><path d={trace.path} />{trace.marker && <circle cx={trace.marker.x} cy={trace.marker.y} r="5" />}</svg></div>
    </div>
    <p className="wave-source">再計算せず、保存済み計算記録 {run.id} の {animation.sourceFrameCount.toLocaleString()} 時刻を使用。表示 {animation.frames.length.toLocaleString()} 時刻{animation.framesReduced ? `（操作性確保のため上限 ${animation.frameLimit} に間引き）` : ''}、管路内最大 {animation.sourceSpatialSampleCount.toLocaleString()} 点{animation.spatialSamplesReduced ? `（描画上限 ${animation.spatialSampleLimit} 点）` : ''}。</p>
  </section>
}
