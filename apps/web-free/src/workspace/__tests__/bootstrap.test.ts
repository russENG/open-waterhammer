import { deleteDB } from 'idb'
import { afterEach, describe, expect, test } from 'vitest'

import { createBlankProject, initializeBrowserWorkspace, installSampleWorkspace } from '../bootstrap'

const names: string[] = []

afterEach(async () => {
  for (const name of names.splice(0)) await deleteDB(name)
})

describe('browser workspace bootstrap', () => {
  test('opens an empty IndexedDB without automatically installing a sample', async () => {
    const databaseName = `owh-ui-bootstrap-${crypto.randomUUID()}`
    names.push(databaseName)
    const first = await initializeBrowserWorkspace({ databaseName })
    expect(first.data.projects).toHaveLength(0)
    expect(first.data.cases).toHaveLength(0)
    first.repository.close()

    const reopened = await initializeBrowserWorkspace({ databaseName })
    expect(reopened.data.projects).toHaveLength(0)
    expect(reopened.data.cases).toHaveLength(0)
    reopened.repository.close()
  })

  test('installs the explicitly selected fictional sample and persists it', async () => {
    const databaseName = `owh-ui-bootstrap-${crypto.randomUUID()}`
    names.push(databaseName)
    const opened = await initializeBrowserWorkspace({ databaseName })
    const installed = await installSampleWorkspace(opened.repository)
    expect(installed.projects[0]?.name).toBe('サンプル：N地区東部幹線水路')
    expect(installed.cases).toHaveLength(4)
    opened.repository.close()

    const reopened = await initializeBrowserWorkspace({ databaseName })
    expect(reopened.data.projects[0]?.name).toBe('サンプル：N地区東部幹線水路')
    expect(reopened.data.cases).toHaveLength(4)
    reopened.repository.close()
  })

  test('creates a named blank project with one editable comparison and scenario', async () => {
    const databaseName = `owh-ui-bootstrap-${crypto.randomUUID()}`
    names.push(databaseName)
    const opened = await initializeBrowserWorkspace({ databaseName })
    const created = await createBlankProject(opened.repository, '  試験幹線  ')
    expect(created.projects[0]?.name).toBe('試験幹線')
    expect(created.alternatives).toHaveLength(1)
    expect(created.cases).toHaveLength(1)
    expect(created.cases[0]?.state).toBe('draft')
    expect(created.scenarios).toHaveLength(1)
    opened.repository.close()
  })
})
