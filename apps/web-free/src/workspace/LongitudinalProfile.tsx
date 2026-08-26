import type { KeyboardEvent } from 'react'

import type { LinkedFocus } from './focus'
import type { LongitudinalProfileDiagram, ProfilePipeSpan, ProfilePoint } from './longitudinal-profile'
import './LongitudinalProfile.css'

type ValueKey = 'groundElevation' | 'pipeCenterElevation' | 'hydraulicGradeElevation' | 'maximumHeadElevation' | 'minimumHeadElevation' | 'designPressureElevation'

const SERIES: Array<{ key: ValueKey; label: string; className: string; result: boolean }> = [
  { key: 'groundElevation', label: '地盤高', className: 'profile-series--ground', result: false },
  { key: 'pipeCenterElevation', label: '管中心高', className: 'profile-series--pipe', result: false },
  { key: 'hydraulicGradeElevation', label: '動水位', className: 'profile-series--hydraulic', result: true },
  { key: 'maximumHeadElevation', label: '最大水頭', className: 'profile-series--maximum', result: true },
  { key: 'minimumHeadElevation', label: '最小水頭', className: 'profile-series--minimum', result: true },
  { key: 'designPressureElevation', label: '設計内圧換算水頭', className: 'profile-series--design', result: true },
]

function finite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value)
}

function lineSegments(points: ProfilePoint[], key: ValueKey, x: (value: number) => number, y: (value: number) => number): string[] {
  const result: string[] = []
  let current = ''
  for (const point of points) {
    const value = point[key]
    if (!finite(value)) {
      if (current) result.push(current)
      current = ''
      continue
    }
    current += `${current ? ' L' : 'M'} ${x(point.distance).toFixed(2)} ${y(value).toFixed(2)}`
  }
  if (current) result.push(current)
  return result
}

function focusForPoint(point: ProfilePoint): LinkedFocus {
  const mapFeatureId = point.nodeId ?? point.pipeId ?? point.id
  const envelopeSeriesId = point.pipeId ?? mapFeatureId
  return {
    targetRef: point.id,
    location: String(point.distanceAlongPipe ?? point.distance),
    mapFeatureId,
    profileCursor: point.id,
    envelopeSeriesId,
    timeSeriesId: point.nodeId ?? envelopeSeriesId,
  }
}

function focusForPipe(span: ProfilePipeSpan): LinkedFocus {
  return {
    targetRef: span.pipeId,
    mapFeatureId: span.pipeId,
    profileCursor: span.pipeId,
    envelopeSeriesId: span.pipeId,
    timeSeriesId: span.pipeId,
  }
}

function activateOnKeyboard(event: KeyboardEvent<SVGGElement>, action: () => void) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  action()
}

export function LongitudinalProfile({ diagram, mode, focus, onFocus }: {
  diagram?: LongitudinalProfileDiagram
  mode: 'input' | 'result'
  focus?: LinkedFocus
  onFocus?(focus: LinkedFocus): void
}) {
  if (!diagram) return <div className="profile-empty"><span>—</span><p>縦断図に必要な測点データがありません。</p></div>
  const width = 900
  const height = 360
  const plot = { left: 58, right: 20, top: 58, bottom: 58 }
  const plotWidth = width - plot.left - plot.right
  const plotHeight = height - plot.top - plot.bottom
  const maximumDistance = Math.max(...diagram.points.map(({ distance }) => distance), 1)
  const values = diagram.points.flatMap((point) => SERIES.map(({ key }) => point[key]).filter(finite))
  const minimumValue = Math.min(...values)
  const maximumValue = Math.max(...values)
  const valuePadding = Math.max((maximumValue - minimumValue) * 0.08, 1)
  const yMinimum = minimumValue - valuePadding
  const yMaximum = maximumValue + valuePadding
  const x = (value: number) => plot.left + value / maximumDistance * plotWidth
  const y = (value: number) => plot.top + (yMaximum - value) / Math.max(yMaximum - yMinimum, 1e-9) * plotHeight
  const visibleSeries = SERIES.filter(({ key, result }) => !result || diagram.points.some((point) => finite(point[key])))
  const selectedPoint = diagram.points.find(({ id }) => id === focus?.profileCursor)
  const selectedPipeId = focus?.envelopeSeriesId
  const statusLabel = mode === 'input'
    ? '入力確認図（計算前）'
    : diagram.hasCalculationResults ? '計算結果重ね合わせ図' : '入力確認図（計算結果なし）'

  return <div className="longitudinal-profile">
    <div className="profile-status-row">
      <strong>{statusLabel}</strong>
      <span>測点 {diagram.points.length}件 / 管路 {diagram.pipeSpans.length}件</span>
      <b className={diagram.issues.length ? 'profile-status-warning' : ''}>{diagram.issues.length ? `要確認 ${diagram.issues.length}件` : '入力整合'}</b>
    </div>
    <div className="profile-chart-scroll">
      <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`${statusLabel}、測点${diagram.points.length}件`}>
        <defs>
          <pattern id={`profile-grid-${mode}`} width="55" height="40" patternUnits="userSpaceOnUse"><path d="M55 0H0V40" fill="none" stroke="currentColor" strokeOpacity=".10" /></pattern>
        </defs>
        <rect x={plot.left} y={plot.top} width={plotWidth} height={plotHeight} fill={`url(#profile-grid-${mode})`} />
        <g className="profile-pipe-spans">
          {diagram.pipeSpans.map((span, index) => {
            const start = x(span.fromDistance)
            const end = x(Math.max(span.toDistance, span.fromDistance))
            const selected = selectedPipeId === span.pipeId
            const action = () => onFocus?.(focusForPipe(span))
            return <g key={`${span.pipeId}-${index}`} className={selected ? 'profile-pipe-span profile-pipe-span--selected' : 'profile-pipe-span'} role={onFocus ? 'button' : undefined} tabIndex={onFocus ? 0 : undefined} aria-label={`管路 ${span.pipeId}${span.diameter === undefined ? '' : `、管内径 ${Math.round(span.diameter * 1000)}ミリメートル`}`} aria-pressed={onFocus ? selected : undefined} onClick={action} onKeyDown={(event) => activateOnKeyboard(event, action)}>
              <line x1={start} x2={Math.max(end, start + 2)} y1="35" y2="35" />
              <text x={(start + end) / 2} y="27">{span.pipeId}{span.diameter === undefined ? '' : ` · φ${Math.round(span.diameter * 1000)}`}</text>
            </g>
          })}
        </g>
        <g className="profile-series">
          {visibleSeries.flatMap((series) => lineSegments(diagram.points, series.key, x, y).map((path, index) => <path key={`${series.key}-${index}`} d={path} className={series.className} />))}
        </g>
        <g className="profile-points">
          {diagram.points.map((point) => {
            const markerValue = point.pipeCenterElevation ?? point.groundElevation ?? yMinimum
            const selected = point.id === selectedPoint?.id
            const action = () => onFocus?.(focusForPoint(point))
            return <g key={point.id} className={`profile-point${point.issueCodes.length ? ' profile-point--invalid' : ''}${selected ? ' profile-point--selected' : ''}`} role={onFocus ? 'button' : undefined} tabIndex={onFocus ? 0 : undefined} aria-label={`測点 ${point.id}${point.pipeId ? `、管路 ${point.pipeId}` : ''}${point.nodeId ? `、節点 ${point.nodeId}` : ''}${point.issueCodes.length ? '、要確認' : ''}`} aria-pressed={onFocus ? selected : undefined} onClick={action} onKeyDown={(event) => activateOnKeyboard(event, action)}>
              <line x1={x(point.distance)} x2={x(point.distance)} y1={plot.top} y2={plot.top + plotHeight} />
              {point.issueCodes.length ? <path d={`M ${x(point.distance)} ${y(markerValue) - 8} l 8 14 h -16 Z`} /> : <circle cx={x(point.distance)} cy={y(markerValue)} r="5" />}
              <text x={x(point.distance)} y={height - 31}>{point.id}</text>
              {point.nodeId && <text className="profile-node-label" x={x(point.distance)} y={height - 14}>節点 {point.nodeId}</text>}
            </g>
          })}
        </g>
        {selectedPoint && <line className="linked-chart-cursor profile-selected-cursor" x1={x(selectedPoint.distance)} x2={x(selectedPoint.distance)} y1={plot.top - 8} y2={plot.top + plotHeight + 8} />}
        <g className="profile-axis-labels">
          <text x={plot.left} y={plot.top - 8}>{yMaximum.toFixed(1)} m</text>
          <text x={plot.left} y={plot.top + plotHeight + 15}>{yMinimum.toFixed(1)} m</text>
          <text x={plot.left} y={height - 2}>0 m</text>
          <text x={plot.left + plotWidth} y={height - 2} textAnchor="end">{maximumDistance.toFixed(1)} m</text>
        </g>
      </svg>
    </div>
    {onFocus && <p className="profile-hint">測点や管路をクリックすると、その地点の時系列・平面図・圧力包絡が連動して切り替わります。</p>}
    <div className="profile-series-legend" aria-label="縦断図の凡例">
      {visibleSeries.map(({ key, label, className }) => <span key={key}><i className={className} />{label}</span>)}
      <span><i className="profile-legend-invalid" />欠損・不整合</span>
    </div>
    {diagram.resultRunIds.length > 0 && <p className="profile-result-source">重ね合わせ元の保存済み計算記録：{diagram.resultRunIds.join(' / ')}</p>}
    {diagram.issues.length > 0 && <ul className="profile-issue-list">{diagram.issues.map((issue, index) => <li key={`${issue.code}-${issue.pointId}-${index}`}><button type="button" onClick={() => { const point = diagram.points.find(({ id }) => id === issue.pointId); if (point) onFocus?.(focusForPoint(point)) }}>{issue.message}</button></li>)}</ul>}
  </div>
}
