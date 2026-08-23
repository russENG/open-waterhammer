import type { Run } from '@open-waterhammer/contracts'
import { useState } from 'react'

import { APPLICABILITY_LIMITATIONS, buildRunJsonExport, generatePersistedRunExcel } from '../../reports/run-exports'

function download(bytes: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

export function ReportsPanel({ runs }: { runs: Run[] }) {
  const [selectedId, setSelectedId] = useState(runs.at(-1)?.id ?? '')
  const [message, setMessage] = useState<string | null>(null)
  const selected = runs.find(({ id }) => id === selectedId) ?? runs.at(-1)

  async function excel() {
    if (!selected) return
    try {
      const bytes = await generatePersistedRunExcel(selected)
      const copy = new Uint8Array(bytes.byteLength)
      copy.set(bytes)
      download(copy.buffer, `run-${selected.id}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      setMessage('Excel report exported from persisted Run')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  function json() {
    if (!selected) return
    download(buildRunJsonExport(selected), `run-${selected.id}.json`, 'application/json;charset=utf-8')
    setMessage('Run JSON exported')
  }

  return <div className="panel-stack reports-panel">
    <div className="panel-title-row"><div><span className="eyebrow">EVIDENCE EXPORT / 07</span><h1>Reports</h1><p>再計算せず、保存済み Run の manifest・summary・assessment をそのまま成果にします。</p></div></div>
    <div className="reports-grid">
      <section className="notebook-card report-selector"><div className="card-heading"><span>R</span><div><h2>Persisted Run</h2><p>エクスポート対象を選択</p></div></div>
        {runs.length ? <label><span>Run record</span><select value={selected?.id} onChange={(event) => setSelectedId(event.target.value)}>{[...runs].reverse().map((run) => <option key={run.id} value={run.id}>{run.kind} · {run.status} · {new Date(run.updatedAt).toLocaleString('ja-JP')}</option>)}</select></label> : <div className="empty-ledger"><span>∅</span><p>保存済み Run がありません。</p></div>}
      </section>
      <section className="notebook-card report-manifest"><div className="card-heading"><span>M</span><div><h2>Manifest summary</h2><p>証跡に含まれる正準情報</p></div></div>{selected ? <dl className="condition-list"><div><dt>Product</dt><dd>{selected.manifest.productVersion}</dd></div><div><dt>Method</dt><dd>{selected.manifest.method}</dd></div><div><dt>Engine / runtime</dt><dd>{selected.manifest.engine} / {selected.manifest.runtime}</dd></div><div><dt>Rule IDs</dt><dd>{selected.assessment.findings.map(({ ruleId }) => ruleId).join(', ') || 'finding none'}</dd></div></dl> : null}</section>
      <section className="notebook-card export-actions"><div className="card-heading"><span>⇩</span><div><h2>Export files</h2><p>ブラウザからローカル保存</p></div></div><button className="export-button" disabled={!selected} onClick={() => void excel()}><strong>Excel report</strong><small>.xlsx · generateRunReport</small></button><button className="export-button" disabled={!selected} onClick={json}><strong>Run JSON</strong><small>.json · canonical evidence</small></button>{message && <p role="status" className="inline-message">{message}</p>}</section>
    </div>
    <div className="limitations-box"><strong>alpha · 設計比較支援</strong><p>{APPLICABILITY_LIMITATIONS}</p></div>
  </div>
}
