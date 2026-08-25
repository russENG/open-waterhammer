import { ASSESSMENT_NOTICE, runFixture } from '@open-waterhammer/contracts'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { RunInspector } from '../RunInspector'

describe('RunInspector recursive Differences', () => {
  test('places the short confirmation beside the automatic assessment', () => {
    render(<RunInspector run={runFixture} />)

    const assessmentSection = screen.getByRole('heading', { name: '自動評価' }).closest('section')!
    expect(within(assessmentSection).getByText(ASSESSMENT_NOTICE)).toBeVisible()
  })

  test('surfaces a nested numeric difference path between two runs', () => {
    const baseline = { ...runFixture, summary: { pipes: { 'P-01': { waveSpeed: 1200 } } } }
    const run = { ...runFixture, summary: { pipes: { 'P-01': { waveSpeed: 1215 } } } }

    render(<RunInspector run={run} baseline={baseline} />)

    const differencesSection = screen.getByRole('heading', { name: '差分' }).closest('section')!
    // JSONパスはそのまま出さず、末尾のキーを用語辞書で日本語にして中間の識別子と繋ぐ。
    expect(within(differencesSection).getByText('pipes · P-01 · 波速')).toBeVisible()
    expect(within(differencesSection).getByText('+15.00')).toBeVisible()
  })

  test('caps rendered Differences rows around 24 with an 他 n 件 overflow note', () => {
    const baselineSummary = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`metric${index}`, 100]))
    const runSummary = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`metric${index}`, 105]))
    const baseline = { ...runFixture, summary: baselineSummary }
    const run = { ...runFixture, summary: runSummary }

    render(<RunInspector run={run} baseline={baseline} />)

    const differencesSection = screen.getByRole('heading', { name: '差分' }).closest('section')!
    expect(within(differencesSection).getAllByText('+5.000')).toHaveLength(24)
    expect(within(differencesSection).getByText('他 6 件')).toBeVisible()
  })
})
