import type { Run } from '@open-waterhammer/contracts'

import { createLinkedFocus, type LinkedFocus } from '../workspace/focus'

function numbers(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === 'number') : []
}

function series(run?: Run) {
  const value = run?.timeSeries
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { seconds: [], pressure: [] }
  return { seconds: numbers(value.seconds), pressure: numbers(value.pressureMpa) }
}

function chartPath(values: number[], width: number, height: number): string {
  if (!values.length) return ''
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const range = Math.max(maximum - minimum, 0.001)
  return values.map((value, index) => `${index ? 'L' : 'M'} ${(index / Math.max(values.length - 1, 1)) * width} ${height - ((value - minimum) / range) * height}`).join(' ')
}

export function ResultsPanel({ runs, selectedRun, focus, onSelectRun, onFocus }: { runs: Run[]; selectedRun?: Run; focus?: LinkedFocus; onSelectRun(run: Run): void; onFocus(focus: LinkedFocus): void }) {
  const run = selectedRun ?? runs.at(-1)
  const data = series(run)
  const path = chartPath(data.pressure, 600, 180)
  return <div className="panel-stack results-panel">
    <div className="panel-title-row"><div><span className="eyebrow">RUN EVIDENCE / 05</span><h1>Results</h1><p>summary、圧力包絡、縦断、時系列を同じ Run 証跡で読み解きます。</p></div>{run && <select className="run-selector" value={run.id} onChange={(event) => { const found = runs.find(({ id }) => id === event.target.value); if (found) onSelectRun(found) }}>{[...runs].reverse().map((item) => <option value={item.id} key={item.id}>{item.kind} · {item.status}</option>)}</select>}</div>
    {!run ? <div className="comparison-empty"><span>R—00</span><p>Analysis で計算を実行してください。</p></div> : <>
      <div className="result-summary-strip"><article><span>STATUS</span><strong>{run.status}</strong></article><article><span>ASSESSMENT</span><strong>{run.assessment.status}</strong></article><article><span>WARNINGS</span><strong>{run.manifest.warnings.length}</strong></article><article><span>METHOD</span><strong>{run.kind}</strong></article></div>
      <div className="result-visual-grid">
        <section className="notebook-card chart-card chart-card--wide"><div className="chart-heading"><div><span className="eyebrow">TIME SERIES</span><h2>Pressure trace</h2></div><span>{focus?.timeSeriesId ?? 'all elements'}</span></div><svg viewBox="0 0 640 220" role="img" aria-label="Pressure time series"><defs><pattern id="graph-paper" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="currentColor" strokeOpacity=".12" /></pattern></defs><rect width="640" height="220" fill="url(#graph-paper)" /><path d={path ? `${path}` : 'M0 160 L640 160'} transform="translate(20 20)" fill="none" stroke="currentColor" strokeWidth="3" vectorEffect="non-scaling-stroke" /><line x1="20" x2="620" y1="75" y2="75" className="threshold-line" /></svg></section>
        <section className="notebook-card envelope-card"><div className="chart-heading"><div><span className="eyebrow">ENVELOPE</span><h2>Pressure bounds</h2></div><span>{focus?.envelopeSeriesId ?? 'P—01'}</span></div><div className="envelope-sketch"><svg viewBox="0 0 360 180" role="img" aria-label="Pressure envelope"><path className="ground-line" d="M0 110 C80 70 130 130 210 85 S320 55 360 72" /><path className="envelope-max" d="M0 70 C90 30 130 95 210 44 S320 16 360 28" /><path className="envelope-min" d="M0 145 C80 112 140 158 220 123 S315 98 360 110" /><line x1="0" y1="110" x2="360" y2="110" /></svg><div className="envelope-legend"><span><i className="legend-max" />H max</span><span><i className="legend-min" />H min</span></div></div></section>
        <section className="notebook-card findings-card"><div className="chart-heading"><div><span className="eyebrow">ASSESSMENT</span><h2>Linked findings</h2></div><span>{run.assessment.findings.length}</span></div>{run.assessment.findings.length ? <ol>{run.assessment.findings.map((finding) => <li key={`${finding.ruleId}-${finding.targetRef}`}><button onClick={() => onFocus(createLinkedFocus(finding))}><span className="ng-marker">NG</span><div><strong>{finding.targetRef} · {finding.location ?? 'location unknown'}</strong><small>{finding.ruleId} / {String(finding.observedValue)} &gt; {String(finding.threshold)} {finding.unit}</small></div><span>SYNC ↗</span></button></li>)}</ol> : <div className="empty-ledger"><span>✓</span><p>finding はありません。</p></div>}</section>
        <section className="notebook-card profile-card"><div className="chart-heading"><div><span className="eyebrow">LONGITUDINAL</span><h2>Focused location</h2></div><span>{focus?.profileCursor ?? 'full alignment'}</span></div><div className="profile-ruler"><span>0+000</span><i className={focus ? 'profile-cursor profile-cursor--active' : 'profile-cursor'} /><span>0+500</span></div></section>
      </div>
    </>}
  </div>
}
