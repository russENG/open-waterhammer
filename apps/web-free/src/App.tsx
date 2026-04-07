import { useState, useEffect } from 'react'
import { AboutPage } from './pages/AboutPage'
import { DesignFlowPage } from './pages/DesignFlowPage'
import { HydraulicOverviewPage } from './pages/HydraulicOverviewPage'
import { WaterHammerPage } from './pages/WaterHammerPage'
import { ReferencePage } from './pages/ReferencePage'
import { onNavigate, type AppPage } from './lib/navigation'
import './App.css'

export default function App() {
  const [page, setPage] = useState<AppPage>('water-hammer')
  const [refTopicId, setRefTopicId] = useState<string | undefined>(undefined)

  // 子コンポーネントからの「基準照会の特定トピックを開いて」要求を受信
  useEffect(() => {
    return onNavigate((detail) => {
      setPage(detail.page)
      if (detail.page === 'reference') {
        setRefTopicId(detail.topicId)
      }
      window.scrollTo({ top: 0, behavior: 'smooth' })
    })
  }, [])

  function navigate(target: AppPage) {
    setPage(target)
    if (target !== 'reference') setRefTopicId(undefined)
  }

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
              onClick={() => navigate('water-hammer')}
            >
              計算
            </button>
            <button
              className={`header-nav-btn${page === 'reference' ? ' header-nav-btn--active' : ''}`}
              onClick={() => navigate('reference')}
            >
              基準照会
            </button>
            <button
              className={`header-nav-btn${page === 'design-flow' ? ' header-nav-btn--active' : ''}`}
              onClick={() => navigate('design-flow')}
            >
              設計フロー
            </button>
            <button
              className={`header-nav-btn${page === 'hydraulic' ? ' header-nav-btn--active' : ''}`}
              onClick={() => navigate('hydraulic')}
            >
              水理俯瞰
            </button>
            <button
              className={`header-nav-btn${page === 'about' ? ' header-nav-btn--active' : ''}`}
              onClick={() => navigate('about')}
            >
              about
            </button>
          </div>
        </div>
      </header>
      <main className={page === 'reference' ? 'main main--fullwidth' : 'main'}>
        {page === 'about' && <AboutPage />}
        {page === 'design-flow' && <DesignFlowPage />}
        {page === 'hydraulic' && <HydraulicOverviewPage />}
        {page === 'water-hammer' && <WaterHammerPage />}
        {page === 'reference' && <ReferencePage initialTopicId={refTopicId} />}
      </main>
      <footer className="footer">
        <p>計算ロジックはオープンソース（AGPL-3.0）。結果には採用基準・手法・前提条件を明示。</p>
        <div className="footer-links">
          <button className="footer-link" onClick={() => navigate('water-hammer')}>
            水撃圧計算
          </button>
          <span className="footer-sep">|</span>
          <button className="footer-link" onClick={() => navigate('reference')}>
            基準照会
          </button>
          <span className="footer-sep">|</span>
          <button className="footer-link" onClick={() => navigate('design-flow')}>
            パイプライン設計フロー
          </button>
          <span className="footer-sep">|</span>
          <button className="footer-link" onClick={() => navigate('hydraulic')}>
            水理計算俯瞰
          </button>
          <span className="footer-sep">|</span>
          <button className="footer-link" onClick={() => navigate('about')}>
            社会基盤設計コモンズとは
          </button>
        </div>
      </footer>
    </div>
  )
}
