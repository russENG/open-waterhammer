import {
  RUN_KINDS,
  alternativeFixture,
  caseFixture,
  projectFixture,
  scenarioFixture,
  type JsonValue,
  type RunKind,
} from '@open-waterhammer/contracts'
import { buildCanonicalHydraulicModel, type MeasurementPoint } from '@open-waterhammer/core'
import type { WorkspaceData } from '@open-waterhammer/workspace'

import { mergeDraftGeometryIntoCanonicalModel, type HydraulicDraft } from '../gis/import-model'

const pipe = {
  id: 'P-01', name: '第1号幹線', startNodeId: 'R-01', endNodeId: 'J-01',
  pipeType: 'ductile_iron' as const, innerDiameter: 0.3, wallThickness: 0.007,
  length: 500, roughnessCoeff: 130,
}

// ─── サンプル路線の水理諸元 ─────────────────────────────────────────────────
//
// 一つの自然流下パイプラインを、全ての計算方法が同じ標高基準で共有する。
// 上流端 R-01 は調整池（常時満水位 HWL 142.00 m、呑口の管中心高 138.50 m）、
// 下流端 V-01/J-01 は分水工の制水弁（管中心高 114.00 m）。計画最大流量
// 0.070 m³/s（φ300 で流速 0.990 m/s）で摩擦損失は 500 m あたり約 1.66 m
// なので、定常の動水位は 142.00 → 140.30 m とごく緩く下がる。
// 以前のサンプルは方式ごとに標高基準がばらばら（定常は 100/88 m、過渡は
// 水頭 80/30 m）で、結果タブが同じ縦断図に重ねると最小水頭の線が管中心高の
// はるか下に描かれ、読み取れる図になっていなかった。
const STATIC_WATER_LEVEL = 142
/** 定常時に分水工（下流端）へ届く水頭 [m] = HWL − 管路全長の摩擦損失。 */
const DOWNSTREAM_STEADY_HEAD = 140.3
const INTAKE_PIPE_CENTER = 138.5
const OUTLET_PIPE_CENTER = 114
/** 計画最大流量 [m³/s]。φ300 で流速 0.990 m/s（技術書の推奨流速の範囲内）。 */
const DESIGN_FLOW = 0.07

const network: JsonValue = {
  caseName: '取水支線 定常解析',
  pipes: [{
    id: 'P-01', upstreamNodeId: 'R-01', downstreamNodeId: 'J-01',
    innerDiameter: 0.3, length: 500, roughnessC: 130, minorLossCoeff: 0,
  }],
  nodes: [
    { id: 'R-01', elevation: INTAKE_PIPE_CENTER, type: 'reservoir', head: STATIC_WATER_LEVEL },
    { id: 'J-01', elevation: OUTLET_PIPE_CENTER, type: 'demand', demand: DESIGN_FLOW },
  ],
}

const transientNetwork = {
  pipes: [{
    id: 'P-01', pipe, nReaches: 10, upstreamNodeId: 'R-01', downstreamNodeId: 'V-01', initialFlow: DESIGN_FLOW,
  }],
  nodes: {
    'R-01': { type: 'reservoir', head: STATIC_WATER_LEVEL },
    'V-01': { type: 'valve', Q0: DESIGN_FLOW, H0v: DOWNSTREAM_STEADY_HEAD, closeTime: 2, operation: 'close' },
  },
}

// 縦断測点。農水省 成果品様式「計画最大流量時の水理計算書」に倣い、屈曲工・
// 空気弁工・排泥工といった変化点で区切る（等間隔の測点ではない）。
// 管長 SL は前測点からの実延長、単距離 Lh は同じ区間の水平距離 √(SL²−Δ管中心高²)、
// distanceAlongPipe は SL の累計で、末端が管路延長 500 m に一致する。
// 地盤高は一般部で管中心高 +1.20 m（標準土被り）。起点だけは調整池の堤天高。
// 195 m と 395 m の凸部が空気弁の設置位置で、過渡解析でも最小水頭が最も
// 管中心高に近づく（＝負圧の検討箇所）ため、サンプルとして意味のある形にした。
const longitudinalPoints: MeasurementPoint[] = ([
  // [測点距離, 管中心高 FH, 地盤高 GL, 単距離 Lh, 曲管損失係数 fb, 弁損失係数 fv, 名称]
  [0, 138.5, 143, 0, 0, 0, '調整池 呑口'],
  [45, 136.2, 137.4, 44.94, 0.1, 0, '屈曲工'],
  [100, 132.4, 133.6, 54.87, 0.05, 0, ''],
  [150, 130.1, 131.3, 49.95, 0.1, 0, '排泥工'],
  [195, 131.3, 132.5, 44.98, 0.12, 0, '空気弁工'],
  [250, 128.6, 129.8, 54.93, 0.05, 0, ''],
  [300, 124.3, 125.5, 49.81, 0.06, 0, ''],
  [350, 121.1, 122.3, 49.9, 0.1, 0, '排泥工'],
  [395, 122.4, 123.6, 44.98, 0.12, 0, '空気弁工'],
  [440, 119.2, 120.4, 44.89, 0.05, 0, ''],
  [500, 114, 115.2, 59.77, 0.08, 0.2, '分水工 制水弁'],
] as const).map(([distance, pipeCenterHeight, groundLevel, horizontalDistance, bendLossCoeff, valveLossCoeff, name], index, rows) => ({
  id: `STA-${String(distance).padStart(3, '0')}`,
  ...(name ? { name } : {}),
  pipeId: 'P-01',
  ...(index === 0 ? { nodeId: 'R-01' } : index === rows.length - 1 ? { nodeId: 'J-01' } : {}),
  distanceAlongPipe: distance,
  horizontalDistance,
  groundLevel,
  pipeCenterHeight,
  pipeLength: distance - (rows[index - 1]?.[0] ?? 0),
  flowRate: DESIGN_FLOW,
  diameter: 0.3,
  roughnessC: 130,
  bendLossCoeff,
  valveLossCoeff,
  branchLossCoeff: 0,
}))

// Dedicated network for transient_protection_device (does NOT share transientNetwork):
// R-01 --P-01-- J-01 --P-02-- V-01. V-01 keeps the same closing-valve event as
// transientNetwork; J-01 is a plain junction (type: 'junction' — no explicit boundary
// condition, protocol.py's _network() treats it as an internal MOC continuity node) that a
// protectionSettings device can target. A device may NOT target V-01 itself: replacing an
// event-carrying valve/pump node would delete the transient the run analyzes rather than
// mitigate it (Task 4b-2 fix round 1 controller ruling).
const protectionNetwork = {
  pipes: [
    {
      id: 'P-01',
      pipe: {
        id: 'P-01', name: '第1号幹線', startNodeId: 'R-01', endNodeId: 'J-01',
        pipeType: 'ductile_iron', innerDiameter: 0.3, wallThickness: 0.007,
        length: 400, roughnessCoeff: 130,
      },
      nReaches: 8, upstreamNodeId: 'R-01', downstreamNodeId: 'J-01', initialFlow: DESIGN_FLOW,
    },
    {
      id: 'P-02',
      pipe: {
        id: 'P-02', name: '第2号幹線', startNodeId: 'J-01', endNodeId: 'V-01',
        pipeType: 'ductile_iron', innerDiameter: 0.3, wallThickness: 0.007,
        length: 100, roughnessCoeff: 130,
      },
      nReaches: 2, upstreamNodeId: 'J-01', downstreamNodeId: 'V-01', initialFlow: DESIGN_FLOW,
    },
  ],
  nodes: {
    'R-01': { type: 'reservoir', head: STATIC_WATER_LEVEL },
    'J-01': { type: 'junction' },
    'V-01': { type: 'valve', Q0: DESIGN_FLOW, H0v: DOWNSTREAM_STEADY_HEAD, closeTime: 2, operation: 'close' },
  },
}

export const SAMPLE_RUN_INPUTS: Record<RunKind, JsonValue> = {
  wave_speed: { pipe },
  joukowsky_allievi: {
    pipe,
    calculationCase: {
      id: 'CALC-01', name: '末端弁閉鎖', operationType: 'valve_close',
      // initialHead は分水工の静水頭 H₀ = 静水位 − 管中心高 = 142.00 − 114.00。
      targetFacilityId: 'V-01', initialVelocity: 0.99, initialHead: STATIC_WATER_LEVEL - OUTLET_PIPE_CENTER,
    },
    allowablePressureMpa: 0.75,
  },
  // 静水圧 = 分水工の静水頭 28.0 m ≒ 0.27 MPa。
  empirical_pressure: { systemType: 'gravity_open', staticPressureMpa: 0.27, allowablePressureMpa: 0.75 },
  steady_single_pipe: {
    method: 'hazen-williams', innerDiameter: 0.3, length: 500, flowRate: DESIGN_FLOW,
    upstreamElevation: INTAKE_PIPE_CENTER, downstreamElevation: OUTLET_PIPE_CENTER, roughnessC: 130,
  },
  steady_network_python: network,
  steady_network_epanet: network,
  longitudinal_hydraulics: {
    caseName: '取水支線縦断', staticWaterLevel: STATIC_WATER_LEVEL, waterhammerRatio: 0.2,
    points: longitudinalPoints as unknown as JsonValue,
    allowablePressureMpa: 0.75,
  },
  transient_single_pipe: { pipe },
  transient_network: { network: transientNetwork, options: { tMax: 8, initialFlow: DESIGN_FLOW } },
  transient_pump: { pipe },
  // Own network (protectionNetwork, not shared with transient_network): V-01's closing-valve
  // event is unchanged, but a junction node J-01 now sits between it and the reservoir so a
  // protectionSettings device (surge_tank at J-01, see buildSampleWorkspace below) can target
  // that junction instead of the event-carrying valve — packages/core-py's
  // _transient_protection handler swaps it in at run time and forbids targeting V-01 itself
  // (Task 4b-2, fix round 1).
  transient_protection_device: { network: protectionNetwork, options: { tMax: 8, initialFlow: DESIGN_FLOW } },
}

// 平面図の線形。45 m 地点の屈曲工で折れる 2 区間で、実長は約 500 m と
// 管路延長に一致させてある（以前は約 850 m で縦断の測点距離と合っていなかった）。
const INTAKE_POINT = [139.7000, 35.6800]
const BEND_POINT = [139.70270, 35.67880]
const OUTLET_POINT = [139.70440, 35.67735]

const geoDrafts: JsonValue = [
  { sourceFeatureId: 'R-01', id: 'R-01', kind: 'node', geometry: { type: 'Point', coordinates: INTAKE_POINT }, properties: { elevation: INTAKE_PIPE_CENTER }, errors: [] },
  { sourceFeatureId: 'J-01', id: 'J-01', kind: 'node', geometry: { type: 'Point', coordinates: OUTLET_POINT }, properties: { elevation: OUTLET_PIPE_CENTER }, errors: [] },
  { sourceFeatureId: 'P-01', id: 'P-01', kind: 'pipe', geometry: { type: 'LineString', coordinates: [INTAKE_POINT, BEND_POINT, OUTLET_POINT] }, properties: { startNodeId: 'R-01', endNodeId: 'J-01', innerDiameter: 0.3 }, errors: [] },
]

const sampleCanonicalModel = mergeDraftGeometryIntoCanonicalModel(
  buildCanonicalHydraulicModel({
    source: 'web',
    crs: 'EPSG:4326',
    pipes: [pipe],
    nodes: [
      { id: 'R-01', nodeType: 'reservoir', elevation: INTAKE_PIPE_CENTER, hydraulicGrade: STATIC_WATER_LEVEL },
      { id: 'J-01', nodeType: 'junction', elevation: OUTLET_PIPE_CENTER },
    ],
    measurementPoints: longitudinalPoints,
  }).model,
  geoDrafts as unknown as HydraulicDraft[],
  'EPSG:4326',
).model

export function buildSampleWorkspace(timestamp = new Date().toISOString()): WorkspaceData {
  const project = {
    ...projectFixture,
    name: 'サンプル：N地区東部幹線水路',
    crs: 'EPSG:6677',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  const alternative = {
    ...alternativeFixture,
    name: '原案・弁閉鎖条件',
    description: '現況管径を基準に閉鎖時間と防護工を比較',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  const reasons = ['基準案', '閉鎖時間延長', '空気室追加', '管径拡大']
  const cases = reasons.map((reason, index) => ({
    ...caseFixture,
    id: `33333333-3333-4333-8333-${String(index + 1).padStart(12, '0')}`,
    parentCaseId: index === 0 ? null : `33333333-3333-4333-8333-${String(index).padStart(12, '0')}`,
    ...(index === 0 ? {} : { revisionReason: reason }),
    modelSnapshot: { runInputs: SAMPLE_RUN_INPUTS, canonicalModel: sampleCanonicalModel as unknown as JsonValue, geoDrafts, geoSourceCrs: 'EPSG:4326', designLabel: reason },
    createdAt: timestamp,
    updatedAt: new Date(new Date(timestamp).getTime() + index * 1000).toISOString(),
  }))
  const scenarios = cases.map((record, index) => {
    // index 2 ("空気室追加") is the only seeded scenario with an enabled protection device —
    // targets J-01, the junction protectionNetwork adds between the reservoir and the closing
    // valve V-01 (a device may not target V-01 itself; see protectionNetwork's comment above).
    // Matches PROTECTION_TEMPLATES.transient_protection_device in engineering-fields.ts so a
    // freshly-created Case and this seeded one demonstrate the same device (Task 4b-2 fix round 1).
    const protectionSettings: JsonValue = index === 2
      // initialLevel は基準標高 0 からの水位、つまり J-01 の定常水頭そのもの
      // （静水位 142.00 − R-01〜J-01 400 m の摩擦損失 1.33 m）。
      ? { devices: [{ id: 'J-01', type: 'surge_tank', enabled: true, tankArea: 4, initialLevel: 140.7 }] }
      : {}
    return {
      ...scenarioFixture,
      id: `44444444-4444-4444-8444-${String(index + 1).padStart(12, '0')}`,
      caseId: record.id,
      name: index === 0 ? '末端弁 2秒閉鎖' : `${reasons[index]}シナリオ`,
      boundaryConditions: { upstream: 'reservoir', downstream: 'valve' },
      eventSettings: {
        closeTime: index === 1 ? 8 : 2, waveSpeed: 1100, initialVelocity: 0.99,
        initialDownstreamHead: DOWNSTREAM_STEADY_HEAD, nReaches: 10, tMax: 8, operation: 'close',
        mode: 'trip', Q0: DESIGN_FLOW, pumpHead: 50, shutdownTime: 0.5,
      },
      protectionSettings,
      createdAt: timestamp,
      updatedAt: new Date(new Date(timestamp).getTime() + index * 1000).toISOString(),
    }
  })
  return {
    projects: [project],
    alternatives: [alternative],
    cases,
    scenarios,
    runs: [],
    legacyArtifacts: [],
  }
}

export function sampleRunKinds(): readonly RunKind[] {
  return RUN_KINDS
}
