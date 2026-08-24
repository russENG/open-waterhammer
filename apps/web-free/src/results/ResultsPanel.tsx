import { useRef } from 'react'
import type { Run } from '@open-waterhammer/contracts'

import { downloadCsv } from '../utils/csv'
import { downloadPng, downloadSvg } from '../utils/svgExport'
import { createLinkedFocus, type LinkedFocus } from '../workspace/focus'
import { deriveRunVisuals, type PlotLine } from './run-visuals'

type Series = { id: string; seconds: number[]; values: number[] }
type SvgRef = { readonly current: SVGSVGElement | null }
type CsvRow = (string | number)[]

function chartPath(x: number[], y: number[], width: number, height: number): string {
  if (!x.length || !y.length) return ''
  const xMin = Math.min(...x)
  const xRange = Math.max(Math.max(...x) - xMin, 0.001)
  const yMin = Math.min(...y)
  const yRange = Math.max(Math.max(...y) - yMin, 0.001)
  return y.map((value, index) => {
    const px = ((x[index] ?? index) - xMin) / xRange * width
    const py = height - (value - yMin) / yRange * height
    return `${index ? 'L' : 'M'} ${px} ${py}`
  }).join(' ')
}

function extent(values: number[]): [number, number] | undefined {
  return values.length ? [Math.min(...values), Math.max(...values)] : undefined
}

function fmt(value: number, digits: number): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '—'
}

function envelopeRows(envelope: PlotLine): CsvRow[] {
  return [
    ['distance', 'H_steady', 'Hmax', 'Hmin'],
    ...envelope.distance.map((distance, index): CsvRow => [
      distance, envelope.steady[index] ?? '', envelope.maximum[index] ?? '', envelope.minimum[index] ?? '',
    ]),
  ]
}

function seriesRows(series: Series, valueHeader: string): CsvRow[] {
  return [['t', valueHeader], ...series.seconds.map((t, index): CsvRow => [t, series.values[index] ?? ''])]
}

/** 各チャートの最小限の軸目盛（最小・最大値、単位付き）。チャート内の translate 済み座標系に合わせて配置する。 */
function AxisTicks({ xRange, yRange, width, height, xUnit, yUnit, xDigits = 0, yDigits = 1 }: {
  xRange?: [number, number]
  yRange?: [number, number]
  width: number
  height: number
  xUnit: string
  yUnit: string
  xDigits?: number
  yDigits?: number
}) {
  const tickStyle = { font: '8px var(--mono, monospace)', fill: 'currentColor', opacity: 0.65 }
  return <g className="chart-axis-ticks">
    {yRange && <text x={2} y={-6} style={tickStyle}>{fmt(yRange[1], yDigits)} {yUnit}</text>}
    {yRange && <text x={2} y={height - 3} style={tickStyle}>{fmt(yRange[0], yDigits)} {yUnit}</text>}
    {xRange && <text x={0} y={height + 12} style={tickStyle}>{fmt(xRange[0], xDigits)} {xUnit}</text>}
    {xRange && <text x={width} y={height + 12} textAnchor="end" style={tickStyle}>{fmt(xRange[1], xDigits)} {xUnit}</text>}
  </g>
}

function ChartLegend({ items }: { items: Array<{ label: string; className?: string }> }) {
  return <div className="envelope-legend chart-legend">{items.map((item) => <span key={item.label}><i className={item.className} />{item.label}</span>)}</div>
}

/** CSV / SVG / PNG エクスポートボタン。SVG・PNG は与えられた svgRef の実要素から出力する（永続化済み Run 由来の描画のみを対象）。 */
function ChartActions({ svgRef, filenameBase, rows }: { svgRef: SvgRef; filenameBase: string; rows: CsvRow[] }) {
  return <div className="chart-actions" style={{ display: 'flex', gap: 6, marginTop: 8 }}>
    <button type="button" className="export-button" onClick={() => downloadCsv(`${filenameBase}.csv`, rows)}>CSV</button>
    <button type="button" className="export-button" onClick={() => { if (svgRef.current) downloadSvg(svgRef.current, `${filenameBase}.svg`) }}>SVG</button>
    <button type="button" className="export-button" onClick={() => { if (svgRef.current) void downloadPng(svgRef.current, `${filenameBase}.png`) }}>PNG</button>
  </div>
}

export function ResultsPanel({ runs, selectedRun, focus, onSelectRun, onFocus }: { runs: Run[]; selectedRun?: Run; focus?: LinkedFocus; onSelectRun(run: Run): void; onFocus(focus: LinkedFocus): void }) {
  const timeSeriesSvgRef = useRef<SVGSVGElement>(null)
  const envelopeSvgRef = useRef<SVGSVGElement>(null)
  const profileSvgRef = useRef<SVGSVGElement>(null)
  const speedSvgRef = useRef<SVGSVGElement>(null)

  const run = selectedRun ?? runs.at(-1)
  const visuals = run ? deriveRunVisuals(run, focus) : undefined
  const timeSeries = visuals?.timeSeries
  const speedSeries = visuals?.speedSeries
  const timePath = timeSeries ? chartPath(timeSeries.seconds, timeSeries.values, 600, 180) : ''
  const speedPath = speedSeries ? chartPath(speedSeries.seconds, speedSeries.values, 600, 180) : ''
  const timeXRange = timeSeries ? extent(timeSeries.seconds) : undefined
  const timeYRange = timeSeries ? extent(timeSeries.values) : undefined
  const speedXRange = speedSeries ? extent(speedSeries.seconds) : undefined
  const speedYRange = speedSeries ? extent(speedSeries.values) : undefined
  const envelope = visuals?.envelope
  const envelopeMaximum = envelope ? chartPath(envelope.distance, envelope.maximum, 340, 140) : ''
  const envelopeMinimum = envelope ? chartPath(envelope.distance, envelope.minimum, 340, 140) : ''
  const envelopeSteady = envelope ? chartPath(envelope.distance, envelope.steady, 340, 140) : ''
  const envelopeXRange = envelope ? extent(envelope.distance) : undefined
  const envelopeYRange = envelope ? extent([...envelope.maximum, ...envelope.minimum, ...envelope.steady]) : undefined
  const profileYRange = envelope ? extent(envelope.steady) : undefined
  return <div className="panel-stack results-panel">
    <div className="panel-title-row"><div><span className="eyebrow">RUN EVIDENCE / 05</span><h1>Results</h1><p>summary、圧力包絡、縦断、時系列を同じ永続化済み Run 証跡から描画します。</p></div>{run && <select className="run-selector" value={run.id} onChange={(event) => { const found = runs.find(({ id }) => id === event.target.value); if (found) onSelectRun(found) }}>{[...runs].reverse().map((item) => <option value={item.id} key={item.id}>{item.kind} · {item.status}</option>)}</select>}</div>
    {!run ? <div className="comparison-empty"><span>R—00</span><p>Analysis で計算を実行してください。</p></div> : <>
      <div className="result-summary-strip"><article><span>STATUS</span><strong>{run.status}</strong></article><article><span>ASSESSMENT</span><strong>{run.assessment.status}</strong></article>{visuals!.summaryMetrics.slice(0, 2).map((metric) => <article key={metric.path}><span>{metric.path}</span><strong>{metric.value.toPrecision(5)}</strong></article>)}</div>
      <div className="result-visual-grid">
        <section className="notebook-card chart-card chart-card--wide">
          <div className="chart-heading"><div><span className="eyebrow">TIME SERIES</span><h2>Persisted trace</h2></div><span>{timeSeries?.id ?? 'no time series'}</span></div>
          {timePath && timeSeries ? <>
            <svg ref={timeSeriesSvgRef} viewBox="0 0 640 220" role="img" aria-label={`Time series for ${timeSeries.id}`}>
              <defs><pattern id="graph-paper" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="currentColor" strokeOpacity=".12" /></pattern></defs>
              <rect width="640" height="220" fill="url(#graph-paper)" />
              <g transform="translate(20 20)">
                <path d={timePath} fill="none" stroke="currentColor" strokeWidth="3" vectorEffect="non-scaling-stroke" />
                <AxisTicks xRange={timeXRange} yRange={timeYRange} width={600} height={180} xUnit="s" yUnit="m" xDigits={2} yDigits={1} />
              </g>
            </svg>
            <ChartLegend items={[{ label: `${timeSeries.id} · H` }]} />
            <ChartActions svgRef={timeSeriesSvgRef} filenameBase={`time-series-${timeSeries.id}`} rows={seriesRows(timeSeries, 'H')} />
          </> : <div className="empty-ledger"><span>∿</span><p>この Run に時系列はありません。</p></div>}
        </section>
        <section className="notebook-card envelope-card">
          <div className="chart-heading"><div><span className="eyebrow">ENVELOPE</span><h2>Persisted pressure bounds</h2></div><span>{envelope?.id ?? 'not recorded'}</span></div>
          {envelope ? <div className="envelope-sketch">
            <svg ref={envelopeSvgRef} viewBox="0 0 360 180" role="img" aria-label={`Pressure envelope for ${envelope.id}`}>
              <path className="ground-line" d={envelopeSteady} transform="translate(10 20)" />
              <path className="envelope-max" d={envelopeMaximum} transform="translate(10 20)" />
              <path className="envelope-min" d={envelopeMinimum} transform="translate(10 20)" />
              {visuals?.profileCursorRatio !== undefined && <line x1={10 + visuals.profileCursorRatio * 340} x2={10 + visuals.profileCursorRatio * 340} y1="5" y2="165" className="linked-chart-cursor" />}
              <g transform="translate(10 20)"><AxisTicks xRange={envelopeXRange} yRange={envelopeYRange} width={340} height={140} xUnit="m" yUnit="m" xDigits={0} yDigits={1} /></g>
            </svg>
            <ChartLegend items={[{ label: 'H steady' }, { label: 'H max', className: 'legend-max' }, { label: 'H min', className: 'legend-min' }]} />
            <ChartActions svgRef={envelopeSvgRef} filenameBase={`envelope-${envelope.id}`} rows={envelopeRows(envelope)} />
          </div> : <div className="empty-ledger"><span>—</span><p>包絡線は記録されていません。</p></div>}
        </section>
        <section className="notebook-card findings-card"><div className="chart-heading"><div><span className="eyebrow">ASSESSMENT</span><h2>Linked findings</h2></div><span>{run.assessment.findings.length}</span></div>{run.assessment.findings.length ? <ol>{run.assessment.findings.map((finding) => <li key={`${finding.ruleId}-${finding.targetRef}`}><button aria-pressed={focus?.targetRef === finding.targetRef} onClick={() => onFocus(createLinkedFocus(finding))}><span className="ng-marker">NG</span><div><strong>{finding.targetRef} · {finding.location ?? 'location unknown'}</strong><small>{finding.ruleId} / {String(finding.observedValue)} &gt; {String(finding.threshold)} {finding.unit}</small></div><span>SYNC ↗</span></button></li>)}</ol> : <div className="empty-ledger"><span>✓</span><p>finding はありません。</p></div>}</section>
        <section className="notebook-card profile-card">
          <div className="chart-heading"><div><span className="eyebrow">LONGITUDINAL</span><h2>Persisted profile</h2></div><span>{focus?.profileCursor ?? envelope?.id ?? 'not recorded'}</span></div>
          {envelope ? <div className="profile-plot">
            <svg ref={profileSvgRef} viewBox="0 0 360 150" role="img" aria-label={`Longitudinal profile for ${envelope.id}`}>
              <path d={envelopeSteady} transform="translate(10 5)" className="ground-line" />
              {visuals?.profileCursorRatio !== undefined && <line x1={10 + visuals.profileCursorRatio * 340} x2={10 + visuals.profileCursorRatio * 340} y1="5" y2="145" className="linked-chart-cursor profile-cursor-line" />}
              <g transform="translate(10 5)"><AxisTicks xRange={envelopeXRange} yRange={profileYRange} width={340} height={140} xUnit="m" yUnit="m" xDigits={0} yDigits={1} /></g>
            </svg>
            <div className="profile-ruler"><span>0</span><span>{envelope.distance.at(-1)?.toFixed(0)} m</span></div>
            <ChartLegend items={[{ label: 'H steady' }]} />
            <ChartActions svgRef={profileSvgRef} filenameBase={`profile-${envelope.id}`} rows={envelopeRows(envelope)} />
          </div> : <div className="empty-ledger"><span>—</span><p>縦断データは記録されていません。</p></div>}
        </section>
        {speedSeries && <section className="notebook-card chart-card speed-card">
          <div className="chart-heading"><div><span className="eyebrow">PUMP SPEED</span><h2>Persisted rotational speed</h2></div><span>{speedSeries.id}</span></div>
          <svg ref={speedSvgRef} viewBox="0 0 640 220" role="img" aria-label={`Pump speed for ${speedSeries.id}`}>
            <defs><pattern id="graph-paper-speed" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="currentColor" strokeOpacity=".12" /></pattern></defs>
            <rect width="640" height="220" fill="url(#graph-paper-speed)" />
            <g transform="translate(20 20)">
              <path d={speedPath} fill="none" stroke="currentColor" strokeWidth="3" vectorEffect="non-scaling-stroke" />
              <AxisTicks xRange={speedXRange} yRange={speedYRange} width={600} height={180} xUnit="s" yUnit="min⁻¹" xDigits={2} yDigits={0} />
            </g>
          </svg>
          <ChartLegend items={[{ label: `${speedSeries.id} · N` }]} />
          <ChartActions svgRef={speedSvgRef} filenameBase={`pump-speed-${speedSeries.id}`} rows={seriesRows(speedSeries, 'N')} />
        </section>}
      </div>
    </>}
  </div>
}
