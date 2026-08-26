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
    {/* 固定された比較案では11種すべてが無効になる。理由は入力欄の側にも出しているが、
        利用者がまず見るのはこの一覧なので、無効化された選択肢のところにも短く添える
        （「主要解析しか選べない」と読まれていた）。 */}
    {locked && <p className="analysis-method-locked-note">この比較案は計算済み・固定のため、計算方法は変更できません。入力欄の「複製して編集」から、編集できる複製を作れます。</p>}
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
