import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react'
import type { Project } from '@open-waterhammer/contracts'
import type { ParseError, WorkbookData } from '@open-waterhammer/excel-io'
import type { WorkspaceData } from '@open-waterhammer/workspace'

import { SITE_TITLE } from './branding'
import { onNavigate, type AppPage } from './lib/navigation'
import { resolveLegacyHash } from './lib/legacy-hash'
import { ensureBrowserBuffer } from './reports/browser-buffer'
import { WorkspaceApp } from './workspace/WorkspaceApp'
import {
  createBlankProject,
  createProjectFromExcel,
  initializeBrowserWorkspace,
  installSampleWorkspace,
  replaceProjectFromExcel,
  replaceWithBlankProject,
  replaceWithSampleWorkspace,
} from './workspace/bootstrap'
import { downloadInputTemplate } from './workspace/excel-template-download'
import { projectDisplayName } from './workspace/project-label'
import { replaceProjectFile } from './workspace/project-transfer'
import type { WorkspaceRepositoryClient } from './workspace/workspace-context'
import './App.css'

const AboutPage = lazy(() => import('./pages/AboutPage').then((module) => ({ default: module.AboutPage })))
const DesignFlowPage = lazy(() => import('./pages/DesignFlowPage').then((module) => ({ default: module.DesignFlowPage })))
const HydraulicOverviewPage = lazy(() => import('./pages/HydraulicOverviewPage').then((module) => ({ default: module.HydraulicOverviewPage })))
const LibraryPage = lazy(() => import('./pages/LibraryPage').then((module) => ({ default: module.LibraryPage })))
const ReferencePage = lazy(() => import('./pages/ReferencePage').then((module) => ({ default: module.ReferencePage })))

interface BrowserWorkspace {
  repository: WorkspaceRepositoryClient
  data: WorkspaceData
}

function documentationPage(hash: string): AppPage | null {
  const value = hash.replace(/^#\/?docs\/?/, '').split(/[?/]/)[0]
  if (value === 'reference' || value === 'library' || value === 'design-flow' || value === 'hydraulic' || value === 'about') return value
  return null
}

export default function App() {
  const [hash, setHash] = useState(() => resolveLegacyHash(window.location.hash) ?? window.location.hash)
  const [workspace, setWorkspace] = useState<BrowserWorkspace | null>(null)
  // 起動時は保存済みプロジェクトの有無にかかわらず開始画面を出す。作業画面へ入るのは、
  // 開始画面で「続ける」「Excelから開始」などを利用者が明示的に選んだときだけ。
  const [entered, setEntered] = useState(false)
  const [bootError, setBootError] = useState<string | null>(null)
  const docsPage = documentationPage(hash)

  // レガシー式アンカー URL（#joukowsky 等）を #/docs/library へ書き換える。
  // 初期表示・hashchange の両方をこの1エフェクトでカバーする（マウント時に一度手動実行）。
  // `location.hash = target` は使わない — それは新しい履歴エントリを push してしまい、
  // 「外部引用リンクから着地 → 補正後の URL」という2エントリの間に元の #joukowsky が
  // 残り続け、Back を押すたびに hashchange が再発火してまた push し直す
  // （Back で参照元まで戻れなくなる）罠になる。replaceState は現在のエントリを
  // その場で書き換えるだけなので履歴は増えず、hashchange も飛ばないため state は
  // 明示的に setHash で揃える。
  useEffect(() => {
    const update = () => {
      const raw = window.location.hash
      const legacyTarget = resolveLegacyHash(raw)
      if (legacyTarget) {
        history.replaceState(null, '', legacyTarget)
        setHash(legacyTarget)
        return
      }
      setHash(raw)
    }
    update()
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])

  useEffect(() => onNavigate(({ page, topicId }) => {
    window.location.hash = `#/docs/${page}${topicId ? `?topic=${encodeURIComponent(topicId)}` : ''}`
  }), [])

  useEffect(() => {
    if (docsPage || workspace) return
    let active = true
    initializeBrowserWorkspace().then((opened) => {
      if (active) setWorkspace(opened)
      else opened.repository.close()
    }).catch((error) => {
      if (active) setBootError(error instanceof Error ? error.message : String(error))
    })
    return () => { active = false }
  }, [docsPage, workspace])

  if (docsPage) return <DocumentationShell page={docsPage} />
  if (bootError) return <div className="boot-screen boot-screen--error" role="alert"><span>作業画面エラー</span><h1>ローカル作業画面を開けませんでした</h1><p>{bootError}</p><button onClick={() => window.location.reload()}>再読み込み</button></div>
  if (!workspace) return <div className="boot-screen" role="status"><div className="boot-mark"><i /><i /><i /></div><span>{SITE_TITLE}</span><h1>ローカル作業画面</h1><p>IndexedDB と設計証跡を確認しています…</p></div>
  if (!entered) return <WorkspaceStart workspace={workspace} onReady={(data) => { setWorkspace({ ...workspace, data }); setEntered(true) }} />
  return <WorkspaceApp repository={workspace.repository} initialData={workspace.data} />
}

/**
 * 開始画面の導線。保存内容を置き換える操作は、いったんこの型に積んでから確認画面を挟む。
 * Excelだけは、置き換えを確認する前に検証を済ませておく（不正なExcelで確認を出さない）。
 */
type StartAction =
  | { kind: 'excel'; workbook: WorkbookData; warnings: string[] }
  | { kind: 'project'; file: File }
  | { kind: 'sample' }
  | { kind: 'blank'; projectName: string }

const REPLACE_ACTION_LABEL: Record<StartAction['kind'], string> = {
  excel: 'Excelから新しいプロジェクトを作成する',
  project: '.owhproj のプロジェクトを開く',
  sample: 'サンプルを開く',
  blank: '空のプロジェクトを作成する',
}

/** 保存済みプロジェクトのうち、再開の対象として見せる1件（最終更新が新しいもの）。 */
function latestProject(data: WorkspaceData): Project | null {
  return [...data.projects].sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : -1))[0] ?? null
}

/** 端末の書式差で表示が揺れないよう、保存日時は固定書式で出す。 */
function formatSavedAt(timestamp: string): string {
  const at = new Date(timestamp)
  if (Number.isNaN(at.getTime())) return '日時不明'
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${at.getFullYear()}/${pad(at.getMonth() + 1)}/${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

export function WorkspaceStart({ workspace, onReady }: { workspace: BrowserWorkspace; onReady(data: WorkspaceData): void }) {
  const [projectName, setProjectName] = useState('')
  const [busy, setBusy] = useState<'excel' | 'project' | 'template' | 'blank' | 'sample' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [parseErrors, setParseErrors] = useState<ParseError[]>([])
  // 取込は成功したが注意事項があるとき、作業画面へ進む前に一度見せる。
  // 既定値で補完した項目（静水位など）は計算結果を左右するため、黙って通さない。
  const [importReport, setImportReport] = useState<{ data: WorkspaceData; warnings: string[] } | null>(null)
  // 保存済みプロジェクトがあるときだけ、置き換え前の確認画面に積む操作。
  const [pending, setPending] = useState<StartAction | null>(null)

  const saved = latestProject(workspace.data)
  // 保存が無いときは 01 から、あるときは「続きから再開」が 01 なので 02 から番号を振る。
  const step = (order: number) => String(saved ? order + 1 : order).padStart(2, '0')

  async function perform(action: StartAction) {
    setPending(null)
    setBusy(action.kind)
    setError(null)
    try {
      if (action.kind === 'blank') {
        onReady(saved
          ? await replaceWithBlankProject(workspace.repository, action.projectName)
          : await createBlankProject(workspace.repository, action.projectName))
      } else if (action.kind === 'sample') {
        onReady(saved
          ? await replaceWithSampleWorkspace(workspace.repository)
          : await installSampleWorkspace(workspace.repository))
      } else if (action.kind === 'project') {
        // replaceProjectFile は検証してから置き換えるので、壊れたファイルでは保存内容が残る。
        await replaceProjectFile(workspace.repository, action.file)
        onReady(await workspace.repository.snapshot())
      } else {
        const created = saved
          ? await replaceProjectFromExcel(workspace.repository, action.workbook)
          : await createProjectFromExcel(workspace.repository, action.workbook)
        const warnings = [...action.warnings, ...created.warnings]
        if (warnings.length > 0) setImportReport({ data: created.data, warnings })
        else onReady(created.data)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(null)
    }
  }

  /** 保存済みプロジェクトがあるなら確認画面へ、無ければそのまま実行する。 */
  function request(action: StartAction): Promise<void> {
    setError(null)
    setParseErrors([])
    if (!saved) return perform(action)
    setPending(action)
    return Promise.resolve()
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const name = projectName.trim()
    if (!name) {
      setError('プロジェクト名を入力してください。')
      return
    }
    void request({ kind: 'blank', projectName: name })
  }

  async function openExcel(file: File) {
    setBusy('excel')
    setError(null)
    setParseErrors([])
    try {
      await ensureBrowserBuffer()
      const { parseWorkbook } = await import('@open-waterhammer/excel-io')
      const result = await parseWorkbook(await file.arrayBuffer())
      if (result.errors.length > 0) {
        setParseErrors(result.errors)
        setError('Excelに入力エラーがあるため、プロジェクトは作成していません。')
        return
      }
      await request({ kind: 'excel', workbook: result.data, warnings: result.warnings })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(null)
    }
  }

  async function downloadTemplate() {
    setBusy('template')
    setError(null)
    try {
      await downloadInputTemplate()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(null)
    }
  }

  if (importReport) return <main className="workspace-start import-report">
    <header className="workspace-start__brand"><span className="mark-lines" aria-hidden="true"><i /><i /><i /></span><strong>{SITE_TITLE}</strong></header>
    <section className="workspace-start__intro"><span>Excel取込</span><h1>取り込みました（注意 {importReport.warnings.length}件）</h1><p>既定値で補完した項目や、正本の値で読み替えた項目があります。作業画面へ進む前に確認してください。</p></section>
    <ol className="import-report__list">{importReport.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ol>
    <button className="start-card__button" type="button" onClick={() => onReady(importReport.data)}>確認した · 作業画面へ進む</button>
  </main>

  if (saved && pending) return <main className="workspace-start start-confirm" role="alertdialog" aria-labelledby="start-confirm-title">
    <header className="workspace-start__brand"><span className="mark-lines" aria-hidden="true"><i /><i /><i /></span><strong>{SITE_TITLE}</strong></header>
    <section className="workspace-start__intro"><span>確認</span><h1 id="start-confirm-title">保存内容を置き換えます</h1><p>このブラウザーには「{projectDisplayName(saved)}」（最終更新 {formatSavedAt(saved.updatedAt)}）が保存されています。{REPLACE_ACTION_LABEL[pending.kind]}と、この保存内容は置き換えられ、元に戻せません。</p></section>
    <p className="start-confirm__note">保存内容を残したいときは、「やめる」→「続ける」で作業画面に戻り、<code>.owhproj</code> を書き出してから実行してください。</p>
    <div className="start-confirm__actions">
      <button className="start-card__button" type="button" onClick={() => void perform(pending)}>置き換えて実行</button>
      <button className="start-confirm__cancel" type="button" onClick={() => setPending(null)}>やめる</button>
    </div>
  </main>

  return <main className="workspace-start">
    <header className="workspace-start__brand"><span className="mark-lines" aria-hidden="true"><i /><i /><i /></span><strong>{SITE_TITLE}</strong></header>
    <section className="workspace-start__intro"><span>ブラウザ内に保存する作業画面</span><h1>作業を始める</h1><p>起動時は必ずこの画面から始まります。作業画面へ入るのは、下の導線を選んだときだけです。実案件はExcelから開始するのが推奨で、読込後はWeb画面のプロジェクトデータを正本として確認・修正します。</p></section>
    <div className="workspace-start__choices">
      {saved && <article className="start-card start-card--resume" style={{ gridColumn: '1 / -1', minHeight: 0 }}>
        <span className="start-card__number">01</span><div><small>前回の続き</small><h2>このブラウザーの続きから再開</h2><p>このブラウザー（IndexedDB）に保存されている作業内容です。「続ける」を押すまで作業画面は開きません。</p></div>
        <div className="sample-project"><span>保存済み</span><strong>{projectDisplayName(saved)}</strong><small>最終更新 {formatSavedAt(saved.updatedAt)} ／ 比較案 {workspace.data.cases.length}件・計算 {workspace.data.runs.length}件{workspace.data.projects.length > 1 ? ` ／ ほかにプロジェクト${workspace.data.projects.length - 1}件` : ''}</small></div>
        <button className="start-card__button" type="button" onClick={() => onReady(workspace.data)} disabled={busy !== null}>続ける</button>
      </article>}
      <article className="start-card start-card--sample" style={{ gridColumn: '1 / -1', minHeight: 270 }}>
        <span className="start-card__number">{step(1)}</span><div><small>実案件の推奨導線</small><h2>Excelから開始</h2><p>入力を検証してから、案件情報のプロジェクト名と最初の「編集中」の比較案を自動作成します。入力エラー時は空のプロジェクトを残しません。</p></div>
        <div className="sample-project"><span>入力データの扱い</span><strong>Excelは初期一括入力、読込後はWeb画面が正本</strong><small>保存・共有・作業再開には .owhproj を使用します</small></div>
        <div>
          <label><span>入力済みExcelを選択</span><input type="file" accept=".xlsx" aria-label="Excelから開始するファイルを選択" disabled={busy !== null} onChange={(event) => { const file = event.target.files?.[0]; if (file) void openExcel(file); event.currentTarget.value = '' }} /></label>
          <button className="start-card__button" type="button" onClick={() => void downloadTemplate()} disabled={busy !== null}>{busy === 'template' ? '準備中…' : '入力テンプレートをダウンロード'}</button>
        </div>
      </article>
      <article className="start-card">
        <span className="start-card__number">{step(2)}</span><div><small>保存したファイルから</small><h2>プロジェクトファイルを開く</h2><p>書き出した <code>.owhproj</code> を読み込み、別の端末やブラウザーでの続きを再開します。</p></div>
        <label><span>プロジェクトファイルを選択</span><input type="file" accept=".owhproj" aria-label="owhprojプロジェクトを開く" disabled={busy !== null} onChange={(event) => { const file = event.target.files?.[0]; if (file) void request({ kind: 'project', file }); event.currentTarget.value = '' }} /></label>
      </article>
      <form className="start-card" onSubmit={submit}>
        <span className="start-card__number">{step(3)}</span><div><small>補助導線</small><h2>空から始める</h2><p>Excelを使わず、空の入力条件と「編集中」の比較案を1件作成します。</p></div>
        <label><span>プロジェクト名</span><input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="例：○○幹線 水撃圧検討" /></label>
        <button className="start-card__button" disabled={busy !== null}>{busy === 'blank' ? '作成中…' : '作成する'}</button>
      </form>
      <article className="start-card start-card--sample">
        <span className="start-card__number">{step(4)}</span><div><small>補助導線</small><h2>サンプルを開く</h2><p>入力、シナリオ、比較案が入ったサンプルで画面を確認できます。</p></div>
        <div className="sample-project"><span>サンプルデータ</span><strong>サンプル：N地区東部幹線水路</strong><small>実在する路線・施設とは関係ありません</small></div>
        <button className="start-card__button" type="button" onClick={() => void request({ kind: 'sample' })} disabled={busy !== null}>{busy === 'sample' ? '準備中…' : 'このサンプルを開く'}</button>
      </article>
    </div>
    {error && <p className="workspace-start__error" role="alert">{error}</p>}
    {parseErrors.length > 0 && <div className="workspace-start__error">{parseErrors.map((item, index) => <p key={index}>[{item.sheet}{item.row != null ? ` 行${item.row}` : ''}{item.field ? ` / ${item.field}` : ''}] {item.message}</p>)}</div>}
    <aside className="local-storage-note"><strong>データの保存場所</strong><p>入力条件と作業状態は、このブラウザ内（IndexedDB）に保存されます。GitHub Pages のサーバーには送信されず、別の端末やブラウザとも自動同期されません。バックアップや共有には <code>.owhproj</code> の書き出しを利用してください。<br />ブラウザー内の保存は暗号化保管庫ではありません。機微な施設情報は、バージョン固定のオフライン版を組織内で利用してください。</p></aside>
  </main>
}

function DocumentationShell({ page }: { page: AppPage }) {
  const topic = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('topic') ?? undefined
  return <div className="docs-app">
    <header className="docs-header"><a className="docs-brand" href="#/"><span className="mark-lines" aria-hidden="true"><i /><i /><i /></span><strong>{SITE_TITLE}</strong></a><nav aria-label="サービス内メニュー"><a href="#/">作業画面</a><a className={page === 'reference' ? 'active' : ''} href="#/docs/reference">設計基準</a><a className={page === 'library' ? 'active' : ''} href="#/docs/library">計算ライブラリ</a><a className={page === 'design-flow' ? 'active' : ''} href="#/docs/design-flow">設計フロー</a><a className={page === 'hydraulic' ? 'active' : ''} href="#/docs/hydraulic">水理設計の視点</a><a className={page === 'about' ? 'active' : ''} href="#/docs/about">このサイトについて</a><a href="demo/">デモ手順</a></nav></header>
    <main className="docs-main"><Suspense fallback={<div className="panel-loading" role="status"><span /><p>設計資料を読み込んでいます…</p></div>}>
      {page === 'reference' && <ReferencePage initialTopicId={topic} />}
      {page === 'library' && <LibraryPage initialAnchor={topic} />}
      {page === 'design-flow' && <DesignFlowPage />}
      {page === 'hydraulic' && <HydraulicOverviewPage />}
      {page === 'about' && <AboutPage />}
    </Suspense></main>
  </div>
}
