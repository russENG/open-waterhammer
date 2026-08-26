import {
  alternativeFixture,
  caseFixture,
  type JsonValue,
  projectFixture,
  scenarioFixture,
} from '@open-waterhammer/contracts'
import type { WorkbookData } from '@open-waterhammer/excel-io'
import { TEMPLATE_SAMPLE_PROJECT_NAME } from '@open-waterhammer/sample-data'
import {
  exportProjectBundle,
  IndexedDBWorkspaceRepository,
  type OpenIndexedDBWorkspaceOptions,
  type WorkspaceData,
} from '@open-waterhammer/workspace'

import { buildSampleWorkspace } from './sample-workspace'
import { mapWorkbookToRunInputs } from './excel-import'

function isEmpty(data: WorkspaceData): boolean {
  return data.projects.length === 0 && data.alternatives.length === 0 && data.cases.length === 0
}

interface InitializableWorkspaceRepository {
  snapshot(): Promise<WorkspaceData>
  importBundle(bytes: Uint8Array): Promise<unknown>
  replaceBundle(bytes: Uint8Array): Promise<unknown>
}

function buildBlankWorkspace(projectName: string, timestamp = new Date().toISOString()): WorkspaceData {
  const projectId = globalThis.crypto.randomUUID()
  const alternativeId = globalThis.crypto.randomUUID()
  const caseId = globalThis.crypto.randomUUID()
  return {
    projects: [{ ...projectFixture, id: projectId, name: projectName, createdAt: timestamp, updatedAt: timestamp }],
    alternatives: [{ ...alternativeFixture, id: alternativeId, projectId, name: '基本案', description: '新規プロジェクト', createdAt: timestamp, updatedAt: timestamp }],
    cases: [{
      ...caseFixture,
      id: caseId,
      alternativeId,
      parentCaseId: null,
      modelSnapshot: { runInputs: {}, geoDrafts: [], geoSourceCrs: projectFixture.crs },
      state: 'draft',
      lockProvenance: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    scenarios: [{
      ...scenarioFixture,
      id: globalThis.crypto.randomUUID(),
      caseId,
      name: '新規シナリオ',
      boundaryConditions: {},
      eventSettings: {},
      protectionSettings: {},
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    runs: [],
    legacyArtifacts: [],
  }
}

async function importIntoEmptyWorkspace(repository: InitializableWorkspaceRepository, data: WorkspaceData): Promise<WorkspaceData> {
  if (!isEmpty(await repository.snapshot())) throw new Error('このブラウザには既にプロジェクトがあります。')
  await repository.importBundle(await exportProjectBundle(data, data.projects[0]!.id))
  return repository.snapshot()
}

async function replaceWithBlankWorkspace(repository: InitializableWorkspaceRepository, projectName: string): Promise<WorkspaceData> {
  const name = projectName.trim()
  if (!name) throw new Error('プロジェクト名を入力してください。')
  const data = buildBlankWorkspace(name)
  await repository.replaceBundle(await exportProjectBundle(data, data.projects[0]!.id))
  return repository.snapshot()
}

function buildWorkspaceFromExcel(workbook: WorkbookData): { data: WorkspaceData; warnings: string[] } {
  const projectName = workbook.meta.projectName.trim()
  if (!projectName) {
    throw new Error('Excelの「案件情報」B2セル（project_name）に案件名を入力してください。')
  }
  const hasAnyData = workbook.pipes.length > 0 || workbook.nodes.length > 0
    || workbook.cases.length > 0 || workbook.measurementPoints.length > 0
  if (!hasAnyData) throw new Error('Excelに取り込める管路・節点・ケース・測点データがありません。')

  // 配布テンプレートの既定名のまま読み込むのは動作確認としては正しい使い方なので拒否しない。
  // 実案件で書き換え忘れたときだけ気づけるよう、警告として残す。
  // （かつてはここで例外を投げていたため、配布したテンプレートを取込側が受け付けなかった）
  const nameWarnings = projectName === TEMPLATE_SAMPLE_PROJECT_NAME
    ? ['案件名がテンプレートの既定値のままです。実案件では「案件情報」シートの案件名を書き換えてください。']
    : []

  const mapped = mapWorkbookToRunInputs(workbook)
  const data = buildBlankWorkspace(projectName)
  const project = data.projects[0]!
  if (workbook.meta.standardId.trim()) {
    project.standardSelection = { ...project.standardSelection, profileId: workbook.meta.standardId.trim() }
  }
  data.alternatives[0]!.description = 'Excelから開始'
  data.cases[0]!.modelSnapshot = {
    runInputs: mapped.runInputs as JsonValue,
    excelImport: workbook as unknown as JsonValue,
    canonicalModel: mapped.canonicalModel as unknown as JsonValue,
    canonicalIssues: mapped.canonicalIssues as unknown as JsonValue,
    geoDrafts: [],
    geoSourceCrs: project.crs,
  }
  if (mapped.scenarios.length > 0) {
    const caseId = data.cases[0]!.id
    const timestamp = data.cases[0]!.createdAt
    data.scenarios = mapped.scenarios.map((scenario) => ({
      id: globalThis.crypto.randomUUID(),
      caseId,
      name: scenario.name,
      boundaryConditions: {},
      eventSettings: scenario.eventSettings as JsonValue,
      protectionSettings: {},
      createdAt: timestamp,
      updatedAt: timestamp,
    }))
  } else {
    data.scenarios[0]!.eventSettings = mapped.eventSettings as JsonValue
  }

  return { data, warnings: [...nameWarnings, ...mapped.warnings] }
}

export function createBlankProject(repository: InitializableWorkspaceRepository, projectName: string): Promise<WorkspaceData> {
  const name = projectName.trim()
  if (!name) return Promise.reject(new Error('プロジェクト名を入力してください。'))
  return importIntoEmptyWorkspace(repository, buildBlankWorkspace(name))
}

/** 現在の保存内容を、編集可能な空のプロジェクト1件で置き換える。 */
export function replaceWithBlankProject(repository: InitializableWorkspaceRepository, projectName: string): Promise<WorkspaceData> {
  return replaceWithBlankWorkspace(repository, projectName)
}

export function installSampleWorkspace(repository: InitializableWorkspaceRepository): Promise<WorkspaceData> {
  return importIntoEmptyWorkspace(repository, buildSampleWorkspace())
}

/** 現在の保存内容を、明示的に選択されたサンプルプロジェクトで置き換える。 */
export async function replaceWithSampleWorkspace(repository: InitializableWorkspaceRepository): Promise<WorkspaceData> {
  const data = buildSampleWorkspace()
  await repository.replaceBundle(await exportProjectBundle(data, data.projects[0]!.id))
  return repository.snapshot()
}

export async function createProjectFromExcel(
  repository: InitializableWorkspaceRepository,
  workbook: WorkbookData,
): Promise<{ data: WorkspaceData; warnings: string[] }> {
  // Parse/validation is completed by the caller before this function. Build the complete
  // workspace in memory first, then commit it as one validated bundle so a failed import never
  // leaves an empty Project behind in IndexedDB.
  const prepared = buildWorkspaceFromExcel(workbook)
  return { ...prepared, data: await importIntoEmptyWorkspace(repository, prepared.data) }
}

/**
 * 検証済みExcelから作った完全なプロジェクトで、現在の保存内容を原子的に置き換える。
 * Excelの解析・検証は呼び出し側で先に完了させるため、不正なExcelではこの関数を呼ばない。
 */
export async function replaceProjectFromExcel(
  repository: InitializableWorkspaceRepository,
  workbook: WorkbookData,
): Promise<{ data: WorkspaceData; warnings: string[] }> {
  const prepared = buildWorkspaceFromExcel(workbook)
  const bytes = await exportProjectBundle(prepared.data, prepared.data.projects[0]!.id)
  await repository.replaceBundle(bytes)
  return { ...prepared, data: await repository.snapshot() }
}

export async function initializeBrowserWorkspace(options: OpenIndexedDBWorkspaceOptions = {}): Promise<{
  repository: IndexedDBWorkspaceRepository
  data: WorkspaceData
}> {
  const repository = await IndexedDBWorkspaceRepository.open(options)
  try {
    return { repository, data: await repository.snapshot() }
  } catch (error) {
    repository.close()
    throw error
  }
}
