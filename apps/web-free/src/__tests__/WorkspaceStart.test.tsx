import { deleteDB } from 'idb'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { WorkspaceStart } from '../App'
import { initializeBrowserWorkspace } from '../workspace/bootstrap'

vi.mock('@open-waterhammer/excel-io', () => ({
  parseWorkbook: vi.fn(),
  generateTemplate: vi.fn(async () => new ArrayBuffer(8)),
}))

import { parseWorkbook } from '@open-waterhammer/excel-io'

const mockedParseWorkbook = vi.mocked(parseWorkbook)
const databaseNames: string[] = []
const repositories: Array<{ close(): void }> = []

beforeEach(() => mockedParseWorkbook.mockReset())

afterEach(async () => {
  for (const repository of repositories.splice(0)) repository.close()
  for (const name of databaseNames.splice(0)) await deleteDB(name)
})

const workbookData = {
  meta: { projectName: 'Excel案件', standardId: 'nochi_pipeline_2021' },
  pipes: [{
    id: 'P-01', name: '幹線', startNodeId: 'N-01', endNodeId: 'N-02', pipeType: 'ductile_iron' as const,
    innerDiameter: 0.4, wallThickness: 0.007, length: 500, roughnessCoeff: 130,
  }],
  nodes: [],
  cases: [{
    id: 'C-01', name: '閉鎖', operationType: 'valve_close' as const, targetFacilityId: 'V-01',
    initialVelocity: 1, initialHead: 30,
  }],
  measurementPoints: [],
}

async function setup() {
  const databaseName = `owh-workspace-start-${crypto.randomUUID()}`
  databaseNames.push(databaseName)
  const workspace = await initializeBrowserWorkspace({ databaseName })
  repositories.push(workspace.repository)
  const onReady = vi.fn()
  render(<WorkspaceStart workspace={workspace} onReady={onReady} />)
  return { workspace, onReady }
}

describe('WorkspaceStart', () => {
  test('presents Excel as the primary path and the other starts as secondary paths', async () => {
    await setup()

    expect(screen.getByRole('heading', { name: 'Excelから開始' })).toBeVisible()
    expect(screen.getByText(/実案件の推奨導線/)).toBeVisible()
    expect(screen.getByRole('heading', { name: '空から始める' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'サンプルを開く' })).toBeVisible()
    expect(screen.getByLabelText('owhprojプロジェクトを開く')).toBeVisible()
  })

  test('creates the project only after a valid Excel workbook is parsed', async () => {
    const user = userEvent.setup()
    mockedParseWorkbook.mockResolvedValueOnce({ data: workbookData, errors: [], warnings: [] })
    const { onReady } = await setup()

    await user.upload(
      screen.getByLabelText('Excelから開始するファイルを選択'),
      new File(['xlsx'], 'project.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    )

    await waitFor(() => expect(onReady).toHaveBeenCalledOnce())
    expect(onReady.mock.calls[0]![0].projects[0].name).toBe('Excel案件')
    expect(onReady.mock.calls[0]![0].cases[0].state).toBe('draft')
  })

  test('keeps the workspace empty when Excel validation fails', async () => {
    const user = userEvent.setup()
    mockedParseWorkbook.mockResolvedValueOnce({
      data: workbookData,
      errors: [{ sheet: '管路・節点', row: 3, field: 'inner_diameter', message: '管内径が不正です' }],
      warnings: [],
    })
    const { workspace, onReady } = await setup()

    await user.upload(
      screen.getByLabelText('Excelから開始するファイルを選択'),
      new File(['xlsx'], 'invalid.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(/プロジェクトは作成していません/)
    expect(onReady).not.toHaveBeenCalled()
    expect((await workspace.repository.snapshot()).projects).toHaveLength(0)
  })
})
