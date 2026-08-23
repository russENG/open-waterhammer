import { RUN_KINDS, type JsonValue, type RunKind } from '@open-waterhammer/contracts'

import { SAMPLE_RUN_INPUTS } from './sample-workspace'

export type EngineeringTarget = 'model' | 'event' | 'boundary' | 'protection'

export interface EngineeringField {
  target: EngineeringTarget
  path: string
  label: string
  unit?: string
  kind: 'number' | 'text' | 'select' | 'boolean'
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

export interface EngineeringCollection {
  target: EngineeringTarget
  path: string
  label: string
  itemTemplate: JsonValue
  minimumItems: number
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

const FIELD_OVERRIDES: Record<RunKind, EngineeringField[]> = {
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

const EVENT_TEMPLATES: Record<RunKind, JsonValue> = {
  wave_speed: { closeTime: 2 },
  joukowsky_allievi: { closeTime: 2 },
  empirical_pressure: {},
  steady_single_pipe: {},
  steady_network_python: {},
  steady_network_epanet: {},
  longitudinal_hydraulics: {},
  transient_single_pipe: {
    waveSpeed: 1100, initialVelocity: 1, initialDownstreamHead: 30,
    closeTime: 2, nReaches: 10, tMax: 8, operation: 'close',
  },
  transient_network: {},
  transient_pump: {
    mode: 'trip', waveSpeed: 1100, Q0: 0.07, pumpHead: 50,
    shutdownTime: 0.5, checkValve: true, nReaches: 10, tMax: 8,
  },
  transient_protection_device: {},
}

const PROTECTION_TEMPLATES: Record<RunKind, JsonValue> = Object.fromEntries(RUN_KINDS.map((kind) => [kind, kind === 'transient_protection_device'
  ? { devices: [{ id: 'V-01', type: 'surge_tank', enabled: true, tankArea: 4, initialLevel: 30 }] }
  : {}])) as Record<RunKind, JsonValue>

export const ENGINEERING_TEMPLATES = Object.fromEntries(RUN_KINDS.map((kind) => [kind, {
  model: structuredClone(SAMPLE_RUN_INPUTS[kind]),
  event: structuredClone(EVENT_TEMPLATES[kind]),
  boundary: {},
  protection: structuredClone(PROTECTION_TEMPLATES[kind]),
}])) as Record<RunKind, EngineeringState>

const LABELS: Record<string, string> = {
  caseName: '解析ケース名', id: 'ID', name: '名称', pipeType: '管種',
  startNodeId: '始点節点 ID', endNodeId: '終点節点 ID', upstreamNodeId: '上流節点 ID', downstreamNodeId: '下流節点 ID',
  innerDiameter: '管内径', wallThickness: '管厚', length: '管路延長', roughnessCoeff: '粗度係数 C', roughnessC: 'Hazen–Williams C',
  method: '計算方式', flowRate: '流量', upstreamElevation: '上流標高', downstreamElevation: '下流標高',
  elevation: '標高', type: '種別', head: '水頭', demand: '需要流量', minorLossCoeff: '局部損失係数',
  horizontalDistance: '水平距離', groundLevel: '地盤高', pipeCenterHeight: '管中心高', pipeLength: '区間長', diameter: '管径',
  bendLossCoeff: '曲管損失係数', valveLossCoeff: '弁損失係数', branchLossCoeff: '分岐損失係数', staticWaterLevel: '静水位',
  waterhammerRatio: '水撃圧比', systemType: '送配水方式', staticPressureMpa: '静水圧', operatingPressureMpa: '通水圧', hydraulicGradePressureMpa: '動水勾配線水圧',
  operationType: '操作種別', targetFacilityId: '対象施設 ID', initialVelocity: '初期流速', initialHead: '初期水頭',
  closeTime: '閉鎖時間', waveSpeed: '波速', initialDownstreamHead: '下流初期水頭', nReaches: '計算区間数', tMax: '解析時間', operation: '操作',
  initialFlow: '初期流量', mode: 'ポンプ操作', Q0: '定格流量', pumpHead: 'ポンプ揚程', shutdownTime: '停止時間', checkValve: '逆止弁',
  tankArea: 'タンク面積', initialLevel: '初期水位', datum: '基準標高', enabled: '有効',
}

const UNITS: Record<string, string> = {
  innerDiameter: 'm', wallThickness: 'm', length: 'm', flowRate: 'm³/s', upstreamElevation: 'm', downstreamElevation: 'm',
  elevation: 'm', head: 'm', demand: 'm³/s', horizontalDistance: 'm', groundLevel: 'm', pipeCenterHeight: 'm', pipeLength: 'm', diameter: 'm',
  staticWaterLevel: 'm', initialHead: 'm', initialDownstreamHead: 'm', pumpHead: 'm', initialLevel: 'm', datum: 'm',
  initialVelocity: 'm/s', waveSpeed: 'm/s', initialFlow: 'm³/s', Q0: 'm³/s', tankArea: 'm²',
  closeTime: 's', tMax: 's', shutdownTime: 's', staticPressureMpa: 'MPa', operatingPressureMpa: 'MPa', hydraulicGradePressureMpa: 'MPa',
  roughnessCoeff: '—', roughnessC: '—', minorLossCoeff: '—', bendLossCoeff: '—', valveLossCoeff: '—', branchLossCoeff: '—', waterhammerRatio: '—', nReaches: '区間',
}

const OPTIONAL_KEYS = new Set([
  'name', 'caseName', 'startNodeId', 'endNodeId', 'minorLossCoeff', 'head', 'demand',
  'waterhammerRatio', 'operatingPressureMpa', 'hydraulicGradePressureMpa', 'initialFlow',
  'closeTime', 'tMax', 'shutdownTime', 'checkValve', 'datum',
])

const POSITIVE_KEYS = new Set(['innerDiameter', 'wallThickness', 'length', 'diameter', 'roughnessCoeff', 'roughnessC', 'waveSpeed', 'nReaches', 'tankArea'])
const NONNEGATIVE_KEYS = new Set(['minorLossCoeff', 'bendLossCoeff', 'valveLossCoeff', 'branchLossCoeff', 'closeTime', 'tMax', 'shutdownTime', 'staticPressureMpa', 'operatingPressureMpa', 'hydraulicGradePressureMpa'])

function normalizeArrayPath(path: string): string {
  return path.replace(/\.\d+(?=\.|$)/g, '.0')
}

function leafKey(path: string): string {
  return path.split('.').at(-1) ?? path
}

function contextualLabel(path: string, base: string): string {
  const pipe = path.match(/(?:^|\.)pipes\.(\d+)/)
  if (pipe) return `管路 ${Number(pipe[1]) + 1} · ${base === 'ID' ? '管路 ID' : base}`
  const node = path.match(/(?:^|\.)nodes\.(\d+)/)
  if (node) return `節点 ${Number(node[1]) + 1} · ${base === 'ID' ? '節点 ID' : base}`
  const point = path.match(/(?:^|\.)points\.(\d+)/)
  if (point) return `測点 ${Number(point[1]) + 1} · ${base === 'ID' ? '測点 ID' : base}`
  const mappedNode = path.match(/network\.nodes\.([^.]+)/)
  if (mappedNode) return `節点 ${mappedNode[1]} · ${base}`
  if (path.startsWith('pipe.') && base === 'ID') return '管路 ID'
  if (path.startsWith('calculationCase.') && base === 'ID') return '計算ケース ID'
  return base
}

function selectOptions(path: string): EngineeringField['options'] | undefined {
  const key = leafKey(path)
  if (key === 'pipeType') return [{ value: 'ductile_iron', label: 'ダクタイル鋳鉄管' }, { value: 'upvc', label: '硬質塩化ビニル管' }, { value: 'steel', label: '鋼管' }]
  if (key === 'method') return [{ value: 'hazen-williams', label: 'Hazen–Williams' }, { value: 'darcy-weisbach', label: 'Darcy–Weisbach' }]
  if (key === 'systemType') return FIELD_OVERRIDES.empirical_pressure[0]!.options
  if (key === 'operationType') return [{ value: 'valve_close', label: '弁閉鎖' }, { value: 'pump_trip', label: 'ポンプ停止' }, { value: 'pump_start', label: 'ポンプ始動' }]
  if (key === 'operation') return [{ value: 'close', label: '閉鎖' }, { value: 'open', label: '開放' }]
  if (key === 'mode') return [{ value: 'trip', label: '停止' }, { value: 'start', label: '始動' }]
  if (key === 'type' && path.includes('network.nodes.')) return [
    { value: 'reservoir', label: '貯水槽' }, { value: 'valve', label: '弁' }, { value: 'pump', label: 'ポンプ' },
    { value: 'surge_tank', label: 'サージタンク' }, { value: 'air_chamber', label: '空気室' },
    { value: 'air_release_valve', label: '吸気弁' }, { value: 'pressure_reducing_valve', label: '減圧弁' }, { value: 'dead_end', label: '閉端' },
  ]
  if (key === 'type' && path.includes('devices.')) return [{ value: 'surge_tank', label: 'サージタンク' }, { value: 'air_chamber', label: '空気室' }]
  if (key === 'type') return [{ value: 'reservoir', label: '貯水槽' }, { value: 'junction', label: '接合点' }, { value: 'demand', label: '需要点' }]
  return undefined
}

function descriptorFor(kind: RunKind, target: EngineeringTarget, path: string, templateValue: JsonValue): EngineeringField {
  const override = FIELD_OVERRIDES[kind].find((field) => field.target === target && normalizeArrayPath(field.path) === normalizeArrayPath(path))
  if (override) return { ...override, path, label: contextualLabel(path, override.label) }
  const key = leafKey(path)
  const options = typeof templateValue === 'string' ? selectOptions(path) : undefined
  const fieldKind: EngineeringField['kind'] = typeof templateValue === 'number' ? 'number' : typeof templateValue === 'boolean' ? 'boolean' : options ? 'select' : 'text'
  return {
    target, path, label: contextualLabel(path, LABELS[key] ?? key), kind: fieldKind,
    ...(UNITS[key] ? { unit: UNITS[key] } : {}),
    ...(options ? { options } : {}),
    required: !OPTIONAL_KEYS.has(key),
    ...(POSITIVE_KEYS.has(key) ? { exclusiveMinimum: 0 } : {}),
    ...(NONNEGATIVE_KEYS.has(key) ? { minimum: 0 } : {}),
  }
}

function collectFields(kind: RunKind, target: EngineeringTarget, template: JsonValue, current: JsonValue, path: string, fields: EngineeringField[]) {
  if (Array.isArray(template)) {
    const rows = Array.isArray(current) ? current : template
    rows.forEach((row, index) => collectFields(kind, target, template[index] ?? template[0]!, row, path ? `${path}.${index}` : String(index), fields))
    return
  }
  if (template && typeof template === 'object') {
    const currentRecord = current && typeof current === 'object' && !Array.isArray(current) ? current as Record<string, JsonValue> : {}
    for (const [key, child] of Object.entries(template)) {
      collectFields(kind, target, child, currentRecord[key] ?? child, path ? `${path}.${key}` : key, fields)
    }
    return
  }
  fields.push(descriptorFor(kind, target, path, template))
}

export function engineeringFieldsFor(kind: RunKind, state: EngineeringState): EngineeringField[] {
  const fields: EngineeringField[] = []
  for (const target of ['model', 'event', 'boundary', 'protection'] as const) {
    collectFields(kind, target, ENGINEERING_TEMPLATES[kind][target], state[target], '', fields)
  }
  for (const field of FIELD_OVERRIDES[kind]) {
    if (!fields.some((candidate) => candidate.target === field.target && normalizeArrayPath(candidate.path) === normalizeArrayPath(field.path))) fields.push(field)
  }
  return fields
}

function collectionLabel(path: string): string {
  const key = leafKey(path)
  return key === 'pipes' ? '管路' : key === 'nodes' ? '節点' : key === 'points' ? '測点' : key === 'devices' ? '防護設備' : LABELS[key] ?? key
}

function collectCollections(target: EngineeringTarget, value: JsonValue, path: string, collections: EngineeringCollection[]) {
  if (Array.isArray(value)) {
    if (value[0] !== undefined) collections.push({ target, path, label: collectionLabel(path), itemTemplate: structuredClone(value[0]), minimumItems: 1 })
    value.forEach((child, index) => collectCollections(target, child, path ? `${path}.${index}` : String(index), collections))
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) collectCollections(target, child, path ? `${path}.${key}` : key, collections)
  }
}

export const ENGINEERING_COLLECTIONS = Object.fromEntries(RUN_KINDS.map((kind) => {
  const collections: EngineeringCollection[] = []
  for (const target of ['model', 'event', 'boundary', 'protection'] as const) collectCollections(target, ENGINEERING_TEMPLATES[kind][target], '', collections)
  return [kind, collections]
})) as Record<RunKind, EngineeringCollection[]>

export const ENGINEERING_FIELDS = Object.fromEntries(RUN_KINDS.map((kind) => [kind, engineeringFieldsFor(kind, ENGINEERING_TEMPLATES[kind])])) as Record<RunKind, EngineeringField[]>

function mergeObject(template: JsonValue, current: JsonValue | undefined): JsonValue {
  if (!template || typeof template !== 'object' || Array.isArray(template)) return current ?? structuredClone(template)
  if (!current || typeof current !== 'object' || Array.isArray(current)) return structuredClone(template)
  return { ...structuredClone(template), ...structuredClone(current) }
}

export function createEngineeringState(kind: RunKind, model: JsonValue | undefined, scenario?: {
  eventSettings: JsonValue
  boundaryConditions: JsonValue
  protectionSettings: JsonValue
}): EngineeringState {
  const template = ENGINEERING_TEMPLATES[kind]
  return {
    model: model === undefined ? structuredClone(template.model) : structuredClone(model),
    event: mergeObject(template.event, scenario?.eventSettings),
    boundary: mergeObject(template.boundary, scenario?.boundaryConditions),
    protection: mergeObject(template.protection, scenario?.protectionSettings),
  }
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

export function removeEngineeringValue(state: EngineeringState, field: Pick<EngineeringField, 'target' | 'path'>): EngineeringState {
  const next = structuredClone(state)
  let current: unknown = next[field.target]
  const path = segments(field.path)
  for (const segment of path.slice(0, -1)) {
    if (!current || typeof current !== 'object') return next
    current = (current as Record<string | number, unknown>)[segment]
  }
  if (current && typeof current === 'object') delete (current as Record<string | number, unknown>)[path.at(-1)!]
  return next
}

export function addEngineeringCollectionItem(state: EngineeringState, collection: EngineeringCollection): EngineeringState {
  const current = readEngineeringValue(state, collection)
  const next = Array.isArray(current) ? structuredClone(current) : []
  next.push(structuredClone(collection.itemTemplate))
  return updateEngineeringValue(state, collection, next)
}

export function removeEngineeringCollectionItem(state: EngineeringState, collection: EngineeringCollection, index: number): EngineeringState {
  const current = readEngineeringValue(state, collection)
  if (!Array.isArray(current)) return state
  const next = structuredClone(current)
  next.splice(index, 1)
  return updateEngineeringValue(state, collection, next)
}

export function updateEngineeringFieldFromInput(state: EngineeringState, field: EngineeringField, raw: string | boolean): EngineeringState {
  if (field.kind === 'number') {
    return String(raw).trim() === '' ? removeEngineeringValue(state, field) : updateEngineeringValue(state, field, Number(raw))
  }
  if (field.kind === 'boolean') return updateEngineeringValue(state, field, Boolean(raw))
  return updateEngineeringValue(state, field, raw)
}

export function validateEngineeringState(kind: RunKind, state: EngineeringState): Array<{ path: string; message: string }> {
  const fieldErrors = engineeringFieldsFor(kind, state).flatMap((field) => {
    const value = readEngineeringValue(state, field)
    if (field.required && (value === undefined || value === null || (typeof value === 'string' && value.trim() === ''))) return [{ path: field.path, message: `${field.label}は必須です。` }]
    if (value === undefined || value === null || value === '') return []
    if (field.kind === 'select' && !field.options?.some((option) => option.value === value)) {
      return [{ path: field.path, message: `${field.label}は一覧から選択してください。` }]
    }
    if (field.kind === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) return [{ path: field.path, message: `${field.label}は有限の数値が必要です。` }]
      const number = value
      if (field.exclusiveMinimum !== undefined && number <= field.exclusiveMinimum) return [{ path: field.path, message: `${field.label}は${field.exclusiveMinimum}より大きい値が必要です。` }]
      if (field.minimum !== undefined && number < field.minimum) return [{ path: field.path, message: `${field.label}は${field.minimum}以上が必要です。` }]
    }
    if (field.kind === 'boolean' && typeof value !== 'boolean') return [{ path: field.path, message: `${field.label}は真偽値が必要です。` }]
    return []
  })
  const collectionErrors = ENGINEERING_COLLECTIONS[kind].flatMap((collection) => {
    const value = readEngineeringValue(state, collection)
    return !Array.isArray(value) || value.length < collection.minimumItems
      ? [{ path: collection.path, message: `${collection.label}は${collection.minimumItems}件以上必要です。` }]
      : []
  })
  return [...fieldErrors, ...collectionErrors]
}
