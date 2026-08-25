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
  onImportProject = vi.fn(async () => '読み込みました。'),
  onExportProject = vi.fn(async () => '書き出しました。'),
} = {}) {
  const repository = new InMemoryWorkspaceRepository(data)
  render(
    <WorkspaceProvider repository={repository} initialData={data}>
      <WorkspaceTree
        projectId={projectFixture.id} caseId={caseFixture.id} comparison={[]}
        onSelect={() => {}} onToggleComparison={() => {}} onCreate={() => {}} onFork={() => {}}
        onCreateProject={onCreateProject} onImportProject={onImportProject} onExportProject={onExportProject}
      />
    </WorkspaceProvider>,
  )
  return { onCreateProject, onImportProject, onExportProject }
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
    await user.click(within(dialog).getByRole('button', { name: '置き換えて作成' }))
    expect(onCreateProject).toHaveBeenCalledWith('西部支線')
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
