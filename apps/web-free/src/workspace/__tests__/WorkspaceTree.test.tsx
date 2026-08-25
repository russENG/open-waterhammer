import { alternativeFixture, caseFixture, projectFixture } from '@open-waterhammer/contracts'
import { InMemoryWorkspaceRepository, type WorkspaceData } from '@open-waterhammer/workspace'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'

import { WorkspaceProvider } from '../workspace-context'
import { WorkspaceTree } from '../WorkspaceTree'

const secondProject = { ...projectFixture, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: '南部幹線 比較' }
const secondAlternative = { ...alternativeFixture, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', projectId: secondProject.id }
const secondCase = { ...caseFixture, id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', alternativeId: secondAlternative.id }

function twoProjectWorkspace(): WorkspaceData {
  return {
    projects: [projectFixture, secondProject],
    alternatives: [alternativeFixture, secondAlternative],
    cases: [caseFixture, secondCase],
    scenarios: [],
    runs: [],
    legacyArtifacts: [],
  }
}

function renderTree(data: WorkspaceData, onSelectProject = vi.fn(), onCreateProject = vi.fn(), onImportProject = vi.fn(async () => '読み込みました。')) {
  const repository = new InMemoryWorkspaceRepository(data)
  render(
    <WorkspaceProvider repository={repository} initialData={data}>
      <WorkspaceTree
        projectId={projectFixture.id}
        caseId={caseFixture.id}
        comparison={[]}
        onSelect={() => {}}
        onToggleComparison={() => {}}
        onCreate={() => {}}
        onFork={() => {}}
        onSelectProject={onSelectProject}
        onCreateProject={onCreateProject}
        onImportProject={onImportProject}
      />
    </WorkspaceProvider>,
  )
  return { onSelectProject, onCreateProject, onImportProject }
}

describe('WorkspaceTree Project switcher', () => {
  test('renders a labeled Project selector listing every Project (with its Alternative count) when more than one exists', () => {
    renderTree(twoProjectWorkspace())

    const select = screen.getByLabelText('プロジェクト切替')
    expect(select).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /North canal rehabilitation/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /南部幹線 比較/ })).toBeInTheDocument()
  })

  test('switching the selector calls onSelectProject with the chosen Project id', async () => {
    const user = userEvent.setup()
    const { onSelectProject } = renderTree(twoProjectWorkspace())

    await user.selectOptions(screen.getByLabelText('プロジェクト切替'), secondProject.id)

    expect(onSelectProject).toHaveBeenCalledWith(secondProject.id)
  })

  test('does not render a Project selector when the workspace has only one Project', () => {
    const singleProjectData: WorkspaceData = {
      projects: [projectFixture],
      alternatives: [alternativeFixture],
      cases: [caseFixture],
      scenarios: [],
      runs: [],
      legacyArtifacts: [],
    }

    renderTree(singleProjectData)

    expect(screen.queryByLabelText('プロジェクト切替')).not.toBeInTheDocument()
  })

  test('creates another Project from the left menu', async () => {
    const user = userEvent.setup()
    const onCreateProject = vi.fn(async () => {})
    renderTree(twoProjectWorkspace(), vi.fn(), onCreateProject)

    await user.click(screen.getByRole('button', { name: '新規プロジェクト' }))
    const dialog = screen.getByRole('dialog', { name: '新規プロジェクト' })
    await user.type(screen.getByLabelText('プロジェクト名'), '西部支線')
    await user.click(within(dialog).getByRole('button', { name: '作成して開く' }))

    expect(onCreateProject).toHaveBeenCalledWith('西部支線')
    expect(screen.queryByRole('dialog', { name: '新規プロジェクト' })).not.toBeInTheDocument()
  })

  test('imports a Project file from the left menu', async () => {
    const user = userEvent.setup()
    const onImportProject = vi.fn(async () => '西部支線を読み込みました。')
    renderTree(twoProjectWorkspace(), vi.fn(), vi.fn(), onImportProject)
    const file = new File([new Uint8Array([1, 2, 3])], 'west.owhproj', { type: 'application/octet-stream' })

    await user.upload(screen.getByTestId('tree-project-file-input'), file)

    expect(onImportProject).toHaveBeenCalledWith(file)
    expect(await screen.findByRole('status')).toHaveTextContent('西部支線を読み込みました。')
  })
})
