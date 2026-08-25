import type { JsonValue, Run, RunKind } from '@open-waterhammer/contracts'

/**
 * 計算方式ごとの「答え」を、日本語ラベル・単位・有効桁つきで取り出す。
 *
 * かつては `run.summary` の数値リーフを機械的に走査して先頭2件を出していたため、
 * キーの並び順しだいで主要な結果が画面から消えていた（波速の計算なのに `alpha` と
 * `vibrationPeriod` だけが出て、肝心の波速が出ない、など）。
 * ここで方式ごとに「何を出すか」を明示し、定義のない方式だけ従来の自動抽出に落とす。
 */
export interface HeadlineMetric {
  label: string
  /** 数値の場合の表示値。文字列の指標（閉そく区分など）は `text` を使う。 */
  value?: number
  text?: string
  unit?: string
  /** 有効桁ではなく小数点以下の桁数。設計値としての読みやすさを優先する。 */
  digits?: number
}

type RecordValue = Record<string, JsonValue>

function asRecord(value: JsonValue | undefined): RecordValue | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : undefined
}

/** ドット区切りのパスで数値を取り出す。存在しない・数値でないなら undefined。 */
function num(summary: RecordValue, path: string): number | undefined {
  let current: JsonValue | undefined = summary
  for (const key of path.split('.')) {
    const object = asRecord(current)
    if (!object) return undefined
    current = object[key]
  }
  return typeof current === 'number' && Number.isFinite(current) ? current : undefined
}

function text(summary: RecordValue, path: string): string | undefined {
  let current: JsonValue | undefined = summary
  for (const key of path.split('.')) {
    const object = asRecord(current)
    if (!object) return undefined
    current = object[key]
  }
  return typeof current === 'string' ? current : undefined
}

/**
 * `summary.pipes.<id>.<key>` に入っている配列（管路の格子点ごとの値）から
 * 全管路をまたいだ最大・最小を取る。MOC 系はここに Hmax / Hmin が入る。
 */
function acrossPipes(summary: RecordValue, key: string, mode: 'max' | 'min'): number | undefined {
  const pipes = asRecord(summary.pipes)
  if (!pipes) return undefined
  const values: number[] = []
  for (const pipe of Object.values(pipes)) {
    const series = asRecord(pipe)?.[key]
    if (!Array.isArray(series)) continue
    for (const item of series) if (typeof item === 'number' && Number.isFinite(item)) values.push(item)
  }
  if (values.length === 0) return undefined
  return mode === 'max' ? Math.max(...values) : Math.min(...values)
}

const CLOSURE_LABELS: Record<string, string> = {
  rapid: '急閉そく',
  slow: '緩閉そく',
  numerical_required: '数値解析要',
}

function metric(label: string, value: number | undefined, unit: string, digits: number): HeadlineMetric | null {
  return value === undefined ? null : { label, value, unit, digits }
}

function build(kind: RunKind, summary: RecordValue): Array<HeadlineMetric | null> {
  switch (kind) {
    case 'wave_speed':
      return [
        metric('波速 a', num(summary, 'waveSpeed'), 'm/s', 1),
        metric('圧力振動周期 T₀', num(summary, 'vibrationPeriod'), 's', 3),
        metric('α = tν/T₀', num(summary, 'alpha'), '—', 3),
      ]
    case 'joukowsky_allievi': {
      const closure = text(summary, 'closureType')
      return [
        metric('水撃圧水頭 ΔH', num(summary, 'deltaHJoukowsky'), 'm', 2),
        metric('最大水頭 Hmax（アリエビ・閉）', num(summary, 'hmaxAllieviClose'), 'm', 2),
        metric('最大圧力低下（アリエビ・開）', num(summary, 'hmaxAllieviOpen'), 'm', 2),
        closure ? { label: '閉そく区分', text: CLOSURE_LABELS[closure] ?? closure } : null,
        metric('波速 a', num(summary, 'waveSpeed.waveSpeed'), 'm/s', 1),
      ]
    }
    case 'empirical_pressure':
      return [metric('水撃圧', num(summary, 'waterhammerMpa'), 'MPa', 3)]
    case 'steady_single_pipe':
      return [
        metric('平均流速 V', num(summary, 'velocity'), 'm/s', 3),
        metric('摩擦損失水頭 hf', num(summary, 'frictionLoss'), 'm', 3),
        metric('必要全揚程', num(summary, 'totalHead'), 'm', 3),
      ]
    case 'steady_network_python':
    case 'steady_network_epanet':
      return [
        metric('最大流速', acrossPipes(summary, 'velocity', 'max'), 'm/s', 3),
        metric('最小節点水頭', acrossPipes(summary, 'head', 'min'), 'm', 3),
      ]
    case 'longitudinal_hydraulics':
      return [
        metric('最大設計内圧 Pp', num(summary, 'maxDesignPressure'), 'MPa', 3),
        metric('最大流速 V', num(summary, 'maxVelocity'), 'm/s', 3),
        metric('静水位', num(summary, 'staticWaterLevel'), 'm', 3),
      ]
    case 'transient_single_pipe':
    case 'transient_network':
    case 'transient_pump':
    case 'transient_protection_device':
      return [
        metric('最大水頭 Hmax', acrossPipes(summary, 'Hmax', 'max'), 'm', 1),
        metric('最小水頭 Hmin', acrossPipes(summary, 'Hmin', 'min'), 'm', 1),
        metric('計算時間刻み Δt', num(summary, 'dt'), 's', 4),
      ]
  }
}

/**
 * 表示する主要指標を返す。方式ごとの定義に該当がなければ空配列。
 * 呼び出し側は空のときだけ `summaryMetrics` の自動抽出にフォールバックする。
 */
export function headlineMetrics(run: Run): HeadlineMetric[] {
  const summary = asRecord(run.summary)
  if (!summary) return []
  return build(run.kind, summary).filter((item): item is HeadlineMetric => item !== null)
}

/** 数値を表示用に丸める。桁数の指定がないときは有効数字5桁（従来と同じ）。 */
export function formatMetric(metricValue: HeadlineMetric): string {
  if (metricValue.text !== undefined) return metricValue.text
  if (metricValue.value === undefined) return '—'
  return metricValue.digits === undefined
    ? metricValue.value.toPrecision(5)
    : metricValue.value.toFixed(metricValue.digits)
}
