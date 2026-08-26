import { alternativeFixture, caseFixture, projectFixture, type Case } from '@open-waterhammer/contracts'
import { InMemoryWorkspaceRepository } from '@open-waterhammer/workspace'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createElement } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { buildSampleWorkspace } from '../../sample-workspace'
import { WorkspaceProvider } from '../../workspace-context'
import { OverviewPanel } from '../OverviewPanel'

vi.mock('../../project-transfer', () => ({
  exportProjectFile: vi.fn(),
  replaceProjectFile: vi.fn(),
  downloadProjectFile: vi.fn(),
}))

import { downloadProjectFile, exportProjectFile, replaceProjectFile } from '../../project-transfer'

beforeEach(() => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

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

describe('OverviewPanel legacy hydraulic model compatibility', () => {
  test('shows the plan and input profile for a persisted sample that predates canonicalModel', () => {
    const data = buildSampleWorkspace('2026-08-23T01:02:03.000Z')
    const source = data.cases[0]!
    const snapshot = source.modelSnapshot as Record<string, unknown>
    const legacySnapshot = { ...snapshot }
    delete legacySnapshot.canonicalModel
    const legacyCase = { ...source, modelSnapshot: legacySnapshot as Case['modelSnapshot'] }

    render(<OverviewPanel project={data.projects[0]!} caseRecord={legacyCase} runs={[]} />)

    expect(screen.getByRole('group', { name: /実座標平面図、管路1件、節点2件/ })).toBeVisible()
    expect(screen.getByRole('group', { name: /入力確認図（計算前）、測点11件/ })).toBeVisible()
    expect(screen.queryByText('縦断図に必要な測点データがありません。')).not.toBeInTheDocument()
  })
})

describe('OverviewPanel project bundle card', () => {
  test('renders the export and import controls as buttons', () => {
    renderInWorkspace()

    expect(screen.getByRole('button', { name: /プロジェクトを書き出し/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /プロジェクトを読み込み/ })).toBeInTheDocument()
  })

  test('clicking export invokes exportProjectFile with the repository and Project id, then downloads the result', async () => {
    const user = userEvent.setup()
    const bundle = { name: 'sample.owhproj', bytes: new Uint8Array([9, 9, 9]) }
    vi.mocked(exportProjectFile).mockResolvedValue(bundle)
    const { repository, project } = renderInWorkspace()

    await user.click(screen.getByRole('button', { name: /プロジェクトを書き出し/ }))

    expect(exportProjectFile).toHaveBeenCalledWith(repository, project.id)
    await screen.findByText(/sample\.owhproj/)
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
    vi.mocked(replaceProjectFile).mockRejectedValue(new Error('読み込んだファイルを検証できませんでした'))
    renderInWorkspace()
    const file = new File([new Uint8Array([1, 2, 3])], 'dup.owhproj')

    const input = screen.getByTestId('project-bundle-file-input')
    await user.upload(input, file)

    expect(await screen.findByRole('alert')).toHaveTextContent('読み込んだファイルを検証できませんでした')
    expect(replaceProjectFile).toHaveBeenCalledWith(expect.anything(), file)
  })

  test('shows imported counts and refreshes workspace data on a successful import', async () => {
    const user = userEvent.setup()
    vi.mocked(replaceProjectFile).mockResolvedValue({
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

  test('navigates to the imported Project\'s newest Case overview (by createdAt) after a successful import', async () => {
    const user = userEvent.setup()
    const base = buildSampleWorkspace('2026-08-23T01:02:03.000Z')
    // The mocked replaceProjectFile below never touches the real repository, so `refresh()`
    // (called after import) reads back whatever this repository was already seeded with —
    // stand in for "the state right after a real import" by seeding the second Project's
    // Alternative/Cases up front, exactly as a real importBundle would have written them.
    const importedProject = { ...projectFixture, id: 'zzzzzzzz-zzzz-4zzz-8zzz-zzzzzzzzzzzz', name: 'Imported harbor line' }
    const importedAlternative = { ...alternativeFixture, id: 'aaaaaaaa-1111-4111-8111-111111111111', projectId: importedProject.id }
    // olderCase has the later updatedAt but earlier createdAt — proves navigation follows
    // createdAt (per the spec), not the app's usual "most recently touched" ordering.
    const olderCase = caseWith({ runInputs: {}, geoDrafts: [] })
    const newerCase = {
      ...olderCase,
      id: 'aaaaaaaa-2222-4222-8222-222222222222',
      alternativeId: importedAlternative.id,
      createdAt: '2021-01-01T00:00:00.000Z',
      updatedAt: '2019-01-01T00:00:00.000Z',
    }
    const seededOlderCase = { ...olderCase, alternativeId: importedAlternative.id, createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z' }
    const data = {
      ...base,
      projects: [...base.projects, importedProject],
      alternatives: [...base.alternatives, importedAlternative],
      cases: [...base.cases, seededOlderCase, newerCase],
    }
    const repository = new InMemoryWorkspaceRepository(data)
    vi.mocked(replaceProjectFile).mockResolvedValue({
      project: importedProject, alternatives: 1, cases: 2, scenarios: 0, runs: 0, legacyArtifacts: 0,
    })
    const onImported = vi.fn()
    render(
      <WorkspaceProvider repository={repository} initialData={data}>
        <OverviewPanel project={data.projects[0]!} caseRecord={data.cases[0]!} runs={[]} onImported={onImported} />
      </WorkspaceProvider>,
    )
    const file = new File([new Uint8Array([1, 2, 3])], 'ok.owhproj')

    await user.upload(screen.getByTestId('project-bundle-file-input'), file)

    await screen.findByRole('status')
    expect(onImported).toHaveBeenCalledWith(importedProject.id, newerCase.id)
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
