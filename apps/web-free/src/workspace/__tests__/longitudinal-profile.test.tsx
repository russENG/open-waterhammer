import { caseFixture, runFixture, type Case, type JsonValue, type Run } from '@open-waterhammer/contracts'
import type { CanonicalHydraulicModel, CanonicalMeasurementPoint } from '@open-waterhammer/core'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'

import { LongitudinalProfile } from '../LongitudinalProfile'
import { deriveLongitudinalProfile } from '../longitudinal-profile'

function point(id: string, sequence: number, distance: number, overrides: Partial<CanonicalMeasurementPoint> = {}): CanonicalMeasurementPoint {
  return {
    id,
    sequence,
    pipeId: 'P1',
    linkStatus: 'linked',
    distanceAlongPipe: distance,
    horizontalDistanceFromPrevious: sequence === 0 ? 0 : distance,
    slopeLengthFromPrevious: sequence === 0 ? 0 : distance,
    groundElevation: 100 - distance * 0.02,
    pipeCenterElevation: 98 - distance * 0.02,
    bendLossCoefficient: 0,
    valveLossCoefficient: 0,
    branchLossCoefficient: 0,
    ...overrides,
  }
}

function model(points: CanonicalMeasurementPoint[], twoPipes = false): CanonicalHydraulicModel {
  return {
    schema: 'open-waterhammer/hydraulic-model',
    version: 1,
    source: 'excel',
    nodes: [
      { id: 'N0', kind: 'reservoir', elevation: 100 },
      { id: 'N1', kind: 'junction', elevation: 90 },
      ...(twoPipes ? [{ id: 'N2', kind: 'junction' as const, elevation: 80 }] : []),
    ],
    pipes: [
      { id: 'P1', fromNodeId: 'N0', toNodeId: 'N1', material: 'ductile_iron', innerDiameter: 0.3, wallThickness: 0.01, length: 100, roughnessC: 130 },
      ...(twoPipes ? [{ id: 'P2', fromNodeId: 'N1', toNodeId: 'N2', material: 'steel' as const, innerDiameter: 0.45, wallThickness: 0.012, length: 100, roughnessC: 120 }] : []),
    ],
    measurementPoints: points,
    hydraulicUnits: [],
  }
}

function caseWith(canonical: CanonicalHydraulicModel): Case {
  return { ...caseFixture, modelSnapshot: { canonicalModel: canonical as unknown as JsonValue } }
}

function run(kind: Run['kind'], summary: JsonValue, suffix: string): Run {
  return {
    ...runFixture,
    id: `55555555-5555-4555-8555-${suffix.padStart(12, '0')}`,
    kind,
    status: 'succeeded',
    summary,
    updatedAt: `2026-08-25T00:00:${suffix.padStart(2, '0')}.000Z`,
  }
}

describe('deriveLongitudinalProfile', () => {
  test('creates an input profile immediately from valid canonical measurement points', () => {
    const diagram = deriveLongitudinalProfile(caseWith(model([
      point('STA-0', 0, 0, { nodeId: 'N0' }),
      point('STA-100', 1, 100, { nodeId: 'N1' }),
    ])))!

    expect(diagram.points.map(({ distance }) => distance)).toEqual([0, 100])
    expect(diagram.points.map(({ groundElevation }) => groundElevation)).toEqual([100, 98])
    expect(diagram.pipeSpans).toEqual([{ pipeId: 'P1', fromDistance: 0, toDistance: 100, diameter: 0.3 }])
    expect(diagram.hasCalculationResults).toBe(false)
    expect(diagram.issues).toEqual([])
  })

  test('shows pipe diameter changes as separate spans', () => {
    const points = [
      point('P1-0', 0, 0),
      point('P1-100', 1, 100, { horizontalDistanceFromPrevious: 100 }),
      point('P2-100', 2, 100, { pipeId: 'P2', distanceAlongPipe: 100, horizontalDistanceFromPrevious: 100, groundElevation: 94, pipeCenterElevation: 92 }),
    ]
    const diagram = deriveLongitudinalProfile(caseWith(model(points, true)))!

    expect(diagram.pipeSpans.map(({ pipeId, diameter }) => [pipeId, diameter])).toEqual([['P1', 0.3], ['P2', 0.45]])
  })

  test('flags ordering, missing references, and distance inconsistencies without hiding the points', () => {
    const points = [
      point('STA-100', 2, 100),
      point('STA-0', 0, 0),
      point('STA-50', 1, 40, { horizontalDistanceFromPrevious: 80 }),
      point('UNKNOWN', 3, 10, { pipeId: 'PX', distanceAlongPipe: 10, horizontalDistanceFromPrevious: -2, groundElevation: Number.NaN }),
    ]
    const diagram = deriveLongitudinalProfile(caseWith(model(points)))!

    expect(diagram.points).toHaveLength(4)
    expect(diagram.issues.map(({ code }) => code)).toEqual(expect.arrayContaining(['POINT_ORDER', 'DISTANCE_MISMATCH', 'PIPE_UNKNOWN', 'DISTANCE_INVALID', 'VALUE_MISSING']))
    expect(diagram.points.find(({ id }) => id === 'STA-50')?.issueCodes).toContain('DISTANCE_MISMATCH')
  })

  test('overlays hydraulic grade, transient extrema, and design pressure from saved results', () => {
    const record = caseWith(model([
      point('STA-0', 0, 0, { nodeId: 'N0' }),
      point('STA-100', 1, 100, { nodeId: 'N1' }),
    ]))
    const longitudinal = run('longitudinal_hydraulics', {
      pointResults: [
        { pointId: 'STA-0', hydraulicGradeLine: 110, designPressure: 0.3 },
        { pointId: 'STA-100', hydraulicGradeLine: 105, designPressure: 0.4 },
      ],
    }, '1')
    const transient = run('transient_network', {
      pipes: { P1: { H_steady: [110, 105], Hmax: [120, 118], Hmin: [90, 88] } },
    }, '2')
    const diagram = deriveLongitudinalProfile(record, [longitudinal, transient])!

    expect(diagram.hasCalculationResults).toBe(true)
    expect(diagram.points[1]).toMatchObject({ hydraulicGradeElevation: 105, maximumHeadElevation: 118, minimumHeadElevation: 88 })
    expect(diagram.points[1]!.designPressureElevation).toBeGreaterThan(diagram.points[1]!.pipeCenterElevation!)
    expect(diagram.resultRunIds).toEqual([longitudinal.id, transient.id])
  })
})

describe('LongitudinalProfile', () => {
  test('distinguishes the input confirmation chart and links point selection to its pipe and node', async () => {
    const user = userEvent.setup()
    const onFocus = vi.fn()
    const diagram = deriveLongitudinalProfile(caseWith(model([
      point('STA-0', 0, 0, { nodeId: 'N0' }),
      point('STA-100', 1, 100, { nodeId: 'N1' }),
    ])))
    render(<LongitudinalProfile diagram={diagram} mode="input" onFocus={onFocus} />)

    expect(screen.getByText('入力確認図（計算前）')).toBeVisible()
    expect(screen.getByRole('group', { name: '入力確認図（計算前）、測点2件' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: /測点 STA-100、管路 P1、節点 N1/ }))
    expect(onFocus).toHaveBeenCalledWith(expect.objectContaining({ profileCursor: 'STA-100', mapFeatureId: 'N1', envelopeSeriesId: 'P1', timeSeriesId: 'N1' }))
  })

  test('labels calculated overlays separately from input series', () => {
    const record = caseWith(model([point('STA-0', 0, 0)]))
    const calculated = run('longitudinal_hydraulics', { pointResults: [{ pointId: 'STA-0', hydraulicGradeLine: 110, designPressure: 0.3 }] }, '1')
    render(<LongitudinalProfile diagram={deriveLongitudinalProfile(record, [calculated])} mode="result" />)

    expect(screen.getByText('計算結果重ね合わせ図')).toBeVisible()
    expect(screen.getByText('動水位')).toBeVisible()
    expect(screen.getByText('設計内圧換算水頭')).toBeVisible()
  })
})
