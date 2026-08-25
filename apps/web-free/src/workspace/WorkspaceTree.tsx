import type { Case } from '@open-waterhammer/contracts'
import { useRef, useState } from 'react'

import { caseStateLabel } from './case-state-labels'
import { caseDisplayName, caseDisplayNameFull, projectDisplayName } from './project-label'
import { useWorkspace } from './workspace-context'

function labelOf(caseRecord: Case): string {
  return caseDisplayName(caseRecord)
}

export function WorkspaceTree({
  projectId,
  caseId,
  comparison,
  onSelect,
  onToggleComparison,
  onCreate,
  onFork,
  onCreateProject,
  onCreateProjectFromExcel,
  onImportProject,
  onExportProject,
  projectActionDisabled = false,
}: {
  projectId: string
  caseId: string
  comparison: string[]
  onSelect(caseId: string): void
  onToggleComparison(caseId: string): void
  onCreate(): void
  onFork(): void
  onCreateProject(name: string): Promise<void>
  onCreateProjectFromExcel(file: File): Promise<string>
  onImportProject(file: File): Promise<string>
  onExportProject(): Promise<string>
  projectActionDisabled?: boolean
}) {
  const { data } = useWorkspace()
  const [open, setOpen] = useState(true)
  const [createProjectOpen, setCreateProjectOpen] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [excelProjectFile, setExcelProjectFile] = useState<File | null>(null)
  const [projectActionBusy, setProjectActionBusy] = useState(false)
  const [projectActionError, setProjectActionError] = useState<string | null>(null)
  const [projectActionMessage, setProjectActionMessage] = useState<string | null>(null)
  const [pendingProjectFile, setPendingProjectFile] = useState<File | null>(null)
  const projectFileInputRef = useRef<HTMLInputElement>(null)
  const project = data.projects.find(({ id }) => id === projectId)!
  const selected = data.cases.find(({ id }) => id === caseId)!
  const alternatives = data.alternatives.filter(({ projectId: owner }) => owner === projectId)
  const actionsDisabled = projectActionDisabled || projectActionBusy

  async function submitNewProject() {
    if (!projectName.trim()) return
    setProjectActionBusy(true)
    setProjectActionError(null)
    setProjectActionMessage(null)
    try {
      await onCreateProject(projectName)
      setProjectName('')
      setCreateProjectOpen(false)
    } catch (error) {
      setProjectActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setProjectActionBusy(false)
    }
  }

  async function submitExcelProject() {
    if (!excelProjectFile) return
    setProjectActionBusy(true)
    setProjectActionError(null)
    setProjectActionMessage(null)
    try {
      setProjectActionMessage(await onCreateProjectFromExcel(excelProjectFile))
      setExcelProjectFile(null)
      setCreateProjectOpen(false)
    } catch (error) {
      setProjectActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setProjectActionBusy(false)
    }
  }

  function handleProjectFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setProjectActionError(null)
    setProjectActionMessage(null)
    setPendingProjectFile(file)
    event.target.value = ''
  }

  async function confirmProjectFile() {
    if (!pendingProjectFile) return
    setProjectActionBusy(true)
    setProjectActionError(null)
    setProjectActionMessage(null)
    try {
      setProjectActionMessage(await onImportProject(pendingProjectFile))
      setPendingProjectFile(null)
    } catch (error) {
      setProjectActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setProjectActionBusy(false)
    }
  }

  async function exportCurrentProject() {
    setProjectActionBusy(true)
    setProjectActionError(null)
    setProjectActionMessage(null)
    try {
      setProjectActionMessage(await onExportProject())
    } catch (error) {
      setProjectActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setProjectActionBusy(false)
    }
  }

  return <>
    <aside className="workspace-tree" aria-label="プロジェクト・代替案・比較案ツリー">
      <div className="tree-project-tools">
        <span className="tree-kicker">プロジェクト管理</span>
        <div className="tree-project-tool-actions">
          <button type="button" disabled={actionsDisabled} onClick={() => {
            setProjectActionError(null)
            setProjectActionMessage(null)
            setExcelProjectFile(null)
            setCreateProjectOpen(true)
          }}>新規プロジェクト</button>
          <button type="button" disabled={actionsDisabled} onClick={() => projectFileInputRef.current?.click()}>プロジェクトを開く</button>
          <button type="button" disabled={actionsDisabled} onClick={() => void exportCurrentProject()}>現在のプロジェクトを書き出す</button>
        </div>
        <input
          ref={projectFileInputRef}
          type="file"
          accept=".owhproj"
          data-testid="tree-project-file-input"
          className="tree-project-file-input"
          onChange={handleProjectFile}
          disabled={actionsDisabled}
          aria-hidden="true"
          tabIndex={-1}
        />
        {projectActionMessage && <p role="status" className="tree-project-message">{projectActionMessage}</p>}
        {projectActionError && !createProjectOpen && <p role="alert" className="form-error">{projectActionError}</p>}
      </div>
      <div className="tree-project-row">
        <button className="tree-expander" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? '−' : '+'}</button>
        <div><span className="tree-kicker">現在のプロジェクト</span><h2>{projectDisplayName(project)}</h2><small>{project.crs} · {project.standardSelection.version}</small></div>
      </div>
      {open && <div className="tree-branches">
        {alternatives.map((alternative) => {
          const cases = data.cases.filter(({ alternativeId }) => alternativeId === alternative.id)
          return <section className="alternative-branch" key={alternative.id}>
            <div className="alternative-label"><span>A</span><div><strong>{alternative.name}</strong><small>{alternative.description}</small></div></div>
            <ol className="case-list">
              {cases.map((caseRecord, index) => <li key={caseRecord.id} className={caseRecord.id === caseId ? 'case-row case-row--active' : 'case-row'}>
                <button className="case-select" onClick={() => onSelect(caseRecord.id)} aria-current={caseRecord.id === caseId ? 'page' : undefined}>
                  <span className={`state-dot state-dot--${caseRecord.state}`} aria-hidden="true" />
                  <span title={caseDisplayNameFull(caseRecord)}><strong>{String(index + 1).padStart(2, '0')} · {labelOf(caseRecord)}</strong><small>{caseStateLabel(caseRecord.state)}{caseRecord.parentCaseId ? ' · 派生' : ' · 起点'}</small></span>
                </button>
                <label className="compare-check"><input type="checkbox" checked={comparison.includes(caseRecord.id)} onChange={() => onToggleComparison(caseRecord.id)} aria-label={`${labelOf(caseRecord)}を比較に追加`} /><span>比較</span></label>
              </li>)}
            </ol>
          </section>
        })}
      </div>}
      <div className="tree-actions">
        <button onClick={onCreate}>新しい比較案</button>
        {selected.state === 'locked' && <button className="accent-button" onClick={onFork}>複製して編集</button>}
      </div>
      <div className="tree-legend"><span><i className="state-dot state-dot--draft" />編集中</span><span><i className="state-dot state-dot--locked" />計算済み・固定</span><span><i className="state-dot state-dot--archived" />保管済み</span></div>
    </aside>
    {createProjectOpen && <div className="modal-backdrop"><section className="modal-sheet project-dialog" role="dialog" aria-modal="true" aria-label="新規プロジェクト">
      <div className="modal-heading"><div><span className="eyebrow">プロジェクト管理</span><h2>新しいプロジェクトを開始</h2></div><button className="icon-button" aria-label="新規プロジェクトを閉じる" onClick={() => setCreateProjectOpen(false)}>×</button></div>
      <p>このブラウザで開けるプロジェクトは1件です。開始すると、現在の「{projectDisplayName(project)}」を閉じて置き換えます。必要な場合は先に書き出してください。</p>
      <section className="project-start-choice project-start-choice--primary" aria-labelledby="excel-project-start-heading">
        <span className="eyebrow">実案件の推奨導線</span>
        <h3 id="excel-project-start-heading">Excelから開始</h3>
        <p>Excelを検証し、成功した場合だけ案件名、最初の比較案、シナリオ、計算入力を作成します。入力エラー時は現在のプロジェクトを残します。</p>
        <label><span>入力済みExcel</span><input type="file" accept=".xlsx" data-testid="tree-excel-project-file-input" onChange={(event) => { setExcelProjectFile(event.target.files?.[0] ?? null); event.currentTarget.value = '' }} disabled={actionsDisabled} /></label>
        {excelProjectFile && <p className="project-start-file">選択中：{excelProjectFile.name}</p>}
        <button type="button" className="primary-button" disabled={actionsDisabled || !excelProjectFile} onClick={() => void submitExcelProject()}>Excelで置き換えて開始</button>
      </section>
      <section className="project-start-choice" aria-labelledby="blank-project-start-heading">
        <span className="eyebrow">補助導線</span>
        <h3 id="blank-project-start-heading">空から始める</h3>
        <label><span>プロジェクト名</span><input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="例：○○幹線 水撃圧検討" /></label>
        <button type="button" disabled={actionsDisabled || !projectName.trim()} onClick={() => void submitNewProject()}>空のプロジェクトで置き換える</button>
      </section>
      {projectActionMessage && <p role="status" className="tree-project-message">{projectActionMessage}</p>}
      {projectActionError && <p role="alert" className="form-error">{projectActionError}</p>}
      <div className="modal-actions"><button type="button" disabled={projectActionBusy} onClick={() => setCreateProjectOpen(false)}>キャンセル</button><button type="button" disabled={actionsDisabled} onClick={() => void exportCurrentProject()}>現在のプロジェクトを書き出す</button></div>
    </section></div>}
    {pendingProjectFile && <div className="modal-backdrop"><section className="modal-sheet project-dialog" role="dialog" aria-modal="true" aria-label="プロジェクトを開く">
      <div className="modal-heading"><div><span className="eyebrow">プロジェクト管理</span><h2>プロジェクトを開く</h2></div><button className="icon-button" aria-label="プロジェクトを開く画面を閉じる" onClick={() => setPendingProjectFile(null)}>×</button></div>
      <p>「{pendingProjectFile.name}」を開くと、現在の「{projectDisplayName(project)}」は閉じられ、読み込んだプロジェクトに置き換わります。必要な場合は先に書き出してください。</p>
      {data.projects.length > 1 && <p className="form-error">旧版で保存されたプロジェクトを含む全{data.projects.length}件が置き換わります。</p>}
      {projectActionMessage && <p role="status" className="tree-project-message">{projectActionMessage}</p>}
      {projectActionError && <p role="alert" className="form-error">{projectActionError}</p>}
      <div className="modal-actions"><button type="button" disabled={projectActionBusy} onClick={() => setPendingProjectFile(null)}>キャンセル</button><button type="button" disabled={actionsDisabled} onClick={() => void exportCurrentProject()}>現在のプロジェクトを書き出す</button><button type="button" className="primary-button" disabled={actionsDisabled} onClick={() => void confirmProjectFile()}>置き換えて開く</button></div>
    </section></div>}
  </>
}
