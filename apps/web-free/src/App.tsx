import { useState } from 'react'
import { AboutPage } from './pages/AboutPage'
import { DesignFlowPage } from './pages/DesignFlowPage'
import { HydraulicOverviewPage } from './pages/HydraulicOverviewPage'
import { WaterHammerPage } from './pages/WaterHammerPage'
import './App.css'

type Page = 'about' | 'design-flow' | 'hydraulic' | 'water-hammer'

const NAV_ITEMS: { id: Page; label: string }[] = [
  { id: 'about', label: '社会基盤設計コモンズとは' },
  { id: 'design-flow', label: 'パイプライン設計フロー' },
  { id: 'hydraulic', label: '水理計算俯瞰' },
  { id: 'water-hammer', label: '水撃圧計算' },
]

export default function App() {
  const [page, setPage] = useState<Page>('about')

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div className="header-title">
            <span className="header-badge">OSS</span>
            <h1>社会基盤設計コモンズ</h1>
            <span className="header-sub">Open Civil Design</span>
          </div>
          <div className="header-standard">
            農業用パイプライン設計 / 土地改良設計基準　設計「パイプライン」技術書（令和3年6月改訂）準拠
          </div>
        </div>
        <nav className="nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`nav-link${page === item.id ? ' nav-link--active' : ''}`}
              onClick={() => setPage(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>
      <main className="main">
        {page === 'about' && <AboutPage />}
        {page === 'design-flow' && <DesignFlowPage />}
        {page === 'hydraulic' && <HydraulicOverviewPage />}
        {page === 'water-hammer' && <WaterHammerPage />}
      </main>
      <footer className="footer">
        <p>計算ロジックはオープンソース（AGPL-3.0）。結果には採用基準・手法・前提条件を明示。</p>
      </footer>
    </div>
  )
}
