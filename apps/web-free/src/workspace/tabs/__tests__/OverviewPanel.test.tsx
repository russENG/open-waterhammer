import { caseFixture, projectFixture, type Case } from '@open-waterhammer/contracts'
import { InMemoryWorkspaceRepository } from '@open-waterhammer/workspace'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createElement } from 'react'
import { describe, expect, test, vi } from 'vitest'

import { buildSampleWorkspace } from '../../sample-workspace'
import { WorkspaceProvider } from '../../workspace-context'
import { OverviewPanel } from '../OverviewPanel'

vi.mock('../../project-transfer', () => ({
  exportProjectFile: vi.fn(),
  importProjectFile: vi.fn(),
  downloadProjectFile: vi.fn(),
}))

import { downloadProjectFile, exportProjectFile, importProjectFile } from '../../project-transfer'

function caseWith(modelSnapshot: Case['modelSnapshot']): Case {
  return { ...caseFixture, modelSnapshot }
}

function renderInWorkspace() {
  const data = buildSampleWorkspace('2026-08-23T01:02:03.000Z')
  const repository = new InMemoryWorkspaceRepository(data)
  const project = data.projects[0]!
  const caseRecord = data.cases[0]!
  render(
    <WorkspaceProvider repository={repository} initialData={data}>
      <OverviewPanel project={project} caseRecord={caseRecord} runs={[]} />
    </WorkspaceProvider>,
  )
  return { data, repository, project }
}

describe('OverviewPanel project bundle card', () => {
  test('renders the export and import controls as buttons', () => {
    renderInWorkspace()

    expect(screen.getByRole('button', { name: /プロジェクトを書き出し/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /プロジェクトを読み込み/ })).toBeInTheDocument()
  })

  test('clicking export invokes exportProjectFile with the repository and Project id, then downloads the result', async () => {
    const user = userEvent.setup()
    const bundle = { name: 'sample-project.owhproj', bytes: new Uint8Array([9, 9, 9]) }
    vi.mocked(exportProjectFile).mockResolvedValue(bundle)
    const { repository, project } = renderInWorkspace()

    await user.click(screen.getByRole('button', { name: /プロジェクトを書き出し/ }))

    expect(exportProjectFile).toHaveBeenCalledWith(repository, project.id)
    await screen.findByText(/sample-project\.owhproj/)
    expect(downloadProjectFile).toHaveBeenCalledWith(bundle)
  })

  test('shows the readable error message verbatim when export fails', async () => {
    const user = userEvent.setup()
    vi.mocked(exportProjectFile).mockRejectedValue(new Error('Project not found: missing-id'))
    renderInWorkspace()

    await user.click(screen.getByRole('button', { name: /プロジェクトを書き出し/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Project not found: missing-id')
  })

  test('shows the readable error message verbatim when import fails (duplicate or corrupt bundle)', async () => {
    const user = userEvent.setup()
    vi.mocked(importProjectFile).mockRejectedValue(new Error('Duplicate workspace entity id: 11111111-1111-4111-8111-111111111111'))
    renderInWorkspace()
    const file = new File([new Uint8Array([1, 2, 3])], 'dup.owhproj')

    const input = screen.getByTestId('project-bundle-file-input')
    await user.upload(input, file)

    expect(await screen.findByRole('alert')).toHaveTextContent('Duplicate workspace entity id: 11111111-1111-4111-8111-111111111111')
    expect(importProjectFile).toHaveBeenCalledWith(expect.anything(), file)
  })

  test('shows imported counts and refreshes workspace data on a successful import', async () => {
    const user = userEvent.setup()
    vi.mocked(importProjectFile).mockResolvedValue({
      project: { ...projectFixture, id: 'zzzzzzzz-zzzz-4zzz-8zzz-zzzzzzzzzzzz', name: 'Imported harbor line' },
      alternatives: 1,
      cases: 2,
      scenarios: 2,
      runs: 1,
      legacyArtifacts: 0,
    })
    renderInWorkspace()
    const file = new File([new Uint8Array([1, 2, 3])], 'ok.owhproj')

    await user.upload(screen.getByTestId('project-bundle-file-input'), file)

    expect(await screen.findByRole('status')).toHaveTextContent('Imported harbor line')
  })

  test('does not render the project bundle card (and does not throw) when rendered outside a WorkspaceProvider', () => {
    // Mirrors ../../__tests__/schematic.test.ts, which renders OverviewPanel bare to test
    // schematic derivation only — this must keep working without a WorkspaceProvider ancestor.
    expect(() => render(createElement(OverviewPanel, {
      project: projectFixture,
      caseRecord: caseWith({ runInputs: {}, geoDrafts: [] }),
      runs: [],
    }))).not.toThrow()

    expect(screen.queryByRole('button', { name: /プロジェクトを書き出し/ })).not.toBeInTheDocument()
  })
})
