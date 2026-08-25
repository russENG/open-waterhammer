import { caseFixture, runFixture, type Case, type Run } from '@open-waterhammer/contracts'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'

import { PressureWaveAnimator } from '../PressureWaveAnimator'
import { derivePressureWaveAnimation, PRESSURE_WAVE_MAX_FRAMES, PRESSURE_WAVE_MAX_SPATIAL_SAMPLES, pressureWaveColor, valueAtRatio } from '../pressure-wave'

const transientRun: Run = {
  ...runFixture,
  status: 'succeeded',
  kind: 'transient_network',
  timeSeries: {
    pipes: {
      P1: [
        { t: 0, H: [30, 29, 28, 27] },
        { t: 0.5, H: [31, 33, 35, 37] },
        { t: 1, H: [29, 30, 31, 32] },
        { t: 1.5, H: [28, 27, 26, 25] },
      ],
    },
    nodes: {
      N0: { H: [{ t: 0, H: 30 }, { t: 0.5, H: 31 }, { t: 1, H: 29 }, { t: 1.5, H: 28 }] },
    },
  },
  summary: { pipes: { P1: { H_steady: [30, 29, 28, 27], Hmax: [31, 33, 35, 37], Hmin: [28, 27, 26, 25] } } },
}

const caseRecord: Case = {
  ...caseFixture,
  modelSnapshot: {
    canonicalModel: {
      schema: 'open-waterhammer/hydraulic-model', version: 1, source: 'excel',
      nodes: [{ id: 'N0', kind: 'reservoir', elevation: 20 }, { id: 'N1', kind: 'junction', elevation: 18 }],
      pipes: [{ id: 'P1', fromNodeId: 'N0', toNodeId: 'N1', material: 'ductile_iron', innerDiameter: 0.3, wallThickness: 0.01, length: 300, roughnessC: 130 }],
      measurementPoints: [
        { id: 'S0', sequence: 0, pipeId: 'P1', nodeId: 'N0', linkStatus: 'linked', distanceAlongPipe: 0, horizontalDistanceFromPrevious: 0, slopeLengthFromPrevious: 0, groundElevation: 23, pipeCenterElevation: 20, bendLossCoefficient: 0, valveLossCoefficient: 0, branchLossCoefficient: 0 },
        { id: 'S1', sequence: 1, pipeId: 'P1', nodeId: 'N1', linkStatus: 'linked', distanceAlongPipe: 300, horizontalDistanceFromPrevious: 300, slopeLengthFromPrevious: 300, groundElevation: 21, pipeCenterElevation: 18, bendLossCoefficient: 0, valveLossCoefficient: 0, branchLossCoefficient: 0 },
      ],
      hydraulicUnits: [],
    },
  },
}

describe('saved pressure-wave animation model', () => {
  test('limits frames and spatial samples while preserving saved first and last values and raw extrema', () => {
    const model = derivePressureWaveAnimation(transientRun, { maxFrames: 3, maxSpatialSamples: 3 })

    expect(model).toMatchObject({ sourceFrameCount: 4, sourceSpatialSampleCount: 4, framesReduced: true, spatialSamplesReduced: true, minimumHead: 25, maximumHead: 37 })
    expect(model?.frames.map(({ time }) => time)).toEqual([0, 1, 1.5])
    expect(model?.frames[0]?.pipes.P1?.heads).toEqual([30, 28, 27])
    expect(model?.frames.at(-1)?.pipes.P1?.heads).toEqual([28, 26, 25])
    expect(model?.frames.at(-1)?.nodes.N0).toBe(28)
  })

  test('interpolates only between persisted spatial samples and provides a deterministic color scale', () => {
    expect(valueAtRatio([10, 20, 30], 0.25)).toBe(15)
    expect(pressureWaveColor(10, 0, 20)).toBe('hsl(110 72% 43%)')
  })

  test('enforces the production rendering limits for a long saved series', () => {
    const longRun: Run = {
      ...transientRun,
      timeSeries: {
        pipes: {
          P1: Array.from({ length: PRESSURE_WAVE_MAX_FRAMES + 5 }, (_, index) => ({
            t: index * 0.01,
            H: index === 0 ? Array.from({ length: PRESSURE_WAVE_MAX_SPATIAL_SAMPLES + 5 }, (__, point) => point) : [index, index + 1],
          })),
        },
      },
    }

    const model = derivePressureWaveAnimation(longRun)
    expect(model?.frames).toHaveLength(PRESSURE_WAVE_MAX_FRAMES)
    expect(model?.frames[0]?.pipes.P1?.heads).toHaveLength(PRESSURE_WAVE_MAX_SPATIAL_SAMPLES)
    expect(model?.frames.at(-1)?.time).toBeCloseTo((PRESSURE_WAVE_MAX_FRAMES + 4) * 0.01)
  })
})

describe('PressureWaveAnimator', () => {
  test('changes saved frames with keyboard-accessible controls without mutating the Run', async () => {
    const user = userEvent.setup()
    const onFocus = vi.fn()
    const before = JSON.stringify(transientRun)
    render(<PressureWaveAnimator caseRecord={caseRecord} run={transientRun} onFocus={onFocus} />)

    expect(screen.getByText(/停止中 · t = 0.000 s/)).toBeVisible()
    const slider = screen.getByRole('slider', { name: '圧力波の時刻' })
    fireEvent.change(slider, { target: { value: '3' } })
    expect(screen.getByText(/停止中 · t = 1.500 s/)).toBeVisible()
    expect(screen.getByRole('group', { name: /圧力波の模式図、時刻1.500秒/ })).toBeVisible()
    expect(screen.getByRole('img', { name: /圧力波の縦断図、時刻1.500秒/ })).toBeVisible()

    await user.selectOptions(screen.getByRole('combobox', { name: '圧力波の表示量' }), 'pressure')
    expect(screen.getAllByText('圧力 P (MPa)').length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: /管路 P1、圧力 P/ }))
    expect(onFocus).toHaveBeenCalledWith(expect.objectContaining({ mapFeatureId: 'P1', timeSeriesId: 'P1' }))
    expect(JSON.stringify(transientRun)).toBe(before)
  })
})
