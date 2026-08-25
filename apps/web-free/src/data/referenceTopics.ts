/**
 * 基準照会トピック定義（3文書横串）
 * ReferencePage と RefTooltip で共有する。
 */

export interface TopicRef {
  pdfId: string;
  /** PDFファイル内の物理ページ番号 */
  page: number;
  note: string;
  /** 技術書（章別PDF）の場合、章ごとに異なるURLを直接指定 */
  chapterUrl?: string;
}

export interface Topic {
  id: string;
  category: string;
  title: string;
  refs: TopicRef[];
}

/** 技術書 章別PDF（農林水産省 https://www.maff.go.jp/j/nousin/pipeline/） */
export const GIJUTSUSHO_CHAPTERS = {
  ch1:  'https://www.maff.go.jp/j/nousin/pipeline/attach/pdf/pipeline-24.pdf',
  ch3:  'https://www.maff.go.jp/j/nousin/pipeline/attach/pdf/pipeline-6.pdf',
  ch6:  'https://www.maff.go.jp/j/nousin/pipeline/attach/pdf/pipeline-8.pdf',
  ch7:  'https://www.maff.go.jp/j/nousin/pipeline/attach/pdf/pipeline-49.pdf',
  ch8:  'https://www.maff.go.jp/j/nousin/pipeline/attach/pdf/pipeline-58.pdf',
  ch9:  'https://www.maff.go.jp/j/nousin/pipeline/attach/pdf/pipeline-61.pdf',
  ch10: 'https://www.maff.go.jp/j/nousin/pipeline/attach/pdf/pipeline-16.pdf',
  ch13: 'https://www.maff.go.jp/j/nousin/pipeline/attach/pdf/pipeline-48.pdf',
  ch14: 'https://www.maff.go.jp/j/nousin/pipeline/attach/pdf/pipeline-68.pdf',
} as const;

export const TOPICS: Topic[] = [
  {
    id: 'design-flow',
    category: '総論',
    title: 'パイプラインの設計フロー',
    refs: [
      { pdfId: 'kijun', page: 18, note: '5 設計の手順' },
      { pdfId: 'gijutsusho', chapterUrl: GIJUTSUSHO_CHAPTERS.ch3, page: 1, note: '第3章 設計の標準的手順' },
      { pdfId: 'gijutsusho', chapterUrl: GIJUTSUSHO_CHAPTERS.ch1, page: 1, note: '第1章 導入の経緯と役割' },
      { pdfId: 'seikahinyoshiki', page: 9, note: '目次・章構成' },
    ],
  },
  {
    id: 'pipe-material',
    category: '管体工',
    title: '管種・管径の決定',
    refs: [
      { pdfId: 'kijun', page: 32, note: '7-9 管体及び継手等の選定' },
      { pdfId: 'gijutsusho', chapterUrl: GIJUTSUSHO_CHAPTERS.ch14, page: 1, note: '第14章 既製管の管体及び継手' },
      { pdfId: 'seikahinyoshiki', page: 35, note: '4.2 管種管径（管種の決定・管径の決定）' },
    ],
  },
  {
    id: 'steady-flow',
    category: '水理計算',
    title: '定常時の水理計算',
    refs: [
      { pdfId: 'kijun', page: 36, note: '9-1 定常的な水理現象の解析' },
      { pdfId: 'gijutsusho', chapterUrl: GIJUTSUSHO_CHAPTERS.ch7, page: 1, note: '第7章 定常的な水理現象の解析（摩擦・局部損失）' },
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
      { pdfId: 'kijun', page: 40, note: '9-2 非定常的な水理現象の解析' },
      { pdfId: 'gijutsusho', chapterUrl: GIJUTSUSHO_CHAPTERS.ch8, page: 7, note: '8.2.2 圧力波の伝播速度と圧力振動周期' },
    ],
  },
  {
    id: 'waterhammer-estimate',
    category: '水撃圧',
    title: '水撃圧の推定（計算法・経験則）',
    refs: [
      { pdfId: 'kijun', page: 40, note: '9-2 (1) 水撃圧の計算' },
      { pdfId: 'gijutsusho', chapterUrl: GIJUTSUSHO_CHAPTERS.ch8, page: 14, note: '8.3.2 水撃圧の推定方法（理論解法・数値解法・経験則）' },
      { pdfId: 'seikahinyoshiki', page: 47, note: '5.2.1 検討必要区間と推定方法' },
    ],
  },
  {
    id: 'waterhammer-result',
    category: '水撃圧',
    title: '水撃圧の推定結果と対策',
    refs: [
      { pdfId: 'gijutsusho', chapterUrl: GIJUTSUSHO_CHAPTERS.ch8, page: 20, note: '8.3.5 経験則による水撃圧の推定' },
      { pdfId: 'gijutsusho', chapterUrl: GIJUTSUSHO_CHAPTERS.ch8, page: 25, note: '8.3.6 水撃圧対策' },
      { pdfId: 'gijutsusho', chapterUrl: GIJUTSUSHO_CHAPTERS.ch8, page: 43, note: '8.4.4 結果の評価及び設計への利用' },
      { pdfId: 'seikahinyoshiki', page: 48, note: '5.2.2 推定結果と対策（許容内圧判定）' },
    ],
  },
  {
    id: 'moc',
    category: '水撃圧',
    title: '水撃圧の数値解析（特性曲線法）',
    refs: [
      { pdfId: 'kijun', page: 40, note: '9-2 (1) 水撃圧の計算' },
      { pdfId: 'gijutsusho', chapterUrl: GIJUTSUSHO_CHAPTERS.ch8, page: 31, note: '8.4.2 数理モデル（特性曲線法）' },
      { pdfId: 'seikahinyoshiki', page: 13, note: '添付資料: 水撃圧計算' },
    ],
  },
  {
    id: 'pump',
    category: '水撃圧',
    title: 'ポンプ過渡解析',
    refs: [
      { pdfId: 'kijun', page: 40, note: '9-2 (1) 水撃圧の計算' },
      { pdfId: 'gijutsusho', chapterUrl: GIJUTSUSHO_CHAPTERS.ch8, page: 38, note: '8.4.2 ポンプ境界（急停止後の回転速度）' },
      { pdfId: 'seikahinyoshiki', page: 49, note: '5.4 その他の非定常時の検討' },
    ],
  },
  {
    id: 'surging',
    category: '非定常',
    title: 'サージングの検討',
    refs: [
      { pdfId: 'kijun', page: 40, note: '9-2 (2) サージングの計算' },
      { pdfId: 'gijutsusho', chapterUrl: GIJUTSUSHO_CHAPTERS.ch8, page: 45, note: '8.5.1 剛体理論による非定常流況解析' },
      { pdfId: 'seikahinyoshiki', page: 49, note: '5.3 サージングの検討' },
    ],
  },
  {
    id: 'structure',
    category: '構造',
    title: '管体の構造計算',
    refs: [
      { pdfId: 'kijun', page: 42, note: '10 管路の構造設計' },
      { pdfId: 'gijutsusho', chapterUrl: GIJUTSUSHO_CHAPTERS.ch9, page: 1, note: '第9章 管路の構造設計' },
      { pdfId: 'seikahinyoshiki', page: 50, note: '第6章 管体の構造計算' },
    ],
  },
];

export const PDF_LABELS: Record<string, string> = {
  kijun: '設計基準',
  gijutsusho: '技術書',
  seikahinyoshiki: '成果品様式',
};

export function getTopic(id: string): Topic | undefined {
  return TOPICS.find((t) => t.id === id);
}
