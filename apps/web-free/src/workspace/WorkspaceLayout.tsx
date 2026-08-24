import { PRODUCT_VERSION } from '@open-waterhammer/contracts'
import type { Run } from '@open-waterhammer/contracts'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import type { LinkedFocus } from './focus'
import { PyodideStatusChip } from './PyodideStatusChip'
import { RunInspector } from './RunInspector'
import { WorkspaceTree } from './WorkspaceTree'
import { useWorkspace } from './workspace-context'
import { resolveWorkspaceRoute, toggleComparisonCase, WORKSPACE_TABS, type WorkspaceTab } from './workspace-state'
import { AnalysisPanel } from './tabs/AnalysisPanel'
import { ComparePanel } from './tabs/ComparePanel'
import { OverviewPanel } from './tabs/OverviewPanel'
import { ScenarioPanel } from './tabs/ScenarioPanel'

const GisPanel = lazy(() => import('../gis/GisPanel').then((module) => ({ default: module.GisPanel })))
const ExcelIoCard = lazy(() => import('./tabs/ExcelIoCard').then((module) => ({ default: module.ExcelIoCard })))
const ResultsPanel = lazy(() => import('../results/ResultsPanel').then((module) => ({ default: module.ResultsPanel })))
const ReportsPanel = lazy(() => import('./tabs/ReportsPanel').then((module) => ({ default: module.ReportsPanel })))

const TAB_LABELS: Record<WorkspaceTab, string> = {
  overview: 'Overview',
  'model-gis': 'Model＋GIS',
  scenario: 'Scenario',
  analysis: 'Analysis',
  results: 'Results',
  compare: 'Compare',
  reports: 'Reports',
}

function canonicalPath(projectId: string, caseId: string, tab: WorkspaceTab) {
  return `/projects/${projectId}/cases/${caseId}/${tab}`
}

function recentSelection() {
  try { return JSON.parse(localStorage.getItem('owh_recent_workspace') ?? '{}') as { projectId?: string; caseId?: string; tab?: string } } catch { return {} }
}

export function WorkspaceLayout() {
  const { data, createFrom, fork, archive } = useWorkspace()
  const params = useParams()
  const navigate = useNavigate()
  const selection = resolveWorkspaceRoute(data, params, recentSelection())
  const project = data.projects.find(({ id }) => id === selection.projectId)!
  const caseRecord = data.cases.find(({ id }) => id === selection.caseId)!
  const scenario = data.scenarios.find(({ caseId }) => caseId === selection.caseId)
  const caseRuns = data.runs.filter(({ caseId }) => caseId === selection.caseId)
  const [comparison, setComparison] = useState<string[]>([])
  const [comparisonError, setComparisonError] = useState<string | null>(null)
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>(caseRuns.at(-1)?.id)
  const [focus, setFocus] = useState<LinkedFocus>()
  const [forkDialog, setForkDialog] = useState(false)
  const [forkReason, setForkReason] = useState('')
  const [forkError, setForkError] = useState<string | null>(null)
  const selectedRun = caseRuns.find(({ id }) => id === selectedRunId) ?? caseRuns.at(-1)
  const selectedRunIndex = selectedRun ? caseRuns.findIndex(({ id }) => id === selectedRun.id) : -1
  const baselineRun = selectedRunIndex > 0 ? caseRuns[selectedRunIndex - 1] : undefined
  const comparedCases = useMemo(() => comparison.map((id) => data.cases.find((record) => record.id === id)).filter((record): record is NonNullable<typeof record> => Boolean(record)), [comparison, data.cases])

  useEffect(() => {
    const expected = canonicalPath(selection.projectId, selection.caseId, selection.tab)
    if (params.projectId !== selection.projectId || params.caseId !== selection.caseId || params.tab !== selection.tab) navigate(expected, { replace: true })
    localStorage.setItem('owh_recent_workspace', JSON.stringify({ projectId: selection.projectId, caseId: selection.caseId, tab: selection.tab }))
  }, [navigate, params.caseId, params.projectId, params.tab, selection.caseId, selection.projectId, selection.tab])

  function goToCase(nextCaseId: string) {
    navigate(canonicalPath(selection.projectId, nextCaseId, selection.tab))
  }

  function goToProject(nextProjectId: string) {
    const target = resolveWorkspaceRoute(data, { projectId: nextProjectId })
    navigate(canonicalPath(target.projectId, target.caseId, target.tab))
  }

  function toggleComparison(nextCaseId: string) {
    const result = toggleComparisonCase(comparison, nextCaseId)
    setComparison(result.selection)
    setComparisonError(result.error ?? null)
  }

  async function createNew() {
    const created = await createFrom(selection.caseId)
    goToCase(created.id)
  }

  async function submitFork() {
    if (!forkReason.trim()) {
      setForkError('分岐理由を入力してください。')
      return
    }
    const created = await fork(selection.caseId, forkReason)
    setForkDialog(false)
    setForkReason('')
    setForkError(null)
    setComparison((current) => [...new Set([...current, selection.caseId, created.id])].slice(0, 4))
    goToCase(created.id)
  }

  async function archiveSelected() {
    await archive(selection.caseId)
  }

  let panel
  if (selection.tab === 'overview') panel = <OverviewPanel project={project} caseRecord={caseRecord} scenario={scenario} runs={caseRuns} onImported={(importedProjectId, importedCaseId) => navigate(canonicalPath(importedProjectId, importedCaseId, 'overview'))} />
  if (selection.tab === 'model-gis') panel = <Suspense fallback={<PanelLoading label="GIS" />}><ExcelIoCard key={`excel-${caseRecord.id}`} caseRecord={caseRecord} /><GisPanel key={caseRecord.id} caseRecord={caseRecord} projectCrs={project.crs} locked={caseRecord.state !== 'draft'} focus={focus} /></Suspense>
  if (selection.tab === 'scenario') panel = <ScenarioPanel key={scenario?.id} scenario={scenario} locked={caseRecord.state !== 'draft'} />
  if (selection.tab === 'analysis') panel = <AnalysisPanel key={caseRecord.id} caseRecord={caseRecord} onRunSelected={(run) => setSelectedRunId(run.id)} />
  if (selection.tab === 'results') panel = <Suspense fallback={<PanelLoading label="results visualization" />}><ResultsPanel runs={caseRuns} selectedRun={selectedRun} focus={focus} onSelectRun={(run: Run) => setSelectedRunId(run.id)} onFocus={setFocus} /></Suspense>
  if (selection.tab === 'compare') panel = <ComparePanel cases={comparedCases} scenarios={data.scenarios} runs={data.runs} />
  if (selection.tab === 'reports') panel = <Suspense fallback={<PanelLoading label="report tools" />}><ReportsPanel runs={caseRuns} /></Suspense>

  return <div className="workspace-page">
    <a href="#workspace-main" className="skip-link">Skip to workspace</a>
    <header className="product-header">
      <div className="product-mark"><span className="mark-lines" aria-hidden="true"><i /><i /><i /></span><div><strong>OPEN WATERHAMMER</strong><small>Hydraulic transient workspace</small></div></div>
      <div className="product-context"><span className="alpha-label">alpha</span><span className="support-label">設計比較支援</span><span className="version-label">{`v${PRODUCT_VERSION}`}</span><PyodideStatusChip /></div>
      <nav aria-label="Documentation"><Link to={canonicalPath(selection.projectId, selection.caseId, 'overview')}>Workspace</Link><a href="#/docs/reference">Reference</a><a href="#/docs/library">Library</a><a href="#/docs/design-flow">設計フロー</a><a href="#/docs/hydraulic">水理設計の視点</a><a href="#/docs/about">Help / About</a></nav>
    </header>
    <div className="workspace-grid">
      <WorkspaceTree projectId={selection.projectId} caseId={selection.caseId} comparison={comparison} onSelect={goToCase} onToggleComparison={toggleComparison} onCreate={() => void createNew()} onFork={() => setForkDialog(true)} onArchive={() => void archiveSelected()} onSelectProject={goToProject} />
      <main id="workspace-main" className="workspace-main">
        <div className="workspace-breadcrumb"><span>{project.name}</span><i>/</i><span>{caseRecord.revisionReason ?? '基準案'}</span><b className={`state-pill state-pill--${caseRecord.state}`}>{caseRecord.state}</b></div>
        <nav className="workspace-tabs" aria-label="Workspace tabs">{WORKSPACE_TABS.map((tab) => <Link key={tab} aria-label={TAB_LABELS[tab]} aria-current={tab === selection.tab ? 'page' : undefined} to={canonicalPath(selection.projectId, selection.caseId, tab)} className={tab === selection.tab ? 'workspace-tab workspace-tab--active' : 'workspace-tab'}><span aria-hidden="true">{String(WORKSPACE_TABS.indexOf(tab) + 1).padStart(2, '0')}</span>{TAB_LABELS[tab]}</Link>)}</nav>
        {comparisonError && <div className="notice-bar" role="alert">{comparisonError}<button onClick={() => setComparisonError(null)}>×</button></div>}
        <section className="workspace-panel">{panel}</section>
      </main>
      <RunInspector run={selectedRun} baseline={baselineRun} />
    </div>
    <footer className="product-footer"><div><strong>alpha · 設計比較支援</strong><span>local-first / static hosting / evidence preserved</span><nav aria-label="External resources"><a href="https://github.com/russENG/open-waterhammer" target="_blank" rel="noopener noreferrer">GitHub リポジトリ</a> ・ <a href="./notebooks/" target="_blank" rel="noreferrer">計算ノートブック ↗</a></nav></div><p><b>適用限界：</b>自動評価は設計比較支援のための参考情報です。入力条件、適用基準、数値解法の妥当性は設計者が個別に確認してください。</p></footer>
    {forkDialog && <div className="modal-backdrop"><section className="modal-sheet fork-dialog" role="dialog" aria-modal="true" aria-label="Fork locked Case"><div className="modal-heading"><div><span className="eyebrow">CASE LIFECYCLE</span><h2>Fork locked Case</h2></div><button className="icon-button" aria-label="Close fork dialog" onClick={() => setForkDialog(false)}>×</button></div><p>固定済み Case は変更できません。差分理由を残して編集可能な子 Case を作成します。</p><label><span>分岐理由</span><textarea value={forkReason} onChange={(event) => setForkReason(event.target.value)} autoFocus /></label>{forkError && <p className="form-error">{forkError}</p>}<div className="modal-actions"><button onClick={() => setForkDialog(false)}>Cancel</button><button className="primary-button" onClick={() => void submitFork()}>Create fork</button></div></section></div>}
  </div>
}

function PanelLoading({ label }: { label: string }) {
  return <div className="panel-loading" role="status"><span /><p>Loading {label}…</p></div>
}
