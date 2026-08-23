import { InMemoryWorkspaceRepository } from '@open-waterhammer/workspace'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { buildSampleWorkspace } from '../../sample-workspace'
import { WorkspaceProvider } from '../../workspace-context'
import { ExcelIoCard } from '../ExcelIoCard'

vi.mock('@open-waterhammer/excel-io', () => ({
  parseWorkbook: vi.fn(),
  generateTemplate: vi.fn(async () => new ArrayBuffer(8)),
}))

import { generateTemplate, parseWorkbook } from '@open-waterhammer/excel-io'

const mockedParseWorkbook = vi.mocked(parseWorkbook)
const mockedGenerateTemplate = vi.mocked(generateTemplate)

function setup(caseOverrides: Partial<{ state: 'draft' | 'locked' | 'archived' }> = {}) {
  const data = buildSampleWorkspace('2026-08-23T01:02:03.000Z')
  const repository = new InMemoryWorkspaceRepository(data)
  const caseRecord = { ...data.cases[0]!, ...caseOverrides }
  render(
    <WorkspaceProvider repository={repository} initialData={data}>
      <ExcelIoCard caseRecord={caseRecord} />
    </WorkspaceProvider>,
  )
  return { data, repository, caseRecord }
}

const validWorkbookData = {
  meta: { projectName: 'アップロード案件', standardId: 'nochi_pipeline_2021' },
  pipes: [{
    id: 'P-99', name: 'アップロード管路', startNodeId: 'R-01', endNodeId: 'J-01',
    pipeType: 'ductile_iron' as const, innerDiameter: 0.3, wallThickness: 0.007,
    length: 400, roughnessCoeff: 130,
  }],
  nodes: [],
  cases: [{
    id: 'CALC-99', name: 'アップロードケース', operationType: 'valve_close' as const,
    targetFacilityId: 'V-01', initialVelocity: 1.1, initialHead: 28,
  }],
  measurementPoints: [],
}

beforeEach(() => {
  mockedParseWorkbook.mockReset()
  mockedGenerateTemplate.mockReset()
  mockedGenerateTemplate.mockResolvedValue(new ArrayBuffer(8))
})

describe('ExcelIoCard', () => {
  test('renders parse errors from a bad workbook without touching the Case', async () => {
    const user = userEvent.setup()
    mockedParseWorkbook.mockResolvedValueOnce({
      data: { meta: { projectName: '', standardId: '' }, pipes: [], nodes: [], cases: [], measurementPoints: [] },
      errors: [{ sheet: 'network', row: 3, field: 'pipe_type', message: '不明な管種コード: "foo"' }],
      warnings: [],
    })
    const { repository } = setup()

    const file = new File(['dummy'], 'bad.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const input = screen.getByLabelText(/xlsx/i)
    await user.upload(input, file)

    expect(await screen.findByText(/不明な管種コード/)).toBeVisible()
    const snapshot = await repository.snapshot()
    const caseRecord = snapshot.cases[0]!
    const modelSnapshot = caseRecord.modelSnapshot as Record<string, unknown>
    expect(modelSnapshot.excelImport).toBeUndefined()
  })

  test('a successful upload maps and persists runInputs + excelImport in one save', async () => {
    const user = userEvent.setup()
    mockedParseWorkbook.mockResolvedValueOnce({ data: validWorkbookData, errors: [], warnings: [] })
    const { repository, caseRecord } = setup()

    const file = new File(['dummy'], 'good.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const input = screen.getByLabelText(/xlsx/i)
    await user.upload(input, file)

    await waitFor(async () => {
      const snapshot = await repository.snapshot()
      const persisted = snapshot.cases.find(({ id }) => id === caseRecord.id)!
      const modelSnapshot = persisted.modelSnapshot as Record<string, unknown>
      expect(modelSnapshot.excelImport).toEqual(validWorkbookData)
      const runInputs = modelSnapshot.runInputs as Record<string, unknown>
      expect((runInputs.wave_speed as { pipe: { id: string } }).pipe.id).toBe('P-99')
      expect((runInputs.joukowsky_allievi as { calculationCase: { id: string } }).calculationCase.id).toBe('CALC-99')
    })
    expect(await screen.findByText(/wave_speed/)).toBeVisible()
  })

  test('disables the upload input with a reason when the Case is not a draft', () => {
    setup({ state: 'locked' })
    const input = screen.getByLabelText(/xlsx/i)
    expect(input).toBeDisabled()
    expect(screen.getByText(/固定済み|Fork/)).toBeVisible()
  })

  test('template download seeds generateTemplate with the documented demo constants', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button', { name: /テンプレート/ }))

    expect(mockedGenerateTemplate).toHaveBeenCalledOnce()
    const [options] = mockedGenerateTemplate.mock.calls[0]!
    expect(options?.pipes).toHaveLength(1)
    expect(options?.pipes?.[0]?.id).toBe('pipe-01')
    expect(options?.cases).toHaveLength(2)
    expect(options?.measurementPoints?.length).toBeGreaterThan(0)
  })
})
