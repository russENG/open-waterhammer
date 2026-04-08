/**
 * 基準照会ページ
 *
 * 3文書を横串で参照:
 *   1. 設計基準（本編）    — 土地改良事業計画設計基準 設計「パイプライン」（令和3年3月改定）
 *   2. 技術書             — 同 技術書（令和3年6月改訂）
 *   3. 成果品様式          — 農林水産省 成果品様式「パイプライン」(Ⅱ-2)
 *
 * 左: トピック別メニュー（各トピックに3文書の該当ページを紐付け）
 * 右: PDF閲覧パネル
 */

import { useState, useRef, useEffect } from 'react'

// ─── PDF ソース定義 ──────────────────────────────────────────────────────────

interface PdfSource {
  id: string
  shortLabel: string
  fullLabel: string
  description: string
  /** オンラインURL（あれば） */
  onlineUrl?: string
  /** ローカル読み込みされたURL */
  localUrl?: string
  color: string
}

/** 3文書の初期定義 — いずれも農林水産省が公式PDFを無償公開している */
const INITIAL_SOURCES: PdfSource[] = [
  {
    id: 'kijun',
    shortLabel: '基準',
    fullLabel: '設計基準（本編）',
    description: '土地改良事業計画設計基準 設計「パイプライン」基準・運用・運用の解説（令和3年改定）',
    onlineUrl: 'https://www.maff.go.jp/j/nousin/pipeline/attach/pdf/pipeline-67.pdf',
    color: '#e53e3e',
  },
  {
    id: 'gijutsusho',
    shortLabel: '技術書',
    fullLabel: '技術書（章別）',
    description: '土地改良事業計画設計基準 設計「パイプライン」技術書（令和3年改定）— 農林水産省は章別PDFで公開しています。トピックから該当章を選択してください。',
    // デフォルトは第8章（非定常水理現象）— 本アプリは水撃圧計算がメインのため
    onlineUrl: 'https://www.maff.go.jp/j/nousin/pipeline/attach/pdf/pipeline-58.pdf',
    color: '#38a169',
  },
  {
    id: 'seikahinyoshiki',
    shortLabel: '様式',
    fullLabel: '成果品様式',
    description: '農林水産省 成果品様式「パイプライン」(Ⅱ-2)',
    onlineUrl: 'https://www.maff.go.jp/j/nousin/seko/seikahin/s_yosiki/pdf/paip.pdf',
    color: '#3182ce',
  },
]

// ─── トピック横串メニュー ────────────────────────────────────────────────────

interface TopicRef {
  pdfId: string
  page?: number
  note: string
  /** 技術書（章別PDF）の場合、章ごとに異なるURLを直接指定 */
  chapterUrl?: string
}

/** 技術書 章別PDF（農林水産省 https://www.maff.go.jp/j/nousin/pipeline/） */
const GIJUTSUSHO_CHAPTERS = {
  ch1:  'https://www.maff.go.jp/j/nousin/pipeline/attach/pdf/pipeline-24.pdf', // 第1章 農業用パイプライン導入の経緯と役割
  ch3:  'https://www.maff.go.jp/j/nousin/pipeline/attach/pdf/pipeline-6.pdf',  // 第3章 設計の標準的手順
  ch6:  'https://www.maff.go.jp/j/nousin/pipeline/attach/pdf/pipeline-8.pdf',  // 第6章 パイプラインシステムの設計
  ch7:  'https://www.maff.go.jp/j/nousin/pipeline/attach/pdf/pipeline-49.pdf', // 第7章 定常的な水理現象の解析
  ch8:  'https://www.maff.go.jp/j/nousin/pipeline/attach/pdf/pipeline-58.pdf', // 第8章 非定常的な水理現象の解析（水撃圧）
  ch9:  'https://www.maff.go.jp/j/nousin/pipeline/attach/pdf/pipeline-61.pdf', // 第9章 管路の構造設計
  ch10: 'https://www.maff.go.jp/j/nousin/pipeline/attach/pdf/pipeline-16.pdf', // 第10章 附帯施設の設計
  ch13: 'https://www.maff.go.jp/j/nousin/pipeline/attach/pdf/pipeline-48.pdf', // 第13章 施工
  ch14: 'https://www.maff.go.jp/j/nousin/pipeline/attach/pdf/pipeline-68.pdf', // 第14章 既製管の管体及び継手
} as const

interface Topic {
  id: string
  category: string
  title: string
  refs: TopicRef[]
}

const TOPICS: Topic[] = [
  {
    id: 'design-flow',
    category: '総論',
    title: 'パイプラインの設計フロー',
    refs: [
      { pdfId: 'kijun', note: '第1章 総論・設計の基本' },
      { pdfId: 'gijutsusho', chapterUrl: GIJUTSUSHO_CHAPTERS.ch3, note: '第3章 設計の標準的手順' },
      { pdfId: 'gijutsusho', chapterUrl: GIJUTSUSHO_CHAPTERS.ch1, note: '第1章 導入の経緯と役割' },
      { pdfId: 'seikahinyoshiki', page: 9, note: '目次・章構成' },
    ],
  },
  {
    id: 'pipe-material',
    category: '管体工',
    title: '管種・管径の決定',
    refs: [
      { pdfId: 'kijun', note: '第3章 管種の選定' },
      { pdfId: 'gijutsusho', chapterUrl: GIJUTSUSHO_CHAPTERS.ch14, note: '第14章 既製管の管体及び継手' },
      { pdfId: 'seikahinyoshiki', page: 35, note: '4.2 管種管径（管種の決定・管径の決定）' },
    ],
  },
  {
    id: 'steady-flow',
    category: '水理計算',
    title: '定常時の水理計算',
    refs: [
      { pdfId: 'kijun', note: '第4章 管路の水理' },
      { pdfId: 'gijutsusho', chapterUrl: GIJUTSUSHO_CHAPTERS.ch7, note: '第7章 定常的な水理現象の解析（摩擦・局部損失）' },
      { pdfId: 'seikahinyoshiki', page: 44, note: '5.1 定常時の水理計算（手法・式・条件）' },
    ],
  },
  {
    id: 'hydraulic-sheet',
    category: '水理計算',
    title: '水理計算書（帳票）',
    refs: [
      { pdfId: 'seikahinyoshiki', page: 45, note: '水理計算書 帳票例（計画最大流量時 24列）' },
      { pdfId: 'seikahinyoshiki', page: 46, note: '計算結果の集計・到達目標水位確認' },
    ],
  },
  {
    id: 'wave-speed',
    category: '水撃圧',
    title: '伝播速度の算定',
    refs: [
      { pdfId: 'kijun', note: '§8.2 圧力波の伝播' },
      { pdfId: 'gijutsusho', chapterUrl: GIJUTSUSHO_CHAPTERS.ch8, note: '第8章 §8.2 圧力波の伝播速度・§8.3.1 波速算定' },
    ],
  },
  {
    id: 'waterhammer-estimate',
    category: '水撃圧',
    title: '水撃圧の推定（計算法・経験則）',
    refs: [
      { pdfId: 'kijun', note: '§8.3 水撃圧の推定' },
      { pdfId: 'gijutsusho', chapterUrl: GIJUTSUSHO_CHAPTERS.ch8, note: '第8章 §8.3 ジューコフスキー式・アリエビ式・経験則' },
      { pdfId: 'seikahinyoshiki', page: 47, note: '5.2.1 検討必要区間と推定方法' },
    ],
  },
  {
    id: 'waterhammer-result',
    category: '水撃圧',
    title: '水撃圧の推定結果と対策',
    refs: [
      { pdfId: 'gijutsusho', chapterUrl: GIJUTSUSHO_CHAPTERS.ch8, note: '第8章 §8.3.5 経験則 / §8.4.6 防護工' },
      { pdfId: 'seikahinyoshiki', page: 48, note: '5.2.2 推定結果と対策（許容内圧判定）' },
    ],
  },
  {
    id: 'moc',
    category: '水撃圧',
    title: '特性曲線法（MOC）',
    refs: [
      { pdfId: 'kijun', note: '§8.4 水撃圧の数値解析' },
      { pdfId: 'gijutsusho', chapterUrl: GIJUTSUSHO_CHAPTERS.ch8, note: '第8章 §8.4 特性曲線法の基礎理論・境界条件' },
      { pdfId: 'seikahinyoshiki', page: 13, note: '添付資料: 水撃圧計算' },
    ],
  },
  {
    id: 'pump',
    category: '水撃圧',
    title: 'ポンプ過渡解析',
    refs: [
      { pdfId: 'kijun', note: '§8.4 ポンプ急停止・起動' },
      { pdfId: 'gijutsusho', chapterUrl: GIJUTSUSHO_CHAPTERS.ch8, note: '第8章 §8.4.4 ポンプ急停止 / §8.4.5 ポンプ起動' },
      { pdfId: 'seikahinyoshiki', page: 49, note: '5.4 その他の非定常時の検討' },
    ],
  },
  {
    id: 'surging',
    category: '非定常',
    title: 'サージングの検討',
    refs: [
      { pdfId: 'kijun', note: '§9 サージング' },
      { pdfId: 'gijutsusho', chapterUrl: GIJUTSUSHO_CHAPTERS.ch8, note: '第8章 サージングの基礎・解析' },
      { pdfId: 'seikahinyoshiki', page: 49, note: '5.3 サージングの検討' },
    ],
  },
  {
    id: 'structure',
    category: '構造',
    title: '管体の構造計算',
    refs: [
      { pdfId: 'kijun', note: '第5章 管体の構造計算' },
      { pdfId: 'gijutsusho', chapterUrl: GIJUTSUSHO_CHAPTERS.ch9, note: '第9章 管路の構造設計' },
      { pdfId: 'seikahinyoshiki', page: 50, note: '第6章 管体の構造計算' },
    ],
  },
]

// カテゴリでグループ化
function groupByCategory(topics: Topic[]): { category: string; topics: Topic[] }[] {
  const map = new Map<string, Topic[]>()
  for (const t of topics) {
    if (!map.has(t.category)) map.set(t.category, [])
    map.get(t.category)!.push(t)
  }
  return Array.from(map, ([category, topics]) => ({ category, topics }))
}

// ─── コンポーネント ──────────────────────────────────────────────────────────

export function ReferencePage({ initialTopicId }: { initialTopicId?: string } = {}) {
  const [sources, setSources] = useState<PdfSource[]>(INITIAL_SOURCES)
  const [activeSourceId, setActiveSourceId] = useState('seikahinyoshiki')
  const [pdfPage, setPdfPage] = useState<number | undefined>(undefined)
  const [activeRefKey, setActiveRefKey] = useState('')
  /** 技術書の章別PDF URL を直接指定する場合の上書き */
  const [chapterOverrideUrl, setChapterOverrideUrl] = useState<string | null>(null)
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const topicRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // 外部から initialTopicId が指定された場合、該当トピックの最初の参照を自動的に開く
  useEffect(() => {
    if (!initialTopicId) return
    const topic = TOPICS.find(t => t.id === initialTopicId)
    if (!topic || topic.refs.length === 0) return
    const firstRef = topic.refs[0]!
    const src = INITIAL_SOURCES.find(s => s.id === firstRef.pdfId)
    if (!src) return
    if (src.onlineUrl || src.localUrl || firstRef.chapterUrl) {
      setActiveSourceId(firstRef.pdfId)
      setChapterOverrideUrl(firstRef.chapterUrl ?? null)
      setPdfPage(firstRef.page)
      setActiveRefKey(topic.id + ':' + firstRef.pdfId + ':' + firstRef.page)
    }
    // メニュー側のスクロール
    setTimeout(() => {
      topicRefs.current[topic.id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
  }, [initialTopicId])

  const activeSource = sources.find(s => s.id === activeSourceId) ?? sources[2]!

  function getSourceUrl(src: PdfSource): string | null {
    return src.localUrl ?? src.onlineUrl ?? null
  }

  function handleLocalPdf(sourceId: string, file: File) {
    const url = URL.createObjectURL(file)
    setSources(prev => prev.map(s =>
      s.id === sourceId ? { ...s, localUrl: url } : s
    ))
    setActiveSourceId(sourceId)
    setPdfPage(undefined)
  }

  function handleRefClick(ref: TopicRef, topicId: string) {
    const src = sources.find(s => s.id === ref.pdfId)
    if (!src) return
    // 章別URLが指定されていればそれを優先（技術書は章ごとに別ファイル）
    const url = ref.chapterUrl ?? getSourceUrl(src)
    if (!url) {
      // PDFが未登録 → ファイル選択を促す
      fileInputRefs.current[ref.pdfId]?.click()
      return
    }
    setActiveSourceId(ref.pdfId)
    setChapterOverrideUrl(ref.chapterUrl ?? null)
    setPdfPage(ref.page)
    setActiveRefKey(topicId + ':' + ref.pdfId + ':' + ref.page)
  }

  const pdfViewUrl = (() => {
    const url = chapterOverrideUrl ?? getSourceUrl(activeSource)
    if (!url) return null
    if (pdfPage) return `${url}#page=${pdfPage}`
    return url
  })()

  const categories = groupByCategory(TOPICS)

  return (
    <div className="ref-page">
      {/* 左パネル */}
      <aside className="ref-menu">
        <h2 className="ref-menu-title">基準照会</h2>
        <p className="ref-menu-desc">
          トピックごとに設計基準・技術書・成果品様式を横断的に参照
        </p>

        {/* 3文書の登録状況 */}
        <div className="ref-sources-panel">
          <h3 className="ref-section-label">文書</h3>
          {sources.map(src => {
            const loaded = !!getSourceUrl(src)
            return (
              <div key={src.id} className="ref-source-row">
                <button
                  className={`ref-source-btn${activeSourceId === src.id ? ' ref-source-btn--active' : ''}${!loaded ? ' ref-source-btn--unloaded' : ''}`}
                  style={{ borderLeftColor: src.color }}
                  onClick={() => {
                    if (loaded) {
                      setActiveSourceId(src.id)
                      setChapterOverrideUrl(null)
                      setPdfPage(undefined)
                    } else {
                      fileInputRefs.current[src.id]?.click()
                    }
                  }}
                >
                  <span className="ref-source-short" style={{ color: src.color }}>{src.shortLabel}</span>
                  <span className="ref-source-name">{src.fullLabel}</span>
                  {loaded
                    ? <span className="ref-source-status ref-source-status--ok">OK</span>
                    : <span className="ref-source-status ref-source-status--none">未登録</span>
                  }
                </button>
                <input
                  ref={el => { fileInputRefs.current[src.id] = el }}
                  type="file"
                  accept=".pdf"
                  style={{ display: 'none' }}
                  onChange={e => {
                    const file = e.target.files?.[0]
                    if (file) handleLocalPdf(src.id, file)
                  }}
                />
              </div>
            )
          })}
          <p className="ref-sources-note">
            3文書はすべて農林水産省の公式PDF（無償公開）を直接参照しています。
            社内回線等でオンラインPDFにアクセスできない場合は、ローカルPDFを登録すると上書きできます。
          </p>
        </div>

        {/* トピック横串メニュー */}
        <nav className="ref-nav">
          {categories.map(cat => (
            <div key={cat.category} className="ref-cat-group">
              <div className="ref-cat-label">{cat.category}</div>
              {cat.topics.map(topic => (
                <div
                  key={topic.id}
                  className={`ref-topic${initialTopicId === topic.id ? ' ref-topic--highlight' : ''}`}
                  ref={el => { topicRefs.current[topic.id] = el }}
                >
                  <div className="ref-topic-title">{topic.title}</div>
                  <div className="ref-topic-refs">
                    {topic.refs.map((ref, i) => {
                      const src = sources.find(s => s.id === ref.pdfId)
                      if (!src) return null
                      const loaded = !!ref.chapterUrl || !!getSourceUrl(src)
                      const refKey = topic.id + ':' + ref.pdfId + ':' + ref.page
                      return (
                        <button
                          key={i}
                          className={`ref-topic-ref${activeRefKey === refKey ? ' ref-topic-ref--active' : ''}${!loaded ? ' ref-topic-ref--dim' : ''}`}
                          onClick={() => handleRefClick(ref, topic.id)}
                          title={ref.note}
                        >
                          <span className="ref-topic-ref-badge" style={{ background: src.color }}>{src.shortLabel}</span>
                          <span className="ref-topic-ref-note">{ref.note}</span>
                          {ref.page && <span className="ref-topic-ref-page">p.{ref.page}</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      {/* 右パネル: PDF閲覧 */}
      <div className="ref-viewer">
        <div className="ref-viewer-header">
          <span className="ref-viewer-badge" style={{ background: activeSource.color }}>{activeSource.shortLabel}</span>
          <span className="ref-viewer-title">{activeSource.fullLabel}</span>
          <span className="ref-viewer-desc">{activeSource.description}</span>
          {pdfPage && <span className="ref-viewer-page">p.{pdfPage}</span>}
        </div>
        {pdfViewUrl ? (
          <iframe
            key={pdfViewUrl}
            className="ref-viewer-iframe"
            src={pdfViewUrl}
            title={activeSource.fullLabel}
          />
        ) : (
          <div className="ref-viewer-empty">
            <p>「{activeSource.fullLabel}」のPDFが登録されていません</p>
            <button
              className="btn btn--secondary"
              onClick={() => fileInputRefs.current[activeSourceId]?.click()}
            >
              PDFファイルを選択
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
