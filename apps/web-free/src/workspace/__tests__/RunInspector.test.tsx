import { runFixture } from '@open-waterhammer/contracts'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { RunInspector } from '../RunInspector'

describe('RunInspector recursive Differences', () => {
  test('surfaces a nested numeric difference path between two runs', () => {
    const baseline = { ...runFixture, summary: { pipes: { 'P-01': { waveSpeed: 1200 } } } }
    const run = { ...runFixture, summary: { pipes: { 'P-01': { waveSpeed: 1215 } } } }

    render(<RunInspector run={run} baseline={baseline} />)

    const differencesSection = screen.getByRole('heading', { name: 'Differences' }).closest('section')!
    expect(within(differencesSection).getByText('pipes.P-01.waveSpeed')).toBeVisible()
    expect(within(differencesSection).getByText('+15.00')).toBeVisible()
  })

  test('caps rendered Differences rows around 24 with an 他 n 件 overflow note', () => {
    const baselineSummary = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`metric${index}`, 100]))
    const runSummary = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`metric${index}`, 105]))
    const baseline = { ...runFixture, summary: baselineSummary }
    const run = { ...runFixture, summary: runSummary }

    render(<RunInspector run={run} baseline={baseline} />)

    const differencesSection = screen.getByRole('heading', { name: 'Differences' }).closest('section')!
    expect(within(differencesSection).getAllByText('+5.000')).toHaveLength(24)
    expect(within(differencesSection).getByText('他 6 件')).toBeVisible()
  })
})
