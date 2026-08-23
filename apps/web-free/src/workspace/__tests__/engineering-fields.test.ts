import { RUN_KINDS } from '@open-waterhammer/contracts'
import { describe, expect, test } from 'vitest'

import {
  ENGINEERING_COLLECTIONS,
  ENGINEERING_FIELDS,
  ENGINEERING_TEMPLATES,
  addEngineeringCollectionItem,
  engineeringFieldsFor,
  readEngineeringValue,
  removeEngineeringCollectionItem,
  updateEngineeringFieldFromInput,
  updateEngineeringValue,
  validateEngineeringState,
  type EngineeringState,
} from '../engineering-fields'
import { SAMPLE_RUN_INPUTS } from '../sample-workspace'

function scalarPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((child, index) => scalarPaths(child, `${prefix}.${index}`))
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, child]) => scalarPaths(child, prefix ? `${prefix}.${key}` : key))
  return [prefix]
}

function arrayPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return [prefix, ...value.flatMap((child, index) => arrayPaths(child, `${prefix}.${index}`))]
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, child]) => arrayPaths(child, prefix ? `${prefix}.${key}` : key))
  return []
}

describe('RunKind engineering field catalog', () => {
  test('provides kind-specific unit-aware primary fields for every exact RunKind', () => {
    expect(Object.keys(ENGINEERING_FIELDS).sort()).toEqual([...RUN_KINDS].sort())
    for (const kind of RUN_KINDS) {
      expect(ENGINEERING_FIELDS[kind].length, kind).toBeGreaterThanOrEqual(3)
      expect(ENGINEERING_FIELDS[kind].some(({ unit }) => Boolean(unit)), kind).toBe(true)
    }
  })

  test('covers every scalar leaf in every canonical RunKind template with an editable descriptor', () => {
    for (const kind of RUN_KINDS) {
      expect(ENGINEERING_TEMPLATES[kind].model, kind).toEqual(SAMPLE_RUN_INPUTS[kind])
      const descriptors = engineeringFieldsFor(kind, ENGINEERING_TEMPLATES[kind])
      const described = new Set(descriptors.map(({ target, path }) => `${target}.${path}`))
      const expected = (['model', 'event', 'boundary', 'protection'] as const).flatMap((target) =>
        scalarPaths(ENGINEERING_TEMPLATES[kind][target]).map((path) => `${target}.${path}`),
      )
      expect(expected.every((path) => described.has(path)), kind).toBe(true)
      expect(descriptors.every(({ kind: control }) => ['number', 'text', 'select', 'boolean'].includes(control)), kind).toBe(true)
      for (const descriptor of descriptors) {
        const value = readEngineeringValue(ENGINEERING_TEMPLATES[kind], descriptor)
        if (typeof value === 'number') expect(descriptor.kind, `${kind}:${descriptor.target}.${descriptor.path}`).toBe('number')
        if (typeof value === 'boolean') expect(descriptor.kind, `${kind}:${descriptor.target}.${descriptor.path}`).toBe('boolean')
      }
      expect(validateEngineeringState(kind, ENGINEERING_TEMPLATES[kind]), kind).toEqual([])
    }
  })

  test('describes every nested template array and adds/removes complete editable rows', () => {
    for (const kind of RUN_KINDS) {
      const expected = (['model', 'event', 'boundary', 'protection'] as const).flatMap((target) =>
        arrayPaths(ENGINEERING_TEMPLATES[kind][target]).map((path) => `${target}.${path}`),
      )
      expect(ENGINEERING_COLLECTIONS[kind].map(({ target, path }) => `${target}.${path}`).sort(), kind)
        .toEqual([...new Set(expected)].sort())
    }

    const collection = ENGINEERING_COLLECTIONS.steady_network_python.find(({ path }) => path === 'pipes')!
    const initial = structuredClone(ENGINEERING_TEMPLATES.steady_network_python) as EngineeringState
    const added = addEngineeringCollectionItem(initial, collection)
    expect(readEngineeringValue(added, collection)).toHaveLength(2)
    const removed = removeEngineeringCollectionItem(added, collection, 1)
    expect(readEngineeringValue(removed, collection)).toHaveLength(1)
    expect(readEngineeringValue(removed, { target: 'model', path: 'pipes.0.id' })).toBe('P-01')
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

  test('deletes a cleared optional numeric path while a cleared required numeric path remains invalid', () => {
    const state = {
      model: { systemType: 'gravity_open', staticPressureMpa: 0.42, operatingPressureMpa: 0.3 },
      event: {}, boundary: {}, protection: {},
    }
    const optional = ENGINEERING_FIELDS.empirical_pressure.find(({ path }) => path === 'operatingPressureMpa')!
    const required = ENGINEERING_FIELDS.empirical_pressure.find(({ path }) => path === 'staticPressureMpa')!
    const withoutOptional = updateEngineeringFieldFromInput(state, optional, '')
    const withoutRequired = updateEngineeringFieldFromInput(withoutOptional, required, '')

    expect(withoutOptional.model).toEqual({ systemType: 'gravity_open', staticPressureMpa: 0.42 })
    expect(withoutRequired.model).toEqual({ systemType: 'gravity_open' })
    expect(validateEngineeringState('empirical_pressure', withoutRequired)).toContainEqual(expect.objectContaining({ path: 'staticPressureMpa' }))
    expect(JSON.stringify(withoutRequired)).not.toContain('""')
  })
})
