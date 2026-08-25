import { deleteDB } from 'idb'
import { afterEach, describe, expect, test } from 'vitest'

import { createBlankProject, createProjectFromExcel, initializeBrowserWorkspace, installSampleWorkspace, replaceWithBlankProject } from '../bootstrap'

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

  test('replaces the existing data with one named blank project', async () => {
    const databaseName = `owh-ui-bootstrap-${crypto.randomUUID()}`
    names.push(databaseName)
    const opened = await initializeBrowserWorkspace({ databaseName })
    await installSampleWorkspace(opened.repository)

    const added = await replaceWithBlankProject(opened.repository, '  西部支線  ')

    expect(added.projects.map(({ name }) => name)).toEqual(['西部支線'])
    expect(added.cases).toHaveLength(1)
    expect(added.scenarios).toHaveLength(1)
    opened.repository.close()
  })

  test('creates one editable project from validated Excel data using the workbook project name', async () => {
    const databaseName = `owh-ui-bootstrap-${crypto.randomUUID()}`
    names.push(databaseName)
    const opened = await initializeBrowserWorkspace({ databaseName })
    const workbook = {
      meta: { projectName: '  東部幹線水撃圧検討  ', standardId: 'nochi_pipeline_2021' },
      pipes: [{
        id: 'P-01', name: '幹線', startNodeId: 'N-01', endNodeId: 'N-02', pipeType: 'ductile_iron' as const,
        innerDiameter: 0.5, wallThickness: 0.008, length: 800, roughnessCoeff: 130,
      }],
      nodes: [],
      cases: [{
        id: 'C-01', name: '末端弁閉鎖', operationType: 'valve_close' as const, targetFacilityId: 'V-01',
        initialVelocity: 1.2, initialHead: 35, closeTime: 3,
      }, {
        id: 'C-02', name: 'ポンプ停止', operationType: 'pump_stop' as const, targetFacilityId: 'PUMP-01',
        initialVelocity: 1.0, initialHead: 32,
      }],
      measurementPoints: [],
    }

    const created = await createProjectFromExcel(opened.repository, workbook)

    expect(created.data.projects[0]?.name).toBe('東部幹線水撃圧検討')
    expect(created.data.cases).toHaveLength(1)
    expect(created.data.cases[0]?.state).toBe('draft')
    const snapshot = created.data.cases[0]!.modelSnapshot as Record<string, unknown>
    expect(snapshot.excelImport).toEqual(workbook)
    expect(snapshot.canonicalModel).toMatchObject({ schema: 'open-waterhammer/hydraulic-model', version: 1, source: 'excel' })
    expect((snapshot.runInputs as Record<string, unknown>).wave_speed).toBeDefined()
    expect(created.data.scenarios).toHaveLength(2)
    expect(created.data.scenarios.map(({ name }) => name).sort()).toEqual(['ポンプ停止', '末端弁閉鎖'].sort())
    expect(created.data.scenarios.find(({ eventSettings }) => (
      eventSettings as Record<string, unknown>
    ).sourceExcelCaseId === 'C-01')?.eventSettings).toMatchObject({ sourceExcelCaseId: 'C-01', closeTime: 3 })
    opened.repository.close()
  })

  test('does not create an empty project when required Excel project information is missing', async () => {
    const databaseName = `owh-ui-bootstrap-${crypto.randomUUID()}`
    names.push(databaseName)
    const opened = await initializeBrowserWorkspace({ databaseName })
    const workbook = {
      meta: { projectName: ' ', standardId: 'nochi_pipeline_2021' },
      pipes: [], nodes: [], cases: [], measurementPoints: [],
    }

    await expect(createProjectFromExcel(opened.repository, workbook)).rejects.toThrow(/プロジェクト名/)
    expect((await opened.repository.snapshot()).projects).toHaveLength(0)
    opened.repository.close()
  })

  test('does not accept the untouched template placeholder as a project name', async () => {
    const databaseName = `owh-ui-bootstrap-${crypto.randomUUID()}`
    names.push(databaseName)
    const opened = await initializeBrowserWorkspace({ databaseName })
    const workbook = {
      meta: { projectName: '（案件名を入力）', standardId: 'nochi_pipeline_2021' },
      pipes: [], nodes: [], cases: [], measurementPoints: [],
    }

    await expect(createProjectFromExcel(opened.repository, workbook)).rejects.toThrow(/プロジェクト名/)
    expect((await opened.repository.snapshot()).projects).toHaveLength(0)
    opened.repository.close()
  })
})
