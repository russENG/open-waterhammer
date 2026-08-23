import { RUN_KINDS } from '@open-waterhammer/contracts'
import { describe, expect, test } from 'vitest'

import { ENGINEERING_FIELDS, updateEngineeringValue, validateEngineeringState } from '../engineering-fields'

describe('RunKind engineering field catalog', () => {
  test('provides kind-specific unit-aware primary fields for every exact RunKind', () => {
    expect(Object.keys(ENGINEERING_FIELDS).sort()).toEqual([...RUN_KINDS].sort())
    for (const kind of RUN_KINDS) {
      expect(ENGINEERING_FIELDS[kind].length, kind).toBeGreaterThanOrEqual(3)
      expect(ENGINEERING_FIELDS[kind].some(({ unit }) => Boolean(unit)), kind).toBe(true)
    }
  })

  test('updates nested model and Scenario paths and rejects missing or non-positive required values', () => {
    const initial = { model: {}, event: {}, boundary: {}, protection: {} }
    const withDiameter = updateEngineeringValue(initial, { target: 'model', path: 'pipe.innerDiameter' }, 0.3)
    const withCloseTime = updateEngineeringValue(withDiameter, { target: 'event', path: 'closeTime' }, 2)
    expect(withCloseTime).toEqual({
      model: { pipe: { innerDiameter: 0.3 } }, event: { closeTime: 2 }, boundary: {}, protection: {},
    })
    expect(validateEngineeringState('wave_speed', initial)).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'pipe.innerDiameter' }),
    ]))
    expect(validateEngineeringState('wave_speed', updateEngineeringValue(initial, { target: 'model', path: 'pipe.innerDiameter' }, 0)))
      .toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringMatching(/0より大きい/) })]))
  })

  test('uses the canonical empirical pipeline-system values and rejects an unsupported selection', () => {
    const systemType = ENGINEERING_FIELDS.empirical_pressure.find(({ path }) => path === 'systemType')!
    expect(systemType.options?.map(({ value }) => value)).toEqual([
      'gravity_open', 'gravity_closed', 'gravity_semi_closed',
      'pump_distribution_tank', 'pump_direct', 'pump_pressure_tank',
    ])
    expect(validateEngineeringState('empirical_pressure', {
      model: { systemType: 'natural', staticPressureMpa: 0.42 },
      event: {}, boundary: {}, protection: {},
    })).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'systemType' })]))
  })
})
