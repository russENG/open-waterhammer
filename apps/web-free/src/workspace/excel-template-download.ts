import {
  DEMO_CASE_01_CASE,
  DEMO_CASE_01_NODES,
  DEMO_CASE_01_PIPE,
  DEMO_CASE_02_CASE,
  DEMO_MEASUREMENT_POINTS,
} from '@open-waterhammer/sample-data'

import { ensureBrowserBuffer } from '../reports/browser-buffer'

export async function downloadInputTemplate(): Promise<void> {
  await ensureBrowserBuffer()
  const { generateTemplate } = await import('@open-waterhammer/excel-io')
  const bytes = await generateTemplate({
    meta: { projectName: '（案件名を入力）', standardId: 'nochi_pipeline_2021', methodId: 'joukowsky_v1' },
    pipes: [DEMO_CASE_01_PIPE],
    nodes: DEMO_CASE_01_NODES,
    cases: [DEMO_CASE_01_CASE, DEMO_CASE_02_CASE],
    measurementPoints: DEMO_MEASUREMENT_POINTS,
  })
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'waterhammer-template.xlsx'
  anchor.click()
  URL.revokeObjectURL(url)
}
