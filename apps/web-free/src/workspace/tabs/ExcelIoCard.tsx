import type { Case, JsonValue, RunKind } from '@open-waterhammer/contracts'
import type { ParseError } from '@open-waterhammer/excel-io'
import {
  DEMO_CASE_01_CASE,
  DEMO_CASE_01_PIPE,
  DEMO_CASE_02_CASE,
  DEMO_MEASUREMENT_POINTS,
} from '@open-waterhammer/sample-data'
import { useRef, useState } from 'react'

import { ensureBrowserBuffer } from '../../reports/browser-buffer'
import { mapWorkbookToRunInputs } from '../excel-import'
import { useWorkspace } from '../workspace-context'

function download(bytes: ArrayBuffer, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * テンプレート DL + xlsx アップロード。
 * `WorkspaceLayout.tsx` の Model＋GIS タブで `GisPanel` と並べて表示する
 * （移行元: `git show master:apps/web-free/src/components/ExcelPanel.tsx`）。
 */
export function ExcelIoCard({ caseRecord }: { caseRecord: Case }) {
  const { importExcelInputs, busy: workspaceBusy } = useWorkspace()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [errors, setErrors] = useState<ParseError[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const locked = caseRecord.state !== 'draft'

  async function downloadTemplate() {
    try {
      await ensureBrowserBuffer()
      const { generateTemplate } = await import('@open-waterhammer/excel-io')
      const buf = await generateTemplate({
        meta: { projectName: '（案件名を入力）', standardId: 'nochi_pipeline_2021', methodId: 'joukowsky_v1' },
        pipes: [DEMO_CASE_01_PIPE],
        nodes: [],
        cases: [DEMO_CASE_01_CASE, DEMO_CASE_02_CASE],
        measurementPoints: DEMO_MEASUREMENT_POINTS,
      })
      download(buf, 'waterhammer-template.xlsx', XLSX_MIME)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function handleFile(file: File) {
    setLoading(true)
    setErrors([])
    setWarnings([])
    setStatus(null)
    try {
      await ensureBrowserBuffer()
      const buffer = await file.arrayBuffer()
      const { parseWorkbook } = await import('@open-waterhammer/excel-io')
      const result = await parseWorkbook(buffer)
      setErrors(result.errors)

      const hasAnyData = result.data.pipes.length > 0 || result.data.cases.length > 0 || result.data.measurementPoints.length > 0
      if (!hasAnyData) {
        setWarnings(result.warnings)
        setStatus(`${file.name}: 取り込めるデータがありませんでした。`)
        return
      }

      const mapped = mapWorkbookToRunInputs(result.data)
      setWarnings([...result.warnings, ...mapped.warnings])
      const kinds = Object.keys(mapped.runInputs) as RunKind[]
      await importExcelInputs(
        caseRecord.id,
        mapped.runInputs as Partial<Record<RunKind, JsonValue>>,
        result.data as unknown as JsonValue,
      )
      setStatus(kinds.length > 0
        ? `${file.name} を読み込み、${kinds.join(' / ')} の入力を更新しました。`
        : `${file.name} を読み込みましたが、反映できる入力はありませんでした。`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) void handleFile(file)
  }

  return <section className="notebook-card excel-panel">
    <div className="card-heading"><span>X</span><div><h2>Excel 入出力</h2><p>管路・節点・ケース・測点データをテンプレートで読み込みます。</p></div></div>
    <div className="excel-actions">
      <div className="excel-action-group">
        <div className="excel-action-label">テンプレート</div>
        <button type="button" className="btn btn--secondary" onClick={() => void downloadTemplate()}>
          <span className="btn-icon">↓</span>入力テンプレートをダウンロード (.xlsx)
        </button>
        <p className="excel-action-note">同梱のサンプル値はダミーデータです。実案件には使用せず、ご自身の設計値に書き換えてください。</p>
      </div>
      <div className="excel-action-group">
        <div className="excel-action-label">読み込み</div>
        <label className="excel-dropzone" htmlFor="excel-io-upload">
          <span className="excel-dropzone-icon">📂</span>
          <span className="excel-dropzone-text">{loading ? '読み込み中…' : 'xlsx ファイルを選択して読み込み'}</span>
          <input
            id="excel-io-upload"
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' }}
            onChange={handleInputChange}
            disabled={locked || workspaceBusy || loading}
            aria-label="xlsx ファイルを選択して読み込み"
          />
        </label>
        {locked && <p className="excel-action-note">固定済み Case のため取り込めません。Fork してから取り込んでください。</p>}
      </div>
    </div>
    {status && <p role="status" className="inline-message">{status}</p>}
    {warnings.length > 0 && <div className="warnings">{warnings.map((warning, index) => <div key={index} className="warning-item"><span className="warning-icon">⚠</span>{warning}</div>)}</div>}
    {errors.length > 0 && <div className="excel-errors">{errors.map((error, index) => <div key={index} className="excel-error-item"><span className="excel-error-location">[{error.sheet}{error.row != null ? ` 行${error.row}` : ''}{error.field ? ` / ${error.field}` : ''}]</span>{error.message}</div>)}</div>}
  </section>
}
