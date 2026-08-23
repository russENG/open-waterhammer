import {
  createCase,
  type Case,
  type JsonValue,
  type Run,
  type RunKind,
  type Scenario,
} from '@open-waterhammer/contracts'
import {
  runCalculation,
  type CalculationExecutorRegistry,
} from '@open-waterhammer/runner/browser'
import type { WorkspaceData, WorkspaceRepository } from '@open-waterhammer/workspace'
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

import { validateHydraulicDrafts, type HydraulicDraft } from '../gis/import-model'
import type { LocalTransformDefinition } from '../gis/projections'
import type { BrowserProtocolCaller } from '../runner/browser-runner'

export interface WorkspaceRepositoryClient extends WorkspaceRepository {
  snapshot(): Promise<WorkspaceData>
  archiveCase(caseId: string, timestamp: string): Promise<Case>
  close?(): void
}

interface WorkspaceContextValue {
  data: WorkspaceData
  repository: WorkspaceRepositoryClient
  busy: boolean
  lastError: string | null
  refresh(): Promise<WorkspaceData>
  run(caseId: string, kind: RunKind): Promise<Run>
  createFrom(caseId: string): Promise<Case>
  fork(caseId: string, reason: string): Promise<Case>
  archive(caseId: string): Promise<Case>
  saveModel(caseId: string, kind: RunKind, input: JsonValue, scenario?: Scenario): Promise<void>
  saveGeoDrafts(caseId: string, drafts: JsonValue, sourceCrs: string, localTransform?: LocalTransformDefinition): Promise<void>
  saveScenario(scenario: Scenario): Promise<void>
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

function uuid(): string {
  return globalThis.crypto.randomUUID()
}

function now(): string {
  return new Date().toISOString()
}

function modelsFrom(caseRecord: Case): Record<string, JsonValue> {
  const snapshot = caseRecord.modelSnapshot
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return {}
  const runInputs = snapshot.runInputs
  return runInputs && typeof runInputs === 'object' && !Array.isArray(runInputs)
    ? runInputs as Record<string, JsonValue>
    : {}
}

async function defaultExecutors(callProtocol?: BrowserProtocolCaller) {
  const { createBrowserExecutorRegistry } = await import('../runner/browser-runner')
  return createBrowserExecutorRegistry({ ...(callProtocol ? { callProtocol } : {}) })
}

export function WorkspaceProvider({
  repository,
  initialData,
  executors,
  callProtocol,
  children,
}: {
  repository: WorkspaceRepositoryClient
  initialData: WorkspaceData
  executors?: CalculationExecutorRegistry
  callProtocol?: BrowserProtocolCaller
  children: ReactNode
}) {
  const [data, setData] = useState(initialData)
  const [busy, setBusy] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const next = await repository.snapshot()
    setData(next)
    return next
  }, [repository])

  const guarded = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    setBusy(true)
    setLastError(null)
    try {
      return await operation()
    } catch (error) {
      setLastError(error instanceof Error ? error.message : String(error))
      throw error
    } finally {
      setBusy(false)
    }
  }, [])

  const run = useCallback((caseId: string, kind: RunKind) => guarded(async () => {
    const caseRecord = data.cases.find(({ id }) => id === caseId)
    const scenario = data.scenarios.find(({ caseId: owner }) => owner === caseId)
    const alternative = data.alternatives.find(({ id }) => id === caseRecord?.alternativeId)
    const project = data.projects.find(({ id }) => id === alternative?.projectId)
    if (!caseRecord || !scenario || !project) throw new Error('Run context is incomplete')
    if (caseRecord.state !== 'draft') throw new Error('Locked or archived Case must be forked before execution')
    const snapshot = caseRecord.modelSnapshot
    const geoDrafts = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) && Array.isArray(snapshot.geoDrafts)
      ? snapshot.geoDrafts as unknown as HydraulicDraft[] : []
    if (!validateHydraulicDrafts(geoDrafts).canRun) throw new Error('A persisted valid GIS topology is required before Run')
    const model = modelsFrom(caseRecord)[kind]
    if (model === undefined) throw new Error(`Run input is missing: ${kind}`)
    const registry = executors ?? await defaultExecutors(callProtocol)
    const calculated = await runCalculation({
      repository,
      project,
      caseSnapshot: { ...caseRecord, modelSnapshot: structuredClone(model) },
      scenarioSnapshot: scenario,
      kind,
      executors: registry,
      gitSha: import.meta.env.VITE_GIT_SHA ?? 'browser-build',
    })
    await refresh()
    return calculated
  }), [callProtocol, data, executors, guarded, refresh, repository])

  const createFrom = useCallback((caseId: string) => guarded(async () => {
    const source = data.cases.find(({ id }) => id === caseId)
    if (!source) throw new Error('Source Case not found')
    const alternative = data.alternatives.find(({ id }) => id === source.alternativeId)
    const project = data.projects.find(({ id }) => id === alternative?.projectId)
    const timestamp = now()
    const created = createCase({
      id: uuid(),
      alternativeId: source.alternativeId,
      modelSnapshot: { runInputs: {}, geoDrafts: [], geoSourceCrs: project?.crs ?? 'EPSG:4326' },
      timestamp,
    })
    const scenarios: Scenario[] = [{
      id: uuid(), caseId: created.id, name: '新規シナリオ',
      boundaryConditions: {}, eventSettings: {}, protectionSettings: {},
      createdAt: timestamp, updatedAt: timestamp,
    }]
    await repository.saveDraftCase(created, scenarios)
    await refresh()
    return created
  }), [data, guarded, refresh, repository])

  const fork = useCallback((caseId: string, reason: string) => guarded(async () => {
    if (!reason.trim()) throw new Error('A non-blank revision reason is required')
    const timestamp = now()
    const child = await repository.forkCase(caseId, { id: uuid(), revisionReason: reason, timestamp })
    const parentScenarios = data.scenarios.filter(({ caseId: owner }) => owner === caseId)
    const childScenarios = parentScenarios.map((scenario) => ({
      ...structuredClone(scenario), id: uuid(), caseId: child.id,
      createdAt: timestamp, updatedAt: timestamp,
    }))
    await repository.saveDraftCase(child, childScenarios)
    await refresh()
    return child
  }), [data.scenarios, guarded, refresh, repository])

  const archive = useCallback((caseId: string) => guarded(async () => {
    const archived = await repository.archiveCase(caseId, now())
    await refresh()
    return archived
  }), [guarded, refresh, repository])

  const saveModel = useCallback((caseId: string, kind: RunKind, input: JsonValue, scenario?: Scenario) => guarded(async () => {
    const current = data.cases.find(({ id }) => id === caseId)
    if (!current) throw new Error('Case not found')
    const root = current.modelSnapshot && typeof current.modelSnapshot === 'object' && !Array.isArray(current.modelSnapshot)
      ? structuredClone(current.modelSnapshot) : {}
    const edited: Case = {
      ...current,
      modelSnapshot: { ...root, runInputs: { ...modelsFrom(current), [kind]: input } },
      updatedAt: now(),
    }
    const scenarios = scenario
      ? [{ ...scenario, updatedAt: now() }]
      : data.scenarios.filter(({ caseId: owner }) => owner === caseId)
    await repository.saveDraftCase(edited, scenarios)
    await refresh()
  }), [data.cases, data.scenarios, guarded, refresh, repository])

  const saveGeoDrafts = useCallback((caseId: string, drafts: JsonValue, sourceCrs: string, localTransform?: LocalTransformDefinition) => guarded(async () => {
    const current = data.cases.find(({ id }) => id === caseId)
    if (!current) throw new Error('Case not found')
    const root = current.modelSnapshot && typeof current.modelSnapshot === 'object' && !Array.isArray(current.modelSnapshot)
      ? structuredClone(current.modelSnapshot) : {}
    const edited: Case = {
      ...current,
      modelSnapshot: { ...root, geoDrafts: drafts, geoSourceCrs: sourceCrs, geoLocalTransform: localTransform ? { proj4: localTransform.proj4 } : null },
      updatedAt: now(),
    }
    await repository.saveDraftCase(edited, data.scenarios.filter(({ caseId: owner }) => owner === caseId))
    await refresh()
  }), [data.cases, data.scenarios, guarded, refresh, repository])

  const saveScenario = useCallback((scenario: Scenario) => guarded(async () => {
    const current = data.cases.find(({ id }) => id === scenario.caseId)
    if (!current) throw new Error('Case not found')
    await repository.saveDraftCase(current, [{ ...scenario, updatedAt: now() }])
    await refresh()
  }), [data.cases, guarded, refresh, repository])

  const value = useMemo<WorkspaceContextValue>(() => ({
    data, repository, busy, lastError, refresh, run, createFrom, fork, archive, saveModel, saveGeoDrafts, saveScenario,
  }), [archive, busy, createFrom, data, fork, lastError, refresh, repository, run, saveGeoDrafts, saveModel, saveScenario])

  return <WorkspaceContext value={value}>{children}</WorkspaceContext>
}

// eslint-disable-next-line react-refresh/only-export-components -- provider and its typed hook form one public module boundary
export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext)
  if (!context) throw new Error('useWorkspace must be used within WorkspaceProvider')
  return context
}
