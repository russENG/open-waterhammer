import {
  SOFTWARE_DISCLAIMER,
  SOFTWARE_LICENSE_ID,
  SOFTWARE_LICENSE_URL,
  SOFTWARE_SOURCE_URL,
  type Run,
} from '@open-waterhammer/contracts'

import { ensureBrowserBuffer } from './browser-buffer'

type RunReportGenerator = (run: Run) => Promise<Uint8Array>

export function buildRunJsonExport(run: Run): string {
  const ruleIds = [...new Set(run.assessment.findings.map(({ ruleId }) => ruleId))]
  return JSON.stringify({
    labels: ['alpha', '設計比較支援'],
    license: {
      id: SOFTWARE_LICENSE_ID,
      url: SOFTWARE_LICENSE_URL,
      source: SOFTWARE_SOURCE_URL,
    },
    warrantyDisclaimer: SOFTWARE_DISCLAIMER,
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
