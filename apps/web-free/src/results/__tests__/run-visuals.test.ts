import { runFixture, type Run } from '@open-waterhammer/contracts'
import { describe, expect, test } from 'vitest'

import { deriveRunVisuals } from '../run-visuals'

const transientRun: Run = {
  ...runFixture,
  kind: 'transient_network',
  manifest: {
    ...runFixture.manifest,
    numericParameters: { network: { pipes: [{ id: 'P-17', pipe: { length: 500 } }] } },
  },
  summary: {
    dt: 0.25,
    pipes: {
      'P-17': { H_steady: [30, 29, 28], Hmax: [31, 34, 36], Hmin: [28, 25, 24] },
    },
  },
  timeSeries: {
    pipes: {
      'P-17': [
        { t: 0, H: [30, 29, 28], Q: [0.1, 0.1, 0.1] },
        { t: 0.25, H: [31, 32, 34], Q: [0.1, 0.08, 0.04] },
      ],
      'N-17': [
        { t: 0, H: [99, 99, 99], Q: [0, 0, 0] },
        { t: 0.25, H: [98, 98, 98], Q: [0, 0, 0] },
      ],
    },
    nodes: { 'N-17': { H: [30, 34] } },
  },
}

describe('persisted Run visualization model', () => {
  test('derives envelope, profile, and time-series points from nested persisted transient output', () => {
    const visuals = deriveRunVisuals(transientRun, {
      targetRef: 'P-17', location: 'STA. 0+250', mapFeatureId: 'P-17',
      profileCursor: 'STA. 0+250', envelopeSeriesId: 'P-17', timeSeriesId: 'P-17',
    })

    expect(visuals.envelope).toEqual({
      id: 'P-17', distance: [0, 250, 500], steady: [30, 29, 28], maximum: [31, 34, 36], minimum: [28, 25, 24],
    })
    expect(visuals.timeSeries).toEqual({ id: 'P-17', seconds: [0, 0.25], values: [29, 32] })
    expect(visuals.profileCursorRatio).toBeCloseTo(0.5)
    expect(visuals.summaryMetrics).toEqual(expect.arrayContaining([{ path: 'dt', value: 0.25 }]))
  })

  test('prefers an exact persisted node trace before a same-id pipe fallback', () => {
    const visuals = deriveRunVisuals(transientRun, {
      targetRef: 'N-17', mapFeatureId: 'N-17', profileCursor: 'N-17',
      envelopeSeriesId: 'N-17', timeSeriesId: 'N-17',
    })

    expect(visuals.timeSeries).toEqual({ id: 'N-17', seconds: [0, 0.25], values: [30, 34] })
  })
})
