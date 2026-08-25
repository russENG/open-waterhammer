import type { JsonValue, Run } from '@open-waterhammer/contracts'
import { useState } from 'react'

import { flattenComparisonValue } from './comparison'
import { assessmentStatusLabel, runKindLabel, runStatusLabel } from './run-display-labels'

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
    <aside className={`run-inspector${collapsed ? ' run-inspector--collapsed' : ''}`} aria-label="計算記録の詳細">
      <div className="inspector-heading">
        <div><span className="eyebrow">証跡</span><h2>計算記録の詳細</h2></div>
        <button className="icon-button" onClick={() => setCollapsed((value) => !value)} aria-expanded={!collapsed} aria-label={collapsed ? '計算記録の詳細を展開' : '計算記録の詳細を折りたたむ'}>
          {collapsed ? '‹' : '›'}
        </button>
      </div>
      {!collapsed && (run ? (
        <div className="inspector-scroll">
          <div className={`status-stamp status-stamp--${run.status}`}>{runStatusLabel(run.status)}</div>
          <dl className="manifest-grid">
            <dt>計算記録</dt><dd>{run.id.slice(0, 13)}…</dd>
            <dt>計算種別</dt><dd>{runKindLabel(run.kind)}</dd>
            <dt>エンジン</dt><dd>{run.manifest.engine}</dd>
            <dt>実行環境</dt><dd>{run.manifest.runtime}</dd>
            <dt>規則</dt><dd>{run.manifest.rulesVersion}</dd>
          </dl>
          <section className="inspector-section">
            <h3>評価</h3>
            <p className={`assessment assessment--${run.assessment.status}`}>{assessmentStatusLabel(run.assessment.status)}</p>
            {run.assessment.findings.map((finding) => <div className="finding-card" key={`${finding.ruleId}-${finding.targetRef}`}><strong>{finding.targetRef}</strong><span>{finding.ruleId}</span><small>{String(finding.observedValue)} / {String(finding.threshold)} {finding.unit}</small></div>)}
          </section>
          <section className="inspector-section"><h3>警告</h3>{run.manifest.warnings.length ? run.manifest.warnings.map((warning) => <p className="warning-line" key={warning}>{warning}</p>) : <p className="muted">警告はありません。</p>}</section>
          <section className="inspector-section"><h3>由来情報</h3><code className="hash-code">{run.manifest.inputHashes.calculation}</code></section>
          <section className="inspector-section"><h3>結果項目</h3><dl className="manifest-grid">{summaryFields.rows.map(([key, value]) => <span className="manifest-pair" key={key}><dt>{key}</dt><dd>{value}</dd></span>)}</dl>{summaryFields.overflow > 0 && <p className="muted">他 {summaryFields.overflow} 件</p>}</section>
          <section className="inspector-section"><h3>差分</h3>{baseline ? <><p className="muted">比較元：{runKindLabel(baseline.kind)} · {baseline.id.slice(0, 8)}</p><dl className="manifest-grid"><dt>入力スナップショット</dt><dd>{baseline.manifest.inputHashes.calculation === run.manifest.inputHashes.calculation ? '同一' : '変更あり'}</dd>{differences.rows.map(([key, value]) => <span className="manifest-pair" key={key}><dt>{key}</dt><dd>{value}</dd></span>)}</dl>{differences.overflow > 0 && <p className="muted">他 {differences.overflow} 件</p>}{!differences.rows.length && <p className="muted">共通する数値項目に差分はありません。</p>}</> : <p className="muted">この比較案に以前の計算結果はありません。</p>}</section>
        </div>
      ) : <div className="inspector-empty"><span>R—00</span><p>計算結果を選択すると、計算記録、評価、警告、由来情報を固定表示します。</p><section className="inspector-section"><h3>差分</h3><p className="muted">比較する計算結果はまだありません。</p></section></div>)}
    </aside>
  )
}
