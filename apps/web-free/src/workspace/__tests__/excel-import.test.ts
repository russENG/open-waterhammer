import type { WorkbookData } from '@open-waterhammer/excel-io'
import { describe, expect, test } from 'vitest'

import { mapWorkbookToRunInputs } from '../excel-import'

function baseFixture(): WorkbookData {
  return {
    meta: { projectName: 'テスト案件', standardId: 'nochi_pipeline_2021' },
    pipes: [{
      id: 'P-01', name: '第1号幹線', startNodeId: 'R-01', endNodeId: 'J-01',
      pipeType: 'ductile_iron', innerDiameter: 0.3, wallThickness: 0.007,
      length: 500, roughnessCoeff: 130,
    }],
    nodes: [
      { id: 'R-01', elevation: 100, nodeType: 'reservoir', hydraulicGrade: 142 },
      { id: 'J-01', elevation: 88, nodeType: 'junction' },
    ],
    cases: [{
      id: 'CALC-01', name: '末端弁閉鎖', operationType: 'valve_close',
      targetFacilityId: 'V-01', initialVelocity: 1, initialHead: 30,
    }],
    measurementPoints: [
      { id: 'STA-000', horizontalDistance: 0, groundLevel: 100, pipeCenterHeight: 98, pipeLength: 0, flowRate: 0.03, diameter: 0.3, roughnessC: 130, bendLossCoeff: 0, valveLossCoeff: 0, branchLossCoeff: 0 },
      { id: 'STA-500', horizontalDistance: 500, groundLevel: 90, pipeCenterHeight: 88, pipeLength: 500, flowRate: 0.03, diameter: 0.3, roughnessC: 130, bendLossCoeff: 0.2, valveLossCoeff: 0, branchLossCoeff: 0 },
    ],
  }
}

/** Deep-freezes a plain JSON-shaped value so any accidental mutation throws in strict mode. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

describe('mapWorkbookToRunInputs', () => {
  test('pipes[0] + cases[0] populate wave_speed and joukowsky_allievi verbatim', () => {
    const fixture = baseFixture()
    const { runInputs, warnings } = mapWorkbookToRunInputs(fixture)

    expect(runInputs.wave_speed).toEqual({ pipe: fixture.pipes[0] })
    const joukowsky = runInputs.joukowsky_allievi as { pipe: { id: string }; calculationCase: { id: string } }
    expect(joukowsky.pipe.id).toBe('P-01')
    expect(joukowsky).toEqual({ pipe: fixture.pipes[0], calculationCase: fixture.cases[0] })
    expect(warnings.some((warning) => /joukowsky/i.test(warning))).toBe(false)
  })

  test('maps every Excel scenario row instead of silently using only the first row', () => {
    const fixture = baseFixture()
    fixture.cases.push({
      id: 'CALC-02', name: 'ポンプ停止', operationType: 'pump_stop',
      targetFacilityId: 'PUMP-01', initialVelocity: 0.8, initialHead: 28,
    })

    const { scenarios } = mapWorkbookToRunInputs(fixture)

    expect(scenarios).toHaveLength(2)
    expect(scenarios.map(({ name }) => name)).toEqual(['末端弁閉鎖', 'ポンプ停止'])
    expect(scenarios[0]?.eventSettings).toMatchObject({ sourceExcelCaseId: 'CALC-01', initialVelocity: 1 })
    expect(scenarios[1]?.eventSettings).toMatchObject({ sourceExcelCaseId: 'CALC-02', operationType: 'pump_stop' })
  })

  test('measurement points are linked to canonical pipes before longitudinal input is derived', () => {
    const fixture = baseFixture()
    const { runInputs, warnings, canonicalModel, canonicalIssues } = mapWorkbookToRunInputs(fixture)

    const longitudinal = runInputs.longitudinal_hydraulics as { points: Array<Record<string, unknown>>; staticWaterLevel: number }
    expect(longitudinal.points.length).toBe(2)
    expect(longitudinal.points[0]).toMatchObject({ id: 'STA-000', pipeId: 'P-01', distanceAlongPipe: 0, diameter: 0.3, roughnessC: 130 })
    expect(longitudinal.points[1]).toMatchObject({ id: 'STA-500', pipeId: 'P-01', distanceAlongPipe: 500, diameter: 0.3, roughnessC: 130 })
    expect(canonicalModel.measurementPoints.map(({ pipeId }) => pipeId)).toEqual(['P-01', 'P-01'])
    expect(canonicalModel.hydraulicUnits).toHaveLength(1)
    expect(canonicalIssues.filter(({ code }) => code === 'POINT_PIPE_INFERRED')).toHaveLength(2)
    expect(longitudinal.staticWaterLevel).toBe(0)
    expect(warnings.some((warning) => warning.includes('staticWaterLevel') || warning.includes('静水位'))).toBe(true)
  })

  test('network kinds (steady_network_python/epanet) are present only when both pipes and nodes are given', () => {
    const both = mapWorkbookToRunInputs(baseFixture())
    expect(both.runInputs.steady_network_python).toBeDefined()
    expect(both.runInputs.steady_network_epanet).toBeDefined()
    const network = both.runInputs.steady_network_python as { pipes: unknown[]; nodes: unknown[] }
    expect(network.pipes.length).toBe(1)
    expect(network.nodes.length).toBe(2)
    expect(both.runInputs.steady_network_python).toEqual(both.runInputs.steady_network_epanet)

    const pipesOnly = mapWorkbookToRunInputs({ ...baseFixture(), nodes: [] })
    expect(pipesOnly.runInputs.steady_network_python).toBeUndefined()
    expect(pipesOnly.runInputs.steady_network_epanet).toBeUndefined()
    expect(pipesOnly.warnings.length).toBeGreaterThan(0)

    const nodesOnly = mapWorkbookToRunInputs({ ...baseFixture(), pipes: [] })
    expect(nodesOnly.runInputs.steady_network_python).toBeUndefined()
    expect(nodesOnly.runInputs.steady_network_epanet).toBeUndefined()
    // No pipe at all also means no wave_speed / joukowsky_allievi.
    expect(nodesOnly.runInputs.wave_speed).toBeUndefined()
    expect(nodesOnly.runInputs.joukowsky_allievi).toBeUndefined()
  })

  test('network pipe/node fields map to upstreamNodeId/downstreamNodeId/roughnessC/type per the sample shapes', () => {
    const { runInputs } = mapWorkbookToRunInputs(baseFixture())
    const network = runInputs.steady_network_python as {
      pipes: Array<{ id: string; upstreamNodeId: string; downstreamNodeId: string; innerDiameter: number; length: number; roughnessC: number }>
      nodes: Array<{ id: string; elevation: number; type: string; head?: number }>
    }
    expect(network.pipes[0]).toEqual({
      id: 'P-01', upstreamNodeId: 'R-01', downstreamNodeId: 'J-01',
      innerDiameter: 0.3, length: 500, roughnessC: 130,
    })
    const reservoirNode = network.nodes.find((node) => node.id === 'R-01')!
    expect(reservoirNode.type).toBe('reservoir')
    expect(reservoirNode.head).toBe(142)
    const junctionNode = network.nodes.find((node) => node.id === 'J-01')!
    expect(junctionNode.type).toBe('junction')
    expect(junctionNode.head).toBeUndefined()
  })

  test('node types without a direct network counterpart (tank/pump_node/valve_node) fall back to junction with a warning', () => {
    const fixture = baseFixture()
    fixture.nodes.push({ id: 'T-01', elevation: 90, nodeType: 'tank' })
    const { runInputs, warnings } = mapWorkbookToRunInputs(fixture)
    const network = runInputs.steady_network_python as { nodes: Array<{ id: string; type: string }> }
    const tankNode = network.nodes.find((node) => node.id === 'T-01')!
    expect(tankNode.type).toBe('junction')
    expect(warnings.some((warning) => warning.includes('T-01'))).toBe(true)
  })

  test('a reservoir node with no hydraulicGrade omits head and warns', () => {
    const fixture = baseFixture()
    fixture.nodes[0] = { id: 'R-01', elevation: 100, nodeType: 'reservoir' }
    const { runInputs, warnings } = mapWorkbookToRunInputs(fixture)
    const network = runInputs.steady_network_python as { nodes: Array<{ id: string; head?: number }> }
    const reservoirNode = network.nodes.find((node) => node.id === 'R-01')!
    expect(reservoirNode.head).toBeUndefined()
    expect(warnings.some((warning) => warning.includes('R-01'))).toBe(true)
  })

  test('no calculationCase rows: wave_speed is still built, joukowsky_allievi is skipped with a warning', () => {
    const { runInputs, warnings } = mapWorkbookToRunInputs({ ...baseFixture(), cases: [] })
    expect(runInputs.wave_speed).toBeDefined()
    expect(runInputs.joukowsky_allievi).toBeUndefined()
    expect(warnings.length).toBeGreaterThan(0)
  })

  test('never throws on a fully empty workbook and returns empty runInputs plus a warning', () => {
    const empty: WorkbookData = { meta: { projectName: '', standardId: '' }, pipes: [], nodes: [], cases: [], measurementPoints: [] }
    const { runInputs, warnings } = mapWorkbookToRunInputs(empty)
    expect(runInputs).toEqual({})
    expect(warnings.length).toBeGreaterThan(0)
  })

  test('does not mutate the input WorkbookData (raw stays intact for the caller to persist)', () => {
    const fixture = deepFreeze(baseFixture())
    expect(() => mapWorkbookToRunInputs(fixture)).not.toThrow()
  })

  test('uses pipe diameter and roughness as the authoritative values when old point columns disagree', () => {
    const fixture = baseFixture()
    fixture.measurementPoints[1]!.diameter = 0.25
    fixture.measurementPoints[1]!.roughnessC = 100

    const { runInputs, canonicalIssues } = mapWorkbookToRunInputs(fixture)
    const point = (runInputs.longitudinal_hydraulics as { points: Array<{ diameter: number; roughnessC: number }> }).points[1]!
    expect(point).toMatchObject({ diameter: 0.3, roughnessC: 130 })
    expect(canonicalIssues.map(({ code }) => code)).toEqual(expect.arrayContaining(['DUPLICATE_DIAMETER_IGNORED', 'DUPLICATE_ROUGHNESS_IGNORED']))
  })
})
