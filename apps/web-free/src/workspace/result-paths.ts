import type { JsonValue } from '@open-waterhammer/contracts'

import { engineeringKeyLabel, engineeringKeyUnit } from './engineering-fields'

/**
 * 計算結果・差分表の「JSONパスをそのまま画面に出す」問題への共通処理。
 *
 * 従来は `run.summary` を全リーフに平坦化して `PIPES.PIPE_0.HMAX[10]` のような
 * 内部パスを並べていた。時系列や包絡線は要素数が数百になるため、証跡パネルも
 * 比較タブも実質読めない状態だった（docs/ui-terminology.md に反する）。
 *
 * ここでは
 *  - 格子点ごとの配列は「最大 / 最小 / 件数」に要約する
 *  - 残ったパスは既知のキーを日本語ラベルへ写像する
 *  - null（適用外の項目）は行ごと落とす
 * の3点を行う。
 */

/**
 * JSON 値を「パス → リーフ値」の一覧に平坦化する。
 *
 * 比較タブ・証跡パネル・結果要約が共通で使うため、依存の向きが一方通行になるよう
 * ここに置く（`comparison.ts` は本モジュールから再輸出する）。
 */
export function flattenComparisonValue(value: JsonValue, prefix = ''): Array<[string, JsonValue]> {
  if (Array.isArray(value)) return value.flatMap((child, index) => flattenComparisonValue(child, `${prefix}[${index}]`))
  if (value && typeof value === 'object') return Object.keys(value).sort().flatMap((key) => flattenComparisonValue(value[key]!, prefix ? `${prefix}.${key}` : key))
  return [[prefix, value]]
}

/** 配列として持つが、要素そのものではなく最大・最小を見たい系列。 */
const SERIES_KEYS = new Set(['Hmax', 'Hmin', 'H_steady', 'H', 'Q', 'N', 'V_air', 'z', 'seconds', 'pressureMpa'])

export interface ResultRow {
  /** 表示用ラベル */
  label: string
  /** 表示用の値 */
  value: string
}

function leafKey(path: string): string {
  return path.replace(/\[\d+\]$/, '').split('.').at(-1) ?? path
}

/** `pipes.pipe_0.Hmax[3]` → `pipes.pipe_0.Hmax` のように添字を落とす。 */
function seriesPath(path: string): string | null {
  const match = path.match(/^(.*)\[\d+\]$/)
  if (!match) return null
  return SERIES_KEYS.has(leafKey(match[1]!)) ? match[1]! : null
}

/** JSONパスを読める見出しにする。既知のキーは辞書引きし、残りはそのまま繋ぐ。 */
export function describeResultPath(path: string): string {
  const segments = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
  // 中間の識別子（pipe_0 など）は辞書に無いのでそのまま残り、末尾のキーだけ日本語になる。
  return segments.map((segment) => engineeringKeyLabel(segment)).join(' · ')
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  const magnitude = Math.abs(value)
  if (magnitude !== 0 && (magnitude >= 1e6 || magnitude < 1e-3)) return value.toExponential(3)
  return Number(value.toPrecision(6)).toString()
}

/**
 * プロトコル上の列挙値を画面用の日本語にする。
 * 解析フォームの選択肢と同じ語を使い、画面ごとに用語がぶれないようにする。
 */
const ENUM_LABELS: Record<string, Record<string, string>> = {
  operationType: {
    valve_close: '弁閉鎖', valve_open: '弁開放',
    pump_stop: 'ポンプ停止', pump_start: 'ポンプ始動', combined: '複合操作',
  },
  operation: { close: '閉鎖', open: '開放' },
  closureType: { rapid: '急閉そく', slow: '緩閉そく', numerical_required: '数値解析要' },
  mode: { trip: 'ポンプ停止', start: 'ポンプ始動' },
  type: {
    reservoir: '貯水池・水源', junction: '分岐・接合点', tank: '水槽',
    valve: 'バルブ', pump: 'ポンプ', demand: '需要節点',
    air_chamber: '空気室', surge_tank: 'サージタンク', air_release_valve: '空気弁',
  },
}

function formatValue(path: string, value: JsonValue): string {
  if (typeof value === 'number') return formatNumber(value)
  if (typeof value === 'boolean') return value ? 'あり' : 'なし'
  if (typeof value === 'string') return ENUM_LABELS[leafKey(path)]?.[value] ?? value
  return String(value)
}

/** 値と単位をまとめて表示用の文字列にする（一覧・差分表・証跡パネルで共通）。 */
export function describeResultValue(path: string, value: JsonValue): string {
  return withUnit(path, formatValue(path, value))
}

function withUnit(path: string, text: string): string {
  const unit = engineeringKeyUnit(leafKey(path))
  return unit ? `${text} ${unit}` : text
}

/**
 * `run.summary` を表示用の行に畳む。
 *
 * 配列は最大・最小・件数の1行に要約し、`null`（適用外）の項目は落とす。
 */
export function summariseResult(summary: JsonValue): ResultRow[] {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return []
  const series = new Map<string, number[]>()
  const scalars: ResultRow[] = []

  for (const [path, value] of flattenComparisonValue(summary)) {
    const container = seriesPath(path)
    if (container !== null) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        const bucket = series.get(container) ?? []
        bucket.push(value)
        series.set(container, bucket)
      }
      continue
    }
    // 適用外の項目（急閉そくケースのアリエビ値など）は行ごと出さない。
    if (value === null || value === undefined) continue
    scalars.push({ label: describeResultPath(path), value: describeResultValue(path, value) })
  }

  const seriesRows = [...series.entries()].map(([path, values]): ResultRow => ({
    label: describeResultPath(path),
    value: withUnit(path, `最大 ${formatNumber(Math.max(...values))} / 最小 ${formatNumber(Math.min(...values))}（${values.length}点）`),
  }))

  return [...scalars, ...seriesRows]
}

/**
 * 差分表で行として出す価値があるパスかどうか。
 *
 * 時系列・包絡線の要素まで差分に並べると、1つの計算結果で数百行になって
 * 比較タブがスクロールできなくなる。系列は `summariseResult` 側の要約に任せる。
 */
export function isComparablePath(path: string): boolean {
  if (/\[\d+\]/.test(path)) return SERIES_KEYS.has(leafKey(path)) ? false : true
  return true
}

/** 判定ルールの内部IDを、画面に出せる名前へ写像する（docs/ui-terminology.md）。 */
const FINDING_RULE_LABELS: Record<string, string> = {
  'judge_design_pressure/8.3.2': '設計水圧の判定（技術書 §8.3.2）',
  'negative_pressure/8.4': '負圧の判定（水柱分離の検討）',
}

export function findingRuleLabel(ruleId: string): string {
  return FINDING_RULE_LABELS[ruleId] ?? ruleId
}

/** 指摘事項の数値。設計値として読める桁に丸める（生の倍精度をそのまま出さない）。 */
export function formatFindingValue(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(3) : String(value)
}
