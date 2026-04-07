import { useState } from 'react'
import { AboutPage } from './pages/AboutPage'
import { DesignFlowPage } from './pages/DesignFlowPage'
import { HydraulicOverviewPage } from './pages/HydraulicOverviewPage'
import { WaterHammerPage } from './pages/WaterHammerPage'
import { ReferencePage } from './pages/ReferencePage'
import './App.css'

type Page = 'about' | 'design-flow' | 'hydraulic' | 'water-hammer' | 'reference'

export default function App() {
  const [page, setPage] = useState<Page>('water-hammer')

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div className="header-title">
            <span className="header-badge">OSS</span>
            <h1>水撃圧計算</h1>
            <span className="header-sub">農業用パイプライン設計</span>
          </div>
          <div className="header-actions">
            <button
              className={`header-nav-btn${page === 'water-hammer' ? ' header-nav-btn--active' : ''}`}
              onClick={() => setPage('water-hammer')}
            >
              計算
            </button>
            <button
              className={`header-nav-btn${page === 'reference' ? ' header-nav-btn--active' : ''}`}
              onClick={() => setPage('reference')}
            >
              基準照会
            </button>
          </div>
        </div>
      </header>
      <main className={page === 'reference' ? 'main main--fullwidth' : 'main'}>
        {page === 'about' && <AboutPage />}
        {page === 'design-flow' && <DesignFlowPage />}
        {page === 'hydraulic' && <HydraulicOverviewPage />}
        {page === 'water-hammer' && <WaterHammerPage />}
        {page === 'reference' && <ReferencePage />}
      </main>
      <footer className="footer">
        <p>計算ロジックはオープンソース（AGPL-3.0）。結果には採用基準・手法・前提条件を明示。</p>
        <div className="footer-links">
          <button className="footer-link" onClick={() => setPage('water-hammer')}>
            水撃圧計算
          </button>
          <span className="footer-sep">|</span>
          <button className="footer-link" onClick={() => setPage('reference')}>
            基準照会
          </button>
          <span className="footer-sep">|</span>
          <button className="footer-link" onClick={() => setPage('design-flow')}>
            パイプライン設計フロー
          </button>
          <span className="footer-sep">|</span>
          <button className="footer-link" onClick={() => setPage('hydraulic')}>
            水理計算俯瞰
          </button>
          <span className="footer-sep">|</span>
          <button className="footer-link" onClick={() => setPage('about')}>
            社会基盤設計コモンズとは
          </button>
        </div>
      </footer>
    </div>
  )
}
