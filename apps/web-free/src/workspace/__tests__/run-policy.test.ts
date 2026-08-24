import type { Case, JsonValue } from '@open-waterhammer/contracts'
import { RUN_KINDS } from '@open-waterhammer/contracts'
import { describe, expect, test } from 'vitest'

import { evaluateRunGate, TOPOLOGY_REQUIRED_KINDS } from '../run-policy'

const VALID_DRAFTS: JsonValue = [
  { sourceFeatureId: 'R-01', id: 'R-01', kind: 'node', geometry: { type: 'Point', coordinates: [139.7, 35.68] }, properties: { elevation: 100 }, errors: [] },
  { sourceFeatureId: 'J-01', id: 'J-01', kind: 'node', geometry: { type: 'Point', coordinates: [139.708, 35.684] }, properties: { elevation: 88 }, errors: [] },
  { sourceFeatureId: 'P-01', id: 'P-01', kind: 'pipe', geometry: { type: 'LineString', coordinates: [[139.7, 35.68], [139.708, 35.684]] }, properties: { startNodeId: 'R-01', endNodeId: 'J-01', innerDiameter: 0.3 }, errors: [] },
]

const INVALID_DRAFTS: JsonValue = [
  { sourceFeatureId: 'P-01', id: 'P-01', kind: 'pipe', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: { startNodeId: 'R-MISSING', endNodeId: 'J-MISSING', innerDiameter: 0.3 }, errors: [] },
]

const STEADY_NETWORK_MODEL: JsonValue = {
  pipes: [{ id: 'P-01', upstreamNodeId: 'R-01', downstreamNodeId: 'J-01', innerDiameter: 0.3, length: 500, roughnessC: 130 }],
  nodes: [{ id: 'R-01', elevation: 100, type: 'reservoir', head: 142 }, { id: 'J-01', elevation: 88, type: 'demand', demand: 0.03 }],
}

const TRANSIENT_NETWORK_MODEL: JsonValue = {
  network: {
    pipes: [{ id: 'P-01', pipe: { id: 'P-01', startNodeId: 'R-01', endNodeId: 'V-01', pipeType: 'ductile_iron', innerDiameter: 0.3, wallThickness: 0.007, length: 500, roughnessCoeff: 130 }, nReaches: 10, upstreamNodeId: 'R-01', downstreamNodeId: 'V-01' }],
    nodes: { 'R-01': { type: 'reservoir', head: 80 }, 'V-01': { type: 'valve', Q0: 0.07, H0v: 30, closeTime: 2 } },
  },
  options: { tMax: 8 },
}

function makeCase(modelSnapshot: JsonValue): Case {
  return {
    id: 'case-under-test',
    alternativeId: 'alt-1',
    parentCaseId: null,
    modelSnapshot,
    state: 'draft',
    lockProvenance: null,
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
  }
}

const BLANK_CASE = makeCase({ runInputs: {}, geoDrafts: [], geoSourceCrs: 'EPSG:4326' })

describe('TOPOLOGY_REQUIRED_KINDS', () => {
  test('contains exactly the four handlers that read a node/pipe network graph', () => {
    expect([...TOPOLOGY_REQUIRED_KINDS].sort()).toEqual([
      'steady_network_epanet',
      'steady_network_python',
      'transient_network',
      'transient_protection_device',
    ])
  })

  test('every other exact RunKind is a form-only kind not present in the set', () => {
    const formOnly = RUN_KINDS.filter((kind) => !TOPOLOGY_REQUIRED_KINDS.has(kind))
    expect(formOnly.sort()).toEqual([
      'empirical_pressure',
      'joukowsky_allievi',
      'longitudinal_hydraulics',
      'steady_single_pipe',
      'transient_pump',
      'transient_single_pipe',
      'wave_speed',
    ].sort())
  })
})

describe('evaluateRunGate', () => {
  test('a brand-new Case with no geoDrafts and no saved network can immediately run a form-only kind', () => {
    expect(evaluateRunGate('wave_speed', BLANK_CASE)).toEqual({ canRun: true, reason: null, errorsByFeature: {} })
  })

  test('the same blank Case blocks a topology-required kind with reason topology_required', () => {
    const gate = evaluateRunGate('transient_network', BLANK_CASE)
    expect(gate.canRun).toBe(false)
    expect(gate.reason).toBe('topology_required')
  })

  test('every form-only kind always reports canRun true regardless of GIS drafts state', () => {
    const withBrokenDrafts = makeCase({ runInputs: {}, geoDrafts: INVALID_DRAFTS })
    for (const kind of RUN_KINDS.filter((candidate) => !TOPOLOGY_REQUIRED_KINDS.has(candidate))) {
      expect(evaluateRunGate(kind, BLANK_CASE)).toMatchObject({ canRun: true, reason: null })
      expect(evaluateRunGate(kind, withBrokenDrafts)).toMatchObject({ canRun: true, reason: null })
    }
  })

  test('broken (non-empty but invalid) geoDrafts surface as a non-blocking errorsByFeature even for a form-only kind', () => {
    const withBrokenDrafts = makeCase({ runInputs: {}, geoDrafts: INVALID_DRAFTS })
    const gate = evaluateRunGate('wave_speed', withBrokenDrafts)
    expect(gate.canRun).toBe(true)
    expect(Object.keys(gate.errorsByFeature)).toContain('P-01')
  })

  test('a valid persisted GIS topology allows every topology-required kind to run', () => {
    const withValidDrafts = makeCase({ runInputs: {}, geoDrafts: VALID_DRAFTS })
    for (const kind of TOPOLOGY_REQUIRED_KINDS) {
      expect(evaluateRunGate(kind, withValidDrafts)).toEqual({ canRun: true, reason: null, errorsByFeature: {} })
    }
  })

  test('invalid (non-empty but broken) geoDrafts block a topology-required kind with reason topology_invalid when no form network is saved', () => {
    const withBrokenDrafts = makeCase({ runInputs: {}, geoDrafts: INVALID_DRAFTS })
    const gate = evaluateRunGate('steady_network_python', withBrokenDrafts)
    expect(gate.canRun).toBe(false)
    expect(gate.reason).toBe('topology_invalid')
    expect(Object.keys(gate.errorsByFeature)).toContain('P-01')
  })

  test('a structurally complete saved network input (Outcome A OR-branch) allows steady_network_python/epanet without any geoDrafts', () => {
    const formAuthored = makeCase({ runInputs: { steady_network_python: STEADY_NETWORK_MODEL, steady_network_epanet: STEADY_NETWORK_MODEL }, geoDrafts: [] })
    expect(evaluateRunGate('steady_network_python', formAuthored)).toEqual({ canRun: true, reason: null, errorsByFeature: {} })
    expect(evaluateRunGate('steady_network_epanet', formAuthored)).toEqual({ canRun: true, reason: null, errorsByFeature: {} })
  })

  test('a structurally complete saved network input allows transient_network/transient_protection_device without any geoDrafts', () => {
    const formAuthored = makeCase({ runInputs: { transient_network: TRANSIENT_NETWORK_MODEL, transient_protection_device: TRANSIENT_NETWORK_MODEL }, geoDrafts: [] })
    expect(evaluateRunGate('transient_network', formAuthored)).toEqual({ canRun: true, reason: null, errorsByFeature: {} })
    expect(evaluateRunGate('transient_protection_device', formAuthored)).toEqual({ canRun: true, reason: null, errorsByFeature: {} })
  })

  test('a saved network input with an empty pipes or nodes collection is not structurally complete', () => {
    const emptyPipes = makeCase({ runInputs: { steady_network_python: { ...STEADY_NETWORK_MODEL as Record<string, JsonValue>, pipes: [] } }, geoDrafts: [] })
    expect(evaluateRunGate('steady_network_python', emptyPipes).canRun).toBe(false)
    const emptyNodes = makeCase({ runInputs: { transient_network: { ...TRANSIENT_NETWORK_MODEL as Record<string, JsonValue>, network: { pipes: (TRANSIENT_NETWORK_MODEL as Record<string, JsonValue> & { network: Record<string, JsonValue> }).network.pipes, nodes: {} } } }, geoDrafts: [] })
    expect(evaluateRunGate('transient_network', emptyNodes).canRun).toBe(false)
  })

  test('an invalid GIS topology does not block a Run when the form-authored network is already structurally complete', () => {
    const both = makeCase({ runInputs: { steady_network_python: STEADY_NETWORK_MODEL }, geoDrafts: INVALID_DRAFTS })
    expect(evaluateRunGate('steady_network_python', both).canRun).toBe(true)
  })
})
