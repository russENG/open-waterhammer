import { runFixture } from '@open-waterhammer/contracts'
import { describe, expect, test } from 'vitest'

import { buildComparisonRows } from '../comparison'
import { buildSampleWorkspace } from '../sample-workspace'

describe('deterministic nested Case comparison', () => {
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
    expect(rows.resultRows.find(({ path }) => path === 'summary.pipes.P-01.Hmax[1]')).toEqual({
      path: 'summary.pipes.P-01.Hmax[1]', values: [110, 115], deltas: [0, 5],
    })
    expect(rows.resultRows.map(({ path }) => path)).toEqual([...rows.resultRows.map(({ path }) => path)].sort())
  })
})
