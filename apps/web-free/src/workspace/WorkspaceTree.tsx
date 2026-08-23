import type { Case } from '@open-waterhammer/contracts'
import { useState } from 'react'

import { useWorkspace } from './workspace-context'

function labelOf(caseRecord: Case): string {
  if (caseRecord.revisionReason) return caseRecord.revisionReason
  const model = caseRecord.modelSnapshot
  if (model && typeof model === 'object' && !Array.isArray(model) && typeof model.designLabel === 'string') return model.designLabel
  return `Case ${caseRecord.id.slice(0, 8)}`
}

export function WorkspaceTree({
  projectId,
  caseId,
  comparison,
  onSelect,
  onToggleComparison,
  onCreate,
  onFork,
  onArchive,
  onSelectProject,
}: {
  projectId: string
  caseId: string
  comparison: string[]
  onSelect(caseId: string): void
  onToggleComparison(caseId: string): void
  onCreate(): void
  onFork(): void
  onArchive(): void
  onSelectProject(projectId: string): void
}) {
  const { data } = useWorkspace()
  const [open, setOpen] = useState(true)
  const project = data.projects.find(({ id }) => id === projectId)!
  const selected = data.cases.find(({ id }) => id === caseId)!
  const alternatives = data.alternatives.filter(({ projectId: owner }) => owner === projectId)
  return (
    <aside className="workspace-tree" aria-label="Project Alternative Case tree">
      {data.projects.length > 1 && <div className="tree-project-switcher">
        <label htmlFor="workspace-project-switcher">プロジェクト切替</label>
        <select id="workspace-project-switcher" value={projectId} onChange={(event) => onSelectProject(event.target.value)}>
          {data.projects.map((candidate) => {
            const alternativeCount = data.alternatives.filter(({ projectId: owner }) => owner === candidate.id).length
            return <option key={candidate.id} value={candidate.id}>{candidate.name}（代替案 {alternativeCount}件）</option>
          })}
        </select>
      </div>}
      <div className="tree-project-row">
        <button className="tree-expander" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? '−' : '+'}</button>
        <div><span className="tree-kicker">PROJECT</span><h2>{project.name}</h2><small>{project.crs} · {project.standardSelection.version}</small></div>
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
                  <span><strong>{String(index + 1).padStart(2, '0')} · {labelOf(caseRecord)}</strong><small>{caseRecord.state}{caseRecord.parentCaseId ? ` · ↳ ${caseRecord.parentCaseId.slice(0, 6)}` : ' · origin'}</small></span>
                </button>
                <label className="compare-check"><input type="checkbox" checked={comparison.includes(caseRecord.id)} onChange={() => onToggleComparison(caseRecord.id)} aria-label={`${labelOf(caseRecord)}を比較に追加`} /><span>CMP</span></label>
              </li>)}
            </ol>
          </section>
        })}
      </div>}
      <div className="tree-actions">
        <button onClick={onCreate}>New Case</button>
        {selected.state === 'locked' && <button className="accent-button" onClick={onFork}>Fork Case</button>}
        {selected.state === 'draft' && <button onClick={onArchive}>Archive</button>}
      </div>
      <div className="tree-legend"><span><i className="state-dot state-dot--draft" />draft</span><span><i className="state-dot state-dot--locked" />locked</span><span><i className="state-dot state-dot--archived" />archived</span></div>
    </aside>
  )
}
