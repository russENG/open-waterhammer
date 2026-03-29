import { WaterhammerCalculator } from './components/WaterhammerCalculator'
import { EmpiricalCalculator } from './components/EmpiricalCalculator'
import { MocCalculator } from './components/MocCalculator'
import { PumpCalculator } from './components/PumpCalculator'
import './App.css'

export default function App() {
  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div className="header-title">
            <span className="header-badge">OSS</span>
            <h1>水撃圧計算</h1>
            <span className="header-sub">Open Civil Design / 社会基盤設計コモンズ</span>
          </div>
          <div className="header-standard">
            準拠: 土地改良設計基準パイプライン（令和3年6月改訂）
          </div>
        </div>
      </header>
      <main className="main">
        <WaterhammerCalculator />
        <EmpiricalCalculator />
        <MocCalculator />
        <PumpCalculator />
      </main>
      <footer className="footer">
        <p>計算ロジックはオープンソース（AGPL-3.0）。結果には採用基準・手法・前提条件を明示。</p>
      </footer>
    </div>
  )
}
