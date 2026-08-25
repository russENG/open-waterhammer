import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react'
import type { WorkspaceData } from '@open-waterhammer/workspace'

import { onNavigate, type AppPage } from './lib/navigation'
import { resolveLegacyHash } from './lib/legacy-hash'
import { WorkspaceApp } from './workspace/WorkspaceApp'
import { createBlankProject, initializeBrowserWorkspace, installSampleWorkspace } from './workspace/bootstrap'
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
  if (bootError) return <div className="boot-screen boot-screen--error" role="alert"><span>WORKSPACE ERROR</span><h1>ローカル Workspace を開けませんでした</h1><p>{bootError}</p><button onClick={() => window.location.reload()}>Reload</button></div>
  if (!workspace) return <div className="boot-screen" role="status"><div className="boot-mark"><i /><i /><i /></div><span>OPEN WATERHAMMER / alpha</span><h1>Local workspace</h1><p>IndexedDB と設計証跡を確認しています…</p></div>
  if (workspace.data.projects.length === 0) return <WorkspaceStart workspace={workspace} onReady={(data) => setWorkspace({ ...workspace, data })} />
  return <WorkspaceApp repository={workspace.repository} initialData={workspace.data} />
}

function WorkspaceStart({ workspace, onReady }: { workspace: BrowserWorkspace; onReady(data: WorkspaceData): void }) {
  const [projectName, setProjectName] = useState('')
  const [busy, setBusy] = useState<'blank' | 'sample' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(kind: 'blank' | 'sample') {
    setBusy(kind)
    setError(null)
    try {
      const data = kind === 'blank'
        ? await createBlankProject(workspace.repository, projectName)
        : await installSampleWorkspace(workspace.repository)
      onReady(data)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      setBusy(null)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void run('blank')
  }

  return <main className="workspace-start">
    <header className="workspace-start__brand"><span className="mark-lines" aria-hidden="true"><i /><i /><i /></span><div><strong>OPEN WATERHAMMER</strong><small>水撃圧の設計比較ワークスペース</small></div><b>alpha</b></header>
    <section className="workspace-start__intro"><span>LOCAL-FIRST WORKSPACE</span><h1>作業を始める</h1><p>新しい検討を始めるか、架空データ入りのサンプルで操作を確認できます。</p></section>
    <div className="workspace-start__choices">
      <form className="start-card" onSubmit={submit}>
        <span className="start-card__number">01</span><div><small>EMPTY PROJECT</small><h2>新規プロジェクト作成</h2><p>空の入力条件と「編集中」の比較案を1件作成します。</p></div>
        <label><span>プロジェクト名</span><input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="例：○○幹線 水撃圧検討" autoFocus /></label>
        <button className="start-card__button" disabled={busy !== null}>{busy === 'blank' ? '作成中…' : '作成する'}</button>
      </form>
      <article className="start-card start-card--sample">
        <span className="start-card__number">02</span><div><small>SAMPLE PROJECT</small><h2>サンプルを開く</h2><p>入力、シナリオ、比較案が入ったサンプルで画面を確認できます。</p></div>
        <div className="sample-project"><span>サンプルデータ</span><strong>サンプル：N地区東部幹線水路</strong><small>実在する路線・施設とは関係ありません</small></div>
        <button className="start-card__button" type="button" onClick={() => void run('sample')} disabled={busy !== null}>{busy === 'sample' ? '準備中…' : 'このサンプルを開く'}</button>
      </article>
    </div>
    {error && <p className="workspace-start__error" role="alert">{error}</p>}
    <aside className="local-storage-note"><strong>データの保存場所</strong><p>入力条件と作業状態は、このブラウザ内（IndexedDB）に保存されます。GitHub Pages のサーバーには送信されず、別の端末やブラウザとも自動同期されません。バックアップや共有には <code>.owhproj</code> の書き出しを利用してください。</p></aside>
  </main>
}

function DocumentationShell({ page }: { page: AppPage }) {
  const topic = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('topic') ?? undefined
  return <div className="docs-app">
    <header className="docs-header"><a className="docs-brand" href="#/"><span>OWH</span><div><strong>OPEN WATERHAMMER</strong><small>documentation & design references</small></div></a><div className="product-context"><span className="alpha-label">alpha</span><span className="support-label">設計比較支援</span></div><nav aria-label="サービス内メニュー"><a href="#/">作業画面</a><a className={page === 'reference' ? 'active' : ''} href="#/docs/reference">設計基準</a><a className={page === 'library' ? 'active' : ''} href="#/docs/library">計算ライブラリ</a><a className={page === 'design-flow' ? 'active' : ''} href="#/docs/design-flow">設計フロー</a><a className={page === 'hydraulic' ? 'active' : ''} href="#/docs/hydraulic">水理設計の視点</a><a className={page === 'about' ? 'active' : ''} href="#/docs/about">このサイトについて</a></nav></header>
    <main className="docs-main"><Suspense fallback={<div className="panel-loading" role="status"><span /><p>Loading documentation…</p></div>}>
      {page === 'reference' && <ReferencePage initialTopicId={topic} />}
      {page === 'library' && <LibraryPage initialAnchor={topic} />}
      {page === 'design-flow' && <DesignFlowPage />}
      {page === 'hydraulic' && <HydraulicOverviewPage />}
      {page === 'about' && <AboutPage />}
    </Suspense></main>
    <footer className="product-footer"><div><strong>alpha · 設計比較支援</strong><span>documentation preserved</span></div><p><b>適用限界：</b>自動評価は設計比較支援のための参考情報です。入力条件、適用基準、数値解法の妥当性は設計者が個別に確認してください。</p></footer>
  </div>
}
