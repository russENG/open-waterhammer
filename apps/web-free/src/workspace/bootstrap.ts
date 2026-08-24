import {
  exportProjectBundle,
  IndexedDBWorkspaceRepository,
  type OpenIndexedDBWorkspaceOptions,
  type WorkspaceData,
} from '@open-waterhammer/workspace'

import { buildSampleWorkspace } from './sample-workspace'

const seedLocks = new Map<string, Promise<void>>()

function isEmpty(data: WorkspaceData): boolean {
  return data.projects.length === 0 && data.alternatives.length === 0 && data.cases.length === 0
}

async function seedSampleOnce(repository: IndexedDBWorkspaceRepository, databaseName: string): Promise<void> {
  let pending = seedLocks.get(databaseName)
  if (!pending) {
    pending = (async () => {
      if (!isEmpty(await repository.snapshot())) return
      const sample = buildSampleWorkspace()
      await repository.importBundle(await exportProjectBundle(sample, sample.projects[0]!.id))
    })().finally(() => {
      if (seedLocks.get(databaseName) === pending) seedLocks.delete(databaseName)
    })
    seedLocks.set(databaseName, pending)
  }
  await pending
}

export async function initializeBrowserWorkspace(options: OpenIndexedDBWorkspaceOptions = {}): Promise<{
  repository: IndexedDBWorkspaceRepository
  data: WorkspaceData
}> {
  const repository = await IndexedDBWorkspaceRepository.open(options)
  try {
    let data = await repository.snapshot()
    if (isEmpty(data)) {
      await seedSampleOnce(repository, options.databaseName ?? 'open-waterhammer-workspace')
      data = await repository.snapshot()
    }
    return { repository, data }
  } catch (error) {
    repository.close()
    throw error
  }
}
