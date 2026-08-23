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
  speedSeries?: { id: string; seconds: number[]; values: number[] }
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

function interpolateSpatialValue(values: number[], ratio: number | undefined): number {
  if (ratio === undefined || values.length === 1) return values.at(-1)!
  const position = ratio * (values.length - 1)
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  const weight = position - lower
  return values[lower]! + (values[upper]! - values[lower]!) * weight
}

/**
 * ノード（節点）の時刻付きサンプル列を { seconds, values } に変換する。
 * 永続化された Run の実体（packages/core-py の moc.py MocNodeResult / protocol.py の
 * _moc_output 経由）では、H（水頭）・N（ポンプ回転速度）等のノード時系列はいずれも
 * `[{ t, <key> }, ...]` の形（各要素が時刻を持つ）で記録される。
 * フラットな数値配列（他の時系列と同じ規約）で記録されているケースにも対応する。
 */
function timedSeries(value: JsonValue | undefined, key: string, dt: number): { seconds: number[]; values: number[] } | undefined {
  if (!Array.isArray(value) || !value.length) return undefined
  const seconds: number[] = []
  const values: number[] = []
  value.forEach((item, index) => {
    if (typeof item === 'number' && Number.isFinite(item)) {
      seconds.push(index * dt)
      values.push(item)
      return
    }
    const entry = record(item)
    const t = entry?.t
    const v = entry?.[key]
    if (typeof t === 'number' && typeof v === 'number' && Number.isFinite(t) && Number.isFinite(v)) {
      seconds.push(t)
      values.push(v)
    }
  })
  return values.length ? { seconds, values } : undefined
}

function nodeTrace(id: string, output: RecordValue, dt: number): RunVisuals['timeSeries'] {
  const series = timedSeries(output.H, 'H', dt)
  return series ? { id, ...series } : undefined
}

function findSpeedSeries(nodes: RecordValue | undefined, preferredId: string | undefined, dt: number): RunVisuals['speedSeries'] {
  if (!nodes) return undefined
  const ids = Object.keys(nodes).sort()
  const ordered = preferredId && ids.includes(preferredId) ? [preferredId, ...ids.filter((id) => id !== preferredId)] : ids
  for (const id of ordered) {
    const series = timedSeries(record(nodes[id])?.N, 'N', dt)
    if (series) return { id, ...series }
  }
  return undefined
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
  const nodeSeriesContainer = record(timeSeries?.nodes)
  const exactNode = focus?.timeSeriesId ? record(nodeSeriesContainer?.[focus.timeSeriesId]) : undefined
  const dt = typeof summary?.dt === 'number' ? summary.dt : 1
  if (focus?.timeSeriesId && exactNode) {
    derivedTimeSeries = nodeTrace(focus.timeSeriesId, exactNode, dt)
  }
  const pipeSeriesContainer = record(timeSeries?.pipes)
  const pipeSeriesId = focus?.timeSeriesId && Array.isArray(pipeSeriesContainer?.[focus.timeSeriesId])
    ? focus.timeSeriesId
    : Object.keys(pipeSeriesContainer ?? {}).sort().find((id) => Array.isArray(pipeSeriesContainer?.[id]))
  if (!derivedTimeSeries && pipeSeriesId) {
    const id = pipeSeriesId
    const snapshots = pipeSeriesContainer![id] as JsonValue[]
    const seconds: number[] = []
    const values: number[] = []
    for (const snapshotValue of snapshots) {
      const snapshot = record(snapshotValue)
      const heads = numbers(snapshot?.H)
      if (typeof snapshot?.t === 'number' && heads.length) {
        seconds.push(snapshot.t)
        values.push(interpolateSpatialValue(heads, cursorRatio(focus?.location, pipeLength(run, id, heads.length))))
      }
    }
    if (seconds.length) derivedTimeSeries = { id, seconds, values }
  }
  if (!derivedTimeSeries) {
    const nodeSeries = selectedRecord(nodeSeriesContainer, focus?.timeSeriesId)
    if (nodeSeries) {
      const [id, output] = nodeSeries
      derivedTimeSeries = nodeTrace(id, output, dt)
    }
  }
  if (!derivedTimeSeries) {
    const seconds = numbers(timeSeries?.seconds)
    const values = numbers(timeSeries?.pressureMpa)
    if (seconds.length && values.length) derivedTimeSeries = { id: focus?.timeSeriesId ?? 'series', seconds, values }
  }

  const speedSeries = findSpeedSeries(nodeSeriesContainer, focus?.timeSeriesId, dt)

  return {
    ...(envelope ? { envelope } : {}),
    ...(derivedTimeSeries ? { timeSeries: derivedTimeSeries } : {}),
    ...(speedSeries ? { speedSeries } : {}),
    ...(focus ? { profileCursorRatio: cursorRatio(focus.location, length) } : {}),
    summaryMetrics: numericLeaves(run.summary).slice(0, 80),
  }
}
