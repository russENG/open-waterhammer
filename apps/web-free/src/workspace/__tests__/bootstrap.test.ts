import { deleteDB } from 'idb'
import { afterEach, describe, expect, test } from 'vitest'

import { initializeBrowserWorkspace } from '../bootstrap'

const names: string[] = []

afterEach(async () => {
  for (const name of names.splice(0)) await deleteDB(name)
})

describe('browser workspace bootstrap', () => {
  test('seeds a small sample Project only when IndexedDB is empty and persists it across reload', async () => {
    const databaseName = `owh-ui-bootstrap-${crypto.randomUUID()}`
    names.push(databaseName)
    const first = await initializeBrowserWorkspace({ databaseName })
    expect(first.data.projects).toHaveLength(1)
    expect(first.data.cases).toHaveLength(4)
    first.repository.close()

    const reopened = await initializeBrowserWorkspace({ databaseName })
    expect(reopened.data.projects).toHaveLength(1)
    expect(reopened.data.cases).toHaveLength(4)
    reopened.repository.close()
  })

  test('serializes concurrent StrictMode initialization without duplicating sample entities', async () => {
    const databaseName = `owh-ui-bootstrap-${crypto.randomUUID()}`
    names.push(databaseName)

    const [first, second] = await Promise.all([
      initializeBrowserWorkspace({ databaseName }),
      initializeBrowserWorkspace({ databaseName }),
    ])
    expect(first.data.projects).toHaveLength(1)
    expect(second.data.projects).toHaveLength(1)
    expect(first.data.cases).toHaveLength(4)
    expect(second.data.cases).toHaveLength(4)
    first.repository.close()
    second.repository.close()
  })
})
