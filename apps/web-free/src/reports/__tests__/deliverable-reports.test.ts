import { projectFixture, runFixture, type Project, type Run } from '@open-waterhammer/contracts'
import { describe, expect, test } from 'vitest'

import { buildReportInput, generateDeliverableExcel, toSimpleFormulaResult } from '../deliverable-reports'

const project: Project = projectFixture

const baseJoukowskyRun: Run = {
  ...runFixture,
  id: 'run-joukowsky-1',
  kind: 'joukowsky_allievi',
  status: 'succeeded',
  manifest: {
    ...runFixture.manifest,
    method: 'joukowsky-allievi',
    numericParameters: {
      pipe: {
        id: 'P-01', name: '第1号幹線', startNodeId: 'R-01', endNodeId: 'J-01',
        pipeType: 'ductile_iron', innerDiameter: 0.3, wallThickness: 0.007,
        length: 500, roughnessCoeff: 130,
      },
      calculationCase: {
        id: 'CALC-01', name: '末端弁閉鎖', operationType: 'valve_close',
        targetFacilityId: 'V-01', initialVelocity: 1, initialHead: 30,
      },
    },
    boundaryParameters: { eventSettings: { closeTime: 2 } },
  },
  summary: {
    caseId: 'CALC-01', pipeId: 'P-01',
    waveSpeed: { waveSpeed: 1100, vibrationPeriod: 0.91, alpha: 2.2 },
    closureType: 'rapid',
    deltaHJoukowsky: 123.45,
    hmaxAllieviClose: null, hmaxAllieviOpen: null,
    k1: null, allieviApplicable: false,
    warnings: [],
  },
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:10.000Z',
}

const baseLongitudinalRun: Run = {
  ...runFixture,
  id: 'run-longitudinal-1',
  kind: 'longitudinal_hydraulics',
  status: 'succeeded',
  manifest: {
    ...runFixture.manifest,
    method: 'longitudinal-hydraulics',
    numericParameters: {
      staticWaterLevel: 142,
      points: [
        { id: 'STA-000', horizontalDistance: 0, groundLevel: 100, pipeCenterHeight: 98, pipeLength: 0, flowRate: 0.03, diameter: 0.3, roughnessC: 130, bendLossCoeff: 0, valveLossCoeff: 0, branchLossCoeff: 0 },
        { id: 'STA-500', horizontalDistance: 500, groundLevel: 90, pipeCenterHeight: 88, pipeLength: 500, flowRate: 0.03, diameter: 0.3, roughnessC: 130, bendLossCoeff: 0.2, valveLossCoeff: 0, branchLossCoeff: 0 },
      ],
    },
    boundaryParameters: {},
  },
  summary: {
    caseName: '計画最大流量',
    staticWaterLevel: 142,
    pointResults: [
      { pointId: 'STA-000', hydraulicGradient: 0, velocity: 0.42, velocityHead: 0.009, frictionLoss: 0, totalLossCoeff: 0, minorLoss: 0, totalLoss: 0, energyLevel: 142, hydraulicGradeLine: 142, pressureHead: 44, staticPressure: 0.43, waterhammerPressure: 0.1, designPressure: 0.53 },
      { pointId: 'STA-500', hydraulicGradient: 0.001, velocity: 0.42, velocityHead: 0.009, frictionLoss: 0.5, totalLossCoeff: 0.2, minorLoss: 0.01, totalLoss: 0.51, energyLevel: 141.5, hydraulicGradeLine: 141.49, pressureHead: 53.49, staticPressure: 0.52, waterhammerPressure: 0.1, designPressure: 0.62 },
    ],
    maxVelocity: 0.42,
    maxDesignPressure: 0.62,
    warnings: [],
  },
  createdAt: '2026-08-21T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:10.000Z',
}

describe('toSimpleFormulaResult', () => {
  test('maps a rapid-closure (Joukowsky) summary field-by-field, camelCase -> the TS mixed-case shape', () => {
    const result = toSimpleFormulaResult(baseJoukowskyRun)
    expect(result.caseId).toBe('CALC-01')
    expect(result.pipeId).toBe('P-01')
    expect(result.waveSpeed).toEqual({ waveSpeed: 1100, vibrationPeriod: 0.91, alpha: 2.2 })
    expect(result.closureType).toBe('rapid')
    expect(result.deltaH_joukowsky).toBe(123.45)
    expect(result.hmax_allievi_close).toBeUndefined()
    expect(result.hmax_allievi_open).toBeUndefined()
    expect(result.k1).toBeUndefined()
    expect(result.allieviApplicable).toBe(false)
    expect(result.warnings).toEqual([])
  })

  test('maps a slow-closure (Allievi) summary: hmax_allievi_close/open and k1 populate, deltaH_joukowsky is absent', () => {
    const run: Run = {
      ...baseJoukowskyRun,
      summary: {
        caseId: 'CALC-02', pipeId: 'P-02',
        waveSpeed: { waveSpeed: 900, vibrationPeriod: 1.1, alpha: 0.5 },
        closureType: 'slow',
        deltaHJoukowsky: null,
        hmaxAllieviClose: 45.6, hmaxAllieviOpen: 12.3,
        k1: 0.87, allieviApplicable: true,
        warnings: ['アリエビ式適用条件を満たしています'],
      },
    }
    const result = toSimpleFormulaResult(run)
    expect(result.deltaH_joukowsky).toBeUndefined()
    expect(result.hmax_allievi_close).toBe(45.6)
    expect(result.hmax_allievi_open).toBe(12.3)
    expect(result.k1).toBe(0.87)
    expect(result.allieviApplicable).toBe(true)
    expect(result.warnings).toEqual(['アリエビ式適用条件を満たしています'])
  })
})

describe('buildReportInput', () => {
  test('returns null when there is no qualifying succeeded Run', () => {
    expect(buildReportInput(project, [])).toBeNull()
    const failed: Run = { ...baseJoukowskyRun, status: 'failed' }
    const otherKind: Run = { ...baseJoukowskyRun, kind: 'wave_speed' }
    expect(buildReportInput(project, [failed, otherKind])).toBeNull()
  })

  test('a longitudinal_hydraulics run restores hydraulicResults[0] and data.measurementPoints[0].horizontalDistance', () => {
    const input = buildReportInput(project, [baseLongitudinalRun])
    expect(input).not.toBeNull()
    expect(input!.hydraulicResults?.[0]).toEqual(baseLongitudinalRun.summary)
    expect(input!.data.measurementPoints[0]?.horizontalDistance).toBe(0)
    expect(input!.data.measurementPoints.length).toBe(2)
    expect(input!.results).toEqual([])
  })

  test('a joukowsky_allievi run populates results, data.pipes/data.cases, and closeTimes from manifest.numericParameters/boundaryParameters', () => {
    const input = buildReportInput(project, [baseJoukowskyRun])
    expect(input).not.toBeNull()
    expect(input!.results).toHaveLength(1)
    expect(input!.results[0]?.caseId).toBe('CALC-01')
    expect(input!.data.pipes).toEqual([baseJoukowskyRun.manifest.numericParameters && (baseJoukowskyRun.manifest.numericParameters as Record<string, unknown>).pipe])
    expect(input!.data.cases[0]?.id).toBe('CALC-01')
    expect(input!.closeTimes).toEqual({ 'CALC-01': 2 })
  })

  test('results are ordered by Run createdAt ascending', () => {
    const later: Run = {
      ...baseJoukowskyRun,
      id: 'run-joukowsky-2',
      createdAt: '2026-08-22T00:00:00.000Z',
      summary: { ...baseJoukowskyRun.summary as Record<string, unknown>, caseId: 'CALC-03' },
    }
    const input = buildReportInput(project, [later, baseJoukowskyRun])
    expect(input!.results.map((r) => r.caseId)).toEqual(['CALC-01', 'CALC-03'])
  })

  test('duplicate pipe/case ids across multiple joukowsky_allievi Runs are de-duplicated in data.pipes/data.cases', () => {
    const secondRun: Run = {
      ...baseJoukowskyRun,
      id: 'run-joukowsky-2',
      createdAt: '2026-08-22T00:00:00.000Z',
      manifest: {
        ...baseJoukowskyRun.manifest,
        boundaryParameters: { eventSettings: { closeTime: 5 } },
      },
    }
    const input = buildReportInput(project, [baseJoukowskyRun, secondRun])
    expect(input!.data.pipes).toHaveLength(1)
    expect(input!.data.cases).toHaveLength(1)
    // Same caseId on both runs -> closeTimes keeps the later Run's value (last one wins).
    expect(input!.closeTimes).toEqual({ 'CALC-01': 5 })
  })

  test('meta.version is the persisted run.manifest.productVersion, not necessarily the current build constant', () => {
    const stamped: Run = {
      ...baseJoukowskyRun,
      manifest: {
        ...baseJoukowskyRun.manifest,
        productVersion: '9.9.9-test' as unknown as typeof baseJoukowskyRun.manifest.productVersion,
      },
    }
    const input = buildReportInput(project, [stamped])
    expect(input!.meta.version).toBe('9.9.9-test')
    expect(input!.meta.projectName).toBe(project.name)
    expect(input!.meta.standardId).toBe(project.standardSelection.profileId)
    expect(input!.meta.date).toBe('2026-08-20')
  })

  test('prefers modelSnapshot.excelImport for data.pipes/data.cases (richer sheet data) but always keeps measurementPoints from the Run itself', () => {
    const excelImport = {
      meta: { projectName: 'Excel案件', standardId: 'nochi_pipeline_2021', designer: '設計太郎' },
      pipes: [
        { id: 'P-01', name: 'Excel由来', startNodeId: 'R-01', endNodeId: 'J-01', pipeType: 'steel' as const, innerDiameter: 0.35, wallThickness: 0.008, length: 480, roughnessCoeff: 120 },
        { id: 'P-02', name: '支線', startNodeId: 'J-01', endNodeId: 'J-02', pipeType: 'steel' as const, innerDiameter: 0.2, wallThickness: 0.006, length: 200, roughnessCoeff: 120 },
      ],
      nodes: [],
      cases: [
        { id: 'CALC-01', name: 'Excel由来ケース', operationType: 'valve_close' as const, targetFacilityId: 'V-01', initialVelocity: 1.2, initialHead: 32 },
      ],
      measurementPoints: [],
    }
    const input = buildReportInput(project, [baseJoukowskyRun, baseLongitudinalRun], excelImport)
    expect(input!.data.pipes).toEqual(excelImport.pipes)
    expect(input!.data.cases).toEqual(excelImport.cases)
    // measurementPoints always come from the Run's own numericParameters.points, never excelImport.
    expect(input!.data.measurementPoints).toHaveLength(2)
    expect(input!.data.measurementPoints[0]?.horizontalDistance).toBe(0)
    expect(input!.meta.designer).toBe('設計太郎')
  })

  test('falls back to Run-derived pipes/cases when excelImport is present but empty', () => {
    const emptyExcelImport = { meta: { projectName: '', standardId: '' }, pipes: [], nodes: [], cases: [], measurementPoints: [] }
    const input = buildReportInput(project, [baseJoukowskyRun], emptyExcelImport)
    expect(input!.data.pipes[0]?.id).toBe('P-01')
    expect(input!.data.cases[0]?.id).toBe('CALC-01')
  })
})

describe('generateDeliverableExcel', () => {
  test('generates a real, browser-compatible workbook from a built ReportInput', async () => {
    const input = buildReportInput(project, [baseJoukowskyRun, baseLongitudinalRun])!
    const browserGlobal = globalThis as typeof globalThis & { Buffer?: unknown }
    const original = browserGlobal.Buffer
    delete browserGlobal.Buffer
    try {
      const bytes = await generateDeliverableExcel(input)
      expect(bytes).toBeInstanceOf(Uint8Array)
      expect(bytes.byteLength).toBeGreaterThan(1_000)
    } finally {
      browserGlobal.Buffer = original
    }
  })
})
