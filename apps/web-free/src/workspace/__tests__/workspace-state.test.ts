import { RUN_KINDS, alternativeFixture, caseFixture, projectFixture } from '@open-waterhammer/contracts'
import type { WorkspaceData } from '@open-waterhammer/workspace'
import { describe, expect, test } from 'vitest'

import { buildSampleWorkspace } from '../sample-workspace'
import {
  canCompareCases,
  newestCaseIdForProject,
  resolveWorkspaceRoute,
  toggleComparisonCase,
  type WorkspaceTab,
} from '../workspace-state'

describe('workspace routing and comparison state', () => {
  const snapshot = buildSampleWorkspace('2026-08-23T01:02:03.000Z')
  const newestCase = snapshot.cases.at(-1)!

  test('invalid project, Case, or tab falls back to the most recent valid selection', () => {
    expect(resolveWorkspaceRoute(snapshot, {
      projectId: 'missing-project',
      caseId: 'missing-case',
      tab: 'missing-tab',
    }, { projectId: projectFixture.id, caseId: newestCase.id, tab: 'results' })).toEqual({
      projectId: projectFixture.id,
      caseId: newestCase.id,
      tab: 'results',
    })
  })

  test('a Case selection is restricted to its Project and tabs use the approved seven-value vocabulary', () => {
    const first = snapshot.cases[0]!
    const result = resolveWorkspaceRoute(snapshot, {
      projectId: snapshot.projects[0]!.id,
      caseId: first.id,
      tab: 'model-gis',
    })
    expect(result.caseId).toBe(first.id)
    expect(result.tab satisfies WorkspaceTab).toBe('model-gis')
  })

  test('comparison selection permits exactly two through four distinct Cases and refuses a fifth', () => {
    const ids = snapshot.cases.map(({ id }) => id)
    let selected: string[] = []
    for (const id of ids.slice(0, 4)) selected = toggleComparisonCase(selected, id).selection

    expect(selected).toHaveLength(4)
    expect(canCompareCases(selected)).toBe(true)
    expect(toggleComparisonCase(selected, '99999999-9999-4999-8999-999999999999')).toEqual({
      selection: selected,
      error: '比較できる比較案は最大4件です。',
    })
    expect(canCompareCases(selected.slice(0, 1))).toBe(false)
    expect(canCompareCases(selected.slice(0, 2))).toBe(true)
  })

  test('the sample Project contains valid inputs for every common runner kind', () => {
    const model = snapshot.cases[0]!.modelSnapshot as { runInputs: Record<string, unknown> }
    expect(Object.keys(model.runInputs).sort()).toEqual([...RUN_KINDS].sort())
    expect(snapshot.projects).toHaveLength(1)
    expect(snapshot.alternatives.length).toBeGreaterThanOrEqual(1)
    expect(caseFixture.state).toBe('draft')
  })
})

describe('newestCaseIdForProject', () => {
  // Used after a Project bundle import (OverviewPanel's ProjectTransferCard) to find where to
  // navigate: the imported Project's newest Case by createdAt — deliberately NOT updatedAt
  // (that field drives the app's own "most recent visited" fallback elsewhere), so this test
  // seeds the two timestamps in disagreeing order to prove createdAt actually drives the result.
  const otherProjectId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const otherAlternative = { ...alternativeFixture, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', projectId: otherProjectId }
  const data: WorkspaceData = {
    projects: [projectFixture, { ...projectFixture, id: otherProjectId }],
    alternatives: [alternativeFixture, otherAlternative],
    cases: [
      { ...caseFixture, id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z' },
      { ...caseFixture, id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', createdAt: '2021-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' },
      { ...caseFixture, id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', alternativeId: otherAlternative.id, createdAt: '2099-01-01T00:00:00.000Z', updatedAt: '2099-01-01T00:00:00.000Z' },
    ],
    scenarios: [],
    runs: [],
    legacyArtifacts: [],
  }

  test('picks the Case with the latest createdAt within the given Project only', () => {
    expect(newestCaseIdForProject(data, projectFixture.id)).toBe('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')
    expect(newestCaseIdForProject(data, otherProjectId)).toBe('ffffffff-ffff-4fff-8fff-ffffffffffff')
  })

  test('returns undefined when the Project has no Cases', () => {
    const empty: WorkspaceData = { projects: [projectFixture], alternatives: [], cases: [], scenarios: [], runs: [], legacyArtifacts: [] }
    expect(newestCaseIdForProject(empty, projectFixture.id)).toBeUndefined()
  })
})
