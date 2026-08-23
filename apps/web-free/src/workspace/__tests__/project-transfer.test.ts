import {
  alternativeFixture,
  caseFixture,
  projectFixture,
  runFixture,
  scenarioFixture,
} from '@open-waterhammer/contracts'
import { InMemoryWorkspaceRepository } from '@open-waterhammer/workspace'
import { describe, expect, test, vi } from 'vitest'

import { downloadProjectFile, exportProjectFile, importProjectFile } from '../project-transfer'

// A Run locks its Case (successful_run provenance) — exportProjectBundle validates its own
// output before returning, so a seeded repository must already satisfy that relationship or
// export itself throws (see packages/workspace/src/bundle.ts inspectProjectBundle).
const lockedCase = {
  ...caseFixture,
  state: 'locked' as const,
  lockProvenance: 'successful_run' as const,
  updatedAt: runFixture.updatedAt,
}

function seededRepository() {
  return new InMemoryWorkspaceRepository({
    projects: [projectFixture],
    alternatives: [alternativeFixture],
    cases: [lockedCase],
    scenarios: [scenarioFixture],
    runs: [runFixture],
    legacyArtifacts: [],
  })
}

describe('exportProjectFile', () => {
  test('names the file after the Project (slugified) and returns non-empty bundle bytes', async () => {
    const repository = seededRepository()

    const file = await exportProjectFile(repository, projectFixture.id)

    expect(file.name).toBe('North-canal-rehabilitation.owhproj')
    expect(file.bytes).toBeInstanceOf(Uint8Array)
    expect(file.bytes.byteLength).toBeGreaterThan(0)
  })

  test('reads through the repository, not a caller-held snapshot, so IndexedDB state is the source', async () => {
    const repository = seededRepository()
    const exportBundleSpy = vi.spyOn(repository, 'exportBundle')

    await exportProjectFile(repository, projectFixture.id)

    expect(exportBundleSpy).toHaveBeenCalledWith(projectFixture.id)
  })
})

describe('importProjectFile', () => {
  test('round-trips a seeded Project through a fresh repository, matching counts', async () => {
    const source = seededRepository()
    const target = new InMemoryWorkspaceRepository()

    const file = await exportProjectFile(source, projectFixture.id)
    const summary = await importProjectFile(target, new File([file.bytes.slice()], file.name))

    expect(summary).toEqual({
      project: projectFixture,
      alternatives: 1,
      cases: 1,
      scenarios: 1,
      runs: 1,
      legacyArtifacts: 0,
    })
    const imported = await target.snapshot()
    expect(imported.projects).toEqual([projectFixture])
    expect(imported.cases).toEqual([lockedCase])
    expect(imported.runs).toEqual([runFixture])
  })

  test('rejects corrupt bytes with a readable error instead of an opaque failure', async () => {
    const target = new InMemoryWorkspaceRepository()
    const corrupt = new File([new Uint8Array([1, 2, 3, 4])], 'corrupt.owhproj')

    await expect(importProjectFile(target, corrupt)).rejects.toThrow(/invalid zip/i)
  })

  test('surfaces the repository duplicate-id rejection verbatim rather than inventing merge logic', async () => {
    const source = seededRepository()
    const target = seededRepository() // already holds an entity with the same Project id

    const file = await exportProjectFile(source, projectFixture.id)

    await expect(importProjectFile(target, new File([file.bytes.slice()], file.name)))
      .rejects.toThrow(/duplicate workspace entity id/i)
    // Rejected atomically: the target's data must be untouched, never a partial merge.
    expect(await target.snapshot()).toEqual(await seededRepository().snapshot())
  })
})

describe('downloadProjectFile', () => {
  test('triggers a browser download named after the bundle via a thin anchor click', () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url')
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    downloadProjectFile({ name: 'sample.owhproj', bytes: new Uint8Array([1, 2, 3]) })

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url')
  })
})
