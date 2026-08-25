import {
  DEMO_LONGITUDINAL_CASES,
  DEMO_LONGITUDINAL_NODES,
  DEMO_LONGITUDINAL_PIPE,
  DEMO_MEASUREMENT_POINTS,
  DEMO_STATIC_WATER_LEVEL,
  TEMPLATE_SAMPLE_PROJECT_NAME,
} from '@open-waterhammer/sample-data'

import { ensureBrowserBuffer } from '../reports/browser-buffer'

/**
 * 入力テンプレート（.xlsx）を書き出す。
 *
 * 同梱値は「1本の管路」として全シートが整合するように揃えてある
 * （`DEMO_LONGITUDINAL_*` と `DEMO_MEASUREMENT_POINTS` は同じ φ600 の路線）。
 * 別々のデモデータを混ぜると、管径や延長がシート間で食い違い、取込時に
 * 大量の補完警告が出る。組を崩さないこと。
 *
 * 案件名にはプレースホルダーではなくサンプル名を入れる。落としたファイルを
 * そのまま読み込めば動作確認ができ、実案件では利用者が書き換える
 * （書き換え忘れは取込時の警告で知らせる）。
 */
export async function downloadInputTemplate(): Promise<void> {
  await ensureBrowserBuffer()
  const { generateTemplate } = await import('@open-waterhammer/excel-io')
  const bytes = await generateTemplate({
    meta: {
      projectName: TEMPLATE_SAMPLE_PROJECT_NAME,
      standardId: 'nochi_pipeline_2021',
      methodId: 'joukowsky_v1',
      staticWaterLevel: DEMO_STATIC_WATER_LEVEL,
    },
    pipes: [DEMO_LONGITUDINAL_PIPE],
    nodes: DEMO_LONGITUDINAL_NODES,
    cases: DEMO_LONGITUDINAL_CASES,
    measurementPoints: DEMO_MEASUREMENT_POINTS,
  })
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'waterhammer-template.xlsx'
  anchor.click()
  // click() は同期的にダウンロードを開始するが、revoke を同じターンで走らせると
  // ブラウザによっては取り逃がす。次のタスクまで待ってから解放する。
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
