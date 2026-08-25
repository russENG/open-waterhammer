import type { Case } from '@open-waterhammer/contracts'
import { useRef, useState } from 'react'

import { caseStateLabel } from './case-state-labels'
import { projectDisplayName } from './project-label'
import { useWorkspace } from './workspace-context'

function labelOf(caseRecord: Case): string {
  if (caseRecord.revisionReason) return caseRecord.revisionReason
  const model = caseRecord.modelSnapshot
  if (model && typeof model === 'object' && !Array.isArray(model) && typeof model.designLabel === 'string') return model.designLabel
  return `比較案 ${caseRecord.id.slice(0, 8)}`
}

export function WorkspaceTree({
  projectId,
  caseId,
  comparison,
  onSelect,
  onToggleComparison,
  onCreate,
  onFork,
  onSelectProject,
  onCreateProject,
  onImportProject,
  projectActionDisabled = false,
}: {
  projectId: string
  caseId: string
  comparison: string[]
  onSelect(caseId: string): void
  onToggleComparison(caseId: string): void
  onCreate(): void
  onFork(): void
  onSelectProject(projectId: string): void
  onCreateProject(name: string): Promise<void>
  onImportProject(file: File): Promise<string>
  projectActionDisabled?: boolean
}) {
  const { data } = useWorkspace()
  const [open, setOpen] = useState(true)
  const [createProjectOpen, setCreateProjectOpen] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [projectActionBusy, setProjectActionBusy] = useState(false)
  const [projectActionError, setProjectActionError] = useState<string | null>(null)
  const [projectActionMessage, setProjectActionMessage] = useState<string | null>(null)
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

  async function handleProjectFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setProjectActionBusy(true)
    setProjectActionError(null)
    setProjectActionMessage(null)
    try {
      setProjectActionMessage(await onImportProject(file))
    } catch (error) {
      setProjectActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setProjectActionBusy(false)
      event.target.value = ''
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
            setCreateProjectOpen(true)
          }}>新規プロジェクト</button>
          <button type="button" disabled={actionsDisabled} onClick={() => projectFileInputRef.current?.click()}>プロジェクトを読み込み</button>
        </div>
        <input
          ref={projectFileInputRef}
          type="file"
          accept=".owhproj"
          data-testid="tree-project-file-input"
          className="tree-project-file-input"
          onChange={(event) => void handleProjectFile(event)}
          disabled={actionsDisabled}
          aria-hidden="true"
          tabIndex={-1}
        />
        {projectActionMessage && <p role="status" className="tree-project-message">{projectActionMessage}</p>}
        {projectActionError && !createProjectOpen && <p role="alert" className="form-error">{projectActionError}</p>}
      </div>
      {data.projects.length > 1 && <div className="tree-project-switcher">
        <label htmlFor="workspace-project-switcher">プロジェクト切替</label>
        <select id="workspace-project-switcher" value={projectId} onChange={(event) => onSelectProject(event.target.value)}>
          {data.projects.map((candidate) => {
            const alternativeCount = data.alternatives.filter(({ projectId: owner }) => owner === candidate.id).length
            return <option key={candidate.id} value={candidate.id}>{projectDisplayName(candidate)}（代替案 {alternativeCount}件）</option>
          })}
        </select>
      </div>}
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
                  <span><strong>{String(index + 1).padStart(2, '0')} · {labelOf(caseRecord)}</strong><small>{caseStateLabel(caseRecord.state)}{caseRecord.parentCaseId ? ` · ↳ ${caseRecord.parentCaseId.slice(0, 6)}` : ' · 起点'}</small></span>
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
      <div className="modal-heading"><div><span className="eyebrow">プロジェクト管理</span><h2>新規プロジェクト</h2></div><button className="icon-button" aria-label="新規プロジェクトを閉じる" onClick={() => setCreateProjectOpen(false)}>×</button></div>
      <p>空の入力条件と、編集可能な比較案を1件作成します。現在のプロジェクトはそのまま残ります。</p>
      <label><span>プロジェクト名</span><input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="例：○○幹線 水撃圧検討" autoFocus /></label>
      {projectActionError && <p role="alert" className="form-error">{projectActionError}</p>}
      <div className="modal-actions"><button type="button" disabled={projectActionBusy} onClick={() => setCreateProjectOpen(false)}>キャンセル</button><button type="button" className="primary-button" disabled={actionsDisabled || !projectName.trim()} onClick={() => void submitNewProject()}>作成して開く</button></div>
    </section></div>}
  </>
}
