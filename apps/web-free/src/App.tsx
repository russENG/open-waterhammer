import { lazy, Suspense, useEffect, useState } from 'react'
import type { WorkspaceData } from '@open-waterhammer/workspace'

import { onNavigate, type AppPage } from './lib/navigation'
import { WorkspaceApp } from './workspace/WorkspaceApp'
import { initializeBrowserWorkspace } from './workspace/bootstrap'
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

function documentationPage(hash: string): Exclude<AppPage, 'water-hammer'> | null {
  const value = hash.replace(/^#\/?docs\/?/, '').split(/[?/]/)[0]
  if (value === 'reference' || value === 'library' || value === 'design-flow' || value === 'hydraulic' || value === 'about') return value
  return null
}

export default function App() {
  const [hash, setHash] = useState(window.location.hash)
  const [workspace, setWorkspace] = useState<BrowserWorkspace | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)
  const docsPage = documentationPage(hash)

  useEffect(() => {
    const update = () => setHash(window.location.hash)
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])

  useEffect(() => onNavigate(({ page, topicId }) => {
    const target = page === 'water-hammer' ? '#/' : `#/docs/${page}${topicId ? `?topic=${encodeURIComponent(topicId)}` : ''}`
    window.location.hash = target
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
  return <WorkspaceApp repository={workspace.repository} initialData={workspace.data} />
}

function DocumentationShell({ page }: { page: Exclude<AppPage, 'water-hammer'> }) {
  const topic = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('topic') ?? undefined
  return <div className="docs-app">
    <header className="docs-header"><a className="docs-brand" href="#/"><span>OWH</span><div><strong>OPEN WATERHAMMER</strong><small>documentation & design references</small></div></a><div className="product-context"><span className="alpha-label">alpha</span><span className="support-label">設計比較支援</span></div><nav aria-label="Documentation sections"><a href="#/">Workspace</a><a className={page === 'reference' ? 'active' : ''} href="#/docs/reference">Reference</a><a className={page === 'library' ? 'active' : ''} href="#/docs/library">Library</a><a className={page === 'about' ? 'active' : ''} href="#/docs/about">About</a></nav></header>
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
