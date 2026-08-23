import type { Case, Project, Run, Scenario } from '@open-waterhammer/contracts'
import { useRef, useState } from 'react'

import { downloadProjectFile, exportProjectFile, importProjectFile } from '../project-transfer'
import { deriveSchematic, type SchematicPipe } from '../schematic'
import { useWorkspaceOptional } from '../workspace-context'

function modelMetrics(caseRecord: Case) {
  const root = caseRecord.modelSnapshot
  const inputs = root && typeof root === 'object' && !Array.isArray(root) && root.runInputs && typeof root.runInputs === 'object' && !Array.isArray(root.runInputs)
    ? Object.keys(root.runInputs).length : 0
  const geo = root && typeof root === 'object' && !Array.isArray(root) && Array.isArray(root.geoDrafts) ? root.geoDrafts.length : 0
  return { inputs, geo }
}

function formatElevation(elevation?: number): string {
  return elevation === undefined ? 'EL —' : `EL ${elevation.toFixed(2)}`
}

function formatPipeDimensions(pipe: SchematicPipe): string {
  const diameter = pipe.diameter === undefined ? '—' : String(Math.round(pipe.diameter * 1000))
  const length = pipe.length === undefined ? '—' : String(pipe.length)
  return `φ${diameter} / ${length} m`
}

/**
 * Project-level export/import for `.owhproj` bundles (Task 4b-10). Only rendered when a
 * `WorkspaceProvider` ancestor exists — every real route does (see `WorkspaceApp.tsx`) — so it
 * quietly renders nothing for callers that mount `OverviewPanel` bare, such as
 * `../__tests__/schematic.test.ts`.
 */
function ProjectTransferCard({ project }: { project: Project }) {
  const workspace = useWorkspaceOptional()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!workspace) return null
  const { repository, refresh, busy: workspaceBusy } = workspace
  const disabled = busy || workspaceBusy

  async function handleExport() {
    setError(null)
    setMessage(null)
    setBusy(true)
    try {
      const file = await exportProjectFile(repository, project.id)
      downloadProjectFile(file)
      setMessage(`${file.name} を書き出しました。`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setError(null)
    setMessage(null)
    setBusy(true)
    try {
      const summary = await importProjectFile(repository, file)
      await refresh()
      setMessage(`${summary.project.name} を読み込みました（Alternative ${summary.alternatives} / Case ${summary.cases} / Scenario ${summary.scenarios} / Run ${summary.runs}）。`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return <section className="notebook-card project-transfer-card">
    <div className="card-heading"><span>04</span><div><h2>Project bundle</h2><p>プロジェクト全体を書き出し・読み込みします</p></div></div>
    <div className="excel-actions">
      <div className="excel-action-group">
        <div className="excel-action-label">書き出し</div>
        <button type="button" className="btn btn--secondary" disabled={disabled} onClick={() => void handleExport()}>
          <span className="btn-icon">↓</span>プロジェクトを書き出し (.owhproj)
        </button>
        <p className="excel-action-note">Alternative・Case・Scenario・Run を含む全データを 1 ファイルにまとめます。</p>
      </div>
      <div className="excel-action-group">
        <div className="excel-action-label">読み込み</div>
        <button type="button" className="btn btn--secondary" disabled={disabled} onClick={() => fileInputRef.current?.click()}>
          <span className="btn-icon">📂</span>プロジェクトを読み込み
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".owhproj"
          data-testid="project-bundle-file-input"
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' }}
          onChange={(event) => void handleFileChange(event)}
          disabled={disabled}
          aria-hidden="true"
          tabIndex={-1}
        />
        <p className="excel-action-note">同じ ID のプロジェクトが既に存在する場合は読み込めません。</p>
      </div>
    </div>
    {message && <p role="status" className="inline-message">{message}</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
  </section>
}

export function OverviewPanel({ project, caseRecord, scenario, runs }: { project: Project; caseRecord: Case; scenario?: Scenario; runs: Run[] }) {
  const metrics = modelMetrics(caseRecord)
  const schematic = deriveSchematic(caseRecord)
  const latest = runs.at(-1)
  return <div className="panel-stack overview-panel">
    <div className="panel-title-row"><div><span className="eyebrow">CONTROL SHEET / 01</span><h1>設計条件の俯瞰</h1><p>入力・シナリオ・計算証跡を一枚のフィールドノートとして整理します。</p></div><span className={`state-ticket state-ticket--${caseRecord.state}`}>{caseRecord.state}</span></div>
    <div className="metric-strip">
      <article><span>CALCULATION PATHS</span><strong>{metrics.inputs.toString().padStart(2, '0')}</strong><small>RunKinds available</small></article>
      <article><span>MODEL ELEMENTS</span><strong>{metrics.geo.toString().padStart(2, '0')}</strong><small>mapped drafts</small></article>
      <article><span>RECORDED RUNS</span><strong>{runs.length.toString().padStart(2, '0')}</strong><small>{latest?.status ?? 'not executed'}</small></article>
      <article><span>STANDARD PROFILE</span><strong className="metric-word">{project.standardSelection.version}</strong><small>{project.standardSelection.profileId}</small></article>
    </div>
    <div className="overview-grid">
      <section className="notebook-card overview-profile">
        <div className="card-heading"><span>01</span><div><h2>Case definition</h2><p>選択中の比較条件</p></div></div>
        <dl className="condition-list">
          <div><dt>Case ID</dt><dd>{caseRecord.id}</dd></div>
          <div><dt>Lineage</dt><dd>{caseRecord.parentCaseId ? `Forked from ${caseRecord.parentCaseId.slice(0, 13)}…` : 'Origin case'}</dd></div>
          <div><dt>Revision</dt><dd>{caseRecord.revisionReason ?? '基準案'}</dd></div>
          <div><dt>Lock</dt><dd>{caseRecord.lockProvenance ?? 'editable draft'}</dd></div>
        </dl>
      </section>
      <section className="notebook-card schematic-card">
        <div className="card-heading"><span>02</span><div><h2>Hydraulic line</h2><p>{scenario?.name ?? 'Scenario not configured'}</p></div></div>
        {schematic ? <div className="pipe-schematic" aria-label="Hydraulic model schematic">
          <span className="reservoir-symbol" title={schematic.upstream.id}>R</span><i /><b>{schematic.pipe.id ?? '—'}</b><i /><span className="junction-symbol" title={schematic.downstream.id}>J</span>
          <small>{formatElevation(schematic.upstream.elevation)}</small><small>{formatPipeDimensions(schematic.pipe)}</small><small>{formatElevation(schematic.downstream.elevation)}</small>
        </div> : <p className="muted">モデル未設定</p>}
      </section>
      <section className="notebook-card activity-card">
        <div className="card-heading"><span>03</span><div><h2>Recent evidence</h2><p>ローカルに保存された Run</p></div></div>
        {runs.length ? <ol className="run-ledger">{[...runs].reverse().slice(0, 4).map((run) => <li key={run.id}><time>{new Date(run.updatedAt).toLocaleString('ja-JP')}</time><strong>{run.kind}</strong><span className={`assessment assessment--${run.assessment.status}`}>{run.assessment.status}</span></li>)}</ol> : <div className="empty-ledger"><span>∅</span><p>Analysis から計算を実行すると、manifest と結果がここに記録されます。</p></div>}
      </section>
    </div>
    <ProjectTransferCard project={project} />
  </div>
}
