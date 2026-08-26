import type { Case, JsonValue, Run } from '@open-waterhammer/contracts'
import { mpaToHead } from '@open-waterhammer/core'

import { resolveCanonicalHydraulicModel } from './canonical-model-compat'

export type ProfileIssueCode = 'POINT_ORDER' | 'DISTANCE_INVALID' | 'DISTANCE_MISMATCH' | 'VALUE_MISSING' | 'PIPE_UNKNOWN' | 'POINT_OUT_OF_PIPE' | 'NODE_UNKNOWN'

export interface ProfileIssue {
  code: ProfileIssueCode
  pointId: string
  message: string
}

export interface ProfilePoint {
  id: string
  name?: string
  sequence: number
  distance: number
  distanceAlongPipe?: number
  pipeId?: string
  nodeId?: string
  pipeDiameter?: number
  groundElevation?: number
  pipeCenterElevation?: number
  hydraulicGradeElevation?: number
  maximumHeadElevation?: number
  minimumHeadElevation?: number
  designPressureElevation?: number
  issueCodes: ProfileIssueCode[]
}

export interface ProfilePipeSpan {
  pipeId: string
  fromDistance: number
  toDistance: number
  diameter?: number
}

export interface LongitudinalProfileDiagram {
  points: ProfilePoint[]
  pipeSpans: ProfilePipeSpan[]
  issues: ProfileIssue[]
  resultRunIds: string[]
  hasCalculationResults: boolean
}

type JsonRecord = Record<string, JsonValue>

function record(value: JsonValue | undefined): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function numericArray(value: JsonValue | undefined): number[] {
  return Array.isArray(value) && value.every(finite) ? value : []
}

function interpolate(values: number[], ratio: number): number | undefined {
  if (!values.length) return undefined
  if (values.length === 1) return values[0]
  const position = Math.max(0, Math.min(1, ratio)) * (values.length - 1)
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  const weight = position - lower
  return values[lower]! + (values[upper]! - values[lower]!) * weight
}

function selectedRun(runs: Run[], preferredRunId: string | undefined, predicate: (run: Run) => boolean): Run | undefined {
  const successful = runs.filter((run) => run.status === 'succeeded' && predicate(run))
  const preferred = preferredRunId ? successful.find(({ id }) => id === preferredRunId) : undefined
  return preferred ?? [...successful].sort((left, right) => left.updatedAt.localeCompare(right.updatedAt)).at(-1)
}

function longitudinalResults(run: Run | undefined): Map<string, { hydraulicGrade?: number; designPressure?: number }> {
  const results = new Map<string, { hydraulicGrade?: number; designPressure?: number }>()
  const values = run ? record(run.summary)?.pointResults : undefined
  if (!Array.isArray(values)) return results
  for (const value of values) {
    const item = record(value)
    if (!item) continue
    const pointId = typeof item.pointId === 'string' ? item.pointId : undefined
    if (!pointId) continue
    results.set(pointId, {
      ...(finite(item.hydraulicGradeLine) ? { hydraulicGrade: item.hydraulicGradeLine } : {}),
      ...(finite(item.designPressure) ? { designPressure: item.designPressure } : {}),
    })
  }
  return results
}

function envelopeForPipe(run: Run | undefined, pipeId: string): { steady: number[]; maximum: number[]; minimum: number[] } | undefined {
  const output = run ? record(record(run.summary)?.pipes)?.[pipeId] : undefined
  const pipe = record(output)
  if (!pipe) return undefined
  const steady = numericArray(pipe.H_steady)
  const maximum = numericArray(pipe.Hmax)
  const minimum = numericArray(pipe.Hmin)
  return steady.length || maximum.length || minimum.length ? { steady, maximum, minimum } : undefined
}

function pipeSpans(points: ProfilePoint[]): ProfilePipeSpan[] {
  const spans: ProfilePipeSpan[] = []
  for (const point of points) {
    if (!point.pipeId) continue
    const current = spans.at(-1)
    if (current?.pipeId === point.pipeId) {
      current.toDistance = point.distance
      continue
    }
    spans.push({
      pipeId: point.pipeId,
      fromDistance: current?.toDistance ?? point.distance,
      toDistance: point.distance,
      ...(point.pipeDiameter === undefined ? {} : { diameter: point.pipeDiameter }),
    })
  }
  return spans
}

export function deriveLongitudinalProfile(caseRecord: Case, runs: Run[] = [], preferredRunId?: string): LongitudinalProfileDiagram | undefined {
  const model = resolveCanonicalHydraulicModel(caseRecord)
  if (!model || model.measurementPoints.length === 0) return undefined
  const issues: ProfileIssue[] = []
  const pipeById = new Map(model.pipes.map((pipe) => [pipe.id, pipe]))
  const nodeIds = new Set(model.nodes.map(({ id }) => id))
  const original = model.measurementPoints
  const ordered = [...original].sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id))
  const originalOrder = original.map(({ id }) => id).join('\u0000')
  const normalizedOrder = ordered.map(({ id }) => id).join('\u0000')
  const duplicateSequence = new Set(ordered.map(({ sequence }) => sequence)).size !== ordered.length
  if (originalOrder !== normalizedOrder || duplicateSequence) {
    const pointId = ordered.find((point, index) => index > 0 && point.sequence <= ordered[index - 1]!.sequence)?.id ?? ordered[0]!.id
    issues.push({ code: 'POINT_ORDER', pointId, message: '測点の順序番号が入力順と一致しないか、重複しています。図は順序番号で並べ、該当測点を要確認として表示します。' })
  }

  const longitudinalRun = selectedRun(runs, preferredRunId, (run) => run.kind === 'longitudinal_hydraulics')
  const transientRun = selectedRun(runs, preferredRunId, (run) => Boolean(record(record(run.summary)?.pipes)))
  const calculatedByPoint = longitudinalResults(longitudinalRun)
  let cumulativeDistance = 0
  let previousPoint: typeof ordered[number] | undefined
  const points: ProfilePoint[] = []

  function addIssue(code: ProfileIssueCode, pointId: string, message: string) {
    issues.push({ code, pointId, message })
  }

  for (const source of ordered) {
    const pointIssues: ProfileIssueCode[] = []
    const interval = source.horizontalDistanceFromPrevious
    if (!finite(interval) || interval < 0) {
      pointIssues.push('DISTANCE_INVALID')
      addIssue('DISTANCE_INVALID', source.id, `測点 ${source.id} の前測点からの水平距離が0以上の数値ではありません。前の有効な位置に要確認記号を表示します。`)
    } else {
      cumulativeDistance += interval
    }
    const pipe = source.pipeId ? pipeById.get(source.pipeId) : undefined
    if (!source.pipeId || !pipe) {
      pointIssues.push('PIPE_UNKNOWN')
      addIssue('PIPE_UNKNOWN', source.id, `測点 ${source.id} の所属管路が未設定か、正準モデルに存在しません。`)
    }
    if (!finite(source.groundElevation) || !finite(source.pipeCenterElevation)) {
      pointIssues.push('VALUE_MISSING')
      addIssue('VALUE_MISSING', source.id, `測点 ${source.id} の地盤高または管中心高が有効な数値ではありません。該当系列は補間せず切断します。`)
    }
    if (source.nodeId && !nodeIds.has(source.nodeId)) {
      pointIssues.push('NODE_UNKNOWN')
      addIssue('NODE_UNKNOWN', source.id, `測点 ${source.id} が参照する節点 ${source.nodeId} は正準モデルに存在しません。`)
    }
    if (pipe && (!finite(source.distanceAlongPipe) || source.distanceAlongPipe < 0 || source.distanceAlongPipe > pipe.length + 1e-6)) {
      pointIssues.push('POINT_OUT_OF_PIPE')
      addIssue('POINT_OUT_OF_PIPE', source.id, `測点 ${source.id} の管路起点からの距離が管路 ${pipe.id} の延長範囲と一致しません。`)
    }
    if (pipe && previousPoint && previousPoint.pipeId === source.pipeId && finite(previousPoint.distanceAlongPipe) && finite(source.distanceAlongPipe) && finite(interval) && interval >= 0) {
      const expected = source.distanceAlongPipe - previousPoint.distanceAlongPipe
      const tolerance = Math.max(0.5, Math.abs(expected) * 0.01)
      if (expected < 0 || Math.abs(expected - interval) > tolerance) {
        pointIssues.push('DISTANCE_MISMATCH')
        addIssue('DISTANCE_MISMATCH', source.id, `測点 ${source.id} の水平距離 ${interval} m と、管路起点からの距離差 ${expected} m が一致しません。`)
      }
    }
    if (issues.some((issue) => issue.code === 'POINT_ORDER' && issue.pointId === source.id)) pointIssues.push('POINT_ORDER')

    const calculation = calculatedByPoint.get(source.id)
    const envelope = source.pipeId ? envelopeForPipe(transientRun, source.pipeId) : undefined
    const ratio = pipe && finite(source.distanceAlongPipe) && pipe.length > 0 ? source.distanceAlongPipe / pipe.length : undefined
    const hydraulicGrade = calculation?.hydraulicGrade ?? (ratio === undefined || !envelope ? undefined : interpolate(envelope.steady, ratio))
    const designPressureElevation = calculation?.designPressure === undefined || !finite(source.pipeCenterElevation)
      ? undefined
      : source.pipeCenterElevation + mpaToHead(calculation.designPressure)
    points.push({
      id: source.id,
      ...(source.name === undefined ? {} : { name: source.name }),
      sequence: source.sequence,
      distance: cumulativeDistance,
      ...(finite(source.distanceAlongPipe) ? { distanceAlongPipe: source.distanceAlongPipe } : {}),
      ...(source.pipeId === undefined ? {} : { pipeId: source.pipeId }),
      ...(source.nodeId === undefined ? {} : { nodeId: source.nodeId }),
      ...(pipe === undefined ? {} : { pipeDiameter: pipe.innerDiameter }),
      ...(finite(source.groundElevation) ? { groundElevation: source.groundElevation } : {}),
      ...(finite(source.pipeCenterElevation) ? { pipeCenterElevation: source.pipeCenterElevation } : {}),
      ...(hydraulicGrade === undefined ? {} : { hydraulicGradeElevation: hydraulicGrade }),
      ...(ratio === undefined || !envelope ? {} : {
        ...(interpolate(envelope.maximum, ratio) === undefined ? {} : { maximumHeadElevation: interpolate(envelope.maximum, ratio) }),
        ...(interpolate(envelope.minimum, ratio) === undefined ? {} : { minimumHeadElevation: interpolate(envelope.minimum, ratio) }),
      }),
      ...(designPressureElevation === undefined ? {} : { designPressureElevation }),
      issueCodes: [...new Set(pointIssues)],
    })
    previousPoint = source
  }

  const resultRunIds = [...new Set([longitudinalRun?.id, transientRun?.id].filter((id): id is string => id !== undefined))]
  return {
    points,
    pipeSpans: pipeSpans(points),
    issues,
    resultRunIds,
    hasCalculationResults: points.some((point) => point.hydraulicGradeElevation !== undefined || point.maximumHeadElevation !== undefined || point.minimumHeadElevation !== undefined || point.designPressureElevation !== undefined),
  }
}
