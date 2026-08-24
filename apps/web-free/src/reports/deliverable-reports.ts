import type { JsonValue, Project, Run } from '@open-waterhammer/contracts'
import type { ReportInput } from '@open-waterhammer/excel-io'

import { ensureBrowserBuffer } from './browser-buffer'

// `ReportInput`'s nested shapes, derived by indexed access instead of importing
// `@open-waterhammer/core` directly (this module only needs types, and every one of
// them is already reachable off the `ReportInput` type that `@open-waterhammer/excel-io`
// exports).
type SimpleFormulaResult = ReportInput['results'][number]
type WaveSpeedResult = SimpleFormulaResult['waveSpeed']
type LongitudinalHydraulicResult = NonNullable<ReportInput['hydraulicResults']>[number]
type WorkbookData = ReportInput['data']
type ProjectMeta = ReportInput['meta']
type Pipe = WorkbookData['pipes'][number]
type CalculationCase = WorkbookData['cases'][number]
type MeasurementPoint = WorkbookData['measurementPoints'][number]

function asRecord(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, JsonValue> : undefined
}
function num(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' ? value : undefined
}
function str(value: JsonValue | undefined, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}
function bool(value: JsonValue | undefined): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}
function strArray(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/**
 * `run.summary`（`packages/core-py/open_waterhammer/protocol.py` の `_camel_key` が
 * `SimpleFormulaResult` dataclass — `packages/core-py/open_waterhammer/types.py`
 * — をキャメルケース化したもの）→ TS の `SimpleFormulaResult`
 * （`packages/core/src/types.ts` ~L230）への明示的フィールド対応表。
 *
 * TS 側は一部のフィールド名にスネークケースのサフィックスを残しているため
 * （`_camel_key` は `delta_h_joukowsky` → `deltaHJoukowsky` のように変換するが、
 * TS の型はそれを `deltaH_joukowsky` のまま保持する）、汎用のケース変換関数では
 * 正しく戻せない。フィールドごとに書き下す:
 *
 *   TS SimpleFormulaResult    <- Python run.summary (camelCase)
 *   ------------------------------------------------------------
 *   caseId                    <- caseId
 *   pipeId                    <- pipeId
 *   waveSpeed.waveSpeed       <- waveSpeed.waveSpeed
 *   waveSpeed.vibrationPeriod <- waveSpeed.vibrationPeriod
 *   waveSpeed.alpha           <- waveSpeed.alpha
 *   closureType                <- closureType
 *   deltaH_joukowsky          <- deltaHJoukowsky
 *   hmax_allievi_close        <- hmaxAllieviClose
 *   hmax_allievi_open         <- hmaxAllieviOpen
 *   k1                        <- k1
 *   allieviApplicable         <- allieviApplicable
 *   warnings                  <- warnings
 *
 * Both sides enumerate exactly these 10 fields (waveSpeed expands to 3) — there is no
 * field on either side without a counterpart on the other.
 */
export function toSimpleFormulaResult(run: Run): SimpleFormulaResult {
  const summary = asRecord(run.summary) ?? {}
  const waveSpeedRecord = asRecord(summary.waveSpeed) ?? {}
  const waveSpeed: WaveSpeedResult = {
    waveSpeed: num(waveSpeedRecord.waveSpeed) ?? 0,
    vibrationPeriod: num(waveSpeedRecord.vibrationPeriod) ?? 0,
    alpha: num(waveSpeedRecord.alpha) ?? 0,
  }
  const deltaHJoukowsky = num(summary.deltaHJoukowsky)
  const hmaxAllieviClose = num(summary.hmaxAllieviClose)
  const hmaxAllieviOpen = num(summary.hmaxAllieviOpen)
  const k1 = num(summary.k1)
  const allieviApplicable = bool(summary.allieviApplicable)

  return {
    caseId: str(summary.caseId),
    pipeId: str(summary.pipeId),
    waveSpeed,
    closureType: str(summary.closureType, 'numerical_required') as SimpleFormulaResult['closureType'],
    ...(deltaHJoukowsky !== undefined ? { deltaH_joukowsky: deltaHJoukowsky } : {}),
    ...(hmaxAllieviClose !== undefined ? { hmax_allievi_close: hmaxAllieviClose } : {}),
    ...(hmaxAllieviOpen !== undefined ? { hmax_allievi_open: hmaxAllieviOpen } : {}),
    ...(k1 !== undefined ? { k1 } : {}),
    ...(allieviApplicable !== undefined ? { allieviApplicable } : {}),
    warnings: strArray(summary.warnings),
  }
}

function pipeFromNumericParameters(numericParameters: JsonValue): Pipe | undefined {
  const model = asRecord(numericParameters)
  const pipe = model && asRecord(model.pipe)
  return pipe ? (pipe as unknown as Pipe) : undefined
}

function calculationCaseFromNumericParameters(numericParameters: JsonValue): CalculationCase | undefined {
  const model = asRecord(numericParameters)
  const calculationCase = model && asRecord(model.calculationCase)
  return calculationCase ? (calculationCase as unknown as CalculationCase) : undefined
}

function pointsFromNumericParameters(numericParameters: JsonValue): MeasurementPoint[] {
  const model = asRecord(numericParameters)
  const points = model?.points
  return Array.isArray(points) ? (points as unknown as MeasurementPoint[]) : []
}

function closeTimeFromBoundaryParameters(boundaryParameters: JsonValue): number | undefined {
  const boundary = asRecord(boundaryParameters)
  const eventSettings = boundary && asRecord(boundary.eventSettings)
  return eventSettings ? num(eventSettings.closeTime) : undefined
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const byId = new Map<string, T>()
  for (const item of items) byId.set(item.id, item)
  return [...byId.values()]
}

function byCreatedAtAsc(a: Run, b: Run): number {
  return a.createdAt.localeCompare(b.createdAt)
}

/**
 * Assembles `packages/excel-io`'s `generateReport()` input purely from already-persisted
 * Runs — no recalculation. `excelImport`, when given (the case's saved
 * `modelSnapshot.excelImport`, if any), supplies richer `data.pipes` / `data.cases` than
 * what any single Run's `numericParameters` carries (full sheet listings vs. just the one
 * pipe/case that was judged) — everything else (`results`, `hydraulicResults`,
 * `data.measurementPoints`, `closeTimes`) always comes from the Runs themselves so the
 * 水理計算書 sheet never pairs a point row against a mismatched calculated result.
 */
export function buildReportInput(project: Project, runs: Run[], excelImport?: WorkbookData | null): ReportInput | null {
  const joukowskyRuns = runs
    .filter((run) => run.kind === 'joukowsky_allievi' && run.status === 'succeeded')
    .sort(byCreatedAtAsc)
  const longitudinalRuns = runs
    .filter((run) => run.kind === 'longitudinal_hydraulics' && run.status === 'succeeded')
    .sort(byCreatedAtAsc)

  if (joukowskyRuns.length === 0 && longitudinalRuns.length === 0) return null

  const results = joukowskyRuns.map(toSimpleFormulaResult)

  const closeTimes: Record<string, number> = {}
  joukowskyRuns.forEach((run, index) => {
    const closeTime = closeTimeFromBoundaryParameters(run.manifest.boundaryParameters)
    if (closeTime !== undefined) closeTimes[results[index]!.caseId] = closeTime
  })

  const hydraulicResults = longitudinalRuns.length > 0
    ? longitudinalRuns.map((run) => run.summary as unknown as LongitudinalHydraulicResult)
    : undefined

  // `generateReport` renders one shared `data.measurementPoints` array against every
  // `hydraulicResults` entry positionally, so there is no per-Run points list to give it —
  // the most recent succeeded longitudinal_hydraulics Run's own points is the
  // self-consistent choice (guaranteed to line up with that Run's own pointResults).
  const measurementPoints = longitudinalRuns.length > 0
    ? pointsFromNumericParameters(longitudinalRuns.at(-1)!.manifest.numericParameters)
    : []

  const pipesFromRuns = dedupeById(
    joukowskyRuns
      .map((run) => pipeFromNumericParameters(run.manifest.numericParameters))
      .filter((pipe): pipe is Pipe => pipe !== undefined),
  )
  const casesFromRuns = dedupeById(
    joukowskyRuns
      .map((run) => calculationCaseFromNumericParameters(run.manifest.numericParameters))
      .filter((calculationCase): calculationCase is CalculationCase => calculationCase !== undefined),
  )

  const pipes = excelImport && excelImport.pipes.length > 0 ? excelImport.pipes : pipesFromRuns
  const cases = excelImport && excelImport.cases.length > 0 ? excelImport.cases : casesFromRuns

  const representativeRun = [...joukowskyRuns, ...longitudinalRuns].sort(byCreatedAtAsc).at(-1)!

  const meta: ProjectMeta = {
    ...(excelImport?.meta ?? {}),
    projectName: project.name,
    standardId: project.standardSelection.profileId,
    version: representativeRun.manifest.productVersion,
    date: representativeRun.createdAt.slice(0, 10),
  }

  return {
    meta,
    data: {
      meta,
      pipes,
      nodes: excelImport?.nodes ?? [],
      cases,
      measurementPoints,
    },
    results,
    ...(Object.keys(closeTimes).length > 0 ? { closeTimes } : {}),
    ...(hydraulicResults ? { hydraulicResults } : {}),
  }
}

/**
 * Renders the 成果品様式 deliverable workbook (水理計算書 / 水撃圧検討書) from an already
 * built `ReportInput`. `generateReport` only consumes plain types + the `headToMpa` unit
 * helper from `@open-waterhammer/core` — it never invokes a TS solver, so this does not
 * violate the "TS numerics are reference-only" ruling.
 */
export async function generateDeliverableExcel(input: ReportInput): Promise<Uint8Array> {
  await ensureBrowserBuffer()
  const { generateReport } = await import('@open-waterhammer/excel-io')
  return generateReport(input)
}
