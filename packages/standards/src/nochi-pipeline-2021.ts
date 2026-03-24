/**
 * 農水パイプライン基準プロファイル（令和3年6月改訂）
 * 出典: 土地改良事業計画設計基準 設計「パイプライン」技術書
 */

export const NOCHI_PIPELINE_2021 = {
  id: "nochi_pipeline_2021",
  name: "土地改良事業計画設計基準 設計「パイプライン」（令和3年6月改訂）",
  version: "2021-06",
  publisher: "農林水産省農村振興局",
  sourceUrl: "https://www.maff.go.jp/j/nousin/pipeline/pipeline.html",

  /** 経験則適用条件: 静水圧上限 [MPa] */
  empiricalStaticPressureLimit: 0.35,

  /** 経験則: 自然圧・クローズド高圧の下限水撃圧 [MPa] */
  empiricalClosedGravityHighMin: 0.35,

  /** 経験則: ポンプ系・高圧の下限水撃圧 [MPa] */
  empiricalPumpHighMin: 0.45,

  references: {
    chapter8Pdf: "https://www.maff.go.jp/j/nousin/pipeline/attach/pdf/pipeline-58.pdf",
  },
} as const;
