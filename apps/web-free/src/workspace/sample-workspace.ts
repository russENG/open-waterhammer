import {
  RUN_KINDS,
  alternativeFixture,
  caseFixture,
  projectFixture,
  scenarioFixture,
  type JsonValue,
  type RunKind,
} from '@open-waterhammer/contracts'
import type { WorkspaceData } from '@open-waterhammer/workspace'

const pipe = {
  id: 'P-01', name: '第1号幹線', startNodeId: 'R-01', endNodeId: 'J-01',
  pipeType: 'ductile_iron', innerDiameter: 0.3, wallThickness: 0.007,
  length: 500, roughnessCoeff: 130,
}

const network: JsonValue = {
  caseName: '取水支線 定常解析',
  pipes: [{
    id: 'P-01', upstreamNodeId: 'R-01', downstreamNodeId: 'J-01',
    innerDiameter: 0.3, length: 500, roughnessC: 130, minorLossCoeff: 0,
  }],
  nodes: [
    { id: 'R-01', elevation: 100, type: 'reservoir', head: 142 },
    { id: 'J-01', elevation: 88, type: 'demand', demand: 0.03 },
  ],
}

const transientNetwork = {
  pipes: [{
    id: 'P-01', pipe, nReaches: 10, upstreamNodeId: 'R-01', downstreamNodeId: 'V-01', initialFlow: 0.07,
  }],
  nodes: {
    'R-01': { type: 'reservoir', head: 80 },
    'V-01': { type: 'valve', Q0: 0.07, H0v: 30, closeTime: 2, operation: 'close' },
  },
}

export const SAMPLE_RUN_INPUTS: Record<RunKind, JsonValue> = {
  wave_speed: { pipe },
  joukowsky_allievi: {
    pipe,
    calculationCase: {
      id: 'CALC-01', name: '末端弁閉鎖', operationType: 'valve_close',
      targetFacilityId: 'V-01', initialVelocity: 1, initialHead: 30,
    },
    allowablePressureMpa: 0.75,
  },
  empirical_pressure: { systemType: 'gravity_open', staticPressureMpa: 0.42, allowablePressureMpa: 0.75 },
  steady_single_pipe: {
    method: 'hazen-williams', innerDiameter: 0.3, length: 500, flowRate: 0.03,
    upstreamElevation: 100, downstreamElevation: 88, roughnessC: 130,
  },
  steady_network_python: network,
  steady_network_epanet: network,
  longitudinal_hydraulics: {
    caseName: '取水支線縦断', staticWaterLevel: 142, waterhammerRatio: 0.2,
    points: [
      { id: 'STA-000', horizontalDistance: 0, groundLevel: 100, pipeCenterHeight: 98, pipeLength: 0, flowRate: 0.03, diameter: 0.3, roughnessC: 130, bendLossCoeff: 0, valveLossCoeff: 0, branchLossCoeff: 0 },
      { id: 'STA-500', horizontalDistance: 500, groundLevel: 90, pipeCenterHeight: 88, pipeLength: 500, flowRate: 0.03, diameter: 0.3, roughnessC: 130, bendLossCoeff: 0.2, valveLossCoeff: 0, branchLossCoeff: 0 },
    ],
    allowablePressureMpa: 0.75,
  },
  transient_single_pipe: { pipe },
  transient_network: { network: transientNetwork, options: { tMax: 8, initialFlow: 0.07 } },
  transient_pump: { pipe },
  transient_protection_device: {
    network: {
      ...transientNetwork,
      nodes: {
        ...transientNetwork.nodes,
        'V-01': { type: 'surge_tank', tankArea: 4, initialLevel: 30, datum: 0 },
      },
    },
    options: { tMax: 8, initialFlow: 0.07 },
  },
}

const geoDrafts: JsonValue = [
  { sourceFeatureId: 'R-01', id: 'R-01', kind: 'node', geometry: { type: 'Point', coordinates: [139.700, 35.680] }, properties: { elevation: 100 }, errors: [] },
  { sourceFeatureId: 'J-01', id: 'J-01', kind: 'node', geometry: { type: 'Point', coordinates: [139.708, 35.684] }, properties: { elevation: 88 }, errors: [] },
  { sourceFeatureId: 'P-01', id: 'P-01', kind: 'pipe', geometry: { type: 'LineString', coordinates: [[139.700, 35.680], [139.708, 35.684]] }, properties: { startNodeId: 'R-01', endNodeId: 'J-01', innerDiameter: 0.3 }, errors: [] },
]

export function buildSampleWorkspace(timestamp = new Date().toISOString()): WorkspaceData {
  const project = {
    ...projectFixture,
    name: '東部幹線 水撃圧比較',
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
    modelSnapshot: { runInputs: SAMPLE_RUN_INPUTS, geoDrafts, geoSourceCrs: 'EPSG:4326', designLabel: reason },
    createdAt: timestamp,
    updatedAt: new Date(new Date(timestamp).getTime() + index * 1000).toISOString(),
  }))
  const scenarios = cases.map((record, index) => {
    const protectionSettings: JsonValue = index === 2 ? { surgeTank: { enabled: true, area: 4 } } : {}
    return {
      ...scenarioFixture,
      id: `44444444-4444-4444-8444-${String(index + 1).padStart(12, '0')}`,
      caseId: record.id,
      name: index === 0 ? '末端弁 2秒閉鎖' : `${reasons[index]}シナリオ`,
      boundaryConditions: { upstream: 'reservoir', downstream: 'valve' },
      eventSettings: {
        closeTime: index === 1 ? 8 : 2, waveSpeed: 1100, initialVelocity: 1,
        initialDownstreamHead: 30, nReaches: 10, tMax: 8, operation: 'close',
        mode: 'trip', Q0: 0.07, pumpHead: 50, shutdownTime: 0.5,
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
