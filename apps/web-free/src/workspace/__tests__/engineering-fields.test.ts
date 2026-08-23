import { RUN_KINDS, type JsonValue } from '@open-waterhammer/contracts'
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

  test('projects steady single-pipe method switches to complete exclusive Hazen and Darcy field sets', () => {
    const hazen = structuredClone(ENGINEERING_TEMPLATES.steady_single_pipe)
    const method = engineeringFieldsFor('steady_single_pipe', hazen).find(({ target, path }) => target === 'model' && path === 'method')!
    const darcy = updateEngineeringFieldFromInput(hazen, method, 'darcy-weisbach', 'steady_single_pipe')

    expect(darcy.model).toEqual({
      method: 'darcy-weisbach', innerDiameter: 0.3, length: 500, flowRate: 0.03,
      upstreamElevation: 100, downstreamElevation: 88, frictionFactor: 0.02,
    })
    const darcyFields = engineeringFieldsFor('steady_single_pipe', darcy).filter(({ target }) => target === 'model')
    expect(darcyFields.map(({ path }) => path).sort()).toEqual([
      'downstreamElevation', 'flowRate', 'frictionFactor', 'innerDiameter', 'length', 'method', 'upstreamElevation',
    ])
    expect(darcyFields.find(({ path }) => path === 'frictionFactor')).toMatchObject({ kind: 'number', required: true, unit: '—' })
    expect(darcyFields.some(({ path }) => path === 'roughnessC')).toBe(false)
    expect(validateEngineeringState('steady_single_pipe', darcy)).toEqual([])

    const darcyMethod = darcyFields.find(({ path }) => path === 'method')!
    const hazenAgain = updateEngineeringFieldFromInput(darcy, darcyMethod, 'hazen-williams', 'steady_single_pipe')
    expect(hazenAgain.model).toEqual({
      method: 'hazen-williams', innerDiameter: 0.3, length: 500, flowRate: 0.03,
      upstreamElevation: 100, downstreamElevation: 88, roughnessC: 130,
    })
    expect(engineeringFieldsFor('steady_single_pipe', hazenAgain).some(({ path }) => path === 'frictionFactor')).toBe(false)
  })

  test('projects transient pump mode switches to complete exclusive trip and start event sets', () => {
    const trip = structuredClone(ENGINEERING_TEMPLATES.transient_pump)
    const mode = engineeringFieldsFor('transient_pump', trip).find(({ target, path }) => target === 'event' && path === 'mode')!
    const start = updateEngineeringFieldFromInput(trip, mode, 'start', 'transient_pump')

    expect(start.event).toEqual({
      mode: 'start', waveSpeed: 1100, Q_rated: 0.07, pumpHead: 50, Hs: 60,
      startupTime: 0.5, staticHead: 0, nReaches: 10, tMax: 8,
    })
    const startFields = engineeringFieldsFor('transient_pump', start).filter(({ target }) => target === 'event')
    expect(startFields.map(({ path }) => path).sort()).toEqual([
      'Hs', 'Q_rated', 'mode', 'nReaches', 'pumpHead', 'startupTime', 'staticHead', 'tMax', 'waveSpeed',
    ])
    expect(startFields.filter(({ required }) => required).map(({ path }) => path).sort()).toEqual(['Q_rated', 'pumpHead', 'startupTime'])
    expect(startFields.some(({ path }) => path === 'Q0')).toBe(false)
    expect(validateEngineeringState('transient_pump', start)).toEqual([])

    const startMode = startFields.find(({ path }) => path === 'mode')!
    const tripAgain = updateEngineeringFieldFromInput(start, startMode, 'trip', 'transient_pump')
    expect(tripAgain.event).toEqual({
      mode: 'trip', waveSpeed: 1100, Q0: 0.07, pumpHead: 50, Hs: 60,
      GD2: 100, N0: 1450, eta0: 0.8, shutdownTime: 0.5, checkValve: true,
      nReaches: 10, tMax: 8,
    })
    expect(engineeringFieldsFor('transient_pump', tripAgain).some(({ path }) => path === 'Q_rated')).toBe(false)
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
        fields: ['type', 'Q0', 'H0', 'shutdownTime', 'Hs', 'GD2', 'N0', 'eta0', 'mode', 'checkValve'],
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

    const pumpStart = structuredClone(ENGINEERING_TEMPLATES.transient_network) as EngineeringState
    pumpStart.model = updateEngineeringValue(pumpStart, { target: 'model', path: 'network.nodes' }, {
      'PUMP-01': { type: 'pump', mode: 'start', Q0: 0.07, H0: 50, shutdownTime: 0, Hs: 60, startupTime: 0.5, staticHead: 0, checkValve: true },
    }).model
    const startPrefix = 'network.nodes.PUMP-01.'
    const startFields = engineeringFieldsFor('transient_network', pumpStart).filter(({ target, path }) => target === 'model' && path.startsWith(startPrefix))
    expect(startFields.map(({ path }) => path.slice(startPrefix.length)).sort()).toEqual([
      'H0', 'Hs', 'Q0', 'checkValve', 'mode', 'shutdownTime', 'startupTime', 'staticHead', 'type',
    ].sort())
    expect(startFields.filter(({ required }) => required).map(({ path }) => path.slice(startPrefix.length)).sort()).toEqual([
      'H0', 'Q0', 'shutdownTime', 'startupTime', 'type',
    ].sort())
  })

  test('projects renamed protection MOC nodes across boundary and pump-mode branches without V-01 leakage', () => {
    const renameEngineeringRecordKey = (engineeringFieldModule as unknown as {
      renameEngineeringRecordKey(state: EngineeringState, collection: (typeof ENGINEERING_COLLECTIONS)['transient_protection_device'][number], from: string, to: string): EngineeringState
    }).renameEngineeringRecordKey
    const nodes = ENGINEERING_COLLECTIONS.transient_protection_device.find(({ target, path }) => target === 'model' && path === 'network.nodes')!
    let state = renameEngineeringRecordKey(structuredClone(ENGINEERING_TEMPLATES.transient_protection_device), nodes, 'V-01', 'V-02')
    let type = engineeringFieldsFor('transient_protection_device', state).find(({ path }) => path === 'network.nodes.V-02.type')!
    state = updateEngineeringFieldFromInput(state, type, 'air_chamber', 'transient_protection_device')
    expect(readEngineeringValue(state, { target: 'model', path: 'network.nodes.V-02' })).toEqual({
      type: 'air_chamber', V_air0: 2, H_air0: 30, polytropicIndex: 1.2,
    })
    expect(engineeringFieldsFor('transient_protection_device', state).some(({ path }) => path.includes('V-01'))).toBe(false)

    type = engineeringFieldsFor('transient_protection_device', state).find(({ path }) => path === 'network.nodes.V-02.type')!
    state = updateEngineeringFieldFromInput(state, type, 'pump', 'transient_protection_device')
    const mode = engineeringFieldsFor('transient_protection_device', state).find(({ path }) => path === 'network.nodes.V-02.mode')!
    state = updateEngineeringFieldFromInput(state, mode, 'start', 'transient_protection_device')
    expect(readEngineeringValue(state, { target: 'model', path: 'network.nodes.V-02' })).toEqual({
      type: 'pump', Q0: 0.07, H0: 50, shutdownTime: 0, Hs: 60,
      mode: 'start', startupTime: 0.5, staticHead: 0, checkValve: true,
    })
    expect(validateEngineeringState('transient_protection_device', state)).toEqual([])
  })

  test('renders exact branch fields for every steady-network node and protection-device type', () => {
    const steadyExpected: Record<string, string[]> = {
      reservoir: ['id', 'elevation', 'type', 'head'],
      demand: ['id', 'elevation', 'type', 'demand'],
      junction: ['id', 'elevation', 'type'],
    }
    for (const [type, expected] of Object.entries(steadyExpected)) {
      let state = structuredClone(ENGINEERING_TEMPLATES.steady_network_python)
      state = updateEngineeringValue(state, { target: 'model', path: 'nodes.0' }, {
        id: 'N-01', elevation: 100, type, ...(type === 'reservoir' ? { head: 142 } : type === 'demand' ? { demand: 0.03 } : {}),
      })
      const prefix = 'nodes.0.'
      expect(engineeringFieldsFor('steady_network_python', state).filter(({ path }) => path.startsWith(prefix)).map(({ path }) => path.slice(prefix.length)).sort(), type)
        .toEqual([...expected].sort())
    }

    const protectionExpected: Record<string, string[]> = {
      surge_tank: ['id', 'type', 'enabled', 'tankArea', 'initialLevel'],
      air_chamber: ['id', 'type', 'enabled', 'V_air0', 'H_air0', 'polytropicIndex'],
    }
    for (const [type, expected] of Object.entries(protectionExpected)) {
      let state = structuredClone(ENGINEERING_TEMPLATES.transient_protection_device)
      state = updateEngineeringValue(state, { target: 'protection', path: 'devices.0' }, {
        id: 'D-01', type, enabled: true,
        ...(type === 'surge_tank' ? { tankArea: 4, initialLevel: 30 } : { V_air0: 2, H_air0: 30, polytropicIndex: 1.2 }),
      })
      const prefix = 'devices.0.'
      expect(engineeringFieldsFor('transient_protection_device', state).filter(({ target, path }) => target === 'protection' && path.startsWith(prefix)).map(({ path }) => path.slice(prefix.length)).sort(), type)
        .toEqual([...expected].sort())
    }
  })

  test('offers every exact protocol discriminator value in visible select controls', () => {
    const wave = engineeringFieldsFor('wave_speed', ENGINEERING_TEMPLATES.wave_speed)
    expect(wave.find(({ path }) => path === 'pipe.pipeType')?.options?.map(({ value }) => value)).toEqual([
      'steel', 'ductile_iron', 'rcp', 'cpcp', 'upvc', 'pe2', 'pe3_pe100', 'wdpe',
      'grp_fw1', 'grp_fw2', 'grp_fw3', 'grp_fw4', 'grp_fw5', 'gfpe',
    ])
    const operation = engineeringFieldsFor('joukowsky_allievi', ENGINEERING_TEMPLATES.joukowsky_allievi)
    expect(operation.find(({ path }) => path === 'calculationCase.operationType')?.options?.map(({ value }) => value)).toEqual([
      'valve_close', 'valve_open', 'pump_stop', 'pump_start', 'combined',
    ])
    expect(engineeringFieldsFor('steady_single_pipe', ENGINEERING_TEMPLATES.steady_single_pipe).find(({ path }) => path === 'method')?.options?.map(({ value }) => value))
      .toEqual(['hazen-williams', 'darcy-weisbach'])
    expect(engineeringFieldsFor('transient_single_pipe', ENGINEERING_TEMPLATES.transient_single_pipe).find(({ path }) => path === 'operation')?.options?.map(({ value }) => value))
      .toEqual(['close', 'open'])
    expect(engineeringFieldsFor('transient_pump', ENGINEERING_TEMPLATES.transient_pump).find(({ target, path }) => target === 'event' && path === 'mode')?.options?.map(({ value }) => value))
      .toEqual(['trip', 'start'])
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

  test('validates current-only known numeric and select fields instead of letting Advanced JSON bypass descriptors', () => {
    let wave = structuredClone(ENGINEERING_TEMPLATES.wave_speed)
    wave = updateEngineeringValue(wave, { target: 'model', path: 'pipe.youngsModulus' }, '')
    const youngs = engineeringFieldsFor('wave_speed', wave).find(({ path }) => path === 'pipe.youngsModulus')
    expect(youngs).toMatchObject({ kind: 'number', required: false, unit: 'kN/m²' })
    expect(validateEngineeringState('wave_speed', wave)).toContainEqual(expect.objectContaining({ path: 'pipe.youngsModulus' }))

    let longitudinal = structuredClone(ENGINEERING_TEMPLATES.longitudinal_hydraulics)
    longitudinal = updateEngineeringValue(longitudinal, { target: 'model', path: 'waterhammerPressureMpa' }, '')
    longitudinal = updateEngineeringValue(longitudinal, { target: 'model', path: 'points.0.otherLoss' }, '')
    expect(engineeringFieldsFor('longitudinal_hydraulics', longitudinal).filter(({ path }) => path === 'waterhammerPressureMpa' || path === 'points.0.otherLoss'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ path: 'waterhammerPressureMpa', kind: 'number', required: false }),
        expect.objectContaining({ path: 'points.0.otherLoss', kind: 'number', required: false }),
      ]))
    expect(validateEngineeringState('longitudinal_hydraulics', longitudinal)).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'waterhammerPressureMpa' }),
      expect.objectContaining({ path: 'points.0.otherLoss' }),
    ]))

    const blankMode = updateEngineeringValue(ENGINEERING_TEMPLATES.transient_pump, { target: 'event', path: 'mode' }, '')
    expect(validateEngineeringState('transient_pump', blankMode)).toContainEqual(expect.objectContaining({ path: 'mode' }))

    const currentOnlySelect = updateEngineeringValue(ENGINEERING_TEMPLATES.transient_network, { target: 'model', path: 'network.nodes.R-01.operation' }, '')
    expect(engineeringFieldsFor('transient_network', currentOnlySelect).find(({ path }) => path === 'network.nodes.R-01.operation'))
      .toMatchObject({ kind: 'select', required: false })
    expect(validateEngineeringState('transient_network', currentOnlySelect)).toContainEqual(expect.objectContaining({ path: 'network.nodes.R-01.operation' }))
  })

  test('deletes an optional select when cleared instead of retaining an empty protocol string', () => {
    const initial = structuredClone(ENGINEERING_TEMPLATES.steady_single_pipe)
    const method = engineeringFieldsFor('steady_single_pipe', initial).find(({ path }) => path === 'method')!
    const cleared = updateEngineeringFieldFromInput(initial, method, '', 'steady_single_pipe')

    expect(cleared.model).not.toHaveProperty('method')
    expect(cleared.model).toHaveProperty('roughnessC', 130)
    expect(JSON.stringify(cleared)).not.toContain('""')
    expect(validateEngineeringState('steady_single_pipe', cleared)).toEqual([])

    const darcy = updateEngineeringFieldFromInput(initial, method, 'darcy-weisbach', 'steady_single_pipe')
    const clearedDarcy = updateEngineeringFieldFromInput(darcy, engineeringFieldsFor('steady_single_pipe', darcy).find(({ path }) => path === 'method')!, '', 'steady_single_pipe')
    expect(clearedDarcy.model).toEqual({
      innerDiameter: 0.3, length: 500, flowRate: 0.03, upstreamElevation: 100,
      downstreamElevation: 88, roughnessC: 130,
    })

    const trip = structuredClone(ENGINEERING_TEMPLATES.transient_pump)
    const start = updateEngineeringFieldFromInput(trip, engineeringFieldsFor('transient_pump', trip).find(({ target, path }) => target === 'event' && path === 'mode')!, 'start', 'transient_pump')
    const clearedStart = updateEngineeringFieldFromInput(start, engineeringFieldsFor('transient_pump', start).find(({ target, path }) => target === 'event' && path === 'mode')!, '', 'transient_pump')
    expect(clearedStart.event).toEqual({
      waveSpeed: 1100, Q0: 0.07, pumpHead: 50, Hs: 60, GD2: 100, N0: 1450,
      eta0: 0.8, shutdownTime: 0.5, checkValve: true, nReaches: 10, tMax: 8,
    })
    expect(JSON.stringify(clearedStart)).not.toContain('""')
    expect(validateEngineeringState('transient_pump', clearedStart)).toEqual([])
  })

  test('rejects dotted and prototype-sensitive object-keyed node IDs at rename and save boundaries', () => {
    const renameEngineeringRecordKey = (engineeringFieldModule as unknown as {
      renameEngineeringRecordKey(state: EngineeringState, collection: (typeof ENGINEERING_COLLECTIONS)['transient_network'][number], from: string, to: string): EngineeringState
    }).renameEngineeringRecordKey
    const state = structuredClone(ENGINEERING_TEMPLATES.transient_network)
    const nodes = ENGINEERING_COLLECTIONS.transient_network.find(({ path }) => path === 'network.nodes')!

    for (const unsafe of ['R.02', '__proto__', 'constructor', 'prototype']) {
      expect(() => renameEngineeringRecordKey(state, nodes, 'V-01', unsafe), unsafe).toThrow(/ASCII letters, numbers, '_' or '-'/)
      const unsafeNodes = JSON.parse(`{"${unsafe}":{"type":"reservoir","head":80}}`) as JsonValue
      const advanced = updateEngineeringValue(state, { target: 'model', path: 'network.nodes' }, unsafeNodes)
      expect(validateEngineeringState('transient_network', advanced), unsafe).toContainEqual(expect.objectContaining({ path: 'network.nodes' }))
    }
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
