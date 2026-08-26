import { deleteDB } from 'idb'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { WorkspaceStart } from '../App'
import { initializeBrowserWorkspace, installSampleWorkspace } from '../workspace/bootstrap'

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

/** 既にこのブラウザーへ保存済みのプロジェクトがある状態の開始画面。 */
async function setupWithSavedProject() {
  const databaseName = `owh-workspace-start-${crypto.randomUUID()}`
  databaseNames.push(databaseName)
  const opened = await initializeBrowserWorkspace({ databaseName })
  repositories.push(opened.repository)
  const data = await installSampleWorkspace(opened.repository)
  const workspace = { repository: opened.repository, data }
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

    // 取込は IndexedDB への書き込みを挟むので、並列実行時は既定の1秒に収まらないことがある。
    expect(await screen.findByRole('heading', { name: /取り込みました/ }, { timeout: 10_000 })).toBeVisible()
    expect(onReady).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '確認した · 作業画面へ進む' }))
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

describe('WorkspaceStart with a project already saved in this browser', () => {
  test('offers the saved project as an explicit resume, without opening the workspace on its own', async () => {
    const user = userEvent.setup()
    const { workspace, onReady } = await setupWithSavedProject()

    // サンプルの案内カードにも同じ名前が出るので、再開カードの中だけを見る。
    const resume = within(screen.getByRole('heading', { name: 'このブラウザーの続きから再開' }).closest('article')!)
    expect(resume.getByText('サンプル：N地区東部幹線水路')).toBeVisible()
    expect(resume.getByText(/最終更新 \d{4}\/\d{2}\/\d{2} \d{2}:\d{2}/)).toBeVisible()
    expect(onReady).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '続ける' }))

    expect(onReady).toHaveBeenCalledOnce()
    expect(onReady.mock.calls[0]![0].projects[0].name).toBe('サンプル：N地区東部幹線水路')
    // 再開は読むだけなので、保存内容はそのまま残る。
    expect((await workspace.repository.snapshot()).projects).toHaveLength(1)
  })

  test('asks before an action that would replace the saved project, and keeps it when cancelled', async () => {
    const user = userEvent.setup()
    const { workspace, onReady } = await setupWithSavedProject()

    await user.type(screen.getByLabelText('プロジェクト名'), '西部支線 水撃圧検討')
    await user.click(screen.getByRole('button', { name: '作成する' }))

    expect(await screen.findByRole('heading', { name: '保存内容を置き換えます' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'やめる' }))

    expect(onReady).not.toHaveBeenCalled()
    const kept = await workspace.repository.snapshot()
    expect(kept.projects).toHaveLength(1)
    expect(kept.projects[0]!.name).toBe('サンプル：N地区東部幹線水路')
    expect(screen.getByRole('heading', { name: 'このブラウザーの続きから再開' })).toBeVisible()
  })

  test('replaces the saved project only after the replacement is confirmed', async () => {
    const user = userEvent.setup()
    const { workspace, onReady } = await setupWithSavedProject()

    await user.type(screen.getByLabelText('プロジェクト名'), '西部支線 水撃圧検討')
    await user.click(screen.getByRole('button', { name: '作成する' }))
    await user.click(await screen.findByRole('button', { name: '置き換えて実行' }))

    await waitFor(() => expect(onReady).toHaveBeenCalledOnce())
    const replaced = await workspace.repository.snapshot()
    expect(replaced.projects).toHaveLength(1)
    expect(replaced.projects[0]!.name).toBe('西部支線 水撃圧検討')
  })

  test('confirms before an Excel import replaces the saved project, and only for a valid workbook', async () => {
    const user = userEvent.setup()
    mockedParseWorkbook.mockResolvedValueOnce({
      data: workbookData,
      errors: [{ sheet: '管路・節点', row: 3, field: 'inner_diameter', message: '管内径が不正です' }],
      warnings: [],
    })
    const { workspace, onReady } = await setupWithSavedProject()
    const excelInput = () => screen.getByLabelText('Excelから開始するファイルを選択')

    await user.upload(excelInput(), new File(['xlsx'], 'invalid.xlsx', { type: 'application/vnd.ms-excel' }))

    // 検証で落ちたExcelでは確認すら出さない（保存内容は無傷のまま）。
    expect(await screen.findByRole('alert')).toHaveTextContent(/プロジェクトは作成していません/)
    expect(screen.queryByRole('heading', { name: '保存内容を置き換えます' })).not.toBeInTheDocument()
    expect((await workspace.repository.snapshot()).projects[0]!.name).toBe('サンプル：N地区東部幹線水路')

    mockedParseWorkbook.mockResolvedValueOnce({ data: workbookData, errors: [], warnings: [] })
    await user.upload(excelInput(), new File(['xlsx'], 'project.xlsx', { type: 'application/vnd.ms-excel' }))

    expect(await screen.findByRole('heading', { name: '保存内容を置き換えます' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '置き換えて実行' }))

    // このExcelは既定値で補完する項目があるので、置き換えたあとも注意事項の確認を挟む。
    await user.click(await screen.findByRole('button', { name: '確認した · 作業画面へ進む' }, { timeout: 10_000 }))
    await waitFor(() => expect(onReady).toHaveBeenCalledOnce())
    const replaced = await workspace.repository.snapshot()
    expect(replaced.projects).toHaveLength(1)
    expect(replaced.projects[0]!.name).toBe('Excel案件')
  }, 20_000)
})
