import type { Run } from '@open-waterhammer/contracts'

import { createLinkedFocus, type LinkedFocus } from '../workspace/focus'
import { deriveRunVisuals } from './run-visuals'

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

export function ResultsPanel({ runs, selectedRun, focus, onSelectRun, onFocus }: { runs: Run[]; selectedRun?: Run; focus?: LinkedFocus; onSelectRun(run: Run): void; onFocus(focus: LinkedFocus): void }) {
  const run = selectedRun ?? runs.at(-1)
  const visuals = run ? deriveRunVisuals(run, focus) : undefined
  const timePath = visuals?.timeSeries ? chartPath(visuals.timeSeries.seconds, visuals.timeSeries.values, 600, 180) : ''
  const envelope = visuals?.envelope
  const envelopeMaximum = envelope ? chartPath(envelope.distance, envelope.maximum, 340, 140) : ''
  const envelopeMinimum = envelope ? chartPath(envelope.distance, envelope.minimum, 340, 140) : ''
  const envelopeSteady = envelope ? chartPath(envelope.distance, envelope.steady, 340, 140) : ''
  return <div className="panel-stack results-panel">
    <div className="panel-title-row"><div><span className="eyebrow">RUN EVIDENCE / 05</span><h1>Results</h1><p>summary、圧力包絡、縦断、時系列を同じ永続化済み Run 証跡から描画します。</p></div>{run && <select className="run-selector" value={run.id} onChange={(event) => { const found = runs.find(({ id }) => id === event.target.value); if (found) onSelectRun(found) }}>{[...runs].reverse().map((item) => <option value={item.id} key={item.id}>{item.kind} · {item.status}</option>)}</select>}</div>
    {!run ? <div className="comparison-empty"><span>R—00</span><p>Analysis で計算を実行してください。</p></div> : <>
      <div className="result-summary-strip"><article><span>STATUS</span><strong>{run.status}</strong></article><article><span>ASSESSMENT</span><strong>{run.assessment.status}</strong></article>{visuals!.summaryMetrics.slice(0, 2).map((metric) => <article key={metric.path}><span>{metric.path}</span><strong>{metric.value.toPrecision(5)}</strong></article>)}</div>
      <div className="result-visual-grid">
        <section className="notebook-card chart-card chart-card--wide"><div className="chart-heading"><div><span className="eyebrow">TIME SERIES</span><h2>Persisted trace</h2></div><span>{visuals?.timeSeries?.id ?? 'no time series'}</span></div>{timePath ? <svg viewBox="0 0 640 220" role="img" aria-label={`Time series for ${visuals!.timeSeries!.id}`}><defs><pattern id="graph-paper" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="currentColor" strokeOpacity=".12" /></pattern></defs><rect width="640" height="220" fill="url(#graph-paper)" /><path d={timePath} transform="translate(20 20)" fill="none" stroke="currentColor" strokeWidth="3" vectorEffect="non-scaling-stroke" /></svg> : <div className="empty-ledger"><span>∿</span><p>この Run に時系列はありません。</p></div>}</section>
        <section className="notebook-card envelope-card"><div className="chart-heading"><div><span className="eyebrow">ENVELOPE</span><h2>Persisted pressure bounds</h2></div><span>{envelope?.id ?? 'not recorded'}</span></div>{envelope ? <div className="envelope-sketch"><svg viewBox="0 0 360 180" role="img" aria-label={`Pressure envelope for ${envelope.id}`}><path className="ground-line" d={envelopeSteady} transform="translate(10 20)" /><path className="envelope-max" d={envelopeMaximum} transform="translate(10 20)" /><path className="envelope-min" d={envelopeMinimum} transform="translate(10 20)" />{visuals?.profileCursorRatio !== undefined && <line x1={10 + visuals.profileCursorRatio * 340} x2={10 + visuals.profileCursorRatio * 340} y1="5" y2="165" className="linked-chart-cursor" />}</svg><div className="envelope-legend"><span><i className="legend-max" />H max</span><span><i className="legend-min" />H min</span></div></div> : <div className="empty-ledger"><span>—</span><p>包絡線は記録されていません。</p></div>}</section>
        <section className="notebook-card findings-card"><div className="chart-heading"><div><span className="eyebrow">ASSESSMENT</span><h2>Linked findings</h2></div><span>{run.assessment.findings.length}</span></div>{run.assessment.findings.length ? <ol>{run.assessment.findings.map((finding) => <li key={`${finding.ruleId}-${finding.targetRef}`}><button aria-pressed={focus?.targetRef === finding.targetRef} onClick={() => onFocus(createLinkedFocus(finding))}><span className="ng-marker">NG</span><div><strong>{finding.targetRef} · {finding.location ?? 'location unknown'}</strong><small>{finding.ruleId} / {String(finding.observedValue)} &gt; {String(finding.threshold)} {finding.unit}</small></div><span>SYNC ↗</span></button></li>)}</ol> : <div className="empty-ledger"><span>✓</span><p>finding はありません。</p></div>}</section>
        <section className="notebook-card profile-card"><div className="chart-heading"><div><span className="eyebrow">LONGITUDINAL</span><h2>Persisted profile</h2></div><span>{focus?.profileCursor ?? envelope?.id ?? 'not recorded'}</span></div>{envelope ? <div className="profile-plot"><svg viewBox="0 0 360 150" role="img" aria-label={`Longitudinal profile for ${envelope.id}`}><path d={envelopeSteady} transform="translate(10 5)" className="ground-line" />{visuals?.profileCursorRatio !== undefined && <line x1={10 + visuals.profileCursorRatio * 340} x2={10 + visuals.profileCursorRatio * 340} y1="5" y2="145" className="linked-chart-cursor profile-cursor-line" />}</svg><div className="profile-ruler"><span>0</span><span>{envelope.distance.at(-1)?.toFixed(0)} m</span></div></div> : <div className="empty-ledger"><span>—</span><p>縦断データは記録されていません。</p></div>}</section>
      </div>
    </>}
  </div>
}
