import type { Run } from '@open-waterhammer/contracts'

import { ensureBrowserBuffer } from './browser-buffer'

export const APPLICABILITY_LIMITATIONS = '適用限界：本ツールの自動評価は設計比較支援のための参考情報です。入力条件、適用基準、数値解法の妥当性は設計者が個別に確認してください。'

type RunReportGenerator = (run: Run) => Promise<Uint8Array>

export function buildRunJsonExport(run: Run): string {
  const ruleIds = [...new Set(run.assessment.findings.map(({ ruleId }) => ruleId))]
  return JSON.stringify({
    labels: ['alpha', '設計比較支援'],
    applicabilityLimitations: APPLICABILITY_LIMITATIONS,
    manifestSummary: {
      productVersion: run.manifest.productVersion,
      engine: run.manifest.engine,
      runtime: run.manifest.runtime,
      method: run.manifest.method,
      finalStatus: run.manifest.finalStatus,
      standard: run.manifest.standard,
      inputHashes: run.manifest.inputHashes,
      outputHashes: run.manifest.outputHashes,
    },
    ruleIds,
    run,
  }, null, 2)
}

export async function generatePersistedRunExcel(
  run: Run,
  generator?: RunReportGenerator,
): Promise<Uint8Array> {
  if (!generator) await ensureBrowserBuffer()
  const create = generator ?? (await import('@open-waterhammer/excel-io')).generateRunReport
  return create(run)
}
