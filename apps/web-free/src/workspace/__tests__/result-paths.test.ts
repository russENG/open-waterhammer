import { describe, expect, test } from 'vitest'

import { describeResultValue, summariseResult } from '../result-paths'

describe('result value presentation', () => {
  test('translates protocol enum values without exposing internal identifiers', () => {
    expect(describeResultValue('eventSettings.operationType', 'pump_stop')).toBe('ポンプ停止')
    expect(describeResultValue('eventSettings.operation', 'close')).toBe('閉鎖')
    expect(describeResultValue('assessment.closureType', 'numerical_required')).toBe('数値解析要')
    expect(describeResultValue('nodes[0].type', 'air_chamber')).toBe('空気室')
  })

  test('preserves unknown values and applies the existing formatting rules', () => {
    expect(describeResultValue('eventSettings.operationType', 'future_operation')).toBe('future_operation')
    expect(describeResultValue('enabled', true)).toBe('あり')
    expect(describeResultValue('allowablePressureMpa', 1.23456789)).toBe('1.23457 MPa')
  })

  test('uses the same translated values in result summaries', () => {
    expect(summariseResult({ operationType: 'valve_close', mode: 'trip' })).toEqual([
      { label: 'ポンプ操作', value: 'ポンプ停止' },
      { label: '操作種別', value: '弁閉鎖' },
    ])
  })
})
