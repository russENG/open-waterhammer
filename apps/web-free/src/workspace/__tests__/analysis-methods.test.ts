import { RUN_KINDS } from '@open-waterhammer/contracts'
import { describe, expect, test } from 'vitest'

import { ANALYSIS_METHOD_GROUPS, isAdvancedEngineeringField } from '../analysis-methods'

describe('analysis method classification', () => {
  test('classifies every persisted RunKind exactly once with numerical analysis first', () => {
    const classified = ANALYSIS_METHOD_GROUPS.flatMap(({ kinds }) => kinds)
    expect(ANALYSIS_METHOD_GROUPS.map(({ title }) => title)).toEqual(['主要解析', '準備計算', '簡易確認'])
    expect(classified).toHaveLength(RUN_KINDS.length)
    expect(new Set(classified).size).toBe(RUN_KINDS.length)
    expect([...classified].sort()).toEqual([...RUN_KINDS].sort())
    expect(ANALYSIS_METHOD_GROUPS[0]?.kinds).toEqual(expect.arrayContaining(['transient_network', 'transient_pump', 'transient_protection_device']))
  })

  test('moves optional empirical formula inputs behind the detailed-input disclosure', () => {
    expect(isAdvancedEngineeringField('empirical_pressure', { target: 'model', path: 'operatingPressureMpa', label: '通水圧', unit: 'MPa', kind: 'number' })).toBe(true)
    expect(isAdvancedEngineeringField('empirical_pressure', { target: 'model', path: 'staticPressureMpa', label: '静水圧', unit: 'MPa', kind: 'number' })).toBe(false)
  })
})
