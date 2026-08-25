import { alternativeFixture, caseFixture, projectFixture } from '@open-waterhammer/contracts'
import { InMemoryWorkspaceRepository, type WorkspaceData } from '@open-waterhammer/workspace'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'

import { WorkspaceProvider } from '../workspace-context'
import { WorkspaceTree } from '../WorkspaceTree'

const data: WorkspaceData = {
  projects: [projectFixture], alternatives: [alternativeFixture], cases: [caseFixture],
  scenarios: [], runs: [], legacyArtifacts: [],
}

function renderTree({
  onCreateProject = vi.fn(async () => {}),
  onCreateProjectFromExcel = vi.fn(async () => 'Excelから開始しました。'),
  onImportProject = vi.fn(async () => '読み込みました。'),
  onExportProject = vi.fn(async () => '書き出しました。'),
} = {}) {
  const repository = new InMemoryWorkspaceRepository(data)
  render(
    <WorkspaceProvider repository={repository} initialData={data}>
      <WorkspaceTree
        projectId={projectFixture.id} caseId={caseFixture.id} comparison={[]}
        onSelect={() => {}} onToggleComparison={() => {}} onCreate={() => {}} onFork={() => {}}
        onCreateProject={onCreateProject} onCreateProjectFromExcel={onCreateProjectFromExcel} onImportProject={onImportProject} onExportProject={onExportProject}
      />
    </WorkspaceProvider>,
  )
  return { onCreateProject, onCreateProjectFromExcel, onImportProject, onExportProject }
}

describe('WorkspaceTree Project management', () => {
  test('shows one current Project without a Project switcher', () => {
    renderTree()
    expect(screen.getByText('現在のプロジェクト')).toBeInTheDocument()
    expect(screen.queryByLabelText('プロジェクト切替')).not.toBeInTheDocument()
  })

  test('warns before replacing the current Project with a new one', async () => {
    const user = userEvent.setup()
    const onCreateProject = vi.fn(async () => {})
    renderTree({ onCreateProject })
    await user.click(screen.getByRole('button', { name: '新規プロジェクト' }))
    const dialog = screen.getByRole('dialog', { name: '新規プロジェクト' })
    expect(dialog).toHaveTextContent('このブラウザで開けるプロジェクトは1件です')
    await user.type(screen.getByLabelText('プロジェクト名'), '西部支線')
    await user.click(within(dialog).getByRole('button', { name: '空のプロジェクトで置き換える' }))
    expect(onCreateProject).toHaveBeenCalledWith('西部支線')
  })

  test('offers Excel as the primary replacement path and waits for confirmation', async () => {
    const user = userEvent.setup()
    const onCreateProjectFromExcel = vi.fn(async () => '東部幹線をExcelから開始しました。')
    renderTree({ onCreateProjectFromExcel })
    await user.click(screen.getByRole('button', { name: '新規プロジェクト' }))
    const dialog = screen.getByRole('dialog', { name: '新規プロジェクト' })
    expect(within(dialog).getByRole('heading', { name: 'Excelから開始' })).toBeVisible()
    expect(dialog).toHaveTextContent('入力エラー時は現在のプロジェクトを残します')

    const file = new File([new Uint8Array([1, 2, 3])], 'east.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    await user.upload(screen.getByTestId('tree-excel-project-file-input'), file)
    expect(onCreateProjectFromExcel).not.toHaveBeenCalled()
    expect(dialog).toHaveTextContent('選択中：east.xlsx')

    await user.click(within(dialog).getByRole('button', { name: 'Excelで置き換えて開始' }))
    expect(onCreateProjectFromExcel).toHaveBeenCalledWith(file)
    expect(await screen.findByRole('status')).toHaveTextContent('東部幹線をExcelから開始しました。')
  })

  test('keeps the replacement dialog open when Excel validation fails', async () => {
    const user = userEvent.setup()
    const onCreateProjectFromExcel = vi.fn(async () => { throw new Error('Excelに入力エラーがあるため、現在のプロジェクトは置き換えていません。') })
    renderTree({ onCreateProjectFromExcel })
    await user.click(screen.getByRole('button', { name: '新規プロジェクト' }))
    const dialog = screen.getByRole('dialog', { name: '新規プロジェクト' })
    await user.upload(screen.getByTestId('tree-excel-project-file-input'), new File(['invalid'], 'invalid.xlsx'))
    await user.click(within(dialog).getByRole('button', { name: 'Excelで置き換えて開始' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('現在のプロジェクトは置き換えていません')
    expect(screen.getByRole('dialog', { name: '新規プロジェクト' })).toBeVisible()
  })

  test('waits for confirmation before replacing the current Project with a file', async () => {
    const user = userEvent.setup()
    const onImportProject = vi.fn(async () => '西部支線を読み込みました。')
    renderTree({ onImportProject })
    const file = new File([new Uint8Array([1, 2, 3])], 'west.owhproj', { type: 'application/octet-stream' })
    await user.upload(screen.getByTestId('tree-project-file-input'), file)
    expect(onImportProject).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: 'プロジェクトを開く' })
    expect(dialog).toHaveTextContent('west.owhproj')
    await user.click(within(dialog).getByRole('button', { name: '置き換えて開く' }))
    expect(onImportProject).toHaveBeenCalledWith(file)
    expect(await screen.findByRole('status')).toHaveTextContent('西部支線を読み込みました。')
  })

  test('exports the current Project from the left menu', async () => {
    const user = userEvent.setup()
    const onExportProject = vi.fn(async () => 'sample.owhproj を書き出しました。')
    renderTree({ onExportProject })
    await user.click(screen.getByRole('button', { name: '現在のプロジェクトを書き出す' }))
    expect(onExportProject).toHaveBeenCalledOnce()
    expect(await screen.findByRole('status')).toHaveTextContent('sample.owhproj を書き出しました。')
  })
})
