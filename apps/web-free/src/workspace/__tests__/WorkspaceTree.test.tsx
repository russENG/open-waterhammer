import { alternativeFixture, caseFixture, projectFixture } from '@open-waterhammer/contracts'
import { InMemoryWorkspaceRepository, type WorkspaceData } from '@open-waterhammer/workspace'
import { render, screen } from '@testing-library/react'
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

function renderTree(data: WorkspaceData, onSelectProject = vi.fn()) {
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
      />
    </WorkspaceProvider>,
  )
  return { onSelectProject }
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
})
