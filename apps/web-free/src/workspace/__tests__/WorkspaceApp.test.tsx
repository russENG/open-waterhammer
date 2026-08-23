import {
  RUN_KINDS,
  type RunKind,
} from '@open-waterhammer/contracts'
import { createExecutorRegistry } from '@open-waterhammer/runner'
import { InMemoryWorkspaceRepository } from '@open-waterhammer/workspace'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { WorkspaceApp } from '../WorkspaceApp'
import { buildSampleWorkspace } from '../sample-workspace'

const executor = async ({ kind, calculationInputHash }: { kind: RunKind; calculationInputHash: string }) => ({
  engine: 'integration-engine',
  runtime: 'browser-test',
  method: kind,
  numericParameters: {},
  boundaryParameters: {},
  summary: { maxPressureMpa: 1.24, minimumPressureMpa: 0.18 },
  timeSeries: { seconds: [0, 1, 2], pressureMpa: [0.8, 1.24, 0.9] },
  assessment: {
    status: 'warning' as const,
    findings: [{ targetRef: 'P-01', location: 'STA. 0+500', observedValue: 1.24, threshold: 1.2, unit: 'MPa', ruleId: 'NOCHI-8.3.4' }],
  },
  warnings: ['適用条件を確認してください。'],
  inputHash: calculationInputHash,
})

const executors = createExecutorRegistry(Object.fromEntries(
  RUN_KINDS.map((kind) => [kind, executor]),
) as Record<RunKind, typeof executor>)

function setup() {
  const data = buildSampleWorkspace('2026-08-23T01:02:03.000Z')
  const repository = new InMemoryWorkspaceRepository(data)
  render(<WorkspaceApp repository={repository} initialData={data} executors={executors} />)
  return { data, repository }
}

beforeEach(() => {
  localStorage.clear()
  window.location.hash = '#/projects/missing/cases/missing/not-a-tab'
})

afterEach(() => {
  window.location.hash = ''
})

describe('full workspace application', () => {
  test('falls back from an invalid hash route and exposes permanent product and limitations language', async () => {
    const { data } = setup()

    expect(await screen.findByRole('banner')).toHaveTextContent('alpha')
    expect(screen.getByRole('banner')).toHaveTextContent('設計比較支援')
    expect(screen.getByRole('contentinfo')).toHaveTextContent('適用限界')
    expect(screen.getByRole('navigation', { name: 'Workspace tabs' })).toBeVisible()
    expect(screen.getByRole('complementary', { name: 'Run Inspector' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Differences' })).toBeVisible()
    await waitFor(() => expect(window.location.hash).toContain(`/projects/${data.projects[0]!.id}/cases/`))
  })

  test('shows the seven approved workspace tabs and enforces a two-to-four Case comparison', async () => {
    const user = userEvent.setup()
    setup()

    const tabs = screen.getByRole('navigation', { name: 'Workspace tabs' })
    for (const label of ['Overview', 'Model＋GIS', 'Scenario', 'Analysis', 'Results', 'Compare', 'Reports']) {
      expect(within(tabs).getByRole('link', { name: label })).toBeVisible()
    }

    const selectors = await screen.findAllByRole('checkbox', { name: /比較に追加/ })
    expect(selectors).toHaveLength(4)
    await user.click(selectors[0]!)
    await user.click(selectors[1]!)
    await user.click(within(tabs).getByRole('link', { name: 'Compare' }))
    expect(await screen.findByRole('table', { name: 'Case comparison' })).toBeVisible()
    expect(screen.getByText('2 Cases')).toBeVisible()
  })

  test('executes through the common runner, locks the Case, and requires a reason to fork', async () => {
    const user = userEvent.setup()
    const { repository } = setup()
    const tabs = screen.getByRole('navigation', { name: 'Workspace tabs' })

    await user.click(within(tabs).getByRole('link', { name: 'Analysis' }))
    await user.click(await screen.findByRole('button', { name: 'Run calculation' }))
    expect(await screen.findByText('Run succeeded')).toBeVisible()
    expect((await repository.snapshot()).cases.some(({ state }) => state === 'locked')).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Fork Case' }))
    const dialog = await screen.findByRole('dialog', { name: 'Fork locked Case' })
    await user.click(within(dialog).getByRole('button', { name: 'Create fork' }))
    expect(within(dialog).getByText('分岐理由を入力してください。')).toBeVisible()
    await user.type(within(dialog).getByLabelText('分岐理由'), '空気室容量を比較するため')
    await user.click(within(dialog).getByRole('button', { name: 'Create fork' }))

    await waitFor(async () => expect((await repository.snapshot()).cases).toHaveLength(5))
    expect(screen.getByText('空気室容量を比較するため')).toBeVisible()
  })

  test('persists explicitly mapped GeoJSON drafts into the selected Case', async () => {
    const user = userEvent.setup()
    const { repository } = setup()
    const tabs = screen.getByRole('navigation', { name: 'Workspace tabs' })

    await user.click(within(tabs).getByRole('link', { name: 'Model＋GIS' }))
    await user.click(await screen.findByRole('button', { name: 'Import GeoJSON' }))
    const dialog = await screen.findByRole('dialog', { name: 'GeoJSON import wizard' })
    fireEvent.change(within(dialog).getByLabelText('GeoJSON'), { target: { value: JSON.stringify({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature', id: 'feature-new',
        properties: { id: 'N-NEW', elevation: 91 },
        geometry: { type: 'Point', coordinates: [139.71, 35.69] },
      }],
    }) } })
    await user.click(within(dialog).getByRole('button', { name: 'Import as drafts' }))

    await waitFor(async () => {
      const latest = await repository.snapshot()
      const selected = latest.cases.at(-1)!
      const snapshot = selected.modelSnapshot as { geoDrafts?: Array<{ id: string }> }
      expect(snapshot.geoDrafts?.map(({ id }) => id)).toEqual(['N-NEW'])
    })
  })
})
