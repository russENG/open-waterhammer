import type { JsonValue, RunKind } from '@open-waterhammer/contracts'

export type EngineeringTarget = 'model' | 'event' | 'boundary' | 'protection'

export interface EngineeringField {
  target: EngineeringTarget
  path: string
  label: string
  unit?: string
  kind: 'number' | 'text' | 'select'
  options?: Array<{ value: string; label: string }>
  required?: boolean
  minimum?: number
  exclusiveMinimum?: number
}

export interface EngineeringState {
  model: JsonValue
  event: JsonValue
  boundary: JsonValue
  protection: JsonValue
}

const numeric = (target: EngineeringTarget, path: string, label: string, unit: string, options: Pick<EngineeringField, 'required' | 'minimum' | 'exclusiveMinimum'> = { required: true, exclusiveMinimum: 0 }): EngineeringField => ({ target, path, label, unit, kind: 'number', ...options })
const text = (target: EngineeringTarget, path: string, label: string, required = true): EngineeringField => ({ target, path, label, kind: 'text', required })
const select = (target: EngineeringTarget, path: string, label: string, options: EngineeringField['options']): EngineeringField => ({ target, path, label, kind: 'select', options, required: true })
const pipeFields = (): EngineeringField[] => [
  numeric('model', 'pipe.innerDiameter', '管内径', 'm'),
  numeric('model', 'pipe.wallThickness', '管厚', 'm'),
  numeric('model', 'pipe.length', '管路延長', 'm'),
  text('model', 'pipe.id', '管路 ID'),
]
const networkFields = (): EngineeringField[] => [
  numeric('model', 'pipes.0.innerDiameter', '第1管路 内径', 'm'),
  numeric('model', 'pipes.0.length', '第1管路 延長', 'm'),
  numeric('model', 'pipes.0.roughnessC', 'Hazen–Williams C', '—'),
  numeric('model', 'nodes.0.head', '上流水頭', 'm'),
]
const mocNetworkFields = (): EngineeringField[] => [
  numeric('model', 'network.pipes.0.pipe.innerDiameter', '第1管路 内径', 'm'),
  numeric('model', 'network.pipes.0.pipe.length', '第1管路 延長', 'm'),
  numeric('model', 'network.pipes.0.nReaches', '計算区間数', '区間', { required: true, minimum: 1 }),
  numeric('model', 'options.tMax', '解析時間', 's'),
]

export const ENGINEERING_FIELDS: Record<RunKind, EngineeringField[]> = {
  wave_speed: [
    ...pipeFields(),
    select('model', 'pipe.pipeType', '管種', [{ value: 'ductile_iron', label: 'ダクタイル鋳鉄管' }, { value: 'upvc', label: '硬質塩化ビニル管' }, { value: 'steel', label: '鋼管' }]),
  ],
  joukowsky_allievi: [
    numeric('model', 'calculationCase.initialVelocity', '初期流速', 'm/s'),
    numeric('model', 'calculationCase.initialHead', '初期水頭', 'm'),
    numeric('event', 'closeTime', '閉鎖時間', 's'),
    numeric('model', 'pipe.innerDiameter', '管内径', 'm'),
  ],
  empirical_pressure: [
    select('model', 'systemType', '送配水方式', [
      { value: 'gravity_open', label: '自然圧送 オープン' },
      { value: 'gravity_closed', label: '自然圧送 クローズド' },
      { value: 'gravity_semi_closed', label: '自然圧送 セミクローズド' },
      { value: 'pump_distribution_tank', label: 'ポンプ 配水槽' },
      { value: 'pump_direct', label: 'ポンプ 直送' },
      { value: 'pump_pressure_tank', label: 'ポンプ 圧力タンク' },
    ]),
    numeric('model', 'staticPressureMpa', '静水圧', 'MPa'),
    numeric('model', 'operatingPressureMpa', '通水圧', 'MPa', { required: false, minimum: 0 }),
    numeric('model', 'hydraulicGradePressureMpa', '動水勾配線水圧', 'MPa', { required: false, minimum: 0 }),
  ],
  steady_single_pipe: [
    numeric('model', 'innerDiameter', '管内径', 'm'), numeric('model', 'length', '管路延長', 'm'),
    numeric('model', 'flowRate', '流量', 'm³/s'), numeric('model', 'roughnessC', 'Hazen–Williams C', '—'),
    numeric('model', 'upstreamElevation', '上流標高', 'm', { required: true }),
  ],
  steady_network_python: networkFields(),
  steady_network_epanet: networkFields(),
  longitudinal_hydraulics: [
    numeric('model', 'staticWaterLevel', '静水位', 'm', { required: true }),
    numeric('model', 'points.0.flowRate', '始点流量', 'm³/s'),
    numeric('model', 'points.0.diameter', '始点管径', 'm'),
    numeric('model', 'waterhammerRatio', '水撃圧比', '—', { required: false, minimum: 0 }),
  ],
  transient_single_pipe: [
    ...pipeFields(), numeric('event', 'waveSpeed', '波速', 'm/s'), numeric('event', 'initialVelocity', '初期流速', 'm/s'),
    numeric('event', 'initialDownstreamHead', '下流初期水頭', 'm', { required: true }), numeric('event', 'closeTime', '閉鎖時間', 's'),
  ],
  transient_network: mocNetworkFields(),
  transient_pump: [
    ...pipeFields(), numeric('event', 'Q0', '定格流量', 'm³/s'), numeric('event', 'pumpHead', 'ポンプ揚程', 'm'),
    numeric('event', 'shutdownTime', '停止時間', 's', { required: true, minimum: 0 }),
  ],
  transient_protection_device: [
    ...mocNetworkFields(), numeric('model', 'network.nodes.V-01.tankArea', 'サージタンク面積', 'm²'),
    numeric('model', 'network.nodes.V-01.initialLevel', '初期水位', 'm', { required: true }),
  ],
}

function segments(path: string): Array<string | number> {
  return path.split('.').map((part) => /^\d+$/.test(part) ? Number(part) : part)
}

export function readEngineeringValue(state: EngineeringState, field: Pick<EngineeringField, 'target' | 'path'>): JsonValue | undefined {
  let current: unknown = state[field.target]
  for (const segment of segments(field.path)) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string | number, unknown>)[segment]
  }
  return current as JsonValue | undefined
}

export function updateEngineeringValue(state: EngineeringState, field: Pick<EngineeringField, 'target' | 'path'>, value: JsonValue): EngineeringState {
  const next = structuredClone(state)
  const root = next[field.target]
  if (!root || typeof root !== 'object') next[field.target] = {}
  let current = next[field.target] as Record<string | number, JsonValue>
  const path = segments(field.path)
  for (const [index, segment] of path.entries()) {
    if (index === path.length - 1) current[segment] = value
    else {
      const following = path[index + 1]
      if (!current[segment] || typeof current[segment] !== 'object') current[segment] = typeof following === 'number' ? [] : {}
      current = current[segment] as Record<string | number, JsonValue>
    }
  }
  return next
}

export function validateEngineeringState(kind: RunKind, state: EngineeringState): Array<{ path: string; message: string }> {
  return ENGINEERING_FIELDS[kind].flatMap((field) => {
    const value = readEngineeringValue(state, field)
    if (field.required && (value === undefined || value === null || value === '')) return [{ path: field.path, message: `${field.label}は必須です。` }]
    if (value === undefined || value === null || value === '') return []
    if (field.kind === 'select' && !field.options?.some((option) => option.value === value)) {
      return [{ path: field.path, message: `${field.label}は一覧から選択してください。` }]
    }
    if (field.kind === 'number') {
      const number = Number(value)
      if (!Number.isFinite(number)) return [{ path: field.path, message: `${field.label}は有限の数値が必要です。` }]
      if (field.exclusiveMinimum !== undefined && number <= field.exclusiveMinimum) return [{ path: field.path, message: `${field.label}は${field.exclusiveMinimum}より大きい値が必要です。` }]
      if (field.minimum !== undefined && number < field.minimum) return [{ path: field.path, message: `${field.label}は${field.minimum}以上が必要です。` }]
    }
    return []
  })
}
