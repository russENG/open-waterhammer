import {
  createCase,
  type Case,
  type JsonValue,
  type Project,
  type Run,
  type RunKind,
  type Scenario,
} from '@open-waterhammer/contracts'
import type { CanonicalHydraulicModel } from '@open-waterhammer/core'
import {
  runCalculation,
  type CalculationExecutorRegistry,
} from '@open-waterhammer/runner/browser'
import type { WorkspaceData, WorkspaceRepository } from '@open-waterhammer/workspace'
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

import type { LocalTransformDefinition } from '../gis/projections'
import { mergeDraftGeometryIntoCanonicalModel, type HydraulicDraft } from '../gis/import-model'
import type { BrowserProtocolCaller } from '../runner/browser-runner'
import { replaceWithBlankProject } from './bootstrap'
import type { ExcelScenarioInput } from './excel-import'
import { evaluateRunGate } from './run-policy'

export interface WorkspaceRepositoryClient extends WorkspaceRepository {
  snapshot(): Promise<WorkspaceData>
  archiveCase(caseId: string, timestamp: string): Promise<Case>
  close?(): void
}

export interface WorkspaceContextValue {
  data: WorkspaceData
  repository: WorkspaceRepositoryClient
  busy: boolean
  lastError: string | null
  refresh(): Promise<WorkspaceData>
  run(caseId: string, kind: RunKind, scenarioId?: string): Promise<Run>
  replaceProject(name: string): Promise<{ project: Project; caseRecord: Case }>
  createFrom(caseId: string): Promise<Case>
  fork(caseId: string, reason: string): Promise<Case>
  archive(caseId: string): Promise<Case>
  saveModel(caseId: string, kind: RunKind, input: JsonValue, scenario?: Scenario): Promise<void>
  saveGeoDrafts(caseId: string, drafts: JsonValue, sourceCrs: string, localTransform?: LocalTransformDefinition): Promise<void>
  saveScenario(scenario: Scenario): Promise<void>
  createScenario(caseId: string, name?: string): Promise<Scenario>
  importExcelInputs(caseId: string, mapped: Partial<Record<RunKind, JsonValue>>, raw: JsonValue, eventSettings?: JsonValue, excelScenarios?: ExcelScenarioInput[], canonicalModel?: JsonValue, canonicalIssues?: JsonValue): Promise<void>
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

function uuid(): string {
  return globalThis.crypto.randomUUID()
}

function now(): string {
  return new Date().toISOString()
}

function asObject(value: JsonValue | undefined): Record<string, JsonValue> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function isNonEmptyObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return Object.keys(asObject(value)).length > 0
}

function canonicalModelOf(root: Record<string, JsonValue>): CanonicalHydraulicModel | undefined {
  const value = root.canonicalModel
  return value && typeof value === 'object' && !Array.isArray(value)
    && value.schema === 'open-waterhammer/hydraulic-model' && value.version === 1
    ? value as unknown as CanonicalHydraulicModel
    : undefined
}

function modelsFrom(caseRecord: Case): Record<string, JsonValue> {
  const snapshot = caseRecord.modelSnapshot
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return {}
  const runInputs = snapshot.runInputs
  return runInputs && typeof runInputs === 'object' && !Array.isArray(runInputs)
    ? runInputs as Record<string, JsonValue>
    : {}
}

function applyScenarioToModel(kind: RunKind, model: JsonValue, scenario: Scenario): JsonValue {
  if (kind !== 'joukowsky_allievi') return model
  const root = asObject(model)
  const calculationCase = asObject(root.calculationCase)
  const event = asObject(scenario.eventSettings)
  const hasOperationInput = ['initialVelocity', 'initialHead', 'operationType', 'targetFacilityId']
    .some((key) => event[key] !== undefined)
  if (!hasOperationInput) return model
  return {
    ...root,
    calculationCase: {
      ...calculationCase,
      ...(event.calculationCaseId !== undefined ? { id: event.calculationCaseId } : {}),
      ...(event.calculationCaseName !== undefined ? { name: event.calculationCaseName } : {}),
      ...(event.operationType !== undefined ? { operationType: event.operationType } : {}),
      ...(event.targetFacilityId !== undefined ? { targetFacilityId: event.targetFacilityId } : {}),
      ...(event.initialVelocity !== undefined ? { initialVelocity: event.initialVelocity } : {}),
      ...(event.initialHead !== undefined ? { initialHead: event.initialHead } : {}),
    },
  }
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

  const run = useCallback((caseId: string, kind: RunKind, scenarioId?: string) => guarded(async () => {
    const caseRecord = data.cases.find(({ id }) => id === caseId)
    const scenario = data.scenarios.find(({ id, caseId: owner }) => owner === caseId && (!scenarioId || id === scenarioId))
    const alternative = data.alternatives.find(({ id }) => id === caseRecord?.alternativeId)
    const project = data.projects.find(({ id }) => id === alternative?.projectId)
    if (!caseRecord || !scenario || !project) throw new Error('計算に必要な比較案、シナリオ、またはプロジェクトが不足しています')
    if (caseRecord.state !== 'draft') throw new Error('計算済み・固定または保管済みの比較案は、複製して編集してから計算してください')
    const gate = evaluateRunGate(kind, caseRecord)
    if (!gate.canRun) {
      throw new Error(gate.reason === 'topology_invalid'
        ? '保存済みのGIS管路網に検証エラーがあります。修正するか、この計算用の管路網入力を保存してください'
        : '計算前に、有効なGIS管路網または完全な管路網入力を保存してください')
    }
    const model = modelsFrom(caseRecord)[kind]
    if (model === undefined) throw new Error(`計算の入力条件がありません：${kind}`)
    const registry = executors ?? await defaultExecutors(callProtocol)
    const calculated = await runCalculation({
      repository,
      project,
      caseSnapshot: { ...caseRecord, modelSnapshot: structuredClone(applyScenarioToModel(kind, model, scenario)) },
      scenarioSnapshot: scenario,
      kind,
      executors: registry,
      gitSha: import.meta.env.VITE_GIT_SHA ?? 'browser-build',
    })
    await refresh()
    return calculated
  }), [callProtocol, data, executors, guarded, refresh, repository])

  const replaceProject = useCallback((name: string) => guarded(async () => {
    const next = await replaceWithBlankProject(repository, name)
    const project = next.projects[0]
    const alternative = next.alternatives.find(({ projectId }) => projectId === project?.id)
    const caseRecord = next.cases.find(({ alternativeId }) => alternativeId === alternative?.id)
    if (!project || !caseRecord) throw new Error('新しいプロジェクトを開けませんでした。')
    setData(next)
    return { project, caseRecord }
  }), [guarded, repository])

  const createFrom = useCallback((caseId: string) => guarded(async () => {
    const source = data.cases.find(({ id }) => id === caseId)
    if (!source) throw new Error('複製元の比較案が見つかりません')
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
    if (!reason.trim()) throw new Error('変更理由を入力してください')
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
    if (!current) throw new Error('比較案が見つかりません')
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

  const importExcelInputs = useCallback((caseId: string, mapped: Partial<Record<RunKind, JsonValue>>, raw: JsonValue, eventSettings?: JsonValue, excelScenarios: ExcelScenarioInput[] = [], canonicalModel?: JsonValue, canonicalIssues?: JsonValue) => guarded(async () => {
    const current = data.cases.find(({ id }) => id === caseId)
    if (!current) throw new Error('比較案が見つかりません')
    const root = current.modelSnapshot && typeof current.modelSnapshot === 'object' && !Array.isArray(current.modelSnapshot)
      ? structuredClone(current.modelSnapshot) : {}
    const edited: Case = {
      ...current,
      // One save, atomic: merged runInputs (Excel-mapped kinds win over any prior value for
      // the same kind) plus the full parsed workbook retained verbatim as excelImport — raw
      // provenance for deliverable reports (src/reports/deliverable-reports.ts) and
      // traceability. Calculation never runs here; this only ever writes a draft (saveDraftCase
      // itself rejects a locked/archived Case, same rule as every other edit path).
      modelSnapshot: {
        ...root,
        runInputs: { ...modelsFrom(current), ...mapped },
        excelImport: raw,
        ...(canonicalModel === undefined ? {} : { canonicalModel }),
        ...(canonicalIssues === undefined ? {} : { canonicalIssues }),
      },
      updatedAt: now(),
    }
    // Excel 由来の操作条件（等価閉そく時間など）はモデルではなくシナリオ側に入るため、
    // 同じ保存でシナリオの eventSettings にも重ねる。分けて保存すると、後から保存した
    // 側が直前の書き込みを古い値で上書きしてしまう。
    const scenarios = data.scenarios.filter(({ caseId: owner }) => owner === caseId)
    const merged = isNonEmptyObject(eventSettings)
      ? scenarios.map((scenario, index) => (index === 0
        ? {
          ...scenario,
          eventSettings: { ...asObject(scenario.eventSettings), ...eventSettings },
          updatedAt: now(),
        }
        : scenario))
      : scenarios
    if (excelScenarios.length > 0) {
      const timestamp = now()
      const canReuseDefault = merged.length === 1 && !asObject(merged[0]!.eventSettings).sourceExcelCaseId
      for (const [index, source] of excelScenarios.entries()) {
        let targetIndex = merged.findIndex((scenario) => asObject(scenario.eventSettings).sourceExcelCaseId === source.sourceCaseId)
        if (targetIndex < 0 && index === 0 && canReuseDefault) targetIndex = 0
        if (targetIndex >= 0) {
          const currentScenario = merged[targetIndex]!
          merged[targetIndex] = {
            ...currentScenario,
            name: source.name,
            eventSettings: { ...asObject(currentScenario.eventSettings), ...source.eventSettings } as JsonValue,
            updatedAt: timestamp,
          }
        } else {
          merged.push({
            id: uuid(), caseId, name: source.name,
            boundaryConditions: {}, eventSettings: source.eventSettings as JsonValue, protectionSettings: {},
            createdAt: timestamp, updatedAt: timestamp,
          })
        }
      }
    }
    await repository.saveDraftCase(edited, merged)
    await refresh()
  }), [data.cases, data.scenarios, guarded, refresh, repository])

  const saveGeoDrafts = useCallback((caseId: string, drafts: JsonValue, sourceCrs: string, localTransform?: LocalTransformDefinition) => guarded(async () => {
    const current = data.cases.find(({ id }) => id === caseId)
    if (!current) throw new Error('比較案が見つかりません')
    const root = current.modelSnapshot && typeof current.modelSnapshot === 'object' && !Array.isArray(current.modelSnapshot)
      ? structuredClone(current.modelSnapshot) : {}
    const canonical = canonicalModelOf(root)
    const geometry = canonical && Array.isArray(drafts)
      ? mergeDraftGeometryIntoCanonicalModel(canonical, drafts as unknown as HydraulicDraft[], sourceCrs)
      : undefined
    const edited: Case = {
      ...current,
      modelSnapshot: {
        ...root,
        geoDrafts: drafts,
        geoSourceCrs: sourceCrs,
        geoLocalTransform: localTransform ? { proj4: localTransform.proj4 } : null,
        ...(geometry ? {
          canonicalModel: geometry.model as unknown as JsonValue,
          canonicalGeometryIssues: geometry.issues as unknown as JsonValue,
        } : {}),
      },
      updatedAt: now(),
    }
    await repository.saveDraftCase(edited, data.scenarios.filter(({ caseId: owner }) => owner === caseId))
    await refresh()
  }), [data.cases, data.scenarios, guarded, refresh, repository])

  const saveScenario = useCallback((scenario: Scenario) => guarded(async () => {
    const current = data.cases.find(({ id }) => id === scenario.caseId)
    if (!current) throw new Error('比較案が見つかりません')
    await repository.saveDraftCase(current, [{ ...scenario, updatedAt: now() }])
    await refresh()
  }), [data.cases, guarded, refresh, repository])

  const createScenario = useCallback((caseId: string, name = '新規シナリオ') => guarded(async () => {
    const current = data.cases.find(({ id }) => id === caseId)
    if (!current) throw new Error('比較案が見つかりません')
    if (current.state !== 'draft') throw new Error('計算済み・固定または保管済みの比較案にはシナリオを追加できません')
    const timestamp = now()
    const scenario: Scenario = {
      id: uuid(), caseId, name,
      boundaryConditions: {}, eventSettings: {}, protectionSettings: {},
      createdAt: timestamp, updatedAt: timestamp,
    }
    await repository.saveDraftCase(current, [scenario])
    await refresh()
    return scenario
  }), [data.cases, guarded, refresh, repository])

  const value = useMemo<WorkspaceContextValue>(() => ({
    data, repository, busy, lastError, refresh, run, replaceProject, createFrom, fork, archive, saveModel, saveGeoDrafts, saveScenario, createScenario, importExcelInputs,
  }), [archive, busy, createFrom, createScenario, data, fork, importExcelInputs, lastError, refresh, replaceProject, repository, run, saveGeoDrafts, saveModel, saveScenario])

  return <WorkspaceContext value={value}>{children}</WorkspaceContext>
}

// eslint-disable-next-line react-refresh/only-export-components -- provider and its typed hooks form one public module boundary
export function useWorkspace(): WorkspaceContextValue {
  const context = useWorkspaceOptional()
  if (!context) throw new Error('useWorkspace must be used within WorkspaceProvider')
  return context
}

/**
 * Same context as `useWorkspace`, but returns `null` instead of throwing when there is no
 * ancestor `WorkspaceProvider`. For components that are also unit-tested standalone (e.g.
 * `OverviewPanel`, rendered bare in `__tests__/schematic.test.ts`) and must degrade gracefully —
 * every real render path always has a `WorkspaceProvider` ancestor (see `WorkspaceApp.tsx`), so
 * this only matters outside that tree.
 */
// eslint-disable-next-line react-refresh/only-export-components -- provider and its typed hooks form one public module boundary
export function useWorkspaceOptional(): WorkspaceContextValue | null {
  return useContext(WorkspaceContext)
}
