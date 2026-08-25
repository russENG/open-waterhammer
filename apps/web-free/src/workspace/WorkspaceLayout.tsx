import type { Run } from '@open-waterhammer/contracts'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { SITE_TITLE } from '../branding'
import type { LinkedFocus } from './focus'
import { downloadProjectFile, exportProjectFile, replaceProjectFile } from './project-transfer'
import { PyodideStatusChip } from './PyodideStatusChip'
import { RunInspector } from './RunInspector'
import { WorkspaceTree } from './WorkspaceTree'
import { useWorkspace } from './workspace-context'
import { newestCaseIdForProject, resolveWorkspaceRoute, toggleComparisonCase, WORKSPACE_TABS, type WorkspaceTab } from './workspace-state'
import { AnalysisPanel } from './tabs/AnalysisPanel'
import { ComparePanel } from './tabs/ComparePanel'
import { OverviewPanel } from './tabs/OverviewPanel'
import { ScenarioPanel } from './tabs/ScenarioPanel'
import { caseStateLabel } from './case-state-labels'
import { projectDisplayName } from './project-label'

const GisPanel = lazy(() => import('../gis/GisPanel').then((module) => ({ default: module.GisPanel })))
const ExcelIoCard = lazy(() => import('./tabs/ExcelIoCard').then((module) => ({ default: module.ExcelIoCard })))
const ResultsPanel = lazy(() => import('../results/ResultsPanel').then((module) => ({ default: module.ResultsPanel })))
const ReportsPanel = lazy(() => import('./tabs/ReportsPanel').then((module) => ({ default: module.ReportsPanel })))

const TAB_LABELS: Record<WorkspaceTab, string> = {
  overview: '概要',
  'model-gis': 'モデル＋GIS',
  scenario: 'シナリオ',
  analysis: '解析',
  results: '結果',
  compare: '比較',
  reports: '帳票',
}

function canonicalPath(projectId: string, caseId: string, tab: WorkspaceTab) {
  return `/projects/${projectId}/cases/${caseId}/${tab}`
}

function recentSelection() {
  try { return JSON.parse(localStorage.getItem('owh_recent_workspace') ?? '{}') as { projectId?: string; caseId?: string; tab?: string } } catch { return {} }
}

export function WorkspaceLayout() {
  const { data, repository, busy, refresh, replaceProject, createFrom, fork } = useWorkspace()
  const params = useParams()
  const navigate = useNavigate()
  const selection = resolveWorkspaceRoute(data, params, recentSelection())
  const project = data.projects.find(({ id }) => id === selection.projectId)!
  const caseRecord = data.cases.find(({ id }) => id === selection.caseId)!
  const caseScenarios = data.scenarios.filter(({ caseId }) => caseId === selection.caseId)
  const caseRuns = data.runs.filter(({ caseId }) => caseId === selection.caseId)
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>()
  const [comparison, setComparison] = useState<string[]>([])
  const [comparisonError, setComparisonError] = useState<string | null>(null)
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>(caseRuns.at(-1)?.id)
  const [focus, setFocus] = useState<LinkedFocus>()
  const [forkDialog, setForkDialog] = useState(false)
  const [forkReason, setForkReason] = useState('')
  const [forkError, setForkError] = useState<string | null>(null)
  const scenario = caseScenarios.find(({ id }) => id === selectedScenarioId) ?? caseScenarios[0]
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

  function toggleComparison(nextCaseId: string) {
    const result = toggleComparisonCase(comparison, nextCaseId)
    setComparison(result.selection)
    setComparisonError(result.error ?? null)
  }

  async function createNew() {
    const created = await createFrom(selection.caseId)
    goToCase(created.id)
  }

  async function createProject(name: string) {
    const created = await replaceProject(name)
    navigate(canonicalPath(created.project.id, created.caseRecord.id, 'overview'))
  }

  async function importProject(file: File): Promise<string> {
    const summary = await replaceProjectFile(repository, file)
    const next = await refresh()
    const caseId = newestCaseIdForProject(next, summary.project.id)
    if (!caseId) throw new Error('読み込んだプロジェクトに比較案がありません。')
    navigate(canonicalPath(summary.project.id, caseId, 'overview'))
    return `${summary.project.name} を読み込みました。`
  }

  async function exportProject(): Promise<string> {
    const file = await exportProjectFile(repository, project.id)
    downloadProjectFile(file)
    return `${file.name} を書き出しました。`
  }

  async function submitFork() {
    if (!forkReason.trim()) {
      setForkError('変更理由を入力してください。')
      return
    }
    const created = await fork(selection.caseId, forkReason)
    setForkDialog(false)
    setForkReason('')
    setForkError(null)
    setComparison((current) => [...new Set([...current, selection.caseId, created.id])].slice(0, 4))
    goToCase(created.id)
  }

  let panel
  if (selection.tab === 'overview') panel = <OverviewPanel project={project} caseRecord={caseRecord} scenario={scenario} runs={caseRuns} focus={focus} onFocus={setFocus} onImported={(importedProjectId, importedCaseId) => navigate(canonicalPath(importedProjectId, importedCaseId, 'overview'))} />
  if (selection.tab === 'model-gis') panel = <Suspense fallback={<PanelLoading label="GIS" />}><ExcelIoCard key={`excel-${caseRecord.id}`} caseRecord={caseRecord} /><GisPanel key={caseRecord.id} caseRecord={caseRecord} projectCrs={project.crs} locked={caseRecord.state !== 'draft'} focus={focus} /></Suspense>
  if (selection.tab === 'scenario') panel = <ScenarioPanel key={scenario?.id} caseId={caseRecord.id} scenarios={caseScenarios} scenario={scenario} locked={caseRecord.state !== 'draft'} onSelect={setSelectedScenarioId} />
  if (selection.tab === 'analysis') panel = <AnalysisPanel key={`${caseRecord.id}-${scenario?.id}`} caseRecord={caseRecord} scenarios={caseScenarios} scenario={scenario} onScenarioSelect={setSelectedScenarioId} onRunSelected={(run) => setSelectedRunId(run.id)} onFork={() => setForkDialog(true)} />
  if (selection.tab === 'results') panel = <Suspense fallback={<PanelLoading label="results visualization" />}><ResultsPanel caseRecord={caseRecord} runs={caseRuns} selectedRun={selectedRun} focus={focus} onSelectRun={(run: Run) => setSelectedRunId(run.id)} onFocus={setFocus} /></Suspense>
  if (selection.tab === 'compare') panel = <ComparePanel cases={comparedCases} scenarios={data.scenarios} runs={data.runs} />
  if (selection.tab === 'reports') panel = <Suspense fallback={<PanelLoading label="report tools" />}><ReportsPanel runs={caseRuns} /></Suspense>

  return <div className="workspace-page">
    <a href="#workspace-main" className="skip-link">作業内容へ移動</a>
    <header className="product-header">
      <div className="product-mark"><span className="mark-lines" aria-hidden="true"><i /><i /><i /></span><strong>{SITE_TITLE}</strong></div>
      <div className="product-status"><PyodideStatusChip /></div>
      <nav aria-label="サービス内メニュー"><Link to={canonicalPath(selection.projectId, selection.caseId, 'overview')}>作業画面</Link><a href="#/docs/reference">設計基準</a><a href="#/docs/library">計算ライブラリ</a><a href="#/docs/design-flow">設計フロー</a><a href="#/docs/hydraulic">水理設計の視点</a><a href="#/docs/about">このサイトについて</a><a href="demo/">デモ手順</a></nav>
    </header>
    <div className="workspace-grid">
      <WorkspaceTree projectId={selection.projectId} caseId={selection.caseId} comparison={comparison} onSelect={goToCase} onToggleComparison={toggleComparison} onCreate={() => void createNew()} onFork={() => setForkDialog(true)} onCreateProject={createProject} onImportProject={importProject} onExportProject={exportProject} projectActionDisabled={busy} />
      <main id="workspace-main" className="workspace-main">
        <div className="workspace-breadcrumb"><span>{projectDisplayName(project)}</span><i>/</i><span>{caseRecord.revisionReason ?? '基準案'}</span><b className={`state-pill state-pill--${caseRecord.state}`}>{caseStateLabel(caseRecord.state)}</b></div>
        <nav className="workspace-tabs" aria-label="作業タブ">{WORKSPACE_TABS.map((tab) => <Link key={tab} aria-label={TAB_LABELS[tab]} aria-current={tab === selection.tab ? 'page' : undefined} to={canonicalPath(selection.projectId, selection.caseId, tab)} className={tab === selection.tab ? 'workspace-tab workspace-tab--active' : 'workspace-tab'}><span aria-hidden="true">{String(WORKSPACE_TABS.indexOf(tab) + 1).padStart(2, '0')}</span>{TAB_LABELS[tab]}</Link>)}</nav>
        {comparisonError && <div className="notice-bar" role="alert">{comparisonError}<button onClick={() => setComparisonError(null)}>×</button></div>}
        <section className="workspace-panel">{panel}</section>
      </main>
      <RunInspector run={selectedRun} baseline={baselineRun} />
    </div>
    {forkDialog && <div className="modal-backdrop"><section className="modal-sheet fork-dialog" role="dialog" aria-modal="true" aria-label="固定済みの比較案を複製"><div className="modal-heading"><div><span className="eyebrow">比較案の状態</span><h2>固定済みの比較案を複製</h2></div><button className="icon-button" aria-label="複製ダイアログを閉じる" onClick={() => setForkDialog(false)}>×</button></div><p>計算済み・固定の比較案は変更できません。変更理由を残して、編集可能な複製を作成します。</p><label><span>変更理由</span><textarea value={forkReason} onChange={(event) => setForkReason(event.target.value)} autoFocus /></label>{forkError && <p className="form-error">{forkError}</p>}<div className="modal-actions"><button onClick={() => setForkDialog(false)}>キャンセル</button><button className="primary-button" onClick={() => void submitFork()}>複製して編集</button></div></section></div>}
  </div>
}

function PanelLoading({ label }: { label: string }) {
  return <div className="panel-loading" role="status" aria-label={`${label}を読み込み中`}><span /><p>読み込んでいます…</p></div>
}
