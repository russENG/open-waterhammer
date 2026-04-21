/**
 * 水撃圧計算ページ
 * Excel入出力 → 管路諸元一覧（伝播速度自動算定） → 各ステップ（アコーディオン）の構成
 */
import { useState, useCallback } from 'react'
import { usePersistentState, stringSetCodec } from '../hooks/usePersistentState'
import type {
  Pipe,
  CalculationCase,
  MocResult,
  MocNetwork,
  LongitudinalHydraulicInput,
  LongitudinalHydraulicResult,
} from '@open-waterhammer/core'
import { PIPE_MATERIALS, calcWaveSpeed, calcVibrationPeriod, GRAVITY, BULK_MODULUS_WATER, WATER_UNIT_WEIGHT } from '@open-waterhammer/core'
import type { WorkbookData } from '@open-waterhammer/excel-io'
import {
  DEMO_CASE_01_PIPE,
  DEMO_CASE_01_CASE,
  DEMO_CASE_02_PIPE,
  DEMO_CASE_02_CASE,
  DEMO_MEASUREMENT_POINTS,
} from '@open-waterhammer/sample-data'
import { ExcelPanel } from '../components/ExcelPanel'
import { MethodSelectionFlow } from '../components/MethodSelectionFlow'
import { SteadyFlowCalculator } from '../components/SteadyFlowCalculator'
import { WaterhammerCalculator } from '../components/WaterhammerCalculator'
import { EmpiricalCalculator } from '../components/EmpiricalCalculator'
import { MocCalculator } from '../components/MocCalculator'
import { NetworkMocCalculator } from '../components/NetworkMocCalculator'
import { PumpCalculator } from '../components/PumpCalculator'
import { ProtectionCalculator } from '../components/ProtectionCalculator'
import { ReportGenerator } from '../components/ReportGenerator'
import { SessionPanel } from '../components/SessionPanel'
import { SteadyNetworkCalculator } from '../components/SteadyNetworkCalculator'

// 単管路 / 管路網の使い分けを案内するインライン説明
function PipeNetGuide({ kind }: { kind: 'steady' | 'moc' }) {
  return (
    <div className="pipe-net-guide">
      <div className="pipe-net-guide-row">
        <span className="pipe-net-guide-tag pipe-net-guide-tag--single">単管路</span>
        <span>1本の管路（口径変化のみ）の場合 — 上のパネル「{kind === 'steady' ? '定常水理計算' : '水撃圧 数値解析'}」</span>
      </div>
      <div className="pipe-net-guide-row">
        <span className="pipe-net-guide-tag pipe-net-guide-tag--net">管路網</span>
        <span>分岐・合流（T字・三方弁・複数水源）を含む場合 — 下のパネル「{kind === 'steady' ? '定常網計算' : '管路網 水撃圧 数値解析'}」</span>
      </div>
    </div>
  )
}

interface StepDef {
  id: string
  num: string
  title: string
  ref: string
  desc: string
  /** 前提ステップ（計算機能なし・情報表示のみ） */
  prerequisite?: boolean
  /** 任意ステップ（補助的・単点確認用） */
  optional?: boolean
}

/** ダミーデモデータ（成果品様式記入例ベース） — 起動時に自動で適用される */
const DEMO_WORKBOOK: WorkbookData = {
  meta: {
    projectName: '○○幹線水路（デモ）',
    standardId: 'nochi_pipeline_2021',
    methodId: 'joukowsky_v1',
  },
  pipes: [DEMO_CASE_01_PIPE, DEMO_CASE_02_PIPE],
  nodes: [],
  cases: [DEMO_CASE_01_CASE, DEMO_CASE_02_CASE],
  measurementPoints: DEMO_MEASUREMENT_POINTS,
}

const STEPS: StepDef[] = [
  {
    id: 'design-conditions',
    num: '1',
    title: '設計条件の整理',
    ref: '§1〜§3',
    desc: '計画諸元（計画最大流量・設計水頭等）、路線計画、水源・調整施設の条件を整理する',
    prerequisite: true,
  },
  {
    id: 'pipe-selection',
    num: '4.1',
    title: '管種の決定',
    ref: '§4.1',
    desc: '内圧・外圧・土質・施工条件・経済性を考慮し、管種（DCIP, SP, PVC, PE等）を選定する',
    prerequisite: true,
  },
  {
    id: 'pipe-diameter',
    num: '4.2',
    title: '管径の決定',
    ref: '§4.2',
    desc: '計画最大流量に対して許容流速（原則3.0 m/s以下）を満たす管径を決定する',
    prerequisite: true,
  },
  {
    id: 'longitudinal-profile',
    num: '4.3',
    title: '管路縦断の設定',
    ref: '§4.3',
    desc: '測点ごとの地盤高・管中心高・管路延長を設定し、縦断図を作成する。土被り・管路勾配の確認を含む',
    prerequisite: true,
  },
  {
    id: 'steady-flow',
    num: '5.1',
    title: '定常時の水理計算',
    ref: '§5.1',
    desc: '計算手法・計算式及び条件の設定、摩擦損失・局部損失の累積による各測点の動水位・静水圧の算定',
  },
  {
    id: 'wave-speed',
    num: '5.2',
    title: '水撃圧の検討（単点・任意）',
    ref: '§5.2',
    desc: '単点でのジューコフスキー式・アリエビ式・経験則による確認用パネル。実務の検討は下の水撃圧 数値解析を主とし、本ステップは式の挙動確認に使用',
    optional: true,
  },
  {
    id: 'moc',
    num: '添付',
    title: '水撃圧の数値解析（本計算）',
    ref: '添付資料 / §8.4',
    desc: 'バルブ閉鎖シナリオの時系列水撃圧を数値解析（特性曲線法）で算定。単管路 / 分岐合流（管路網）の両方に対応',
  },
  {
    id: 'protection',
    num: '5.2.2',
    title: '水撃圧の推定結果と対策（防護工）',
    ref: '§5.2.2',
    desc: '許容内圧との照合・対策の要否判定。エアチャンバ・サージタンク・吸気弁等の防護工効果を数値解析で定量評価',
  },
  {
    id: 'pump',
    num: '5.4',
    title: 'その他の非定常時の検討（ポンプ過渡）',
    ref: '§5.4',
    desc: 'ポンプ急停止・起動時の過渡解析。GD²（はずみ車効果）慣性方程式による水撃圧の算定',
  },
  {
    id: 'report',
    num: '成果',
    title: '水理計算資料の作成（Excel/PDF出力）',
    ref: '成果品様式',
    desc: '読込みデータと縦断計算結果を成果品様式準拠でExcelまたはPDFで出力',
  },
]

function PrerequisiteContent({ id }: { id: string }) {
  switch (id) {
    case 'design-conditions':
      return (
        <div className="prereq-content">
          <h3 className="prereq-heading">以下の設計条件を整理してから水理計算に進む</h3>
          <div className="prereq-checklist">
            <div className="prereq-group">
              <h4 className="prereq-group-title">計画諸元</h4>
              <ul className="prereq-items">
                <li>計画最大流量 Q [L/s]</li>
                <li>設計水頭（静水位 HWL）[m]</li>
                <li>計画最小流量（必要に応じて）</li>
              </ul>
            </div>
            <div className="prereq-group">
              <h4 className="prereq-group-title">路線条件</h4>
              <ul className="prereq-items">
                <li>水源（ダム・ため池・河川取水等）の位置・水位</li>
                <li>末端（ファームポンド・調整池・分水工等）の位置・条件</li>
                <li>路線延長・主要経過地の地形条件</li>
              </ul>
            </div>
            <div className="prereq-group">
              <h4 className="prereq-group-title">システム構成</h4>
              <ul className="prereq-items">
                <li>自然圧送 or ポンプ圧送の別</li>
                <li>調圧水槽（サージタンク）・エアチャンバの有無</li>
                <li>分岐・合流の有無</li>
                <li>制水弁・減圧弁等の配置計画</li>
              </ul>
            </div>
          </div>
          <p className="prereq-note">
            基準照会ページで設計基準 第1章〜第3章の関連記述を参照できます。
          </p>
        </div>
      )
    case 'pipe-selection':
      return (
        <div className="prereq-content">
          <h3 className="prereq-heading">管種選定の検討事項</h3>
          <div className="prereq-checklist">
            <div className="prereq-group">
              <h4 className="prereq-group-title">選定の考慮要因</h4>
              <ul className="prereq-items">
                <li>内圧条件（設計内圧に対する耐圧性能）</li>
                <li>外圧条件（土被り・活荷重に対するたわみ・座屈）</li>
                <li>土質・地下水条件（腐食性・電食・不同沈下）</li>
                <li>施工条件（口径・重量・接合方法・現場溶接の要否）</li>
                <li>経済性（管体費・施工費・維持管理費のLCC比較）</li>
              </ul>
            </div>
            <div className="prereq-group">
              <h4 className="prereq-group-title">主な管種と特性</h4>
              <ul className="prereq-items">
                <li><strong>DCIP</strong>（ダクタイル鋳鉄管）— 高耐圧・耐食性、農業用で最も一般的</li>
                <li><strong>SP</strong>（鋼管）— 大口径・高圧に適、溶接継手、防食塗覆装が必要</li>
                <li><strong>PVC</strong>（硬質塩化ビニル管）— 軽量・耐食・安価、中小口径向け</li>
                <li><strong>PE</strong>（ポリエチレン管）— 可撓性・耐震性、融着継手</li>
                <li><strong>FRP</strong>（強化プラスチック管）— 軽量・耐食、大口径可</li>
              </ul>
            </div>
          </div>
          <p className="prereq-note">
            管種により伝播速度（波速 a）が大きく異なり、水撃圧の算定に直接影響します。
            基準照会ページで技術書 第3章を参照してください。
          </p>
        </div>
      )
    case 'pipe-diameter':
      return (
        <div className="prereq-content">
          <h3 className="prereq-heading">管径決定の手順</h3>
          <div className="prereq-checklist">
            <div className="prereq-group">
              <h4 className="prereq-group-title">決定手順</h4>
              <ol className="prereq-items prereq-items--ordered">
                <li>計画最大流量 Q と許容流速 V<sub>max</sub> から必要最小内径を算出: D ≥ √(4Q / πV<sub>max</sub>)</li>
                <li>管種の規格口径から仮口径を選定</li>
                <li>実流速 V = Q / A を確認（原則 V ≤ 3.0 m/s）</li>
                <li>損失水頭を概算し、設計水頭内に収まることを確認</li>
                <li>必要に応じて口径を変更し、経済比較を行う</li>
              </ol>
            </div>
            <div className="prereq-group">
              <h4 className="prereq-group-title">留意事項</h4>
              <ul className="prereq-items">
                <li>口径変更点（異径接合部）は水撃圧の反射点となる</li>
                <li>維持管理（通水断面の確保）の観点から過小口径は避ける</li>
                <li>最終的な管径は §5.1 の水理計算結果を踏まえて確定する</li>
              </ul>
            </div>
          </div>
        </div>
      )
    case 'longitudinal-profile':
      return (
        <div className="prereq-content">
          <h3 className="prereq-heading">管路縦断の設定項目</h3>
          <div className="prereq-checklist">
            <div className="prereq-group">
              <h4 className="prereq-group-title">測点ごとの設定項目</h4>
              <ul className="prereq-items">
                <li>測点名（IP番号等）</li>
                <li>単距離・追加距離 [m]</li>
                <li>地盤高 GL [m]</li>
                <li>管中心高 [m]（= GL − 土被り − D/2）</li>
                <li>管路延長 [m]（水平距離と異なる場合あり）</li>
              </ul>
            </div>
            <div className="prereq-group">
              <h4 className="prereq-group-title">確認事項</h4>
              <ul className="prereq-items">
                <li>土被り（原則 1.2 m 以上、道路下は道路管理者基準に従う）</li>
                <li>管路勾配と空気溜まり発生のリスク</li>
                <li>屈曲部の局部損失係数（曲管 f<sub>b</sub>・弁 f<sub>v</sub>・分岐 f<sub>β</sub>）</li>
                <li>弁室・水管橋・伏越し等の特殊構造物の位置</li>
              </ul>
            </div>
          </div>
          <p className="prereq-note">
            Excelテンプレートの「測点データ」シートにこれらの情報を入力します。
            ページ上部のExcel入出力からテンプレートをダウンロードしてください。
          </p>
        </div>
      )
    default:
      return null
  }
}

interface StepContentProps {
  id: string
  excelData: WorkbookData | null
  steadyResult: LongitudinalHydraulicResult | null
  onSteadyResult?: (input: LongitudinalHydraulicInput | null, result: LongitudinalHydraulicResult | null) => void
  onMocResult?: (result: MocResult | null) => void
  onNetworkMocResult?: (network: MocNetwork | null, result: MocResult | null) => void
}

function StepContent({ id, excelData, steadyResult, onSteadyResult, onMocResult, onNetworkMocResult }: StepContentProps) {
  switch (id) {
    case 'steady-flow': return (
      <>
        <PipeNetGuide kind="steady" />
        <SteadyFlowCalculator excelData={excelData} onLongResult={onSteadyResult} />
        <div style={{ marginTop: 24 }}>
          <SteadyNetworkCalculator />
        </div>
      </>
    )
    case 'wave-speed': return (
      <>
        <div className="step-route-hint">
          ※ このステップは <strong>単点での式の挙動確認</strong> 用です。
          実務の水撃圧検討は下の <strong>「水撃圧計算（特性曲線法・本計算）」</strong> を使用してください。
        </div>
        <WaterhammerCalculator excelData={excelData} />
        <div style={{ marginTop: 16 }}>
          <EmpiricalCalculator />
        </div>
      </>
    )
    case 'moc': return (
      <>
        <PipeNetGuide kind="moc" />
        <MocCalculator excelData={excelData} onResult={onMocResult} steadyResult={steadyResult} />
        <div style={{ marginTop: 24 }}>
          <NetworkMocCalculator onResult={onNetworkMocResult} />
        </div>
      </>
    )
    case 'pump': return <PumpCalculator excelData={excelData} />
    case 'protection': return <ProtectionCalculator excelData={excelData} />
    case 'report': return <ReportGenerator excelData={excelData} />
    default: return null
  }
}

// ─── 管路諸元テーブル（伝播速度自動算定付き） ─────────────────────────────────

function PipeTable({ pipes, cases }: { pipes: Pipe[]; cases: CalculationCase[] }) {
  const [formulaOpen, setFormulaOpen] = useState(false)

  return (
    <div className="pipe-table-wrap">
      <h3 className="pipe-table-title">管路諸元（{pipes.length}区間）</h3>
      <div className="pipe-table-scroll">
        <table className="pipe-table">
          <thead>
            <tr>
              <th>管路ID</th>
              <th>管路名</th>
              <th>管種</th>
              <th>内径 D [mm]</th>
              <th>管厚 t [mm]</th>
              <th>延長 L [m]</th>
              <th>粗度係数 C</th>
              <th>伝播速度 a [m/s]</th>
              <th>振動周期 T₀ [s]</th>
            </tr>
          </thead>
          <tbody>
            {pipes.map((p) => {
              const a = calcWaveSpeed(p)
              const T0 = calcVibrationPeriod(p.length, a)
              return (
                <tr key={p.id}>
                  <td>{p.id}</td>
                  <td>{p.name ?? ''}</td>
                  <td>{PIPE_MATERIALS[p.pipeType]?.name ?? p.pipeType}</td>
                  <td className="pipe-table-num">{(p.innerDiameter * 1000).toFixed(0)}</td>
                  <td className="pipe-table-num">{(p.wallThickness * 1000).toFixed(1)}</td>
                  <td className="pipe-table-num">{p.length.toFixed(0)}</td>
                  <td className="pipe-table-num">{p.roughnessCoeff}</td>
                  <td className="pipe-table-num pipe-table-computed">{a.toFixed(1)}</td>
                  <td className="pipe-table-num pipe-table-computed">{T0.toFixed(3)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* 伝播速度算定式の解説 */}
      <button
        className="pipe-table-formula-toggle"
        onClick={() => setFormulaOpen(v => !v)}
        aria-expanded={formulaOpen}
      >
        {formulaOpen ? '▲' : '▼'} 伝播速度の算定式（§8.3.1 / 式 8.2.4）
      </button>
      {formulaOpen && (
        <div className="pipe-table-formula">
          <div className="pipe-table-formula-block">
            <p className="pipe-table-formula-eq">
              a = 1 / √( w₀/g × (1/K + D·C₁/(E<sub>s</sub>·t)) )
            </p>
            <dl className="pipe-table-formula-vars">
              <dt>a</dt><dd>圧力波伝播速度 [m/s]</dd>
              <dt>w₀</dt><dd>水の単位体積重量 = {WATER_UNIT_WEIGHT} kN/m³</dd>
              <dt>g</dt><dd>重力加速度 = {GRAVITY} m/s²</dd>
              <dt>K</dt><dd>水の体積弾性係数 = {(BULK_MODULUS_WATER / 1e6).toFixed(2)} × 10⁶ kN/m²</dd>
              <dt>D</dt><dd>管内径 [m]</dd>
              <dt>t</dt><dd>管厚 [m]</dd>
              <dt>E<sub>s</sub></dt><dd>管材のヤング係数 [kN/m²]（管種により異なる — 表-8.2.1）</dd>
              <dt>C₁</dt><dd>埋設状況係数（通常 1.0）</dd>
            </dl>
          </div>
          <div className="pipe-table-formula-block">
            <p className="pipe-table-formula-eq">
              T₀ = 4L / a
            </p>
            <dl className="pipe-table-formula-vars">
              <dt>T₀</dt><dd>圧力振動周期 [s] — 水撃圧が管路を1往復する時間の2倍</dd>
              <dt>L</dt><dd>管路延長 [m]</dd>
            </dl>
          </div>
          <p className="pipe-table-formula-note">
            管種が柔らかいほど（E<sub>s</sub> が小さいほど）伝播速度は低下します。
            鋼管で約 1,200 m/s、ダクタイル鋳鉄管で約 1,100 m/s、塩ビ管で約 400 m/s が目安です。
            多段口径管路では区間ごとに a を算定し、各計算ステップで個別に使用します。
          </p>
        </div>
      )}

      {cases.length > 0 && (
        <>
          <h3 className="pipe-table-title" style={{ marginTop: 16 }}>計算ケース（{cases.length}件）</h3>
          <div className="pipe-table-scroll">
            <table className="pipe-table">
              <thead>
                <tr>
                  <th>ケースID</th>
                  <th>ケース名</th>
                  <th>操作種別</th>
                  <th>初期流速 V₀ [m/s]</th>
                  <th>初期水頭 H₀ [m]</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => (
                  <tr key={c.id}>
                    <td>{c.id}</td>
                    <td>{c.name}</td>
                    <td>{c.operationType}</td>
                    <td className="pipe-table-num">{c.initialVelocity.toFixed(2)}</td>
                    <td className="pipe-table-num">{c.initialHead.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ─── メインページ ──────────────────────────────────────────────────────────────

export function WaterHammerPage() {
  // 起動時にデモステップ（定常／MOC／成果出力）をデフォルトで開いておく — アコーディオン状態はlocalStorage永続化
  const [openSteps, setOpenSteps] = usePersistentState<Set<string>>(
    'openSteps',
    new Set(['steady-flow', 'moc', 'report']),
    stringSetCodec,
  )
  const [guideOpen, setGuideOpen] = usePersistentState<boolean>('guideOpen', false)
  const [prereqOpen, setPrereqOpen] = usePersistentState<boolean>('prereqOpen', false)
  // 起動時にデモ用ダミーデータを適用 — ユーザーは即座に MOC グラフ等を確認できる
  const [excelData, setExcelData] = useState<WorkbookData | null>(DEMO_WORKBOOK)
  const [usingDemo, setUsingDemo] = useState(true)

  // ── セッション保存用 currentState（各 calculator から bubble up）─────────────
  const [steadyInput, setSteadyInput] = useState<LongitudinalHydraulicInput | null>(null)
  const [steadyResult, setSteadyResult] = useState<LongitudinalHydraulicResult | null>(null)
  const [mocResult, setMocResult] = useState<MocResult | null>(null)
  const [mocNetwork, setMocNetwork] = useState<MocNetwork | null>(null)

  const handleSteadyResult = useCallback((input: LongitudinalHydraulicInput | null, result: LongitudinalHydraulicResult | null) => {
    setSteadyInput(input)
    setSteadyResult(result)
  }, [])
  const handleMocResult = useCallback((result: MocResult | null) => {
    setMocResult(result)
  }, [])
  const handleNetworkMocResult = useCallback((network: MocNetwork | null, result: MocResult | null) => {
    setMocNetwork(network)
    setMocResult(result)
  }, [])

  const currentState = {
    ...(steadyInput && { steadyInput }),
    ...(steadyResult && { steadyResult }),
    ...(mocNetwork && { mocNetwork }),
    ...(mocResult && { mocResult }),
  }

  function toggleStep(id: string) {
    setOpenSteps(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleExcelLoad(data: WorkbookData) {
    setExcelData(data)
    setUsingDemo(false)
  }

  function resetToDemo() {
    if (!usingDemo) {
      const ok = window.confirm(
        '読み込んだユーザー Excel データを破棄してデモデータに戻します。よろしいですか？',
      )
      if (!ok) return
    }
    setExcelData(DEMO_WORKBOOK)
    setUsingDemo(true)
  }

  function jumpToStep(id: string) {
    setOpenSteps(prev => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
    setTimeout(() => {
      const el = document.getElementById(`wh-step-${id}`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        el.classList.add('wh-step--flash')
        setTimeout(() => el.classList.remove('wh-step--flash'), 1600)
      }
    }, 50)
  }

  return (
    <div className="page-waterhammer">
      <div className="page-header">
        <h2 className="page-title">水撃圧計算</h2>
        <p className="page-desc">
          土地改良設計基準　設計「パイプライン」技術書（令和3年6月改訂）§8 準拠
        </p>
      </div>

      {/* デモデータ稼働中バナー */}
      {usingDemo && (
        <div className="demo-banner">
          <span className="demo-banner-tag">DEMO</span>
          <span className="demo-banner-text">
            <strong>サンプル管路</strong>を読み込み済み。アップロード不要でそのまま試せます。
          </span>
          <div className="demo-banner-actions">
            <button className="btn btn--small btn--primary" onClick={() => jumpToStep('steady-flow')}>
              ① 定常計算へ
            </button>
            <button className="btn btn--small btn--primary" onClick={() => jumpToStep('moc')}>
              ② 水撃圧 数値解析へ
            </button>
            <button className="btn btn--small btn--primary" onClick={() => jumpToStep('report')}>
              ③ 帳票出力へ
            </button>
          </div>
        </div>
      )}
      {!usingDemo && (
        <div className="demo-banner demo-banner--user">
          <span className="demo-banner-text">
            ユーザー Excel 読み込み中
          </span>
          <button className="btn btn--small btn--secondary demo-banner-btn" onClick={resetToDemo}>
            ↺ デモデータに戻す
          </button>
        </div>
      )}

      {/* Excel入出力 — デモ中は折りたたんで視覚的優先度を下げる */}
      <ExcelPanel onLoad={handleExcelLoad} loadedData={excelData} collapsedByDefault={usingDemo} />

      {/* 読み込んだ管路諸元の表示 */}
      {excelData && excelData.pipes.length > 0 && (
        <section className="card">
          <p className="pipe-table-role">
            ↓ 下記の管路諸元は <strong>定常水理計算 / 水撃圧 数値解析 / 防護工 / ポンプ過渡 / 帳票出力</strong> の各ステップで共通入力として使用されます。
          </p>
          <PipeTable pipes={excelData.pipes} cases={excelData.cases} />
          {excelData.measurementPoints.length > 0 && (
            <div className="long-calc-summary" style={{ marginTop: 12 }}>
              測点データ: {excelData.measurementPoints.length} 点 読込済
              （ステップ「水理計算資料の作成」で水理計算書として出力できます）
            </div>
          )}
        </section>
      )}

      {/* 前提ステップ（設計条件・管種・管径・縦断） — デフォルトはまとめて折りたたみ */}
      <div className="wh-steps">
        <button
          type="button"
          className="wh-prereq-master"
          onClick={() => setPrereqOpen(v => !v)}
          aria-expanded={prereqOpen}
        >
          <span className="wh-prereq-master-label">
            前提条件（4項目: 設計条件・管種・管径・縦断）
          </span>
          <span className="wh-prereq-master-hint">
            {prereqOpen ? '計算前のチェックリスト — 閉じる' : '計算前のチェックリスト — 展開'}
          </span>
          <span className="wh-prereq-master-toggle">{prereqOpen ? '▲' : '▼'}</span>
        </button>
        {prereqOpen && STEPS.filter(s => s.prerequisite).map((step) => {
          const isOpen = openSteps.has(step.id)
          return (
            <div key={step.id} className={`wh-step wh-step--prereq${isOpen ? ' wh-step--open' : ''}`}>
              <button
                className="wh-step-header"
                onClick={() => toggleStep(step.id)}
                aria-expanded={isOpen}
              >
                <div className="wh-step-left">
                  <span className="wh-step-num">{step.num}</span>
                  <div className="wh-step-title-block">
                    <span className="wh-step-title">{step.title}</span>
                    <span className="wh-step-ref">{step.ref}</span>
                  </div>
                </div>
                <span className="wh-step-desc">{step.desc}</span>
                <span className="wh-step-toggle">{isOpen ? '▲' : '▼'}</span>
              </button>
              {isOpen && (
                <div className="wh-step-body">
                  <PrerequisiteContent id={step.id} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 計算ステップ */}
      <div className="wh-steps">
        <div className="wh-steps-label">水理計算・水撃圧検討</div>
        {STEPS.filter(s => !s.prerequisite).map((step) => {
          const isOpen = openSteps.has(step.id)
          return (
            <div
              key={step.id}
              id={`wh-step-${step.id}`}
              className={`wh-step${isOpen ? ' wh-step--open' : ''}${step.optional ? ' wh-step--optional' : ''}`}
            >
              <button
                className="wh-step-header"
                onClick={() => toggleStep(step.id)}
                aria-expanded={isOpen}
              >
                <div className="wh-step-left">
                  <span className="wh-step-num">{step.num}</span>
                  <div className="wh-step-title-block">
                    <span className="wh-step-title">
                      {step.title}
                      {step.optional && <span className="wh-step-optional-tag">任意</span>}
                    </span>
                    <span className="wh-step-ref">{step.ref}</span>
                  </div>
                </div>
                <span className="wh-step-desc">{step.desc}</span>
                <span className="wh-step-toggle">{isOpen ? '▲' : '▼'}</span>
              </button>
              {isOpen && (
                <div className="wh-step-body">
                  <StepContent
                    id={step.id}
                    excelData={excelData}
                    steadyResult={steadyResult}
                    onSteadyResult={handleSteadyResult}
                    onMocResult={handleMocResult}
                    onNetworkMocResult={handleNetworkMocResult}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* セッション管理（独立カード） */}
      <section className="card" style={{ marginTop: 16 }}>
        <SessionPanel currentState={currentState} />
      </section>

      {/* 手法選定ガイド（参考） */}
      <div className="wh-guide">
        <button
          className="wh-guide-toggle"
          onClick={() => setGuideOpen(v => !v)}
          aria-expanded={guideOpen}
        >
          {guideOpen ? '▲' : '▼'} 参考：手法選定ガイド（§8.3.2 準拠）
        </button>
        {guideOpen && (
          <div className="wh-guide-body">
            <MethodSelectionFlow onSelect={() => {}} selected={null} />
          </div>
        )}
      </div>
    </div>
  )
}
