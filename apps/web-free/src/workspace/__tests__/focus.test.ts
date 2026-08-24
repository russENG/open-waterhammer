import { describe, expect, test } from 'vitest'

import { createLinkedFocus } from '../focus'

describe('linked result focus', () => {
  test('an assessment finding synchronizes map, profile, envelope, and time-series focus', () => {
    expect(createLinkedFocus({
      targetRef: 'P-17',
      location: 'STA. 1+240',
      observedValue: 1.42,
      threshold: 1.2,
      unit: 'MPa',
      ruleId: 'NOCHI-8.3.4',
    })).toEqual({
      targetRef: 'P-17',
      location: 'STA. 1+240',
      mapFeatureId: 'P-17',
      profileCursor: 'STA. 1+240',
      envelopeSeriesId: 'P-17',
      timeSeriesId: 'P-17',
    })
  })
})
