import { RUN_KINDS, type RunKind, type Scenario } from '@open-waterhammer/contracts'
import { createExecutorRegistry, type CalculationExecutor, type EngineExecutionContext } from '@open-waterhammer/runner'
import { InMemoryWorkspaceRepository } from '@open-waterhammer/workspace'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { WorkspaceApp } from '../WorkspaceApp'
import { buildSampleWorkspace } from '../sample-workspace'

vi.mock('../../lib/pyodide-bridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/pyodide-bridge')>()
  return { ...actual, prefetchPyodide: vi.fn() }
})

afterEach(() => {
  window.location.hash = ''
  localStorage.clear()
})

function secondScenario(caseId: string): Scenario {
  return {
    id: crypto.randomUUID(),
    caseId,
    name: 'ポンプ停止シナリオ',
    boundaryConditions: { upstreamHead: 45 },
    eventSettings: {
      operationType: 'pump_stop',
      targetFacilityId: 'PUMP-02',
      initialVelocity: 0.75,
      initialHead: 27,
      shutdownTime: 1.2,
    },
    protectionSettings: {},
    createdAt: '2026-08-23T01:02:03.000Z',
    updatedAt: '2026-08-23T01:02:03.000Z',
  }
}

function executorRegistry(executor: CalculationExecutor) {
  return createExecutorRegistry(Object.fromEntries(RUN_KINDS.map((kind) => [kind, executor])) as Record<RunKind, CalculationExecutor>)
}

describe('multiple scenarios in one comparison', () => {
  test('selects the scenario used for a calculation and records that exact scenario id', async () => {
    const user = userEvent.setup()
    const data = buildSampleWorkspace('2026-08-23T01:02:03.000Z')
    const caseRecord = data.cases.at(-1)!
    const selected = secondScenario(caseRecord.id)
    data.scenarios.push(selected)
    const repository = new InMemoryWorkspaceRepository(data)
    let received: EngineExecutionContext | undefined
    const executor = async (context: EngineExecutionContext) => {
      received = context
      return {
        engine: 'scenario-test', runtime: 'browser-test', method: context.kind,
        numericParameters: {}, boundaryParameters: {}, summary: {},
        assessment: { status: 'needs_review' as const, findings: [] },
      }
    }
    const executors = executorRegistry(executor)
    render(<WorkspaceApp repository={repository} initialData={data} executors={executors} />)

    await user.click(within(screen.getByRole('navigation', { name: '作業タブ' })).getByRole('link', { name: '解析' }))
    const selector = await screen.findByLabelText('計算するシナリオ')
    await user.selectOptions(selector, selected.id)
    await user.click(screen.getByRole('radio', { name: /Joukowsky \/ Allievi/ }))
    await user.click(screen.getByRole('button', { name: '計算を実行' }))

    expect(await screen.findByRole('status')).toHaveTextContent('計算が完了しました')
    expect(received?.scenarioSnapshot.id).toBe(selected.id)
    expect(received?.caseSnapshot.modelSnapshot).toMatchObject({
      calculationCase: {
        operationType: 'pump_stop',
        targetFacilityId: 'PUMP-02',
        initialVelocity: 0.75,
        initialHead: 27,
      },
    })
    expect((await repository.snapshot()).runs.at(-1)?.scenarioId).toBe(selected.id)
  })

  test('adds another editable scenario without creating another comparison', async () => {
    const user = userEvent.setup()
    const data = buildSampleWorkspace('2026-08-23T01:02:03.000Z')
    const caseRecord = data.cases.at(-1)!
    const originalScenarioCount = data.scenarios.filter(({ caseId }) => caseId === caseRecord.id).length
    const repository = new InMemoryWorkspaceRepository(data)
    const executors = executorRegistry(async (context) => ({
      engine: 'scenario-test', runtime: 'browser-test', method: context.kind,
      numericParameters: {}, boundaryParameters: {}, summary: {},
    }))
    render(<WorkspaceApp repository={repository} initialData={data} executors={executors} />)

    await user.click(within(screen.getByRole('navigation', { name: '作業タブ' })).getByRole('link', { name: 'シナリオ' }))
    await user.click(await screen.findByRole('button', { name: '新しいシナリオ' }))

    await waitFor(async () => {
      const snapshot = await repository.snapshot()
      expect(snapshot.scenarios.filter(({ caseId }) => caseId === caseRecord.id)).toHaveLength(originalScenarioCount + 1)
      expect(snapshot.cases).toHaveLength(data.cases.length)
    })
  })
})
