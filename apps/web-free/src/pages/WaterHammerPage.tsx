/**
 * 水撃圧計算ページ
 * §8.3 選定フローに沿って解析手法を選択し、対応するコンポーネントを表示
 */
import { useState } from 'react'
import { MethodSelectionFlow, type SelectedMethod } from '../components/MethodSelectionFlow'
import { WaterhammerCalculator } from '../components/WaterhammerCalculator'
import { EmpiricalCalculator } from '../components/EmpiricalCalculator'
import { MocCalculator } from '../components/MocCalculator'
import { PumpCalculator } from '../components/PumpCalculator'
import { ProtectionCalculator } from '../components/ProtectionCalculator'

export function WaterHammerPage() {
  const [method, setMethod] = useState<SelectedMethod | null>(null)

  const showEmpirical = method === 'empirical'
  const showNumerical = method === 'numerical-nopump' || method === 'numerical-pump'
  const showPump = method === 'numerical-pump'

  return (
    <div className="page-waterhammer">
      <div className="page-header">
        <h2 className="page-title">水撃圧計算</h2>
        <p className="page-desc">
          土地改良設計基準　設計「パイプライン」技術書（令和3年6月改訂）§8 準拠。
          以下の選定フローに従って解析手法を選択してください。
        </p>
      </div>

      {/* 手法選定フロー */}
      <MethodSelectionFlow onSelect={setMethod} selected={method} />

      {/* 手法選定後のみ表示 */}
      {method && (
        <>
          {/* 伝播速度計算は常に先頭 */}
          <div className="wh-section-label">
            <span className="wh-section-step">Step 1</span>
            伝播速度の算定（§8.3.1）
          </div>
          <WaterhammerCalculator />

          {/* 経験則 */}
          {showEmpirical && (
            <>
              <div className="wh-section-label">
                <span className="wh-section-step">Step 2</span>
                経験則による水撃圧の算定（§8.3.2）
              </div>
              <EmpiricalCalculator />
            </>
          )}

          {/* 数値解析（MOC）*/}
          {showNumerical && (
            <>
              <div className="wh-section-label">
                <span className="wh-section-step">Step 2</span>
                特性曲線法（MOC）による水撃圧の解析（§8.4）
              </div>
              <MocCalculator />
            </>
          )}

          {/* ポンプ解析 */}
          {showPump && (
            <>
              <div className="wh-section-label">
                <span className="wh-section-step">Step 3</span>
                ポンプ急停止・起動解析（§8.4.4〜§8.4.5）
              </div>
              <PumpCalculator />
            </>
          )}

          {/* 防護工解析（数値解析の場合） */}
          {showNumerical && (
            <>
              <div className="wh-section-label">
                <span className="wh-section-step">{showPump ? 'Step 4' : 'Step 3'}</span>
                水撃圧防護工の選定・効果検証（§8.4.6）
              </div>
              <ProtectionCalculator />
            </>
          )}
        </>
      )}
    </div>
  )
}
