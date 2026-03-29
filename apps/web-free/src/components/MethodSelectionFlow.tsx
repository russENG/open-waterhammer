/**
 * 水撃圧解析手法 選定フロー
 * 土地改良設計基準　設計「パイプライン」技術書（令和3年6月改訂）§8.3.2 に基づく手法選定
 *
 * 技術書の原則：「水撃圧の予測は計算による方法を原則とする」（§8.3.2(2)）
 * 経験則のみ可の例外：
 *   - パイプライン形式がオープンタイプ の場合
 *   - 給水栓を有する水田用配水系パイプラインで低圧（静水圧0.35MPa未満）の場合
 *   （上記どちらかに該当し、かつ負圧の検討が不要な場合）
 * 数値解法必須：負圧（下降圧）の検討が必要な場合
 */
import { useState } from 'react'

export type SelectedMethod =
  | 'empirical'          // 経験則・理論解法のみ（条件付き適用）
  | 'numerical-nopump'   // 数値解析（ポンプなし）
  | 'numerical-pump'     // 数値解析（ポンプあり）

interface Props {
  onSelect: (method: SelectedMethod) => void
  selected?: SelectedMethod | null
}

interface Answers {
  needsNegative?: boolean  // Q1: 負圧の検討が必要か
  isOpen?: boolean         // Q2: オープンタイプか
  isRiceLow?: boolean      // Q3: 水田用 AND 静水圧<0.35MPa か
  hasPump?: boolean        // Q4: ポンプ系含むか
}

type Step = 'q1' | 'q2' | 'q3' | 'q4' | 'done'

export function MethodSelectionFlow({ onSelect }: Props) {
  const [answers, setAnswers] = useState<Answers>({})
  const [step, setStep] = useState<Step>('q1')
  const [diagramOpen, setDiagramOpen] = useState(true)

  function answer(key: keyof Answers, val: boolean) {
    const next = { ...answers, [key]: val }
    setAnswers(next)

    if (key === 'needsNegative') {
      // Q1: 負圧検討が必要 → 数値解法必須（Q4へ）
      if (val) { setStep('q4'); return }
      setStep('q2')
    } else if (key === 'isOpen') {
      // Q2: オープンタイプ → 経験則可（確定）
      if (val) { setStep('done'); onSelect('empirical'); return }
      setStep('q3')
    } else if (key === 'isRiceLow') {
      // Q3: 水田用低圧 → 経験則可
      if (val) { setStep('done'); onSelect('empirical'); return }
      // どちらでもない → 計算必須（Q4へ）
      setStep('q4')
    } else if (key === 'hasPump') {
      // Q4: ポンプ系
      const method: SelectedMethod = val ? 'numerical-pump' : 'numerical-nopump'
      setStep('done')
      onSelect(method)
    }
  }

  function reset() {
    setAnswers({})
    setStep('q1')
    onSelect(null as unknown as SelectedMethod)
  }

  const methodLabel: Record<SelectedMethod, string> = {
    'empirical': '経験則による方法（§8.3.2）',
    'numerical-nopump': '計算による方法 → 特性曲線法（§8.4）',
    'numerical-pump': '計算による方法 → 特性曲線法 + ポンプ解析（§8.4）',
  }
  const methodDesc: Record<SelectedMethod, string> = {
    'empirical': 'ジューコフスキーの式（急閉そく）またはアリエビの近似式（緩閉そく）による推定。' +
      '計算による値との対比を行って採用値を決定すること（§8.3.2(2)）。' +
      '負圧の検討が必要になった場合は数値解法へ移行。',
    'numerical-nopump': 'バルブ操作を境界条件とした MOC 数値解析。上昇圧・下降圧を時系列で評価。' +
      '防護工の効果検証まで対応。経験則による値との対比を行うこと（§8.3.2(2)）。',
    'numerical-pump': 'ポンプ急停止・起動を GD² 慣性方程式で扱う MOC 数値解析。' +
      '上昇圧・下降圧・防護工の効果検証まで対応。',
  }
  const methodColor: Record<SelectedMethod, string> = {
    'empirical': '#276749',
    'numerical-nopump': '#1a56db',
    'numerical-pump': '#6b46c1',
  }

  const method = step === 'done'
    ? (answers.needsNegative || (!answers.isOpen && !answers.isRiceLow)
        ? (answers.hasPump ? 'numerical-pump' : 'numerical-nopump')
        : 'empirical') as SelectedMethod
    : null

  return (
    <div className="msf-wrap">
      {/* ── 図-8.3.4 予測方法分類 ───────────────── */}
      <button
        className="msf-diagram-toggle"
        onClick={() => setDiagramOpen(v => !v)}
        aria-expanded={diagramOpen}
      >
        {diagramOpen ? '▲' : '▼'} 図-8.3.4　水撃圧の予測方法（§8.3.2 準拠）
      </button>

      {diagramOpen && (
        <div className="msf-diagram">
          {/* 分類ツリー（図-8.3.4）*/}
          <div className="msfd-tree">
            <div className="msfd-root">水撃圧の予測方法</div>
            <div className="msfd-branches">

              <div className="msfd-branch">
                <div className="msfd-branch-line" />
                <div className="msfd-node msfd-node--empirical">
                  <span className="msfd-node-label">経験則による方法</span>
                  <div className="msfd-node-cond">
                    適用可：オープンタイプ<br />
                    または水田用低圧（静水圧&lt;0.35MPa）<br />
                    <em>かつ負圧検討が不要な場合</em>
                  </div>
                </div>
              </div>

              <div className="msfd-branch">
                <div className="msfd-branch-line" />
                <div className="msfd-node msfd-node--calc">
                  <span className="msfd-node-label">計算による方法<span className="msfd-node-principal">（原則）</span></span>
                  <div className="msfd-sub-branches">

                    <div className="msfd-sub-branch">
                      <div className="msfd-sub-node msfd-sub-node--theory">
                        <span className="msfd-sub-label">理論解法</span>
                        <div className="msfd-leaves">
                          <div className="msfd-leaf">
                            <span className="msfd-leaf-cond">急閉そく（t &lt; 2L/a）</span>
                            <span className="msfd-leaf-name">ジューコフスキーの式</span>
                          </div>
                          <div className="msfd-leaf">
                            <span className="msfd-leaf-cond">緩閉そく（t &gt; 2L/a）</span>
                            <span className="msfd-leaf-name">アリエビの近似式</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="msfd-sub-branch">
                      <div className="msfd-sub-node msfd-sub-node--numerical">
                        <span className="msfd-sub-label">数値解法</span>
                        <div className="msfd-node-cond">
                          必須：負圧（下降圧）検討時
                        </div>
                        <div className="msfd-leaves">
                          <div className="msfd-leaf msfd-leaf--impl">
                            <span className="msfd-impl-badge">実装済</span>
                            <span className="msfd-leaf-name">特性曲線法（MOC）</span>
                          </div>
                          <div className="msfd-leaf msfd-leaf--planned">
                            <span className="msfd-impl-badge msfd-impl-badge--planned">計画中</span>
                            <span className="msfd-leaf-name">中心差分法</span>
                          </div>
                        </div>
                      </div>
                    </div>

                  </div>
                </div>
              </div>

            </div>
          </div>

          {/* 適用基準の注記 */}
          <div className="msfd-note">
            <strong>§8.3.2(2) 適用基準の要点：</strong>
            計算による値が経験則の値を上回る場合はバルブ操作速度等を調整して経験則値以下にすること。
            下回る場合も不確定要素・安全性を考慮し経験則値を使用してよい。
            いずれの場合も計算値と経験則値を対比して採用値を決定する。
          </div>
        </div>
      )}

      {/* ── インタラクティブ選定 ─────────────────── */}
      <div className="msf-wizard">
        <div className="msf-wizard-header">
          <span className="msf-wizard-title">
            {step === 'done' ? '解析手法が決定しました' : '手法を選択する（対話式）'}
          </span>
          {step !== 'q1' && (
            <button className="msf-reset-btn" onClick={reset}>やり直す</button>
          )}
        </div>

        {step !== 'done' && (
          <div className="msf-questions">

            <QuestionCard
              num="Q1"
              text="下降圧（負圧）の検討が必要ですか？"
              note="バルブ急閉・ポンプ急停止等で管路が負圧になる恐れがある場合は「はい」。経験則・理論解法は上昇圧のみ扱えるため、負圧検討には数値解法が必須。"
              active={step === 'q1'}
              answer={answers.needsNegative}
              onYes={() => answer('needsNegative', true)}
              onNo={() => answer('needsNegative', false)}
            />

            {answers.needsNegative === false && (
              <QuestionCard
                num="Q2"
                text="パイプライン形式は「オープンタイプ」ですか？"
                note="調圧水槽等による自由水面を持つ開放型システム。オープンタイプの場合は経験則のみで水撃圧の推定を行ってもよい（§8.3.2(2)）。"
                active={step === 'q2'}
                answer={answers.isOpen}
                onYes={() => answer('isOpen', true)}
                onNo={() => answer('isOpen', false)}
              />
            )}

            {answers.needsNegative === false && answers.isOpen === false && (
              <QuestionCard
                num="Q3"
                text="「給水栓を有する水田用配水系パイプライン」かつ「静水圧 0.35 MPa 未満」ですか？"
                note="両条件を同時に満たす場合は経験則のみで推定可（§8.3.2(2)）。畑地潅漑・高圧系等の場合は「いいえ」。"
                active={step === 'q3'}
                answer={answers.isRiceLow}
                onYes={() => answer('isRiceLow', true)}
                onNo={() => answer('isRiceLow', false)}
              />
            )}

            {(step === 'q4') && (
              <QuestionCard
                num="Q4"
                text="ポンプ急停止・起動のシナリオを含みますか？"
                note="ポンプを含む場合は GD²（はずみ車効果）慣性方程式・ポンプ H-Q 特性が境界条件として必要（§8.4.4〜§8.4.5）。"
                active={step === 'q4'}
                answer={answers.hasPump}
                onYes={() => answer('hasPump', true)}
                onNo={() => answer('hasPump', false)}
              />
            )}

          </div>
        )}

        {step === 'done' && method && (
          <div
            className="msf-result-banner"
            style={{ borderColor: methodColor[method] }}
          >
            <div className="msf-result-label" style={{ color: methodColor[method] }}>
              推奨手法
            </div>
            <div className="msf-result-method">{methodLabel[method]}</div>
            <div className="msf-result-desc">{methodDesc[method]}</div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── 質問カード ───────────────────────────────────────── */

interface QuestionCardProps {
  num: string
  text: string
  note: string
  active: boolean
  answer: boolean | undefined
  onYes: () => void
  onNo: () => void
  yesLabel?: string
  noLabel?: string
}

function QuestionCard({
  num, text, note, active, answer,
  yesLabel = 'はい', noLabel = 'いいえ',
  onYes, onNo,
}: QuestionCardProps) {
  return (
    <div className={`msf-q-card${active ? ' msf-q-card--active' : ''}`}>
      <div className="msf-q-header">
        <span className="msf-q-num">{num}</span>
        <span className="msf-q-text">{text}</span>
      </div>
      <p className="msf-q-note">{note}</p>
      {active && (
        <div className="msf-q-buttons">
          <button className="msf-btn msf-btn--yes" onClick={onYes}>{yesLabel}</button>
          <button className="msf-btn msf-btn--no" onClick={onNo}>{noLabel}</button>
        </div>
      )}
      {!active && answer !== undefined && (
        <div className={`msf-q-answered ${answer ? 'msf-q-answered--yes' : 'msf-q-answered--no'}`}>
          → {answer ? yesLabel : noLabel}
        </div>
      )}
    </div>
  )
}
