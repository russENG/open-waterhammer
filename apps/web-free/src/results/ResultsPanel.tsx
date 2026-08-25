import { useRef } from 'react'
import type { Case, Run } from '@open-waterhammer/contracts'

import { downloadCsv } from '../utils/csv'
import { downloadPng, downloadSvg } from '../utils/svgExport'
import { createLinkedFocus, type LinkedFocus } from '../workspace/focus'
import { deriveLongitudinalProfile } from '../workspace/longitudinal-profile'
import { LongitudinalProfile } from '../workspace/LongitudinalProfile'
import { assessmentStatusLabel, runKindLabel, runStatusLabel } from '../workspace/run-display-labels'
import { PressureWaveAnimator } from './PressureWaveAnimator'
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

export function ResultsPanel({ caseRecord, runs, selectedRun, focus, onSelectRun, onFocus }: { caseRecord: Case; runs: Run[]; selectedRun?: Run; focus?: LinkedFocus; onSelectRun(run: Run): void; onFocus(focus: LinkedFocus): void }) {
  const timeSeriesSvgRef = useRef<SVGSVGElement>(null)
  const envelopeSvgRef = useRef<SVGSVGElement>(null)
  const speedSvgRef = useRef<SVGSVGElement>(null)

  const run = selectedRun ?? runs.at(-1)
  const longitudinalProfile = deriveLongitudinalProfile(caseRecord, runs, run?.id)
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
  return <div className="panel-stack results-panel">
    <div className="panel-title-row"><div><span className="eyebrow">計算証跡 / 05</span><h1>結果</h1><p>要約、圧力包絡、縦断、時系列を同じ保存済み計算結果から描画します。</p></div>{run && <select className="run-selector" aria-label="表示する計算結果" value={run.id} onChange={(event) => { const found = runs.find(({ id }) => id === event.target.value); if (found) onSelectRun(found) }}>{[...runs].reverse().map((item) => <option value={item.id} key={item.id}>{runKindLabel(item.kind)} · {runStatusLabel(item.status)}</option>)}</select>}</div>
    {!run ? <div className="comparison-empty"><span>R—00</span><p>解析で計算を実行してください。</p></div> : <>
      <div className="result-summary-strip"><article><span>計算状態</span><strong>{runStatusLabel(run.status)}</strong></article><article><span>評価</span><strong>{assessmentStatusLabel(run.assessment.status)}</strong></article>{visuals!.summaryMetrics.slice(0, 2).map((metric) => <article key={metric.path}><span>{metric.path}</span><strong>{metric.value.toPrecision(5)}</strong></article>)}</div>
      <div className="result-visual-grid">
        {run.kind.startsWith('transient_') && <PressureWaveAnimator key={run.id} caseRecord={caseRecord} run={run} focus={focus} onFocus={onFocus} />}
        <section className="notebook-card chart-card chart-card--wide">
          <div className="chart-heading"><div><span className="eyebrow">時系列</span><h2>保存済みの時系列</h2></div><span>{timeSeries?.id ?? '記録なし'}</span></div>
          {timePath && timeSeries ? <>
            <svg ref={timeSeriesSvgRef} viewBox="0 0 640 220" role="img" aria-label={`${timeSeries.id}の時系列`}>
              <defs><pattern id="graph-paper" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="currentColor" strokeOpacity=".12" /></pattern></defs>
              <rect width="640" height="220" fill="url(#graph-paper)" />
              <g transform="translate(20 20)">
                <path d={timePath} fill="none" stroke="currentColor" strokeWidth="3" vectorEffect="non-scaling-stroke" />
                <AxisTicks xRange={timeXRange} yRange={timeYRange} width={600} height={180} xUnit="s" yUnit="m" xDigits={2} yDigits={1} />
              </g>
            </svg>
            <ChartLegend items={[{ label: `${timeSeries.id} · H` }]} />
            <ChartActions svgRef={timeSeriesSvgRef} filenameBase={`time-series-${timeSeries.id}`} rows={seriesRows(timeSeries, 'H')} />
          </> : <div className="empty-ledger"><span>∿</span><p>この計算結果に時系列はありません。</p></div>}
        </section>
        <section className="notebook-card envelope-card">
          <div className="chart-heading"><div><span className="eyebrow">圧力包絡</span><h2>保存済みの最大・最小水頭</h2></div><span>{envelope?.id ?? '記録なし'}</span></div>
          {envelope ? <div className="envelope-sketch">
            <svg ref={envelopeSvgRef} viewBox="0 0 360 180" role="img" aria-label={`${envelope.id}の圧力包絡`}>
              <path className="ground-line" d={envelopeSteady} transform="translate(10 20)" />
              <path className="envelope-max" d={envelopeMaximum} transform="translate(10 20)" />
              <path className="envelope-min" d={envelopeMinimum} transform="translate(10 20)" />
              {visuals?.profileCursorRatio !== undefined && <line x1={10 + visuals.profileCursorRatio * 340} x2={10 + visuals.profileCursorRatio * 340} y1="5" y2="165" className="linked-chart-cursor" />}
              <g transform="translate(10 20)"><AxisTicks xRange={envelopeXRange} yRange={envelopeYRange} width={340} height={140} xUnit="m" yUnit="m" xDigits={0} yDigits={1} /></g>
            </svg>
            <ChartLegend items={[{ label: '定常水頭 H' }, { label: '最大水頭 H', className: 'legend-max' }, { label: '最小水頭 H', className: 'legend-min' }]} />
            <ChartActions svgRef={envelopeSvgRef} filenameBase={`envelope-${envelope.id}`} rows={envelopeRows(envelope)} />
          </div> : <div className="empty-ledger"><span>—</span><p>包絡線は記録されていません。</p></div>}
        </section>
        <section className="notebook-card findings-card"><div className="chart-heading"><div><span className="eyebrow">評価</span><h2>関連する指摘事項</h2></div><span>{run.assessment.findings.length}</span></div>{run.assessment.findings.length ? <ol>{run.assessment.findings.map((finding) => <li key={`${finding.ruleId}-${finding.targetRef}`}><button aria-pressed={focus?.targetRef === finding.targetRef} onClick={() => onFocus(createLinkedFocus(finding))}><span className="ng-marker">NG</span><div><strong>{finding.targetRef} · {finding.location ?? '位置情報なし'}</strong><small>{finding.ruleId} / {String(finding.observedValue)} &gt; {String(finding.threshold)} {finding.unit}</small></div><span>連動 ↗</span></button></li>)}</ol> : <div className="empty-ledger"><span>✓</span><p>指摘事項はありません。</p></div>}</section>
        <section className="notebook-card profile-card">
          <div className="chart-heading"><div><span className="eyebrow">縦断</span><h2>入力と計算結果の縦断図</h2></div><span>{focus?.profileCursor ?? '測点未選択'}</span></div>
          <LongitudinalProfile diagram={longitudinalProfile} mode="result" focus={focus} onFocus={onFocus} />
        </section>
        {speedSeries && <section className="notebook-card chart-card speed-card">
          <div className="chart-heading"><div><span className="eyebrow">ポンプ回転速度</span><h2>保存済みの回転速度</h2></div><span>{speedSeries.id}</span></div>
          <svg ref={speedSvgRef} viewBox="0 0 640 220" role="img" aria-label={`${speedSeries.id}のポンプ回転速度`}>
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
