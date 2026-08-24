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
  test('renders elevations and pipe dimensions derived from the real model instead of the hardcoded sample', () => {
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

    render(createElement(OverviewPanel, { project: projectFixture, caseRecord: record, runs: [] }))

    expect(screen.getByText('EL 123.45')).toBeVisible()
    expect(screen.getByText('EL 45.60')).toBeVisible()
    expect(screen.getByText('φ450 / 733 m')).toBeVisible()
    expect(screen.queryByText('EL 100.00')).not.toBeInTheDocument()
  })

  test('shows a placeholder when the Case has no usable model data', () => {
    render(createElement(OverviewPanel, { project: projectFixture, caseRecord: caseWith({ runInputs: {}, geoDrafts: [] }), runs: [] }))

    expect(screen.getByText('モデル未設定')).toBeVisible()
  })
})
