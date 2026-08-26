import type { JsonValue, Run } from '@open-waterhammer/contracts'

export const PRESSURE_WAVE_MAX_FRAMES = 600
export const PRESSURE_WAVE_MAX_SPATIAL_SAMPLES = 240

type JsonRecord = Record<string, JsonValue>

export interface PressureWavePipeFrame {
  pipeId: string
  heads: number[]
  minimum: number
  maximum: number
  average: number
}

export interface PressureWaveFrame {
  time: number
  pipes: Record<string, PressureWavePipeFrame>
  nodes: Record<string, number>
}

export interface PressureWaveAnimationData {
  runId: string
  frames: PressureWaveFrame[]
  pipeIds: string[]
  nodeIds: string[]
  minimumHead: number
  maximumHead: number
  sourceFrameCount: number
  sourceSpatialSampleCount: number
  frameLimit: number
  spatialSampleLimit: number
  framesReduced: boolean
  spatialSamplesReduced: boolean
}

function record(value: JsonValue | undefined): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined
}

function finiteNumbers(value: JsonValue | undefined): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item)) : []
}

function sampleIndexes(length: number, limit: number): number[] {
  if (length <= limit) return Array.from({ length }, (_, index) => index)
  const indexes = new Set<number>([0, length - 1])
  for (let index = 1; index < limit - 1; index += 1) indexes.add(Math.round(index * (length - 1) / (limit - 1)))
  return [...indexes].sort((left, right) => left - right)
}

function reducedValues(values: number[], limit: number): number[] {
  return sampleIndexes(values.length, limit).map((index) => values[index]!)
}

function nodeValuesAtTimes(nodes: JsonRecord | undefined, times: number[]): { values: Array<Record<string, number>>; ids: string[] } {
  const values = times.map(() => ({} as Record<string, number>))
  const ids: string[] = []
  for (const id of Object.keys(nodes ?? {}).sort()) {
    const output = record(nodes?.[id])
    const headSeries = output?.H
    if (!Array.isArray(headSeries)) continue
    let found = false
    headSeries.forEach((entry, index) => {
      let time: number | undefined
      let head: number | undefined
      if (typeof entry === 'number' && Number.isFinite(entry)) {
        time = times[index]
        head = entry
      } else {
        const item = record(entry)
        if (typeof item?.t === 'number' && Number.isFinite(item.t) && typeof item.H === 'number' && Number.isFinite(item.H)) {
          time = item.t
          head = item.H
        }
      }
      if (time === undefined || head === undefined) return
      const target = times.findIndex((candidate) => Math.abs(candidate - time!) <= 1e-9)
      if (target >= 0) {
        values[target]![id] = head
        found = true
      }
    })
    if (found) ids.push(id)
  }
  return { values, ids }
}

/**
 * 保存済み Run の出力だけを、描画上限付きの再生モデルへ変換する。
 * 数値解析の実行や入力データの更新は行わず、先頭・末尾を保持した等間隔抽出だけを行う。
 */
export function derivePressureWaveAnimation(
  run: Run,
  options: { maxFrames?: number; maxSpatialSamples?: number } = {},
): PressureWaveAnimationData | undefined {
  if (run.status !== 'succeeded') return undefined
  const timeSeries = record(run.timeSeries)
  const pipes = record(timeSeries?.pipes)
  if (!pipes) return undefined
  const maxFrames = Math.max(2, Math.floor(options.maxFrames ?? PRESSURE_WAVE_MAX_FRAMES))
  const maxSpatialSamples = Math.max(2, Math.floor(options.maxSpatialSamples ?? PRESSURE_WAVE_MAX_SPATIAL_SAMPLES))
  const snapshotsByTime = new Map<number, Record<string, number[]>>()
  const pipeIds: string[] = []
  let sourceSpatialSampleCount = 0
  let spatialSamplesReduced = false
  let minimumHead = Number.POSITIVE_INFINITY
  let maximumHead = Number.NEGATIVE_INFINITY

  for (const pipeId of Object.keys(pipes).sort()) {
    const snapshots = pipes[pipeId]
    if (!Array.isArray(snapshots)) continue
    let found = false
    for (const snapshotValue of snapshots) {
      const snapshot = record(snapshotValue)
      const time = snapshot?.t
      const heads = finiteNumbers(snapshot?.H)
      if (typeof time !== 'number' || !Number.isFinite(time) || !heads.length) continue
      found = true
      sourceSpatialSampleCount = Math.max(sourceSpatialSampleCount, heads.length)
      spatialSamplesReduced ||= heads.length > maxSpatialSamples
      for (const head of heads) {
        minimumHead = Math.min(minimumHead, head)
        maximumHead = Math.max(maximumHead, head)
      }
      const atTime = snapshotsByTime.get(time) ?? {}
      atTime[pipeId] = reducedValues(heads, maxSpatialSamples)
      snapshotsByTime.set(time, atTime)
    }
    if (found) pipeIds.push(pipeId)
  }
  if (!pipeIds.length || !snapshotsByTime.size) return undefined

  const sourceTimes = [...snapshotsByTime.keys()].sort((left, right) => left - right)
  const { values: allNodeValues, ids: nodeIds } = nodeValuesAtTimes(record(timeSeries?.nodes), sourceTimes)
  for (const nodeValues of allNodeValues) {
    for (const head of Object.values(nodeValues)) {
      minimumHead = Math.min(minimumHead, head)
      maximumHead = Math.max(maximumHead, head)
    }
  }
  const frameIndexes = sampleIndexes(sourceTimes.length, maxFrames)
  const frames = frameIndexes.map((sourceIndex): PressureWaveFrame => {
    const time = sourceTimes[sourceIndex]!
    const pipeValues = snapshotsByTime.get(time) ?? {}
    const framePipes: Record<string, PressureWavePipeFrame> = {}
    for (const [pipeId, heads] of Object.entries(pipeValues)) {
      const sum = heads.reduce((total, value) => total + value, 0)
      framePipes[pipeId] = {
        pipeId,
        heads,
        minimum: Math.min(...heads),
        maximum: Math.max(...heads),
        average: sum / heads.length,
      }
    }
    return { time, pipes: framePipes, nodes: allNodeValues[sourceIndex] ?? {} }
  })

  return {
    runId: run.id,
    frames,
    pipeIds,
    nodeIds,
    minimumHead,
    maximumHead,
    sourceFrameCount: sourceTimes.length,
    sourceSpatialSampleCount,
    frameLimit: maxFrames,
    spatialSampleLimit: maxSpatialSamples,
    framesReduced: sourceTimes.length > maxFrames,
    spatialSamplesReduced,
  }
}

/** 設計を支配する地点。管路IDと、その管路の起点からの位置比 (0〜1)。 */
export interface GoverningLocation {
  pipeId: string
  ratio: number
  /** 定常水頭からの最大振れ幅 [m]。上昇側・下降側の大きいほう。 */
  excursion: number
  /** 振れの向き。上昇側なら 'up'（設計内圧側）、下降側なら 'down'（負圧側）。 */
  direction: 'up' | 'down'
}

/**
 * 保存済み計算結果の包絡線から、設計を支配する地点を1つ選ぶ。
 *
 * 判定は「定常水頭からの振れ幅が最大の位置」。上昇側 (Hmax − H_steady) と
 * 下降側 (H_steady − Hmin) を同じ水頭 [m] の物差しで比べ、大きいほうを採る。
 * 上昇側が勝てば設計内圧を、下降側が勝てば負圧・水柱分離を検討すべき地点になる。
 *
 * 何も選択していないときに時系列へ出す既定地点として使う。以前の既定は
 * 「最初の管路の中央」で、工学的な意味がないうえに、なぜそこなのかも画面から
 * 分からなかった。
 *
 * 包絡線 (`summary.pipes[*].Hmax / Hmin / H_steady`) は計算エンジンが全区間で
 * 求めた値で、アニメーション用に間引く前の解像度を持つ。位置は配列の添字から
 * 比に直すので、間引かれたフレーム側とも `valueAtRatio` で突き合わせられる。
 */
export function deriveGoverningLocation(run: Run): GoverningLocation | undefined {
  const pipes = record(record(run.summary)?.pipes)
  if (!pipes) return undefined
  let best: GoverningLocation | undefined
  for (const pipeId of Object.keys(pipes).sort()) {
    const pipe = record(pipes[pipeId])
    if (!pipe) continue
    const steady = finiteNumbers(pipe.H_steady)
    const maximum = finiteNumbers(pipe.Hmax)
    const minimum = finiteNumbers(pipe.Hmin)
    const length = Math.min(steady.length, maximum.length, minimum.length)
    for (let index = 0; index < length; index += 1) {
      const up = maximum[index]! - steady[index]!
      const down = steady[index]! - minimum[index]!
      const excursion = Math.max(up, down)
      if (!Number.isFinite(excursion) || (best && excursion <= best.excursion)) continue
      best = { pipeId, ratio: length === 1 ? 0 : index / (length - 1), excursion, direction: up >= down ? 'up' : 'down' }
    }
  }
  return best
}

export function valueAtRatio(values: number[], ratio: number): number | undefined {
  if (!values.length) return undefined
  if (values.length === 1) return values[0]
  const position = Math.max(0, Math.min(1, ratio)) * (values.length - 1)
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  const weight = position - lower
  return values[lower]! + (values[upper]! - values[lower]!) * weight
}

export function pressureWaveColor(value: number | undefined, minimum: number, maximum: number): string {
  if (value === undefined || !Number.isFinite(value)) return '#7b8490'
  const ratio = maximum <= minimum ? 0.5 : Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)))
  const hue = 220 - ratio * 220
  return `hsl(${hue.toFixed(0)} 72% 43%)`
}
