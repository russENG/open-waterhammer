import type { Case, Run } from '@open-waterhammer/contracts'
import { useState } from 'react'

import { buildReportInput, generateDeliverableExcel } from '../../reports/deliverable-reports'
import { buildRunJsonExport, generatePersistedRunExcel } from '../../reports/run-exports'
import { findingRuleLabel } from '../result-paths'
import { useWorkspace } from '../workspace-context'
import { runKindLabel, runStatusLabel } from '../run-display-labels'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function download(bytes: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

/** `modelSnapshot.excelImport`（`workspace-context.tsx` の `importExcelInputs` が保存する、
 * Excel 取込時の生 WorkbookData）があれば取り出す。`buildReportInput` の第三引数の型と
 * 一致させるため、その関数自身のシグネチャから型を導出する（新たな export は増やさない）。 */
type ExcelImportData = NonNullable<Parameters<typeof buildReportInput>[2]>

function excelImportFrom(caseRecord: Case | undefined): ExcelImportData | undefined {
  const snapshot = caseRecord?.modelSnapshot
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return undefined
  const excelImport = (snapshot as Record<string, unknown>).excelImport
  return excelImport && typeof excelImport === 'object' && !Array.isArray(excelImport)
    ? excelImport as unknown as ExcelImportData
    : undefined
}

export function ReportsPanel({ runs }: { runs: Run[] }) {
  const { data } = useWorkspace()
  const [selectedId, setSelectedId] = useState(runs.at(-1)?.id ?? '')
  const [message, setMessage] = useState<string | null>(null)
  const selected = runs.find(({ id }) => id === selectedId) ?? runs.at(-1)

  // 表示中の Case は「どのプロジェクトを対象にするか」を決めるためだけに使う。
  const caseRecord = data.cases.find(({ id }) => id === runs[0]?.caseId)
  const alternative = data.alternatives.find(({ id }) => id === caseRecord?.alternativeId)
  const project = data.projects.find(({ id }) => id === alternative?.projectId)

  // 成果品様式（水理計算書・検討書）は「計算結果」シートを joukowsky_allievi から、
  // 「水理計算書」シートを longitudinal_hydraulics から組み立てる。
  // 1つの比較案では計算を1回しか成功させられない（成功で locked になる）ため、
  // 比較案スコープのままだと ①と④ が同じ冊子に入らない。プロジェクト全体の
  // 成功した計算結果を対象にして、1ファイルにまとめる。
  const projectCaseIds = new Set(
    data.cases
      .filter((record) => data.alternatives.some((alt) => alt.id === record.alternativeId && alt.projectId === project?.id))
      .map(({ id }) => id),
  )
  // 引数で渡された Run（表示中の比較案のもの）と、同じプロジェクトの保存済み Run を
  // id で重複排除して束ねる。保存前の Run を渡された場合にも対応するため両方見る。
  const deliverableRuns = [...new Map(
    [...runs, ...data.runs.filter((item) => projectCaseIds.has(item.caseId))]
      .filter((item) => item.status === 'succeeded')
      .map((item) => [item.id, item] as const),
  ).values()]
  // Excel取込のシート情報（管路一覧・ケース一覧）は取り込んだ Case が持つ。
  // 表示中の Case に無ければ、同じプロジェクトの他の Case から探す。
  const excelImport = excelImportFrom(caseRecord)
    ?? excelImportFrom(data.cases.find((record) => projectCaseIds.has(record.id) && excelImportFrom(record) !== undefined))
  const reportInput = project ? buildReportInput(project, deliverableRuns, excelImport) : null
  const deliverableKinds = [...new Set(deliverableRuns.map(({ kind }) => kind))]

  async function excel() {
    if (!selected) return
    try {
      const bytes = await generatePersistedRunExcel(selected)
      const copy = new Uint8Array(bytes.byteLength)
      copy.set(bytes)
      download(copy.buffer, `run-${selected.id}.xlsx`, XLSX_MIME)
      setMessage('保存済みの計算結果からExcel帳票を書き出しました')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  function json() {
    if (!selected) return
    download(buildRunJsonExport(selected), `run-${selected.id}.json`, 'application/json;charset=utf-8')
    setMessage('計算記録JSONを書き出しました')
  }

  async function deliverable() {
    if (!reportInput) return
    try {
      const bytes = await generateDeliverableExcel(reportInput)
      const copy = new Uint8Array(bytes.byteLength)
      copy.set(bytes)
      const baseName = reportInput.meta.projectName ? reportInput.meta.projectName.replace(/[\\/:*?"<>|]/g, '_') : 'unnamed'
      download(copy.buffer, `waterhammer-report-${baseName}.xlsx`, XLSX_MIME)
      setMessage('水理計算書・検討書を書き出しました（再計算せず、保存済みの計算結果から生成）')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  return <div className="panel-stack reports-panel">
    <div className="panel-title-row"><div><span className="eyebrow">証跡の書き出し / 07</span><h1>帳票</h1><p>再計算せず、保存済みの計算結果と計算記録をそのまま成果品にします。</p></div></div>
    <div className="reports-grid">
      <section className="notebook-card report-selector"><div className="card-heading"><span>R</span><div><h2>保存済みの計算結果</h2><p>書き出す対象を選択</p></div></div>
        {runs.length ? <label><span>計算結果</span><select value={selected?.id} onChange={(event) => setSelectedId(event.target.value)}>{[...runs].reverse().map((run) => <option key={run.id} value={run.id}>{runKindLabel(run.kind)} · {runStatusLabel(run.status)} · {new Date(run.updatedAt).toLocaleString('ja-JP')}</option>)}</select></label> : <div className="empty-ledger"><span>∅</span><p>保存済みの計算結果がありません。</p></div>}
      </section>
      <section className="notebook-card report-manifest"><div className="card-heading"><span>M</span><div><h2>計算記録の要約</h2><p>証跡に含まれる正準情報</p></div></div>{selected ? <dl className="condition-list"><div><dt>製品</dt><dd>{selected.manifest.productVersion}</dd></div><div><dt>計算方式</dt><dd>{selected.manifest.method}</dd></div><div><dt>エンジン / 実行環境</dt><dd>{selected.manifest.engine} / {selected.manifest.runtime}</dd></div><div><dt>該当した判定ルール</dt><dd>{selected.assessment.findings.map(({ ruleId }) => findingRuleLabel(ruleId)).join(' / ') || '指摘なし'}</dd></div></dl> : null}</section>
      <section className="notebook-card export-actions"><div className="card-heading"><span>⇩</span><div><h2>ファイルの書き出し</h2><p>ブラウザからローカルに保存</p></div></div><button className="export-button" disabled={!selected} onClick={() => void excel()}><strong>Excel帳票</strong><small>.xlsx · 計算結果の帳票</small></button><button className="export-button" disabled={!selected} onClick={json}><strong>計算記録JSON</strong><small>.json · 正準化された計算証跡</small></button><button className="export-button" disabled={!reportInput} onClick={() => void deliverable()}><strong>水理計算書・検討書</strong><small>.xlsx · 成果品様式（再計算なし）</small></button>{reportInput
        ? <p className="inline-message">プロジェクト内の成功した計算結果 {deliverableRuns.length} 件（{deliverableKinds.map(runKindLabel).join(' / ')}）を1冊にまとめます。</p>
        : <p className="inline-message">Joukowsky / Allieviまたは縦断水理計算の成功した計算結果がまだありません。</p>}{message && <p role="status" className="inline-message">{message}</p>}</section>
    </div>
  </div>
}
