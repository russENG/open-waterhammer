import { caseFixture, runFixture, type Case, type Run } from '@open-waterhammer/contracts'
import { render, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'

import { downloadCsv } from '../../utils/csv'
import { ResultsPanel } from '../ResultsPanel'

vi.mock('../../utils/csv', () => ({ downloadCsv: vi.fn() }))

const run: Run = {
  ...runFixture,
  kind: 'transient_network',
  manifest: { ...runFixture.manifest, numericParameters: { network: { pipes: [{ id: 'P-17', pipe: { length: 500 } }] } } },
  summary: { pipes: { 'P-17': { H_steady: [30, 29, 28], Hmax: [31, 34, 36], Hmin: [28, 25, 24] } } },
  timeSeries: { pipes: { 'P-17': [{ t: 0, H: [30, 29, 28] }, { t: 1, H: [31, 32, 34] }] } },
}

const profileCase: Case = {
  ...caseFixture,
  modelSnapshot: {
    canonicalModel: {
      schema: 'open-waterhammer/hydraulic-model', version: 1, source: 'excel',
      nodes: [{ id: 'N-0', kind: 'reservoir', elevation: 30 }, { id: 'N-1', kind: 'junction', elevation: 20 }],
      pipes: [{ id: 'P-17', fromNodeId: 'N-0', toNodeId: 'N-1', material: 'ductile_iron', innerDiameter: 0.3, wallThickness: 0.01, length: 500, roughnessC: 130 }],
      measurementPoints: [
        { id: 'STA. 0+000', sequence: 0, pipeId: 'P-17', nodeId: 'N-0', linkStatus: 'linked', distanceAlongPipe: 0, horizontalDistanceFromPrevious: 0, slopeLengthFromPrevious: 0, groundElevation: 30, pipeCenterElevation: 28, bendLossCoefficient: 0, valveLossCoefficient: 0, branchLossCoefficient: 0 },
        { id: 'STA. 0+250', sequence: 1, pipeId: 'P-17', linkStatus: 'linked', distanceAlongPipe: 250, horizontalDistanceFromPrevious: 250, slopeLengthFromPrevious: 250, groundElevation: 28, pipeCenterElevation: 26, bendLossCoefficient: 0, valveLossCoefficient: 0, branchLossCoefficient: 0 },
        { id: 'STA. 0+500', sequence: 2, pipeId: 'P-17', nodeId: 'N-1', linkStatus: 'linked', distanceAlongPipe: 500, horizontalDistanceFromPrevious: 250, slopeLengthFromPrevious: 250, groundElevation: 25, pipeCenterElevation: 23, bendLossCoefficient: 0, valveLossCoefficient: 0, branchLossCoefficient: 0 },
      ],
      hydraulicUnits: [],
    },
  },
}

describe('persisted result charts', () => {
  test('moves the envelope and longitudinal cursors to the linked finding station', () => {
    const { container } = render(<ResultsPanel
      caseRecord={profileCase}
      runs={[run]}
      selectedRun={run}
      focus={{
        targetRef: 'P-17', location: 'STA. 0+250', mapFeatureId: 'P-17',
        profileCursor: 'STA. 0+250', envelopeSeriesId: 'P-17', timeSeriesId: 'P-17',
      }}
      onSelectRun={vi.fn()}
      onFocus={vi.fn()}
    />)

    const cursors = container.querySelectorAll('.linked-chart-cursor')
    expect(cursors).toHaveLength(2)
    expect([...cursors].map((cursor) => cursor.getAttribute('x1'))).toEqual(['180', '469'])
  })

  test('exports the persisted envelope as CSV with the Hmax header', async () => {
    const user = userEvent.setup()
    const { container } = render(<ResultsPanel
      caseRecord={profileCase}
      runs={[run]}
      selectedRun={run}
      onSelectRun={vi.fn()}
      onFocus={vi.fn()}
    />)

    const envelopeCard = container.querySelector('.envelope-card')
    expect(envelopeCard).not.toBeNull()
    const csvButton = within(envelopeCard as HTMLElement).getByRole('button', { name: 'CSV' })

    await user.click(csvButton)

    expect(downloadCsv).toHaveBeenCalledTimes(1)
    const [, rows] = vi.mocked(downloadCsv).mock.calls[0]!
    const csvText = rows.map((row) => row.join(',')).join('\n')
    expect(csvText).toContain('Hmax')
  })
})
