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
  kind: 'array' | 'record'
  itemTemplate: JsonValue
  keyTemplate?: string
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
  H0: '定格水頭', H0v: '初期水頭', Hs: '締切水頭', GD2: 'GD²', N0: '定格回転速度', eta0: '定格効率',
  startupTime: '起動時間', staticHead: '静水頭', V_air0: '初期空気容積', H_air0: '初期空気水頭', polytropicIndex: 'ポリトロープ指数',
  atmosphericHead: '大気圧水頭', setHead: '設定水頭', tankArea: 'タンク面積', initialLevel: '初期水位', datum: '基準標高', enabled: '有効',
}

const UNITS: Record<string, string> = {
  innerDiameter: 'm', wallThickness: 'm', length: 'm', flowRate: 'm³/s', upstreamElevation: 'm', downstreamElevation: 'm',
  elevation: 'm', head: 'm', demand: 'm³/s', horizontalDistance: 'm', groundLevel: 'm', pipeCenterHeight: 'm', pipeLength: 'm', diameter: 'm',
  staticWaterLevel: 'm', initialHead: 'm', initialDownstreamHead: 'm', pumpHead: 'm', initialLevel: 'm', datum: 'm',
  initialVelocity: 'm/s', waveSpeed: 'm/s', initialFlow: 'm³/s', Q0: 'm³/s', tankArea: 'm²',
  closeTime: 's', tMax: 's', shutdownTime: 's', staticPressureMpa: 'MPa', operatingPressureMpa: 'MPa', hydraulicGradePressureMpa: 'MPa',
  H0: 'm', H0v: 'm', Hs: 'm', startupTime: 's', staticHead: 'm', V_air0: 'm³', H_air0: 'm', atmosphericHead: 'm', setHead: 'm',
  GD2: 'N·m²', N0: 'min⁻¹', eta0: '—', polytropicIndex: '—',
  roughnessCoeff: '—', roughnessC: '—', minorLossCoeff: '—', bendLossCoeff: '—', valveLossCoeff: '—', branchLossCoeff: '—', waterhammerRatio: '—', nReaches: '区間',
}

const OPTIONAL_PATHS: Record<RunKind, Set<string>> = {
  wave_speed: new Set(['model.pipe.name', 'model.pipe.startNodeId', 'model.pipe.endNodeId', 'event.closeTime']),
  joukowsky_allievi: new Set(['model.pipe.name', 'model.pipe.startNodeId', 'model.pipe.endNodeId']),
  empirical_pressure: new Set(['model.operatingPressureMpa', 'model.hydraulicGradePressureMpa']),
  steady_single_pipe: new Set(['model.method']),
  steady_network_python: new Set(['model.caseName', 'model.pipes.0.minorLossCoeff', 'model.nodes.0.head', 'model.nodes.0.demand']),
  steady_network_epanet: new Set(['model.caseName', 'model.pipes.0.minorLossCoeff', 'model.nodes.0.head', 'model.nodes.0.demand']),
  longitudinal_hydraulics: new Set(['model.caseName', 'model.waterhammerRatio']),
  transient_single_pipe: new Set([
    'model.pipe.name', 'model.pipe.startNodeId', 'model.pipe.endNodeId',
    'event.nReaches', 'event.tMax', 'event.operation',
  ]),
  transient_network: new Set([
    'model.network.pipes.0.pipe.name', 'model.network.pipes.0.pipe.startNodeId', 'model.network.pipes.0.pipe.endNodeId',
    'model.network.pipes.0.initialFlow', 'model.network.pipes.0.waveSpeed', 'model.options.tMax', 'model.options.initialFlow',
  ]),
  transient_pump: new Set([
    'model.pipe.name', 'model.pipe.startNodeId', 'model.pipe.endNodeId',
    'event.mode', 'event.waveSpeed', 'event.shutdownTime', 'event.checkValve', 'event.nReaches', 'event.tMax',
  ]),
  transient_protection_device: new Set([
    'model.network.pipes.0.pipe.name', 'model.network.pipes.0.pipe.startNodeId', 'model.network.pipes.0.pipe.endNodeId',
    'model.network.pipes.0.initialFlow', 'model.network.pipes.0.waveSpeed', 'model.options.tMax', 'model.options.initialFlow',
  ]),
}

const MOC_BOUNDARY_REQUIRED: Record<string, Set<string>> = {
  reservoir: new Set(['type', 'head']),
  valve: new Set(['type', 'Q0', 'H0v', 'closeTime']),
  pump: new Set(['type', 'Q0', 'H0', 'shutdownTime']),
  air_chamber: new Set(['type', 'V_air0', 'H_air0']),
  surge_tank: new Set(['type', 'tankArea', 'initialLevel']),
  air_release_valve: new Set(['type']),
  pressure_reducing_valve: new Set(['type', 'setHead', 'Q0']),
  dead_end: new Set(['type']),
}

const MOC_BOUNDARY_TEMPLATES: Record<string, JsonValue> = {
  reservoir: { type: 'reservoir', head: 80 },
  valve: { type: 'valve', Q0: 0.07, H0v: 30, closeTime: 2, operation: 'close' },
  pump: {
    type: 'pump', Q0: 0.07, H0: 50, shutdownTime: 0.5, Hs: 60, GD2: 100,
    N0: 1450, eta0: 0.8, mode: 'trip', startupTime: 0.5, staticHead: 0, checkValve: true,
  },
  air_chamber: { type: 'air_chamber', V_air0: 2, H_air0: 30, polytropicIndex: 1.2 },
  surge_tank: { type: 'surge_tank', tankArea: 4, initialLevel: 30, datum: 0 },
  air_release_valve: { type: 'air_release_valve', atmosphericHead: 10.33 },
  pressure_reducing_valve: { type: 'pressure_reducing_valve', setHead: 30, Q0: 0.07 },
  dead_end: { type: 'dead_end' },
}

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
    required: true,
    ...(POSITIVE_KEYS.has(key) ? { exclusiveMinimum: 0 } : {}),
    ...(NONNEGATIVE_KEYS.has(key) ? { minimum: 0 } : {}),
  }
}

function requiredFor(kind: RunKind, state: EngineeringState, field: Pick<EngineeringField, 'target' | 'path'>): boolean {
  const boundary = field.target === 'model' && (kind === 'transient_network' || kind === 'transient_protection_device')
    ? field.path.match(/^network\.nodes\.([^.]+)\.([^.]+)$/)
    : null
  if (boundary) {
    const type = readEngineeringValue(state, { target: 'model', path: `network.nodes.${boundary[1]}.type` })
    return typeof type === 'string' ? MOC_BOUNDARY_REQUIRED[type]?.has(boundary[2]!) ?? false : boundary[2] === 'type'
  }
  return !OPTIONAL_PATHS[kind].has(`${field.target}.${normalizeArrayPath(field.path)}`)
}

function collectFields(kind: RunKind, target: EngineeringTarget, template: JsonValue, current: JsonValue, path: string, fields: EngineeringField[]) {
  if (Array.isArray(template)) {
    const rows = Array.isArray(current) ? current : template
    rows.forEach((row, index) => collectFields(kind, target, template[index] ?? template[0]!, row, path ? `${path}.${index}` : String(index), fields))
    return
  }
  if (template && typeof template === 'object') {
    const currentRecord = current && typeof current === 'object' && !Array.isArray(current) ? current as Record<string, JsonValue> : {}
    if (target === 'model' && path === 'network.nodes') {
      const templates = Object.values(template)
      for (const [key, row] of Object.entries(currentRecord)) {
        const rowType = row && typeof row === 'object' && !Array.isArray(row) ? row.type : undefined
        const matching = (typeof rowType === 'string' ? MOC_BOUNDARY_TEMPLATES[rowType] : undefined)
          ?? templates.find((candidate) => candidate && typeof candidate === 'object' && !Array.isArray(candidate) && candidate.type === rowType)
          ?? templates[0] ?? row
        collectFields(kind, target, matching, row, `${path}.${key}`, fields)
      }
      return
    }
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
  return fields.map((field) => ({ ...field, required: requiredFor(kind, state, field) }))
}

function collectionLabel(path: string): string {
  const key = leafKey(path)
  return key === 'pipes' ? '管路' : key === 'nodes' ? '節点' : key === 'points' ? '測点' : key === 'devices' ? '防護設備' : LABELS[key] ?? key
}

function collectCollections(target: EngineeringTarget, value: JsonValue, path: string, collections: EngineeringCollection[]) {
  if (Array.isArray(value)) {
    if (value[0] !== undefined) collections.push({ target, path, label: collectionLabel(path), kind: 'array', itemTemplate: structuredClone(value[0]), minimumItems: 1 })
    value.forEach((child, index) => collectCollections(target, child, path ? `${path}.${index}` : String(index), collections))
    return
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
    if (target === 'model' && path === 'network.nodes' && entries[0]) {
      collections.push({
        target, path, label: collectionLabel(path), kind: 'record', keyTemplate: entries[0][0],
        itemTemplate: structuredClone(entries[0][1]), minimumItems: 1,
      })
    }
    for (const [key, child] of entries) collectCollections(target, child, path ? `${path}.${key}` : key, collections)
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

function uniqueIdentifier(existing: string[], template: string): string {
  const used = new Set(existing)
  if (!used.has(template)) return template
  const suffix = template.match(/^(.*?)(\d+)$/)
  const stem = suffix?.[1] ?? `${template}-`
  const width = suffix?.[2]?.length ?? 1
  let sequence = suffix ? Number(suffix[2]) + 1 : 2
  let candidate = `${stem}${String(sequence).padStart(width, '0')}`
  while (used.has(candidate)) {
    sequence += 1
    candidate = `${stem}${String(sequence).padStart(width, '0')}`
  }
  return candidate
}

export function addEngineeringCollectionItem(state: EngineeringState, collection: EngineeringCollection): EngineeringState {
  const current = readEngineeringValue(state, collection)
  if (collection.kind === 'record') {
    const next = current && typeof current === 'object' && !Array.isArray(current)
      ? structuredClone(current) as Record<string, JsonValue> : {}
    const key = uniqueIdentifier(Object.keys(next), collection.keyTemplate ?? 'N-01')
    next[key] = structuredClone(collection.itemTemplate)
    return updateEngineeringValue(state, collection, next)
  }
  const next = Array.isArray(current) ? structuredClone(current) : []
  const item = structuredClone(collection.itemTemplate)
  if (item && typeof item === 'object' && !Array.isArray(item) && typeof item.id === 'string') {
    const existingIds = next.flatMap((row) => row && typeof row === 'object' && !Array.isArray(row) && typeof row.id === 'string' ? [row.id] : [])
    const originalId = item.id
    item.id = uniqueIdentifier(existingIds, originalId)
    if (item.pipe && typeof item.pipe === 'object' && !Array.isArray(item.pipe) && item.pipe.id === originalId) item.pipe.id = item.id
  }
  next.push(item)
  return updateEngineeringValue(state, collection, next)
}

const NODE_REFERENCE_KEYS = new Set(['upstreamNodeId', 'downstreamNodeId', 'startNodeId', 'endNodeId', 'nodeId', 'targetFacilityId'])

function containsReference(value: JsonValue, id: string): boolean {
  if (Array.isArray(value)) return value.some((child) => containsReference(child, id))
  if (!value || typeof value !== 'object') return false
  return Object.entries(value).some(([key, child]) => NODE_REFERENCE_KEYS.has(key) && child === id || containsReference(child, id))
}

function repairReferences(value: JsonValue, from: string, to: string): JsonValue {
  if (Array.isArray(value)) return value.map((child) => repairReferences(child, from, to))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key, NODE_REFERENCE_KEYS.has(key) && child === from ? to : repairReferences(child, from, to),
  ]))
}

export function renameEngineeringRecordKey(
  state: EngineeringState,
  collection: EngineeringCollection,
  from: string,
  to: string,
): EngineeringState {
  if (collection.kind !== 'record') throw new Error('Only object-keyed collections can be renamed')
  const trimmed = to.trim()
  if (!trimmed) throw new Error('A non-blank identifier is required')
  const current = readEngineeringValue(state, collection)
  if (!current || typeof current !== 'object' || Array.isArray(current) || !(from in current)) throw new Error(`Record key does not exist: ${from}`)
  if (trimmed !== from && trimmed in current) throw new Error(`Identifier already exists: ${trimmed}`)
  const renamed = Object.fromEntries(Object.entries(current).map(([key, value]) => [key === from ? trimmed : key, value])) as JsonValue
  const next = updateEngineeringValue(state, collection, renamed)
  return collection.target === 'model' && collection.path === 'network.nodes'
    ? { ...next, model: repairReferences(next.model, from, trimmed) }
    : next
}

export function removeEngineeringCollectionItem(state: EngineeringState, collection: EngineeringCollection, index: number | string): EngineeringState {
  const current = readEngineeringValue(state, collection)
  if (collection.kind === 'record') {
    if (!current || typeof current !== 'object' || Array.isArray(current) || typeof index !== 'string' || !(index in current)) return state
    if (collection.target === 'model' && collection.path === 'network.nodes' && containsReference(state.model, index)) {
      throw new Error(`${index} is referenced by a pipe and cannot be removed`)
    }
    const next = structuredClone(current) as Record<string, JsonValue>
    delete next[index]
    return updateEngineeringValue(state, collection, next)
  }
  if (!Array.isArray(current)) return state
  if (typeof index !== 'number') return state
  const row = current[index]
  if (collection.target === 'model' && collection.path === 'nodes' && row && typeof row === 'object' && !Array.isArray(row) && typeof row.id === 'string' && containsReference(state.model, row.id)) {
    throw new Error(`${row.id} is referenced by a pipe and cannot be removed`)
  }
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

function duplicateIdErrors(collection: EngineeringCollection, value: JsonValue | undefined): Array<{ path: string; message: string }> {
  if (collection.kind !== 'array' || !Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.id !== 'string') return []
    if (seen.has(row.id)) return [{ path: `${collection.path}.${index}.id`, message: `${collection.label} ID ${row.id} が重複しています。` }]
    seen.add(row.id)
    return []
  })
}

function nestedPipeIdErrors(kind: RunKind, state: EngineeringState): Array<{ path: string; message: string }> {
  if (kind !== 'transient_network' && kind !== 'transient_protection_device') return []
  const model = state.model && typeof state.model === 'object' && !Array.isArray(state.model) ? state.model : {}
  const network = model.network && typeof model.network === 'object' && !Array.isArray(model.network) ? model.network : undefined
  if (!Array.isArray(network?.pipes)) return []
  const seen = new Set<string>()
  return network.pipes.flatMap((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || !row.pipe || typeof row.pipe !== 'object' || Array.isArray(row.pipe) || typeof row.pipe.id !== 'string') return []
    if (seen.has(row.pipe.id)) return [{ path: `network.pipes.${index}.pipe.id`, message: `管路詳細 ID ${row.pipe.id} が重複しています。` }]
    seen.add(row.pipe.id)
    return []
  })
}

function endpointReferenceErrors(kind: RunKind, state: EngineeringState): Array<{ path: string; message: string }> {
  const model = state.model && typeof state.model === 'object' && !Array.isArray(state.model) ? state.model : {}
  const moc = kind === 'transient_network' || kind === 'transient_protection_device'
  const network = moc && model.network && typeof model.network === 'object' && !Array.isArray(model.network) ? model.network : undefined
  const pipes = moc ? network?.pipes : model.pipes
  const nodes = moc ? network?.nodes : model.nodes
  const nodeIds = new Set(moc
    ? nodes && typeof nodes === 'object' && !Array.isArray(nodes) ? Object.keys(nodes) : []
    : Array.isArray(nodes) ? nodes.flatMap((node) => node && typeof node === 'object' && !Array.isArray(node) && typeof node.id === 'string' ? [node.id] : []) : [])
  if (!Array.isArray(pipes) || nodeIds.size === 0 && !moc && kind !== 'steady_network_python' && kind !== 'steady_network_epanet') return []
  const prefix = moc ? 'network.pipes' : 'pipes'
  return pipes.flatMap((pipe, index) => {
    if (!pipe || typeof pipe !== 'object' || Array.isArray(pipe)) return []
    return (['upstreamNodeId', 'downstreamNodeId'] as const).flatMap((key) =>
      typeof pipe[key] !== 'string' || !nodeIds.has(pipe[key])
        ? [{ path: `${prefix}.${index}.${key}`, message: `${String(pipe[key] ?? '')} に対応する節点がありません。` }]
        : [],
    )
  })
}

export function validateEngineeringState(kind: RunKind, state: EngineeringState): Array<{ path: string; message: string }> {
  const fieldErrors = engineeringFieldsFor(kind, state).flatMap((field) => {
    const value = readEngineeringValue(state, field)
    if (field.required && (value === undefined || value === null || (typeof value === 'string' && value.trim() === ''))) return [{ path: field.path, message: `${field.label}は必須です。` }]
    if (value === undefined || value === null) return []
    if (typeof value === 'string' && value.trim() === '') {
      return field.kind === 'number' ? [{ path: field.path, message: `${field.label}は有限の数値が必要です。` }] : []
    }
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
    const count = collection.kind === 'array'
      ? Array.isArray(value) ? value.length : 0
      : value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).length : 0
    const hasBlankRecordKey = collection.kind === 'record'
      && value && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).some((key) => key.trim() === '')
    return [
      ...(count < collection.minimumItems
      ? [{ path: collection.path, message: `${collection.label}は${collection.minimumItems}件以上必要です。` }]
      : []),
      ...(hasBlankRecordKey
        ? [{ path: collection.path, message: `${collection.label} ID は空にできません。` }]
        : []),
      ...duplicateIdErrors(collection, value),
    ]
  })
  return [...fieldErrors, ...collectionErrors, ...nestedPipeIdErrors(kind, state), ...endpointReferenceErrors(kind, state)]
}
