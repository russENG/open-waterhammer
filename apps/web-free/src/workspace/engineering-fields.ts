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
]
const mocNetworkFields = (): EngineeringField[] => [
  numeric('model', 'network.pipes.0.pipe.innerDiameter', '第1管路 内径', 'm'),
  numeric('model', 'network.pipes.0.pipe.length', '第1管路 延長', 'm'),
  numeric('model', 'network.pipes.0.nReaches', '計算区間数', '区間', { required: true, minimum: 1 }),
  numeric('model', 'options.tMax', '解析時間', 's'),
]

const PIPE_TYPE_OPTIONS = [
  { value: 'steel', label: '鋼管' }, { value: 'ductile_iron', label: 'ダクタイル鋳鉄管' },
  { value: 'rcp', label: '鉄筋コンクリート管' }, { value: 'cpcp', label: 'コア式プレストレストコンクリート管' },
  { value: 'upvc', label: '硬質塩化ビニル管' }, { value: 'pe2', label: '水道配水用ポリエチレン管 2種' },
  { value: 'pe3_pe100', label: '水道配水用ポリエチレン管 3種 PE100' }, { value: 'wdpe', label: '一般用ポリエチレン管' },
  { value: 'grp_fw1', label: '強化プラスチック複合管 FW1' }, { value: 'grp_fw2', label: '強化プラスチック複合管 FW2' },
  { value: 'grp_fw3', label: '強化プラスチック複合管 FW3' }, { value: 'grp_fw4', label: '強化プラスチック複合管 FW4' },
  { value: 'grp_fw5', label: '強化プラスチック複合管 FW5' }, { value: 'gfpe', label: 'ガラス繊維強化ポリエチレン管' },
]

const FIELD_OVERRIDES: Record<RunKind, EngineeringField[]> = {
  wave_speed: [
    ...pipeFields(),
    select('model', 'pipe.pipeType', '管種', PIPE_TYPE_OPTIONS),
  ],
  joukowsky_allievi: [
    numeric('model', 'calculationCase.initialVelocity', '初期流速', 'm/s'),
    numeric('model', 'calculationCase.initialHead', '初期水頭', 'm'),
    numeric('event', 'closeTime', '閉鎖時間', 's'),
    numeric('model', 'pipe.innerDiameter', '管内径', 'm'),
    numeric('model', 'allowablePressureMpa', '許容圧力', 'MPa', { required: false, exclusiveMinimum: 0 }),
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
    numeric('model', 'allowablePressureMpa', '許容圧力', 'MPa', { required: false, exclusiveMinimum: 0 }),
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
    numeric('model', 'allowablePressureMpa', '許容圧力', 'MPa', { required: false, exclusiveMinimum: 0 }),
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
    ...mocNetworkFields(),
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

const STEADY_SINGLE_PIPE_BRANCHES: Record<string, JsonValue> = {
  'hazen-williams': {
    method: 'hazen-williams', innerDiameter: 0.3, length: 500, flowRate: 0.03,
    upstreamElevation: 100, downstreamElevation: 88, roughnessC: 130,
  },
  'darcy-weisbach': {
    method: 'darcy-weisbach', innerDiameter: 0.3, length: 500, flowRate: 0.03,
    upstreamElevation: 100, downstreamElevation: 88, frictionFactor: 0.02,
  },
}

const TRANSIENT_PUMP_EVENT_BRANCHES: Record<string, JsonValue> = {
  trip: {
    mode: 'trip', waveSpeed: 1100, Q0: 0.07, pumpHead: 50, Hs: 60,
    GD2: 100, N0: 1450, eta0: 0.8, shutdownTime: 0.5, checkValve: true,
    nReaches: 10, tMax: 8,
  },
  start: {
    mode: 'start', waveSpeed: 1100, Q_rated: 0.07, pumpHead: 50, Hs: 60,
    startupTime: 0.5, staticHead: 0, nReaches: 10, tMax: 8,
  },
}

// Targets J-01, the junction node in sample-workspace.ts's protectionNetwork — not V-01 (the
// closing valve): a device may not replace an event-carrying valve/pump node (Task 4b-2 fix
// round 1). initialLevel matches J-01's natural steady head in that network.
const PROTECTION_TEMPLATES: Record<RunKind, JsonValue> = Object.fromEntries(RUN_KINDS.map((kind) => [kind, kind === 'transient_protection_device'
  ? { devices: [{ id: 'J-01', type: 'surge_tank', enabled: true, tankArea: 4, initialLevel: 78.7 }] }
  : {}])) as Record<RunKind, JsonValue>

// allowablePressureMpa is demo-only seasoning on SAMPLE_RUN_INPUTS (sample-workspace.ts) so
// the seeded demo workspace shows real pass/warning/fail assessments out of the box. It must
// NOT leak into fresh-draft templates: createEngineeringState() clones template.model whenever
// a Case has no runInputs yet for a kind, so every brand-new draft would otherwise silently
// carry a judgment threshold the engineer never entered. The demo workspace is unaffected
// because its seeded Cases persist SAMPLE_RUN_INPUTS directly as their own runInputs, bypassing
// this template entirely.
function withoutDemoOnlyAllowablePressure(model: JsonValue): JsonValue {
  if (!model || typeof model !== 'object' || Array.isArray(model)) return model
  const { allowablePressureMpa, ...rest } = model as Record<string, JsonValue>
  return allowablePressureMpa === undefined ? model : rest
}

export const ENGINEERING_TEMPLATES = Object.fromEntries(RUN_KINDS.map((kind) => [kind, {
  model: structuredClone(withoutDemoOnlyAllowablePressure(SAMPLE_RUN_INPUTS[kind])),
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
  allowablePressureMpa: '許容圧力',
  operationType: '操作種別', targetFacilityId: '対象施設 ID', initialVelocity: '初期流速', initialHead: '初期水頭',
  closeTime: '閉鎖時間', waveSpeed: '波速', initialDownstreamHead: '下流初期水頭', nReaches: '計算区間数', tMax: '解析時間', operation: '操作',
  initialFlow: '初期流量', mode: 'ポンプ操作', Q0: '定格流量', Q_rated: '定格流量', pumpHead: 'ポンプ揚程', shutdownTime: '停止時間', checkValve: '逆止弁',
  frictionFactor: 'Darcy 摩擦係数',
  youngsModulus: 'ヤング係数', c1Coeff: '埋設状況係数 C₁', waterhammerPressureMpa: '水撃圧', otherLoss: 'その他損失',
  H0: '定格水頭', H0v: '初期水頭', Hs: '締切水頭', GD2: 'GD²', N0: '定格回転速度', eta0: '定格効率',
  startupTime: '起動時間', staticHead: '静水頭', V_air0: '初期空気容積', H_air0: '初期空気水頭', polytropicIndex: 'ポリトロープ指数',
  atmosphericHead: '大気圧水頭', setHead: '設定水頭', tankArea: 'タンク面積', initialLevel: '初期水位', datum: '基準標高', enabled: '有効',
}

const UNITS: Record<string, string> = {
  innerDiameter: 'm', wallThickness: 'm', length: 'm', flowRate: 'm³/s', upstreamElevation: 'm', downstreamElevation: 'm',
  elevation: 'm', head: 'm', demand: 'm³/s', horizontalDistance: 'm', groundLevel: 'm', pipeCenterHeight: 'm', pipeLength: 'm', diameter: 'm',
  staticWaterLevel: 'm', initialHead: 'm', initialDownstreamHead: 'm', pumpHead: 'm', initialLevel: 'm', datum: 'm',
  initialVelocity: 'm/s', waveSpeed: 'm/s', initialFlow: 'm³/s', Q0: 'm³/s', Q_rated: 'm³/s', tankArea: 'm²',
  closeTime: 's', tMax: 's', shutdownTime: 's', staticPressureMpa: 'MPa', operatingPressureMpa: 'MPa', hydraulicGradePressureMpa: 'MPa', allowablePressureMpa: 'MPa',
  H0: 'm', H0v: 'm', Hs: 'm', startupTime: 's', staticHead: 'm', V_air0: 'm³', H_air0: 'm', atmosphericHead: 'm', setHead: 'm',
  youngsModulus: 'kN/m²', c1Coeff: '—', waterhammerPressureMpa: 'MPa', otherLoss: 'm',
  GD2: 'N·m²', N0: 'min⁻¹', eta0: '—', polytropicIndex: '—',
  roughnessCoeff: '—', roughnessC: '—', frictionFactor: '—', minorLossCoeff: '—', bendLossCoeff: '—', valveLossCoeff: '—', branchLossCoeff: '—', waterhammerRatio: '—', nReaches: '区間',
}

const OPTIONAL_PATHS: Record<RunKind, Set<string>> = {
  wave_speed: new Set(['model.pipe.name', 'model.pipe.startNodeId', 'model.pipe.endNodeId', 'event.closeTime']),
  joukowsky_allievi: new Set(['model.pipe.name', 'model.pipe.startNodeId', 'model.pipe.endNodeId', 'model.allowablePressureMpa']),
  empirical_pressure: new Set(['model.operatingPressureMpa', 'model.hydraulicGradePressureMpa', 'model.allowablePressureMpa']),
  steady_single_pipe: new Set(['model.method']),
  steady_network_python: new Set(['model.caseName', 'model.pipes.0.minorLossCoeff', 'model.nodes.0.head', 'model.nodes.0.demand']),
  steady_network_epanet: new Set(['model.caseName', 'model.pipes.0.minorLossCoeff', 'model.nodes.0.head', 'model.nodes.0.demand']),
  longitudinal_hydraulics: new Set(['model.caseName', 'model.waterhammerRatio', 'model.waterhammerPressureMpa', 'model.points.0.name', 'model.points.0.otherLoss', 'model.allowablePressureMpa']),
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

for (const kind of ['wave_speed', 'joukowsky_allievi', 'transient_single_pipe', 'transient_pump'] as const) {
  OPTIONAL_PATHS[kind].add('model.pipe.youngsModulus')
  OPTIONAL_PATHS[kind].add('model.pipe.c1Coeff')
}
for (const kind of ['transient_network', 'transient_protection_device'] as const) {
  OPTIONAL_PATHS[kind].add('model.network.pipes.0.pipe.youngsModulus')
  OPTIONAL_PATHS[kind].add('model.network.pipes.0.pipe.c1Coeff')
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
  // No boundary condition at all — protocol.py's _network() treats it as an internal MOC
  // continuity junction. A first-class node type (rather than just omitting the node) so the
  // UI's pipe-endpoint validation accepts it and a protection device can target it
  // (Task 4b-2 fix round 1).
  junction: new Set(['type']),
}

const MOC_PUMP_BRANCHES: Record<string, JsonValue> = {
  trip: {
    type: 'pump', Q0: 0.07, H0: 50, shutdownTime: 0.5, Hs: 60,
    GD2: 100, N0: 1450, eta0: 0.8, mode: 'trip', checkValve: true,
  },
  start: {
    type: 'pump', Q0: 0.07, H0: 50, shutdownTime: 0, Hs: 60,
    mode: 'start', startupTime: 0.5, staticHead: 0, checkValve: true,
  },
}

const MOC_BOUNDARY_TEMPLATES: Record<string, JsonValue> = {
  reservoir: { type: 'reservoir', head: 80 },
  valve: { type: 'valve', Q0: 0.07, H0v: 30, closeTime: 2, operation: 'close' },
  pump: MOC_PUMP_BRANCHES.trip!,
  air_chamber: { type: 'air_chamber', V_air0: 2, H_air0: 30, polytropicIndex: 1.2 },
  surge_tank: { type: 'surge_tank', tankArea: 4, initialLevel: 30, datum: 0 },
  air_release_valve: { type: 'air_release_valve', atmosphericHead: 10.33 },
  pressure_reducing_valve: { type: 'pressure_reducing_valve', setHead: 30, Q0: 0.07 },
  dead_end: { type: 'dead_end' },
  junction: { type: 'junction' },
}

const STEADY_NODE_BRANCHES: Record<string, JsonValue> = {
  reservoir: { id: 'R-01', elevation: 100, type: 'reservoir', head: 142 },
  demand: { id: 'J-01', elevation: 88, type: 'demand', demand: 0.03 },
  junction: { id: 'J-01', elevation: 88, type: 'junction' },
}

const PROTECTION_DEVICE_BRANCHES: Record<string, JsonValue> = {
  surge_tank: { id: 'D-01', type: 'surge_tank', enabled: true, tankArea: 4, initialLevel: 30 },
  air_chamber: { id: 'D-01', type: 'air_chamber', enabled: true, V_air0: 2, H_air0: 30, polytropicIndex: 1.2 },
}

const POSITIVE_KEYS = new Set(['innerDiameter', 'wallThickness', 'length', 'diameter', 'roughnessCoeff', 'roughnessC', 'waveSpeed', 'nReaches', 'tankArea'])
const NONNEGATIVE_KEYS = new Set(['minorLossCoeff', 'bendLossCoeff', 'valveLossCoeff', 'branchLossCoeff', 'closeTime', 'tMax', 'shutdownTime', 'staticPressureMpa', 'operatingPressureMpa', 'hydraulicGradePressureMpa'])
const NUMERIC_PROTOCOL_KEYS = new Set([
  ...Object.keys(UNITS), 'youngsModulus', 'c1Coeff', 'waterhammerPressureMpa', 'otherLoss',
])

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
  if (key === 'pipeType') return PIPE_TYPE_OPTIONS
  if (key === 'method') return [{ value: 'hazen-williams', label: 'Hazen–Williams' }, { value: 'darcy-weisbach', label: 'Darcy–Weisbach' }]
  if (key === 'systemType') return FIELD_OVERRIDES.empirical_pressure[0]!.options
  if (key === 'operationType') return [
    { value: 'valve_close', label: '弁閉鎖' }, { value: 'valve_open', label: '弁開放' },
    { value: 'pump_stop', label: 'ポンプ停止' }, { value: 'pump_start', label: 'ポンプ始動' },
    { value: 'combined', label: '複合操作' },
  ]
  if (key === 'operation') return [{ value: 'close', label: '閉鎖' }, { value: 'open', label: '開放' }]
  if (key === 'mode') return [{ value: 'trip', label: '停止' }, { value: 'start', label: '始動' }]
  if (key === 'type' && path.includes('network.nodes.')) return [
    { value: 'reservoir', label: '貯水槽' }, { value: 'valve', label: '弁' }, { value: 'pump', label: 'ポンプ' },
    { value: 'surge_tank', label: 'サージタンク' }, { value: 'air_chamber', label: '空気室' },
    { value: 'air_release_valve', label: '吸気弁' }, { value: 'pressure_reducing_valve', label: '減圧弁' }, { value: 'dead_end', label: '閉端' },
    { value: 'junction', label: '接合点' },
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
  const fieldKind: EngineeringField['kind'] = typeof templateValue === 'number' || NUMERIC_PROTOCOL_KEYS.has(key) ? 'number' : typeof templateValue === 'boolean' ? 'boolean' : options ? 'select' : 'text'
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
  if (kind === 'steady_single_pipe' && field.target === 'model') {
    const method = readEngineeringValue(state, { target: 'model', path: 'method' }) ?? 'hazen-williams'
    if (field.path === 'method') return false
    if (field.path === 'roughnessC') return method === 'hazen-williams'
    if (field.path === 'frictionFactor') return method === 'darcy-weisbach'
  }
  if (kind === 'transient_pump' && field.target === 'event') {
    const mode = readEngineeringValue(state, { target: 'event', path: 'mode' }) ?? 'trip'
    const required = mode === 'start'
      ? new Set(['Q_rated', 'pumpHead', 'startupTime'])
      : new Set(['Q0', 'pumpHead'])
    return required.has(field.path)
  }
  const boundary = field.target === 'model' && (kind === 'transient_network' || kind === 'transient_protection_device')
    ? field.path.match(/^network\.nodes\.([^.]+)\.([^.]+)$/)
    : null
  if (boundary) {
    const type = readEngineeringValue(state, { target: 'model', path: `network.nodes.${boundary[1]}.type` })
    if (type === 'pump') {
      const mode = readEngineeringValue(state, { target: 'model', path: `network.nodes.${boundary[1]}.mode` }) ?? 'trip'
      const required = mode === 'start'
        ? new Set(['type', 'Q0', 'H0', 'shutdownTime', 'startupTime'])
        : MOC_BOUNDARY_REQUIRED.pump
      return required.has(boundary[2]!)
    }
    return typeof type === 'string' ? MOC_BOUNDARY_REQUIRED[type]?.has(boundary[2]!) ?? false : boundary[2] === 'type'
  }
  return !OPTIONAL_PATHS[kind].has(`${field.target}.${normalizeArrayPath(field.path)}`)
}

function selectedTemplate(kind: RunKind, target: EngineeringTarget, path: string, template: JsonValue, current: JsonValue): JsonValue {
  if (path === '' && kind === 'steady_single_pipe' && target === 'model') {
    const method = current && typeof current === 'object' && !Array.isArray(current) && typeof current.method === 'string' ? current.method : 'hazen-williams'
    return STEADY_SINGLE_PIPE_BRANCHES[method] ?? template
  }
  if (path === '' && kind === 'transient_pump' && target === 'event') {
    const mode = current && typeof current === 'object' && !Array.isArray(current) && typeof current.mode === 'string' ? current.mode : 'trip'
    return TRANSIENT_PUMP_EVENT_BRANCHES[mode] ?? template
  }
  if ((kind === 'steady_network_python' || kind === 'steady_network_epanet') && target === 'model' && /^nodes\.\d+$/.test(path)) {
    const type = current && typeof current === 'object' && !Array.isArray(current) && typeof current.type === 'string' ? current.type : 'junction'
    return STEADY_NODE_BRANCHES[type] ?? template
  }
  if (kind === 'transient_protection_device' && target === 'protection' && /^devices\.\d+$/.test(path)) {
    const type = current && typeof current === 'object' && !Array.isArray(current) && typeof current.type === 'string' ? current.type : 'surge_tank'
    return PROTECTION_DEVICE_BRANCHES[type] ?? template
  }
  return template
}

function mocBoundaryTemplate(row: JsonValue, fallback: JsonValue): JsonValue {
  if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.type !== 'string') return fallback
  if (row.type === 'pump') {
    const mode = typeof row.mode === 'string' ? row.mode : 'trip'
    return MOC_PUMP_BRANCHES[mode] ?? MOC_BOUNDARY_TEMPLATES.pump ?? fallback
  }
  return MOC_BOUNDARY_TEMPLATES[row.type] ?? fallback
}

function branchAllowsOverride(kind: RunKind, state: EngineeringState, field: EngineeringField): boolean {
  const shapeChanging = kind === 'steady_single_pipe' && field.target === 'model'
    || kind === 'transient_pump' && field.target === 'event'
  if (!shapeChanging || field.path.includes('.')) return true
  const selected = selectedTemplate(kind, field.target, '', ENGINEERING_TEMPLATES[kind][field.target], state[field.target])
  return !selected || typeof selected !== 'object' || Array.isArray(selected) || field.path in selected
}

function collectFields(kind: RunKind, target: EngineeringTarget, template: JsonValue, current: JsonValue, path: string, fields: EngineeringField[]) {
  template = selectedTemplate(kind, target, path, template, current)
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
        const matching = mocBoundaryTemplate(row, (typeof rowType === 'string' ? MOC_BOUNDARY_TEMPLATES[rowType] : undefined)
          ?? templates.find((candidate) => candidate && typeof candidate === 'object' && !Array.isArray(candidate) && candidate.type === rowType)
          ?? templates[0] ?? row)
        collectFields(kind, target, matching, row, `${path}.${key}`, fields)
      }
      return
    }
    const templateRecord = template as Record<string, JsonValue>
    const keys = new Set([...Object.keys(templateRecord), ...Object.keys(currentRecord)])
    for (const key of keys) {
      const child = templateRecord[key] ?? currentRecord[key]
      if (child !== undefined) collectFields(kind, target, child, currentRecord[key] ?? child, path ? `${path}.${key}` : key, fields)
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
    if (branchAllowsOverride(kind, state, field) && !fields.some((candidate) => candidate.target === field.target && normalizeArrayPath(candidate.path) === normalizeArrayPath(field.path))) fields.push(field)
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
  if (!isPathSafeRecordId(trimmed)) throw new Error("ID must use only ASCII letters, numbers, '_' or '-' and cannot be __proto__, constructor, or prototype")
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

function projectObject(current: JsonValue | undefined, template: JsonValue): JsonValue {
  if (!template || typeof template !== 'object' || Array.isArray(template)) return structuredClone(template)
  const record = current && typeof current === 'object' && !Array.isArray(current) ? current : {}
  return Object.fromEntries(Object.entries(template).map(([key, fallback]) => [key, record[key] ?? structuredClone(fallback)]))
}

export function updateEngineeringFieldFromInput(state: EngineeringState, field: EngineeringField, raw: string | boolean, kind?: RunKind): EngineeringState {
  let next: EngineeringState
  if (field.kind === 'number') {
    next = String(raw).trim() === '' ? removeEngineeringValue(state, field) : updateEngineeringValue(state, field, Number(raw))
  } else if (field.kind === 'boolean') {
    next = updateEngineeringValue(state, field, Boolean(raw))
  } else if (field.kind === 'select' && String(raw).trim() === '') {
    next = removeEngineeringValue(state, field)
  } else {
    next = updateEngineeringValue(state, field, raw)
  }
  if (kind === 'steady_single_pipe' && field.target === 'model' && field.path === 'method' && typeof raw === 'string') {
    const blank = raw.trim() === ''
    const template = STEADY_SINGLE_PIPE_BRANCHES[blank ? 'hazen-williams' : raw]
    if (!template) return next
    const model = projectObject(next.model, template)
    if (blank && model && typeof model === 'object' && !Array.isArray(model)) delete model.method
    return { ...next, model }
  }
  if (kind === 'transient_pump' && field.target === 'event' && field.path === 'mode' && typeof raw === 'string') {
    const blank = raw.trim() === ''
    const template = TRANSIENT_PUMP_EVENT_BRANCHES[blank ? 'trip' : raw]
    if (!template) return next
    const event = projectObject(next.event, template)
    if (blank && event && typeof event === 'object' && !Array.isArray(event)) delete event.mode
    return { ...next, event }
  }
  if ((kind === 'transient_network' || kind === 'transient_protection_device') && field.target === 'model' && typeof raw === 'string') {
    const boundaryType = field.path.match(/^(network\.nodes\.[^.]+)\.type$/)
    if (boundaryType) {
      const template = MOC_BOUNDARY_TEMPLATES[raw]
      return template ? updateEngineeringValue(next, { target: 'model', path: boundaryType[1]! }, projectObject(readEngineeringValue(next, { target: 'model', path: boundaryType[1]! }), template)) : next
    }
    const pumpMode = field.path.match(/^(network\.nodes\.[^.]+)\.mode$/)
    if (pumpMode) {
      const blank = raw.trim() === ''
      const template = MOC_PUMP_BRANCHES[blank ? 'trip' : raw]
      if (!template) return next
      const projected = projectObject(readEngineeringValue(next, { target: 'model', path: pumpMode[1]! }), template)
      if (projected && typeof projected === 'object' && !Array.isArray(projected) && template && typeof template === 'object' && !Array.isArray(template)) {
        projected.shutdownTime = template.shutdownTime
        if (blank) delete projected.mode
      }
      return updateEngineeringValue(next, { target: 'model', path: pumpMode[1]! }, projected)
    }
  }
  if ((kind === 'steady_network_python' || kind === 'steady_network_epanet') && field.target === 'model' && typeof raw === 'string') {
    const nodeType = field.path.match(/^(nodes\.\d+)\.type$/)
    if (nodeType) {
      const template = STEADY_NODE_BRANCHES[raw]
      return template ? updateEngineeringValue(next, { target: 'model', path: nodeType[1]! }, projectObject(readEngineeringValue(next, { target: 'model', path: nodeType[1]! }), template)) : next
    }
  }
  if (kind === 'transient_protection_device' && field.target === 'protection' && typeof raw === 'string') {
    const deviceType = field.path.match(/^(devices\.\d+)\.type$/)
    if (deviceType) {
      const template = PROTECTION_DEVICE_BRANCHES[raw]
      return template ? updateEngineeringValue(next, { target: 'protection', path: deviceType[1]! }, projectObject(readEngineeringValue(next, { target: 'protection', path: deviceType[1]! }), template)) : next
    }
  }
  return next
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

const RESERVED_RECORD_IDS = new Set(['__proto__', 'constructor', 'prototype'])

function isPathSafeRecordId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(id) && !RESERVED_RECORD_IDS.has(id)
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
      if (field.kind === 'number') return [{ path: field.path, message: `${field.label}は有限の数値が必要です。` }]
      if (field.kind === 'select') return [{ path: field.path, message: `${field.label}は一覧から選択してください。` }]
      return []
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
    const hasUnsafeRecordKey = collection.kind === 'record'
      && value && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).some((key) => !isPathSafeRecordId(key))
    return [
      ...(count < collection.minimumItems
      ? [{ path: collection.path, message: `${collection.label}は${collection.minimumItems}件以上必要です。` }]
      : []),
      ...(hasBlankRecordKey
        ? [{ path: collection.path, message: `${collection.label} ID は空にできません。` }]
        : []),
      ...(hasUnsafeRecordKey
        ? [{ path: collection.path, message: `${collection.label} ID は ASCII letters, numbers, '_' or '-' のみ使用でき、__proto__、constructor、prototype は使用できません。` }]
        : []),
      ...duplicateIdErrors(collection, value),
    ]
  })
  return [...fieldErrors, ...collectionErrors, ...nestedPipeIdErrors(kind, state), ...endpointReferenceErrors(kind, state)]
}
