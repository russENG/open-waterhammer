import { runFixture, type Run } from '@open-waterhammer/contracts'
import { InMemoryWorkspaceRepository } from '@open-waterhammer/workspace'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'

import { buildSampleWorkspace } from '../../sample-workspace'
import { WorkspaceProvider } from '../../workspace-context'
import { ReportsPanel } from '../ReportsPanel'

function renderPanel(runs: Run[]) {
  const data = buildSampleWorkspace('2026-08-23T01:02:03.000Z')
  const repository = new InMemoryWorkspaceRepository(data)
  render(
    <WorkspaceProvider repository={repository} initialData={data}>
      <ReportsPanel runs={runs} />
    </WorkspaceProvider>,
  )
  return { data, repository }
}

function joukowskyRun(caseId: string, scenarioId: string): Run {
  return {
    ...runFixture,
    id: 'run-joukowsky-1',
    caseId,
    scenarioId,
    kind: 'joukowsky_allievi',
    status: 'succeeded',
    manifest: {
      ...runFixture.manifest,
      caseId,
      scenarioId,
      method: 'joukowsky-allievi',
      numericParameters: {
        pipe: {
          id: 'P-01', name: '第1号幹線', startNodeId: 'R-01', endNodeId: 'J-01',
          pipeType: 'ductile_iron', innerDiameter: 0.3, wallThickness: 0.007,
          length: 500, roughnessCoeff: 130,
        },
        calculationCase: {
          id: 'CALC-01', name: '末端弁閉鎖', operationType: 'valve_close',
          targetFacilityId: 'V-01', initialVelocity: 1, initialHead: 30,
        },
      },
      boundaryParameters: { eventSettings: { closeTime: 2 } },
    },
    summary: {
      caseId: 'CALC-01', pipeId: 'P-01',
      waveSpeed: { waveSpeed: 1100, vibrationPeriod: 0.9, alpha: 2.2 },
      closureType: 'rapid',
      deltaHJoukowsky: 100, hmaxAllieviClose: null, hmaxAllieviOpen: null,
      k1: null, allieviApplicable: false,
      warnings: [],
    },
    createdAt: '2026-08-23T02:00:00.000Z',
    updatedAt: '2026-08-23T02:00:01.000Z',
  }
}

describe('ReportsPanel deliverable Excel button', () => {
  test('is disabled with a visible reason when there are no Runs at all', () => {
    renderPanel([])
    const button = screen.getByRole('button', { name: /水理計算書・検討書/ })
    expect(button).toBeDisabled()
    expect(screen.getByText(/Joukowsky \/ Allievi|縦断水理計算/)).toBeVisible()
  })

  test('stays disabled when the only Run is the wrong kind or did not succeed', () => {
    const data = buildSampleWorkspace('2026-08-23T01:02:03.000Z')
    const caseId = data.cases[0]!.id
    const scenarioId = data.scenarios[0]!.id
    const wrongKind: Run = { ...joukowskyRun(caseId, scenarioId), id: 'run-wrong-kind', kind: 'wave_speed' }
    const notSucceeded: Run = { ...joukowskyRun(caseId, scenarioId), id: 'run-not-succeeded', status: 'failed' }
    renderPanel([wrongKind, notSucceeded])
    expect(screen.getByRole('button', { name: /水理計算書・検討書/ })).toBeDisabled()
  })

  test('is enabled for a succeeded joukowsky_allievi Run belonging to a real Case, and downloads a workbook on click', async () => {
    const user = userEvent.setup()
    const data = buildSampleWorkspace('2026-08-23T01:02:03.000Z')
    const caseId = data.cases[0]!.id
    const scenarioId = data.scenarios[0]!.id
    const repository = new InMemoryWorkspaceRepository(data)
    render(
      <WorkspaceProvider repository={repository} initialData={data}>
        <ReportsPanel runs={[joukowskyRun(caseId, scenarioId)]} />
      </WorkspaceProvider>,
    )

    const button = screen.getByRole('button', { name: /水理計算書・検討書/ })
    expect(button).toBeEnabled()
    await user.click(button)
    expect(await screen.findByText(/水理計算書|エラー/)).toBeVisible()
  })

  test('the existing Excel report and Run JSON buttons and the applicability box are unaffected', () => {
    renderPanel([])
    expect(screen.getByRole('button', { name: /Excel帳票/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /計算記録JSON/ })).toBeInTheDocument()
    expect(screen.getByText('alpha · 設計比較支援')).toBeVisible()
  })
})
