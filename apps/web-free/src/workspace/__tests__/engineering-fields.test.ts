import { RUN_KINDS } from '@open-waterhammer/contracts'
import { describe, expect, test } from 'vitest'

import * as engineeringFieldModule from '../engineering-fields'
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

const OPTIONAL_CANONICAL_PATHS: Record<(typeof RUN_KINDS)[number], string[]> = {
  wave_speed: ['model.pipe.name', 'model.pipe.startNodeId', 'model.pipe.endNodeId', 'event.closeTime'],
  joukowsky_allievi: ['model.pipe.name', 'model.pipe.startNodeId', 'model.pipe.endNodeId'],
  empirical_pressure: [],
  steady_single_pipe: ['model.method'],
  steady_network_python: [
    'model.caseName', 'model.pipes.0.minorLossCoeff', 'model.nodes.0.head', 'model.nodes.1.demand',
  ],
  steady_network_epanet: [
    'model.caseName', 'model.pipes.0.minorLossCoeff', 'model.nodes.0.head', 'model.nodes.1.demand',
  ],
  longitudinal_hydraulics: ['model.caseName', 'model.waterhammerRatio'],
  transient_single_pipe: [
    'model.pipe.name', 'model.pipe.startNodeId', 'model.pipe.endNodeId',
    'event.nReaches', 'event.tMax', 'event.operation',
  ],
  transient_network: [
    'model.network.pipes.0.pipe.name', 'model.network.pipes.0.pipe.startNodeId', 'model.network.pipes.0.pipe.endNodeId',
    'model.network.pipes.0.initialFlow', 'model.network.nodes.V-01.operation',
    'model.options.tMax', 'model.options.initialFlow',
  ],
  transient_pump: [
    'model.pipe.name', 'model.pipe.startNodeId', 'model.pipe.endNodeId',
    'event.mode', 'event.waveSpeed', 'event.shutdownTime', 'event.checkValve', 'event.nReaches', 'event.tMax',
  ],
  transient_protection_device: [
    'model.network.pipes.0.pipe.name', 'model.network.pipes.0.pipe.startNodeId', 'model.network.pipes.0.pipe.endNodeId',
    'model.network.pipes.0.initialFlow', 'model.network.nodes.V-01.datum',
    'model.options.tMax', 'model.options.initialFlow',
  ],
}

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

  test('classifies every canonical scalar by exact RunKind, target, path, and boundary context', () => {
    for (const kind of RUN_KINDS) {
      const descriptors = engineeringFieldsFor(kind, ENGINEERING_TEMPLATES[kind])
      const byPath = new Map(descriptors.map((field) => [`${field.target}.${field.path}`, field]))
      const canonicalPaths = (['model', 'event', 'boundary', 'protection'] as const).flatMap((target) =>
        scalarPaths(ENGINEERING_TEMPLATES[kind][target]).map((path) => `${target}.${path}`),
      )

      expect(canonicalPaths.map((path) => [path, byPath.get(path)?.required]), kind).toEqual(
        canonicalPaths.map((path) => [path, !OPTIONAL_CANONICAL_PATHS[kind].includes(path)]),
      )
    }
  })

  test('describes every nested template array and adds/removes complete editable rows', () => {
    for (const kind of RUN_KINDS) {
      const expected = (['model', 'event', 'boundary', 'protection'] as const).flatMap((target) =>
        arrayPaths(ENGINEERING_TEMPLATES[kind][target]).map((path) => `${target}.${path}`),
      )
      expect(ENGINEERING_COLLECTIONS[kind].filter(({ kind: collectionKind }) => collectionKind === 'array').map(({ target, path }) => `${target}.${path}`).sort(), kind)
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

  test('adds array rows and object-keyed MOC nodes with deterministic unique identifiers', () => {
    const state = structuredClone(ENGINEERING_TEMPLATES.transient_network) as EngineeringState
    const pipes = ENGINEERING_COLLECTIONS.transient_network.find(({ target, path }) => target === 'model' && path === 'network.pipes')!
    const nodes = ENGINEERING_COLLECTIONS.transient_network.find(({ target, path }) => target === 'model' && path === 'network.nodes')!

    expect(pipes).toMatchObject({ kind: 'array' })
    expect(nodes).toMatchObject({ kind: 'record' })
    const withPipe = addEngineeringCollectionItem(state, pipes)
    expect(readEngineeringValue(withPipe, { target: 'model', path: 'network.pipes.1.id' })).toBe('P-02')
    expect(readEngineeringValue(withPipe, { target: 'model', path: 'network.pipes.1.pipe.id' })).toBe('P-02')

    const withNode = addEngineeringCollectionItem(state, nodes)
    expect(Object.keys(readEngineeringValue(withNode, nodes) as object).sort()).toEqual(['R-01', 'R-02', 'V-01'])

    const protection = structuredClone(ENGINEERING_TEMPLATES.transient_protection_device) as EngineeringState
    const devices = ENGINEERING_COLLECTIONS.transient_protection_device.find(({ target, path }) => target === 'protection' && path === 'devices')!
    const withDevice = addEngineeringCollectionItem(protection, devices)
    expect(readEngineeringValue(withDevice, { target: 'protection', path: 'devices.1.id' })).toBe('V-02')
  })

  test('renames object-keyed nodes with repaired pipe references and rejects referenced removal', () => {
    const renameEngineeringRecordKey = (engineeringFieldModule as unknown as {
      renameEngineeringRecordKey(state: EngineeringState, collection: (typeof ENGINEERING_COLLECTIONS)['transient_network'][number], from: string, to: string): EngineeringState
    }).renameEngineeringRecordKey
    const state = structuredClone(ENGINEERING_TEMPLATES.transient_network) as EngineeringState
    const nodes = ENGINEERING_COLLECTIONS.transient_network.find(({ target, path }) => target === 'model' && path === 'network.nodes')!

    const renamed = renameEngineeringRecordKey(state, nodes, 'V-01', 'V-02')
    expect(readEngineeringValue(renamed, { target: 'model', path: 'network.nodes.V-02.type' })).toBe('valve')
    expect(readEngineeringValue(renamed, { target: 'model', path: 'network.pipes.0.downstreamNodeId' })).toBe('V-02')
    expect(engineeringFieldsFor('transient_network', renamed).some(({ path }) => path === 'network.nodes.V-02.closeTime')).toBe(true)
    expect(validateEngineeringState('transient_network', renamed)).toEqual([])

    expect(() => renameEngineeringRecordKey(state, nodes, 'V-01', 'R-01')).toThrow(/already exists/i)
    expect(() => renameEngineeringRecordKey(state, nodes, 'V-01', '  ')).toThrow(/non-blank/i)
    expect(() => removeEngineeringCollectionItem(state, nodes, 'V-01' as never)).toThrow(/referenced/i)

    const added = addEngineeringCollectionItem(state, nodes)
    const removed = removeEngineeringCollectionItem(added, nodes, 'R-02' as never)
    expect(readEngineeringValue(removed, { target: 'model', path: 'network.nodes.R-02' })).toBeUndefined()
  })

  test('exposes all editable protocol fields for every object-keyed MOC boundary discriminator', () => {
    const expected: Record<string, { fields: string[]; required: string[] }> = {
      reservoir: { fields: ['type', 'head'], required: ['type', 'head'] },
      valve: { fields: ['type', 'Q0', 'H0v', 'closeTime', 'operation'], required: ['type', 'Q0', 'H0v', 'closeTime'] },
      pump: {
        fields: ['type', 'Q0', 'H0', 'shutdownTime', 'Hs', 'GD2', 'N0', 'eta0', 'mode', 'startupTime', 'staticHead', 'checkValve'],
        required: ['type', 'Q0', 'H0', 'shutdownTime'],
      },
      air_chamber: { fields: ['type', 'V_air0', 'H_air0', 'polytropicIndex'], required: ['type', 'V_air0', 'H_air0'] },
      surge_tank: { fields: ['type', 'tankArea', 'initialLevel', 'datum'], required: ['type', 'tankArea', 'initialLevel'] },
      air_release_valve: { fields: ['type', 'atmosphericHead'], required: ['type'] },
      pressure_reducing_valve: { fields: ['type', 'setHead', 'Q0'], required: ['type', 'setHead', 'Q0'] },
      dead_end: { fields: ['type'], required: ['type'] },
    }

    for (const [type, contract] of Object.entries(expected)) {
      const state = structuredClone(ENGINEERING_TEMPLATES.transient_network) as EngineeringState
      state.model = updateEngineeringValue(state, { target: 'model', path: 'network.nodes' }, { 'N-01': { type } }).model
      const prefix = 'network.nodes.N-01.'
      const fields = engineeringFieldsFor('transient_network', state).filter(({ target, path }) => target === 'model' && path.startsWith(prefix))
      expect(fields.map(({ path }) => path.slice(prefix.length)).sort(), type).toEqual([...contract.fields].sort())
      expect(fields.filter(({ required }) => required).map(({ path }) => path.slice(prefix.length)).sort(), type).toEqual([...contract.required].sort())
    }
  })

  test('rejects duplicate row IDs and dangling steady or MOC pipe endpoint references before persistence', () => {
    let steady = structuredClone(ENGINEERING_TEMPLATES.steady_network_python) as EngineeringState
    steady = updateEngineeringValue(steady, { target: 'model', path: 'nodes.1.id' }, 'R-01')
    steady = updateEngineeringValue(steady, { target: 'model', path: 'pipes.0.downstreamNodeId' }, 'MISSING')
    expect(validateEngineeringState('steady_network_python', steady)).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'nodes.1.id' }),
      expect.objectContaining({ path: 'pipes.0.downstreamNodeId' }),
    ]))

    let moc = structuredClone(ENGINEERING_TEMPLATES.transient_network) as EngineeringState
    const pipes = ENGINEERING_COLLECTIONS.transient_network.find(({ path }) => path === 'network.pipes')!
    moc = addEngineeringCollectionItem(moc, pipes)
    moc = updateEngineeringValue(moc, { target: 'model', path: 'network.pipes.1.id' }, 'P-01')
    moc = updateEngineeringValue(moc, { target: 'model', path: 'network.pipes.1.pipe.id' }, 'P-01')
    moc = updateEngineeringValue(moc, { target: 'model', path: 'network.pipes.1.upstreamNodeId' }, 'MISSING')
    expect(validateEngineeringState('transient_network', moc)).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'network.pipes.1.id' }),
      expect.objectContaining({ path: 'network.pipes.1.pipe.id' }),
      expect.objectContaining({ path: 'network.pipes.1.upstreamNodeId' }),
    ]))

    const blankNodeId = updateEngineeringValue(
      structuredClone(ENGINEERING_TEMPLATES.transient_network),
      { target: 'model', path: 'network.nodes' },
      { '': { type: 'reservoir', head: 80 } },
    )
    expect(validateEngineeringState('transient_network', blankNodeId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'network.nodes' }),
    ]))

    const steadyNodes = ENGINEERING_COLLECTIONS.steady_network_python.find(({ path }) => path === 'nodes')!
    expect(() => removeEngineeringCollectionItem(ENGINEERING_TEMPLATES.steady_network_python, steadyNodes, 0)).toThrow(/referenced/i)
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

  test('rejects an empty string placed directly in an optional numeric protocol path', () => {
    const invalid = updateEngineeringValue(ENGINEERING_TEMPLATES.empirical_pressure, {
      target: 'model', path: 'operatingPressureMpa',
    }, '')

    expect(validateEngineeringState('empirical_pressure', invalid)).toContainEqual(expect.objectContaining({ path: 'operatingPressureMpa' }))
  })

  test('rejects cleared MOC reservoir head and valve closeTime but deletes optional tMax', () => {
    const initial = structuredClone(ENGINEERING_TEMPLATES.transient_network)
    const fields = engineeringFieldsFor('transient_network', initial)
    const reservoirHead = fields.find(({ target, path }) => target === 'model' && path === 'network.nodes.R-01.head')!
    const valveCloseTime = fields.find(({ target, path }) => target === 'model' && path === 'network.nodes.V-01.closeTime')!
    const optionalTMax = fields.find(({ target, path }) => target === 'model' && path === 'options.tMax')!

    const withoutHead = updateEngineeringFieldFromInput(initial, reservoirHead, '')
    const withoutValveTime = updateEngineeringFieldFromInput(initial, valveCloseTime, '')
    const withoutOptional = updateEngineeringFieldFromInput(initial, optionalTMax, '')

    expect(validateEngineeringState('transient_network', withoutHead)).toContainEqual(expect.objectContaining({ path: 'network.nodes.R-01.head' }))
    expect(validateEngineeringState('transient_network', withoutValveTime)).toContainEqual(expect.objectContaining({ path: 'network.nodes.V-01.closeTime' }))
    expect(validateEngineeringState('transient_network', withoutOptional)).toEqual([])
    expect(withoutOptional.model).not.toHaveProperty('options.tMax')
    expect(JSON.stringify([withoutHead, withoutValveTime, withoutOptional])).not.toContain('""')
  })
})
