import type { Case, JsonValue, Run, Scenario } from '@open-waterhammer/contracts'

import { buildComparisonRows, formatComparisonNumber } from '../comparison'

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
  if (cases.length < 2 || cases.length > 4) return <div className="panel-stack"><div className="panel-title-row"><div><span className="eyebrow">DELTA SHEET / 06</span><h1>Compare</h1><p>左の CMP チェックで 2–4 Cases を選択してください。</p></div></div><div className="comparison-empty"><span>2—4</span><p>条件差と Run 結果差を横並びで確認します。</p></div></div>
  const latest = cases.map((record) => [...runs].reverse().find(({ caseId }) => caseId === record.id))
  const rows = buildComparisonRows(cases, scenarios, runs)
  return <div className="panel-stack compare-panel">
    <div className="panel-title-row"><div><span className="eyebrow">DELTA SHEET / 06</span><h1>Compare</h1><p>Case 条件と永続化済み Run の差分。評価の採否ではなく比較材料を提示します。</p></div><span className="case-count">{cases.length} Cases</span></div>
    <div className="comparison-table-wrap"><table aria-label="Case comparison" className="comparison-table"><thead><tr><th>Condition / result</th>{cases.map((record, index) => <th key={record.id}><span>C—{String(index + 1).padStart(2, '0')}</span>{label(record)}<small>{record.state}</small></th>)}</tr></thead><tbody>
      <tr><th>Revision reason</th>{cases.map((record) => <td key={record.id}>{record.revisionReason ?? 'Origin'}</td>)}</tr>
      <tr><th>Lineage</th>{cases.map((record) => <td key={record.id}>{record.parentCaseId?.slice(0, 13) ?? '—'}</td>)}</tr>
      <tr><th>Latest Run</th>{latest.map((run, index) => <td key={cases[index]!.id}>{run?.kind ?? 'not executed'}</td>)}</tr>
      <tr><th>Assessment</th>{latest.map((run, index) => <td key={cases[index]!.id}><span className={`assessment assessment--${run?.assessment.status ?? 'not_applicable'}`}>{run?.assessment.status ?? '—'}</span></td>)}</tr>
      <tr className="comparison-group"><th colSpan={cases.length + 1}>Condition differences · model + Scenario</th></tr>
      {rows.conditionRows.map((row) => <tr key={row.path}><th>{row.path}</th>{row.values.map((value, index) => <td key={cases[index]!.id}>{valueText(value)}</td>)}</tr>)}
      <tr className="comparison-group"><th colSpan={cases.length + 1}>Persisted result deltas · nested numeric summary</th></tr>
      {rows.resultRows.map((row) => <tr key={row.path}><th>{row.path}</th>{row.values.map((value, index) => <td key={cases[index]!.id}><strong>{value === undefined ? '—' : formatComparisonNumber(value)}</strong>{index > 0 && row.deltas[index] !== undefined ? <small className={row.deltas[index]! > 0 ? 'delta-up' : 'delta-down'}>{row.deltas[index]! >= 0 ? '+' : ''}{formatComparisonNumber(row.deltas[index]!)}</small> : null}</td>)}</tr>)}
    </tbody></table></div>
  </div>
}
