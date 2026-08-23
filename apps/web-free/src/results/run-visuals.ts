import type { JsonValue, Run } from '@open-waterhammer/contracts'
import type { LinkedFocus } from '../workspace/focus'

type RecordValue = Record<string, JsonValue>

export interface PlotLine {
  id: string
  distance: number[]
  steady: number[]
  maximum: number[]
  minimum: number[]
}

export interface RunVisuals {
  envelope?: PlotLine
  timeSeries?: { id: string; seconds: number[]; values: number[] }
  profileCursorRatio?: number
  summaryMetrics: Array<{ path: string; value: number }>
}

function record(value: JsonValue | undefined): RecordValue | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : undefined
}

function numbers(value: JsonValue | undefined): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item)) : []
}

function numericLeaves(value: JsonValue, prefix = ''): Array<{ path: string; value: number }> {
  if (typeof value === 'number' && Number.isFinite(value)) return [{ path: prefix, value }]
  if (Array.isArray(value)) return value.flatMap((child, index) => numericLeaves(child, `${prefix}[${index}]`))
  const object = record(value)
  if (!object) return []
  return Object.keys(object).sort().flatMap((key) => numericLeaves(object[key]!, prefix ? `${prefix}.${key}` : key))
}

function pipeLength(run: Run, pipeId: string, points: number): number {
  const parameters = record(run.manifest.numericParameters)
  const directPipe = record(parameters?.pipe)
  if (typeof directPipe?.length === 'number') return directPipe.length
  const network = record(parameters?.network)
  const pipes = Array.isArray(network?.pipes) ? network.pipes : []
  const found = pipes.map(record).find((pipe) => pipe?.id === pipeId)
  const nested = record(found?.pipe)
  const length = typeof nested?.length === 'number' ? nested.length : typeof found?.length === 'number' ? found.length : undefined
  return length ?? Math.max(points - 1, 1)
}

function selectedRecord(container: RecordValue | undefined, preferred?: string): [string, RecordValue] | undefined {
  if (!container) return undefined
  const key = preferred && record(container[preferred]) ? preferred : Object.keys(container).sort()[0]
  const value = key ? record(container[key]) : undefined
  return key && value ? [key, value] : undefined
}

function cursorRatio(location: string | undefined, length: number): number | undefined {
  if (!location || !(length > 0)) return undefined
  const station = location.match(/(\d+)\+(\d+(?:\.\d+)?)/)
  const distance = station ? Number(station[1]) * 1000 + Number(station[2]) : Number(location.match(/\d+(?:\.\d+)?/)?.[0])
  return Number.isFinite(distance) ? Math.max(0, Math.min(1, distance / length)) : undefined
}

export function deriveRunVisuals(run: Run, focus?: LinkedFocus): RunVisuals {
  const summary = record(run.summary)
  const selectedPipe = selectedRecord(record(summary?.pipes), focus?.envelopeSeriesId)
  let envelope: PlotLine | undefined
  let length = 1
  if (selectedPipe) {
    const [id, output] = selectedPipe
    const maximum = numbers(output.Hmax)
    const minimum = numbers(output.Hmin)
    const steady = numbers(output.H_steady)
    const count = Math.max(maximum.length, minimum.length, steady.length)
    length = pipeLength(run, id, count)
    if (count) envelope = {
      id,
      distance: Array.from({ length: count }, (_, index) => count === 1 ? 0 : index * length / (count - 1)),
      steady, maximum, minimum,
    }
  }

  const timeSeries = record(run.timeSeries)
  let derivedTimeSeries: RunVisuals['timeSeries']
  const pipeSeriesContainer = record(timeSeries?.pipes)
  const pipeSeriesId = focus?.timeSeriesId && Array.isArray(pipeSeriesContainer?.[focus.timeSeriesId])
    ? focus.timeSeriesId
    : Object.keys(pipeSeriesContainer ?? {}).sort().find((id) => Array.isArray(pipeSeriesContainer?.[id]))
  if (pipeSeriesId) {
    const id = pipeSeriesId
    const snapshots = pipeSeriesContainer![id] as JsonValue[]
    const seconds: number[] = []
    const values: number[] = []
    for (const snapshotValue of snapshots) {
      const snapshot = record(snapshotValue)
      const heads = numbers(snapshot?.H)
      if (typeof snapshot?.t === 'number' && heads.length) {
        seconds.push(snapshot.t)
        values.push(heads.at(-1)!)
      }
    }
    if (seconds.length) derivedTimeSeries = { id, seconds, values }
  }
  if (!derivedTimeSeries) {
    const nodeSeries = selectedRecord(record(timeSeries?.nodes), focus?.timeSeriesId)
    if (nodeSeries) {
      const [id, output] = nodeSeries
      const values = numbers(output.H)
      const dt = typeof summary?.dt === 'number' ? summary.dt : 1
      if (values.length) derivedTimeSeries = { id, seconds: values.map((_, index) => index * dt), values }
    }
  }
  if (!derivedTimeSeries) {
    const seconds = numbers(timeSeries?.seconds)
    const values = numbers(timeSeries?.pressureMpa)
    if (seconds.length && values.length) derivedTimeSeries = { id: focus?.timeSeriesId ?? 'series', seconds, values }
  }

  return {
    ...(envelope ? { envelope } : {}),
    ...(derivedTimeSeries ? { timeSeries: derivedTimeSeries } : {}),
    ...(focus ? { profileCursorRatio: cursorRatio(focus.location, length) } : {}),
    summaryMetrics: numericLeaves(run.summary).slice(0, 80),
  }
}
