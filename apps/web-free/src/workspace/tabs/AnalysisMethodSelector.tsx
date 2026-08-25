import type { RunKind } from '@open-waterhammer/contracts'
import { ANALYSIS_METHOD_GROUPS } from '../analysis-methods'

export interface AnalysisMethodCopy {
  code: string
  title: string
  note: string
}

export function AnalysisMethodSelector({ selectedKind, locked, copy, onSelect }: {
  selectedKind: RunKind
  locked: boolean
  copy: Record<RunKind, AnalysisMethodCopy>
  onSelect(kind: RunKind): void
}) {
  return <div className="run-kind-list analysis-method-groups" role="radiogroup" aria-label="計算の種類">
    {ANALYSIS_METHOD_GROUPS.map((group) => <section key={group.id} className={`analysis-method-group analysis-method-group--${group.id}`} aria-labelledby={`analysis-method-${group.id}`}>
      <div className="analysis-method-group-heading"><h2 id={`analysis-method-${group.id}`}>{group.title}</h2>{group.id === 'primary' && <span>推奨</span>}</div>
      <p>{group.description}</p>
      <div className="analysis-method-cards">{group.kinds.map((kind) => <label key={kind} className={kind === selectedKind ? 'run-kind-card run-kind-card--active' : 'run-kind-card'}>
        <input type="radio" name="run-kind" value={kind} checked={kind === selectedKind} disabled={locked} onChange={() => onSelect(kind)} />
        <span>{copy[kind].code}</span><div><strong>{copy[kind].title}</strong><small>{copy[kind].note}</small></div>
      </label>)}</div>
    </section>)}
  </div>
}
