import { caseFixture, projectFixture, type Case } from '@open-waterhammer/contracts'
import { render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { describe, expect, test } from 'vitest'

import { deriveSchematic } from '../schematic'
import { OverviewPanel } from '../tabs/OverviewPanel'

function caseWith(modelSnapshot: Case['modelSnapshot']): Case {
  return { ...caseFixture, modelSnapshot }
}

describe('deriveSchematic', () => {
  test('derives upstream/downstream node ids, elevations, and pipe dimensions from a steady_network_python model', () => {
    const record = caseWith({
      runInputs: {
        steady_network_python: {
          pipes: [{ id: 'P-99', upstreamNodeId: 'R-09', downstreamNodeId: 'J-09', innerDiameter: 0.45, length: 733 }],
          nodes: [
            { id: 'R-09', elevation: 123.45, type: 'reservoir' },
            { id: 'J-09', elevation: 45.6, type: 'demand' },
          ],
        },
      },
    })

    expect(deriveSchematic(record)).toEqual({
      upstream: { id: 'R-09', elevation: 123.45 },
      downstream: { id: 'J-09', elevation: 45.6 },
      pipe: { id: 'P-99', diameter: 0.45, length: 733 },
    })
  })

  test('falls back to wave_speed single-pipe fields, supplementing elevations from geoDrafts node properties', () => {
    const record = caseWith({
      runInputs: {
        wave_speed: {
          pipe: { id: 'P-07', startNodeId: 'R-07', endNodeId: 'J-07', innerDiameter: 0.2, length: 250 },
        },
      },
      geoDrafts: [
        { sourceFeatureId: 'R-07', id: 'R-07', kind: 'node', geometry: null, properties: { elevation: 61.2 }, errors: [] },
        { sourceFeatureId: 'J-07', id: 'J-07', kind: 'node', geometry: null, properties: { elevation: 40.1 }, errors: [] },
      ],
    })

    expect(deriveSchematic(record)).toEqual({
      upstream: { id: 'R-07', elevation: 61.2 },
      downstream: { id: 'J-07', elevation: 40.1 },
      pipe: { id: 'P-07', diameter: 0.2, length: 250 },
    })
  })

  test('falls back to steady_single_pipe fields when no network or wave_speed input exists', () => {
    const record = caseWith({
      runInputs: {
        steady_single_pipe: {
          method: 'hazen-williams', innerDiameter: 0.5, length: 900,
          flowRate: 0.05, upstreamElevation: 77.7, downstreamElevation: 12.3, roughnessC: 130,
        },
      },
    })

    expect(deriveSchematic(record)).toEqual({
      upstream: { id: 'upstream', elevation: 77.7 },
      downstream: { id: 'downstream', elevation: 12.3 },
      pipe: { id: undefined, diameter: 0.5, length: 900 },
    })
  })

  test('returns undefined when the Case has no usable model data', () => {
    expect(deriveSchematic(caseWith({ runInputs: {}, geoDrafts: [] }))).toBeUndefined()
    expect(deriveSchematic(caseWith(null))).toBeUndefined()
  })
})

describe('OverviewPanel schematic rendering', () => {
  test('renders the plan view from the canonical model', () => {
    const record = caseWith({
      canonicalModel: {
        schema: 'open-waterhammer/hydraulic-model', version: 1, source: 'gis', crs: 'EPSG:6677',
        nodes: [
          { id: 'R-09', kind: 'reservoir', elevation: 123.45, coordinate: { x: 0, y: 0 } },
          { id: 'J-09', kind: 'junction', elevation: 45.6, coordinate: { x: 100, y: 50 } },
        ],
        pipes: [{ id: 'P-99', fromNodeId: 'R-09', toNodeId: 'J-09', material: 'ductile_iron', innerDiameter: 0.45, wallThickness: 0.01, length: 733, roughnessC: 130 }],
        measurementPoints: [], hydraulicUnits: [],
      },
    })

    render(createElement(OverviewPanel, { project: projectFixture, caseRecord: record, runs: [] }))

    expect(screen.getByText('実座標平面図')).toBeVisible()
    expect(screen.getByText('P-99')).toBeVisible()
    expect(screen.getByRole('img', { name: 'R-09、貯水池・水槽、接続済み' })).toBeVisible()
  })

  test('shows a placeholder when the Case has no usable model data', () => {
    render(createElement(OverviewPanel, { project: projectFixture, caseRecord: caseWith({ runInputs: {}, geoDrafts: [] }), runs: [] }))

    expect(screen.getByText('管路・節点モデルが未設定です')).toBeVisible()
  })
})
