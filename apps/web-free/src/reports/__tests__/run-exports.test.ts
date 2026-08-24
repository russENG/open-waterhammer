import { runFixture } from '@open-waterhammer/contracts'
import { describe, expect, test, vi } from 'vitest'

import { APPLICABILITY_LIMITATIONS, buildRunJsonExport, generatePersistedRunExcel } from '../run-exports'

describe('persisted Run exports', () => {
  test('Run JSON carries the manifest summary, rule ids, alpha labels, and limitations', () => {
    const text = buildRunJsonExport({
      ...runFixture,
      assessment: {
        status: 'warning',
        findings: [{
          targetRef: 'P-1', observedValue: 1.3, threshold: 1.2,
          unit: 'MPa', ruleId: 'NOCHI-8.3.4',
        }],
      },
    })
    const exported = JSON.parse(text)

    expect(exported.labels).toEqual(['alpha', '設計比較支援'])
    expect(exported.applicabilityLimitations).toBe(APPLICABILITY_LIMITATIONS)
    expect(exported.ruleIds).toEqual(['NOCHI-8.3.4'])
    expect(exported.run.manifest.runId).toBe(runFixture.id)
    expect(exported.manifestSummary.productVersion).toBe('0.2.0-alpha.1')
  })

  test('Run JSON manifestSummary.productVersion reflects the persisted manifest, not the current build constant', () => {
    const persistedManifest = {
      ...runFixture.manifest,
      productVersion: '9.9.9-test' as unknown as typeof runFixture.manifest.productVersion,
    }
    const text = buildRunJsonExport({ ...runFixture, manifest: persistedManifest })
    const exported = JSON.parse(text)

    expect(exported.manifestSummary.productVersion).toBe('9.9.9-test')
  })

  test('Excel generation passes the exact persisted Run to generateRunReport without recalculation', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const generator = vi.fn(async () => bytes)
    expect(await generatePersistedRunExcel(runFixture, generator)).toBe(bytes)
    expect(generator).toHaveBeenCalledOnce()
    expect(generator).toHaveBeenCalledWith(runFixture)
  })

  test('the real Excel generator returns browser-compatible bytes when Node Buffer is absent', async () => {
    const browserGlobal = globalThis as typeof globalThis & { Buffer?: unknown }
    const original = browserGlobal.Buffer
    delete browserGlobal.Buffer
    try {
      const bytes = await generatePersistedRunExcel(runFixture)
      expect(bytes).toBeInstanceOf(Uint8Array)
      expect(bytes.byteLength).toBeGreaterThan(1_000)
    } finally {
      browserGlobal.Buffer = original
    }
  })
})
