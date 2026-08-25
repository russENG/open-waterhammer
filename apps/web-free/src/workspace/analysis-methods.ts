import type { RunKind } from '@open-waterhammer/contracts'
import type { EngineeringField } from './engineering-fields'

export interface AnalysisMethodGroup {
  id: 'primary' | 'preparation' | 'quick-check'
  title: string
  description: string
  kinds: RunKind[]
}

export const ANALYSIS_METHOD_GROUPS: AnalysisMethodGroup[] = [
  {
    id: 'primary',
    title: '主要解析',
    description: '特性曲線法で上昇圧・下降圧を時系列評価します。管路網、ポンプ、防護工の設計比較ではここを主に使います。',
    kinds: ['transient_network', 'transient_pump', 'transient_protection_device', 'transient_single_pipe'],
  },
  {
    id: 'preparation',
    title: '準備計算',
    description: 'モデル、波速、定常状態、縦断条件を確認し、主要解析へ渡す初期条件を整えます。',
    kinds: ['wave_speed', 'steady_network_python', 'steady_network_epanet', 'steady_single_pipe', 'longitudinal_hydraulics'],
  },
  {
    id: 'quick-check',
    title: '簡易確認',
    description: '概算・検算・教育・数値解析との比較用です。適用範囲を確認し、負圧を含む数値解析の代替には使いません。',
    kinds: ['joukowsky_allievi', 'empirical_pressure'],
  },
]

const ADVANCED_FIELD_KEYS: Partial<Record<RunKind, Set<string>>> = {
  wave_speed: new Set(['model.pipe.id', 'model.pipe.length', 'model.pipe.elasticModulus', 'model.pipe.fluidBulkModulus', 'model.pipe.poissonRatio', 'model.pipe.restraintFactor']),
  joukowsky_allievi: new Set(['model.pipe.innerDiameter', 'model.allowablePressureMpa']),
  empirical_pressure: new Set(['model.operatingPressureMpa', 'model.hydraulicGradePressureMpa', 'model.allowablePressureMpa']),
  longitudinal_hydraulics: new Set(['model.waterhammerRatio', 'model.allowablePressureMpa']),
  transient_single_pipe: new Set(['model.pipe.id']),
  transient_pump: new Set(['model.pipe.id']),
}

export function engineeringFieldKey(field: EngineeringField): string {
  return `${field.target}.${field.path}`
}

export function isAdvancedEngineeringField(kind: RunKind, field: EngineeringField): boolean {
  return ADVANCED_FIELD_KEYS[kind]?.has(engineeringFieldKey(field)) ?? false
}
