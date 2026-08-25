import { runFixture } from '@open-waterhammer/contracts'
import { describe, expect, test } from 'vitest'

import { buildComparisonRows, formatComparisonNumber } from '../comparison'
import { buildSampleWorkspace } from '../sample-workspace'

describe('deterministic nested Case comparison', () => {
  test('formats integers, decimals, negatives, and exponent-scale values without changing magnitude', () => {
    expect([
      formatComparisonNumber(100000),
      formatComparisonNumber(120000),
      formatComparisonNumber(12.34),
      formatComparisonNumber(-120000),
      formatComparisonNumber(1.2e-7),
      formatComparisonNumber(1.2e21),
    ]).toEqual(['100000', '120000', '12.34', '-120000', '1.2e-7', '1.2e+21'])
  })

  test('flattens model and Scenario conditions plus numeric persisted result deltas', () => {
    const data = buildSampleWorkspace('2026-08-23T01:02:03.000Z')
    const cases = data.cases.slice(0, 2)
    const scenarios = data.scenarios.slice(0, 2)
    const runs = cases.map((record, index) => ({
      ...runFixture,
      id: `55555555-5555-4555-8555-${String(index + 1).padStart(12, '0')}`,
      caseId: record.id,
      scenarioId: scenarios[index]!.id,
      summary: { pipes: { 'P-01': { Hmax: [100 + index * 4, 110 + index * 5] } }, peakPressureMpa: 1.2 + index * 0.3 },
    }))

    const rows = buildComparisonRows(cases, scenarios, runs)
    expect(rows.conditionRows.find(({ path }) => path === 'scenario.eventSettings.closeTime')?.values).toEqual([2, 8])
    // 包絡線・時系列は格子点ごとに行が立つと1計算で数百行になるため、差分表からは除く。
    // 比較できるのはスカラーの要約値だけ。
    expect(rows.resultRows.some(({ path }) => path.includes('Hmax['))).toBe(false)
    expect(rows.resultRows.find(({ path }) => path === 'summary.peakPressureMpa')).toEqual({
      path: 'summary.peakPressureMpa', values: [1.2, 1.5], deltas: [0, 0.30000000000000004],
    })
    expect(rows.resultRows.map(({ path }) => path)).toEqual([...rows.resultRows.map(({ path }) => path)].sort())
  })
})
