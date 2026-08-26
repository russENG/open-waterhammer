import type { Case } from '@open-waterhammer/contracts'
import type { CanonicalHydraulicModel, CanonicalNode, CanonicalPipe } from '@open-waterhammer/core'
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { PlanView } from '../PlanView'
import { derivePlanDiagram, derivePlanDiagramFromModel } from '../plan-view'

function node(id: string, overrides: Partial<CanonicalNode> = {}): CanonicalNode {
  return { id, kind: 'junction', elevation: 0, ...overrides }
}

function pipe(id: string, fromNodeId: string, toNodeId: string, overrides: Partial<CanonicalPipe> = {}): CanonicalPipe {
  return {
    id,
    fromNodeId,
    toNodeId,
    material: 'ductile_iron',
    innerDiameter: 0.3,
    wallThickness: 0.007,
    length: 100,
    roughnessC: 130,
    ...overrides,
  }
}

function model(nodes: CanonicalNode[], pipes: CanonicalPipe[], overrides: Partial<CanonicalHydraulicModel> = {}): CanonicalHydraulicModel {
  return {
    schema: 'open-waterhammer/hydraulic-model',
    version: 1,
    source: 'excel',
    nodes,
    pipes,
    measurementPoints: [],
    hydraulicUnits: [],
    ...overrides,
  }
}

describe('derivePlanDiagramFromModel', () => {
  test('uses real coordinates and the pipe centerline when every node has a coordinate', () => {
    const diagram = derivePlanDiagramFromModel(model(
      [
        node('R-01', { kind: 'reservoir', coordinate: { x: 100, y: 200 } }),
        node('J-01', { coordinate: { x: 300, y: 100 } }),
      ],
      [pipe('P-01', 'R-01', 'J-01', { centerline: [{ x: 100, y: 200 }, { x: 180, y: 240 }, { x: 300, y: 100 }] })],
      { source: 'gis', crs: 'EPSG:6677' },
    ))

    expect(diagram?.mode).toBe('real-coordinates')
    expect(diagram?.crs).toBe('EPSG:6677')
    expect(diagram?.pipes[0]?.points).toHaveLength(3)
    expect(diagram?.issues).toEqual([])
  })

  test('automatically lays out a branched model without coordinates', () => {
    const diagram = derivePlanDiagramFromModel(model(
      [node('R', { kind: 'reservoir' }), node('J'), node('A'), node('B', { kind: 'valve_node' })],
      [pipe('P1', 'R', 'J'), pipe('P2', 'J', 'A'), pipe('P3', 'J', 'B')],
    ))!
    const pointById = new Map(diagram.nodes.map(({ id, point }) => [id, point]))

    expect(diagram.mode).toBe('schematic')
    expect(pointById.get('R')!.x).toBeLessThan(pointById.get('J')!.x)
    expect(pointById.get('J')!.x).toBeLessThan(pointById.get('A')!.x)
    expect(pointById.get('A')!.y).not.toBe(pointById.get('B')!.y)
    expect(diagram.pipes).toHaveLength(3)
  })

  test('shows missing references, isolated nodes, and a separated pipe group as issues', () => {
    const diagram = derivePlanDiagramFromModel(model(
      [node('A'), node('B'), node('C'), node('ISOLATED')],
      [pipe('P1', 'A', 'B'), pipe('P2', 'MISSING', 'C')],
    ))!

    expect(diagram.nodes.find(({ id }) => id === 'MISSING')?.status).toBe('missing')
    expect(diagram.nodes.find(({ id }) => id === 'ISOLATED')?.status).toBe('isolated')
    expect(diagram.pipes.find(({ id }) => id === 'P2')?.status).toBe('missing')
    expect(diagram.issues.map(({ code }) => code)).toEqual(expect.arrayContaining(['MISSING_NODE', 'ISOLATED_NODE', 'DISCONNECTED_NETWORK']))
  })

  test('draws identical diagrams for the same canonical model regardless of retained source data', () => {
    const canonical = model([node('A'), node('B')], [pipe('P1', 'A', 'B')])
    const base = {
      id: '33333333-3333-4333-8333-333333333333',
      alternativeId: '22222222-2222-4222-8222-222222222222',
      name: '比較案',
      state: 'draft',
      inputRevision: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as const
    const excelCase = { ...base, modelSnapshot: { canonicalModel: canonical, excelImport: { source: 'book.xlsx' } } } as unknown as Case
    const gisCase = { ...base, modelSnapshot: { canonicalModel: canonical, geoDrafts: [{ sourceFeatureId: 'unmatched' }] } } as unknown as Case

    expect(derivePlanDiagram(excelCase)).toEqual(derivePlanDiagram(gisCase))
  })

  test('restores a schematic from legacy run inputs without a canonical model', () => {
    const legacyCase = {
      id: '33333333-3333-4333-8333-333333333333',
      alternativeId: '22222222-2222-4222-8222-222222222222',
      name: '旧比較案',
      state: 'draft',
      inputRevision: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      modelSnapshot: {
        runInputs: {
          longitudinal_hydraulics: {
            points: [
              { id: 'STA-0', pipeId: 'P1', nodeId: 'N0', distanceAlongPipe: 0, horizontalDistance: 0, groundLevel: 100, pipeCenterHeight: 98, pipeLength: 0, flowRate: 0.03, diameter: 0.3, roughnessC: 130, bendLossCoeff: 0, valveLossCoeff: 0, branchLossCoeff: 0 },
              { id: 'STA-100', pipeId: 'P1', nodeId: 'N1', distanceAlongPipe: 100, horizontalDistance: 100, groundLevel: 98, pipeCenterHeight: 96, pipeLength: 100, flowRate: 0.03, diameter: 0.3, roughnessC: 130, bendLossCoeff: 0, valveLossCoeff: 0, branchLossCoeff: 0 },
            ],
          },
          steady_network_python: {
            nodes: [{ id: 'N0', elevation: 100, type: 'reservoir', head: 110 }, { id: 'N1', elevation: 90, type: 'junction' }],
            pipes: [{ id: 'P1', upstreamNodeId: 'N0', downstreamNodeId: 'N1', innerDiameter: 0.3, length: 100, roughnessC: 130 }],
          },
        },
      },
    } as unknown as Case

    const diagram = derivePlanDiagram(legacyCase)!

    expect(diagram.mode).toBe('schematic')
    expect(diagram.nodes.map(({ id }) => id)).toEqual(['N0', 'N1'])
    expect(diagram.pipes.map(({ id }) => id)).toEqual(['P1'])
    expect(diagram.issues).toEqual([])
  })
})

describe('PlanView', () => {
  test('labels schematic placement and exposes facility and connectivity information', () => {
    const diagram = derivePlanDiagramFromModel(model(
      [node('R', { kind: 'reservoir' }), node('V', { kind: 'valve_node' })],
      [pipe('P1', 'R', 'V')],
    ))
    render(<PlanView diagram={diagram} />)

    expect(screen.getByText('模式図')).toBeVisible()
    expect(screen.getByText('位置・距離は実座標ではありません')).toBeVisible()
    expect(screen.getByRole('group', { name: /管路網模式図、管路1件、節点2件/ })).toBeVisible()
    expect(screen.getByRole('img', { name: 'V、バルブ、接続済み' })).toBeVisible()
    expect(screen.getByText('接続確認済み')).toBeVisible()
  })
})
