import { runFixture, type Run } from '@open-waterhammer/contracts'
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

describe('persisted result charts', () => {
  test('moves the envelope and longitudinal cursors to the linked finding station', () => {
    const { container } = render(<ResultsPanel
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
    expect([...cursors].map((cursor) => cursor.getAttribute('x1'))).toEqual(['180', '180'])
  })

  test('exports the persisted envelope as CSV with the Hmax header', async () => {
    const user = userEvent.setup()
    const { container } = render(<ResultsPanel
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
