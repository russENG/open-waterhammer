import type { JsonValue, Run } from '@open-waterhammer/contracts'
import { useState } from 'react'

import { flattenComparisonValue } from './comparison'

const ROW_LIMIT = 24

interface RowSet {
  rows: Array<[string, string]>
  overflow: number
}

function capRows(entries: Array<[string, string]>): RowSet {
  return { rows: entries.slice(0, ROW_LIMIT), overflow: Math.max(0, entries.length - ROW_LIMIT) }
}

/** run.summary の全リーフを「path → 値の文字列」に再帰的に平坦化する（nested な数値も個別の行になる）。 */
function pairs(value: JsonValue): RowSet {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return capRows([])
  return capRows(flattenComparisonValue(value).map(([path, child]): [string, string] => [path, String(child)]))
}

/** run と baseline の summary を再帰的に平坦化して比較し、両者に存在する数値パスの差分だけを残す。 */
function numericDifferences(run: Run, baseline: Run): RowSet {
  if (!run.summary || typeof run.summary !== 'object' || Array.isArray(run.summary)) return capRows([])
  if (!baseline.summary || typeof baseline.summary !== 'object' || Array.isArray(baseline.summary)) return capRows([])
  const previousByPath = new Map(flattenComparisonValue(baseline.summary))
  const deltas = flattenComparisonValue(run.summary).flatMap(([path, value]): Array<[string, string]> => {
    const previous = previousByPath.get(path)
    if (typeof value !== 'number' || typeof previous !== 'number') return []
    const delta = value - previous
    return [[path, `${delta >= 0 ? '+' : ''}${delta.toPrecision(4)}`]]
  })
  return capRows(deltas)
}

export function RunInspector({ run, baseline }: { run?: Run; baseline?: Run }) {
  const [collapsed, setCollapsed] = useState(false)
  const differences = run && baseline ? numericDifferences(run, baseline) : capRows([])
  const summaryFields = run ? pairs(run.summary) : capRows([])
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
          <section className="inspector-section"><h3>Summary fields</h3><dl className="manifest-grid">{summaryFields.rows.map(([key, value]) => <span className="manifest-pair" key={key}><dt>{key}</dt><dd>{value}</dd></span>)}</dl>{summaryFields.overflow > 0 && <p className="muted">他 {summaryFields.overflow} 件</p>}</section>
          <section className="inspector-section"><h3>Differences</h3>{baseline ? <><p className="muted">vs. {baseline.kind} · {baseline.id.slice(0, 8)}</p><dl className="manifest-grid"><dt>Input snapshot</dt><dd>{baseline.manifest.inputHashes.calculation === run.manifest.inputHashes.calculation ? 'same' : 'changed'}</dd>{differences.rows.map(([key, value]) => <span className="manifest-pair" key={key}><dt>{key}</dt><dd>{value}</dd></span>)}</dl>{differences.overflow > 0 && <p className="muted">他 {differences.overflow} 件</p>}{!differences.rows.length && <p className="muted">No shared numeric summary delta.</p>}</> : <p className="muted">No earlier Run in this Case.</p>}</section>
        </div>
      ) : <div className="inspector-empty"><span>R—00</span><p>Run を選択すると manifest、評価、警告、provenance を固定表示します。</p><section className="inspector-section"><h3>Differences</h3><p className="muted">比較する Run はまだありません。</p></section></div>)}
    </aside>
  )
}
