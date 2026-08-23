import type { Run } from '@open-waterhammer/contracts'
import { useState } from 'react'

function pairs(value: unknown): Array<[string, string]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.entries(value).slice(0, 8).map(([key, child]) => [key, typeof child === 'object' ? JSON.stringify(child) : String(child)])
}

function numericDifferences(run: Run, baseline: Run): Array<[string, string]> {
  if (!run.summary || typeof run.summary !== 'object' || Array.isArray(run.summary)) return []
  if (!baseline.summary || typeof baseline.summary !== 'object' || Array.isArray(baseline.summary)) return []
  return Object.entries(run.summary).flatMap(([key, value]) => {
    const previous = baseline.summary && typeof baseline.summary === 'object' && !Array.isArray(baseline.summary)
      ? baseline.summary[key] : undefined
    if (typeof value !== 'number' || typeof previous !== 'number') return []
    const delta = value - previous
    return [[key, `${delta >= 0 ? '+' : ''}${delta.toPrecision(4)}`]]
  })
}

export function RunInspector({ run, baseline }: { run?: Run; baseline?: Run }) {
  const [collapsed, setCollapsed] = useState(false)
  const differences = run && baseline ? numericDifferences(run, baseline) : []
  return (
    <aside className={`run-inspector${collapsed ? ' run-inspector--collapsed' : ''}`} aria-label="Run Inspector">
      <div className="inspector-heading">
        <div><span className="eyebrow">EVIDENCE</span><h2>Run Inspector</h2></div>
        <button className="icon-button" onClick={() => setCollapsed((value) => !value)} aria-expanded={!collapsed} aria-label={collapsed ? 'Expand Run Inspector' : 'Collapse Run Inspector'}>
          {collapsed ? '‹' : '›'}
        </button>
      </div>
      {!collapsed && (run ? (
        <div className="inspector-scroll">
          <div className={`status-stamp status-stamp--${run.status}`}>{run.status}</div>
          <dl className="manifest-grid">
            <dt>Run</dt><dd>{run.id.slice(0, 13)}…</dd>
            <dt>Method</dt><dd>{run.kind}</dd>
            <dt>Engine</dt><dd>{run.manifest.engine}</dd>
            <dt>Runtime</dt><dd>{run.manifest.runtime}</dd>
            <dt>Rules</dt><dd>{run.manifest.rulesVersion}</dd>
          </dl>
          <section className="inspector-section">
            <h3>Assessment</h3>
            <p className={`assessment assessment--${run.assessment.status}`}>{run.assessment.status.replace('_', ' ')}</p>
            {run.assessment.findings.map((finding) => <div className="finding-card" key={`${finding.ruleId}-${finding.targetRef}`}><strong>{finding.targetRef}</strong><span>{finding.ruleId}</span><small>{String(finding.observedValue)} / {String(finding.threshold)} {finding.unit}</small></div>)}
          </section>
          <section className="inspector-section"><h3>Warnings</h3>{run.manifest.warnings.length ? run.manifest.warnings.map((warning) => <p className="warning-line" key={warning}>{warning}</p>) : <p className="muted">No warnings recorded.</p>}</section>
          <section className="inspector-section"><h3>Provenance</h3><code className="hash-code">{run.manifest.inputHashes.calculation}</code></section>
          <section className="inspector-section"><h3>Summary fields</h3><dl className="manifest-grid">{pairs(run.summary).map(([key, value]) => <span className="manifest-pair" key={key}><dt>{key}</dt><dd>{value}</dd></span>)}</dl></section>
          <section className="inspector-section"><h3>Differences</h3>{baseline ? <><p className="muted">vs. {baseline.kind} · {baseline.id.slice(0, 8)}</p><dl className="manifest-grid"><dt>Input snapshot</dt><dd>{baseline.manifest.inputHashes.calculation === run.manifest.inputHashes.calculation ? 'same' : 'changed'}</dd>{differences.map(([key, value]) => <span className="manifest-pair" key={key}><dt>{key}</dt><dd>{value}</dd></span>)}</dl>{!differences.length && <p className="muted">No shared numeric summary delta.</p>}</> : <p className="muted">No earlier Run in this Case.</p>}</section>
        </div>
      ) : <div className="inspector-empty"><span>R—00</span><p>Run を選択すると manifest、評価、警告、provenance を固定表示します。</p><section className="inspector-section"><h3>Differences</h3><p className="muted">比較する Run はまだありません。</p></section></div>)}
    </aside>
  )
}
