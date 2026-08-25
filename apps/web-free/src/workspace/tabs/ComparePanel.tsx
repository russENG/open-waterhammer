import type { Case, JsonValue, Run, Scenario } from '@open-waterhammer/contracts'

import { caseStateLabel } from '../case-state-labels'
import { buildComparisonRows, formatComparisonNumber } from '../comparison'
import { assessmentStatusLabel, runKindLabel } from '../run-display-labels'

function label(caseRecord: Case): string {
  const root = caseRecord.modelSnapshot
  return root && typeof root === 'object' && !Array.isArray(root) && typeof root.designLabel === 'string' ? root.designLabel : caseRecord.revisionReason ?? caseRecord.id.slice(0, 8)
}

function valueText(value: JsonValue | undefined): string {
  if (value === undefined) return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number') return formatComparisonNumber(value)
  return JSON.stringify(value)
}

export function ComparePanel({ cases, scenarios, runs }: { cases: Case[]; scenarios: Scenario[]; runs: Run[] }) {
  if (cases.length < 2 || cases.length > 4) return <div className="panel-stack"><div className="panel-title-row"><div><span className="eyebrow">差分表 / 06</span><h1>比較</h1><p>左の比較チェックで2～4件の比較案を選択してください。</p></div></div><div className="comparison-empty"><span>2—4</span><p>条件差と計算結果の差を横並びで確認します。</p></div></div>
  const latest = cases.map((record) => [...runs].reverse().find(({ caseId }) => caseId === record.id))
  const rows = buildComparisonRows(cases, scenarios, runs)
  return <div className="panel-stack compare-panel">
    <div className="panel-title-row"><div><span className="eyebrow">差分表 / 06</span><h1>比較</h1><p>比較案の条件と保存済み計算結果の差分を、評価の採否ではなく比較材料として提示します。</p></div><span className="case-count">比較案 {cases.length}件</span></div>
    <div className="comparison-table-wrap"><table aria-label="比較案の比較表" className="comparison-table"><thead><tr><th>条件 / 結果</th>{cases.map((record, index) => <th key={record.id}><span>C—{String(index + 1).padStart(2, '0')}</span>{label(record)}<small>{caseStateLabel(record.state)}</small></th>)}</tr></thead><tbody>
      <tr><th>変更理由</th>{cases.map((record) => <td key={record.id}>{record.revisionReason ?? '起点'}</td>)}</tr>
      <tr><th>系譜</th>{cases.map((record) => <td key={record.id}>{record.parentCaseId?.slice(0, 13) ?? '—'}</td>)}</tr>
      <tr><th>最新の計算結果</th>{latest.map((run, index) => <td key={cases[index]!.id}>{run ? runKindLabel(run.kind) : '未計算'}</td>)}</tr>
      <tr><th>評価</th>{latest.map((run, index) => <td key={cases[index]!.id}><span className={`assessment assessment--${run?.assessment.status ?? 'not_applicable'}`}>{run ? assessmentStatusLabel(run.assessment.status) : '—'}</span></td>)}</tr>
      <tr className="comparison-group"><th colSpan={cases.length + 1}>条件差分・モデル＋シナリオ</th></tr>
      {rows.conditionRows.map((row) => <tr key={row.path}><th>{row.path}</th>{row.values.map((value, index) => <td key={cases[index]!.id}>{valueText(value)}</td>)}</tr>)}
      <tr className="comparison-group"><th colSpan={cases.length + 1}>保存済み計算結果の差分・数値要約</th></tr>
      {rows.resultRows.map((row) => <tr key={row.path}><th>{row.path}</th>{row.values.map((value, index) => <td key={cases[index]!.id}><strong>{value === undefined ? '—' : formatComparisonNumber(value)}</strong>{index > 0 && row.deltas[index] !== undefined ? <small className={row.deltas[index]! > 0 ? 'delta-up' : 'delta-down'}>{row.deltas[index]! >= 0 ? '+' : ''}{formatComparisonNumber(row.deltas[index]!)}</small> : null}</td>)}</tr>)}
    </tbody></table></div>
  </div>
}
