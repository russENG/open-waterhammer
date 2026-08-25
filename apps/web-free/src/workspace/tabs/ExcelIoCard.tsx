import type { Case, JsonValue, RunKind } from '@open-waterhammer/contracts'
import type { ParseError, WorkbookData } from '@open-waterhammer/excel-io'
import { useRef, useState } from 'react'

import { ensureBrowserBuffer } from '../../reports/browser-buffer'
import { mapWorkbookToRunInputs, type ExcelScenarioInput } from '../excel-import'
import { downloadInputTemplate } from '../excel-template-download'
import { useWorkspace } from '../workspace-context'

const RUN_KIND_LABELS: Partial<Record<RunKind, string>> = {
  wave_speed: '波速計算',
  joukowsky_allievi: '簡易水撃圧計算',
  longitudinal_hydraulics: '縦断水理計算',
  steady_network_python: '定常管路網計算',
  steady_network_epanet: 'EPANET 定常管路網計算',
}

interface PendingImport {
  fileName: string
  kinds: RunKind[]
  mapped: Partial<Record<RunKind, JsonValue>>
  raw: WorkbookData
  eventSettings: JsonValue
  scenarios: ExcelScenarioInput[]
  conflictingKinds: RunKind[]
}

function runInputsFrom(caseRecord: Case): Record<string, JsonValue> {
  const snapshot = caseRecord.modelSnapshot
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return {}
  const runInputs = snapshot.runInputs
  return runInputs && typeof runInputs === 'object' && !Array.isArray(runInputs)
    ? runInputs as Record<string, JsonValue>
    : {}
}

function hasPreviousExcelImport(caseRecord: Case): boolean {
  const snapshot = caseRecord.modelSnapshot
  return Boolean(snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) && snapshot.excelImport)
}

function kindLabels(kinds: RunKind[]): string {
  return kinds.map((kind) => RUN_KIND_LABELS[kind] ?? kind).join('、')
}

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
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)
  const locked = caseRecord.state !== 'draft'

  async function downloadTemplate() {
    try {
      await downloadInputTemplate()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function applyImport(pending: PendingImport) {
    setLoading(true)
    setStatus(null)
    try {
      await importExcelInputs(
        caseRecord.id,
        pending.mapped,
        pending.raw as unknown as JsonValue,
        pending.eventSettings,
        pending.scenarios,
      )
      setPendingImport(null)
      setStatus(pending.kinds.length > 0
        ? `${pending.fileName} を読み込み、${kindLabels(pending.kinds)}の入力を更新しました。以後はWeb画面の値が正本です。`
        : `${pending.fileName} を読み込みましたが、反映できる入力はありませんでした。`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
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

      if (result.errors.length > 0) {
        setWarnings(result.warnings)
        setStatus(`${file.name}: 入力エラーがあるため、データは更新していません。`)
        return
      }

      const hasAnyData = result.data.pipes.length > 0 || result.data.cases.length > 0 || result.data.measurementPoints.length > 0
      if (!hasAnyData) {
        setWarnings(result.warnings)
        setStatus(`${file.name}: 取り込めるデータがありませんでした。`)
        return
      }

      const mapped = mapWorkbookToRunInputs(result.data)
      setWarnings([...result.warnings, ...mapped.warnings])
      const kinds = Object.keys(mapped.runInputs) as RunKind[]
      const currentInputs = runInputsFrom(caseRecord)
      const conflictingKinds = kinds.filter((kind) => currentInputs[kind] !== undefined)
      const pending: PendingImport = {
        fileName: file.name,
        kinds,
        mapped: mapped.runInputs as Partial<Record<RunKind, JsonValue>>,
        raw: result.data,
        eventSettings: mapped.eventSettings as JsonValue,
        scenarios: mapped.scenarios,
        conflictingKinds,
      }
      if (hasPreviousExcelImport(caseRecord) || conflictingKinds.length > 0) {
        setPendingImport(pending)
        return
      }
      await applyImport(pending)
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
    <div className="card-heading"><span>X</span><div><h2>Excel 入出力</h2><p>Excelは初期一括入力に使います。読込後はWeb画面のプロジェクトデータが正本です。</p></div></div>
    <p className="excel-action-note"><strong>推奨手順：</strong>Excelを読み込み、Web画面で確認・修正し、<code>.owhproj</code> を保存・共有・作業再開に使用します。Excelを読み直す場合は、対応する計算入力だけを確認後に上書きします。</p>
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
        {locked && <p className="excel-action-note">計算済み・固定の比較案には取り込めません。「複製して編集」で編集可能な比較案を作成してください。</p>}
      </div>
    </div>
    {status && <p role="status" className="inline-message">{status}</p>}
    {warnings.length > 0 && <div className="warnings">{warnings.map((warning, index) => <div key={index} className="warning-item"><span className="warning-icon">⚠</span>{warning}</div>)}</div>}
    {errors.length > 0 && <div className="excel-errors">{errors.map((error, index) => <div key={index} className="excel-error-item"><span className="excel-error-location">[{error.sheet}{error.row != null ? ` 行${error.row}` : ''}{error.field ? ` / ${error.field}` : ''}]</span>{error.message}</div>)}</div>}
    {pendingImport && <div className="modal-backdrop">
      <section className="modal-sheet" role="dialog" aria-modal="true" aria-label="Excel再読込の確認">
        <div className="modal-heading"><div><span className="eyebrow">Excel再読込</span><h2>現在の入力を上書きしますか</h2></div><button type="button" className="icon-button" aria-label="確認画面を閉じる" onClick={() => setPendingImport(null)}>×</button></div>
        <p><strong>{pendingImport.fileName}</strong> を読み込むと、現在の比較案にある次の入力を上書きします。</p>
        <p>{kindLabels(pendingImport.conflictingKinds.length > 0 ? pendingImport.conflictingKinds : pendingImport.kinds)}</p>
        <p>Excelに対応しない計算入力、シナリオのその他の条件、比較案の名前と状態は保持します。再読込前の値は履歴として自動保存されないため、元の状態を残す場合は先に <code>.owhproj</code> を書き出してください。</p>
        <div className="modal-actions"><button type="button" onClick={() => setPendingImport(null)}>キャンセル</button><button type="button" className="primary-button" disabled={loading || workspaceBusy} onClick={() => void applyImport(pendingImport)}>確認して上書き</button></div>
      </section>
    </div>}
  </section>
}
