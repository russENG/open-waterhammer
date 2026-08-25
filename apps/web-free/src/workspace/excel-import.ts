import type { RunKind } from '@open-waterhammer/contracts'
import type { WorkbookData } from '@open-waterhammer/excel-io'

/**
 * Excel 取込 → runInputs マッピング（純粋関数）
 *
 * `WorkbookData.pipes[]` / `.cases[]` / `.measurementPoints[]` は
 * `@open-waterhammer/core` の `Pipe` / `CalculationCase` / `MeasurementPoint`
 * 型そのもの（packages/excel-io/src/types.ts）であり、これは
 * `workspace/sample-workspace.ts` の `SAMPLE_RUN_INPUTS` および
 * `packages/core-py/open_waterhammer/protocol.py` の
 * `_wave_speed` / `_joukowsky_allievi` / `_longitudinal` が読む
 * `model.pipe` / `model.calculationCase` / `model.points[]` と
 * フィールド名が完全一致する（キー変換なしでそのまま使える）。
 *
 * 唯一の翻訳が必要な箇所は 管路網（steady_network_python /
 * steady_network_epanet）のノード種別: Excel の `Node.nodeType`
 * (`reservoir|junction|tank|pump_node|valve_node`) と
 * `NetworkNodeDef.type` (`reservoir|demand|junction`,
 * packages/core/src/steady-network.ts) は別の enum。
 */

type PipeRow = WorkbookData['pipes'][number]
type NodeRow = WorkbookData['nodes'][number]
type NetworkNodeType = 'reservoir' | 'demand' | 'junction'

/**
 * Excel の節点種別 → 管路網ノード種別。
 * `reservoir` と `junction` のみ直接対応する。`tank` / `pump_node` /
 * `valve_node` には対応する種別が管路網モデルに存在しないため、
 * 呼び出し側で `junction` にフォールバックし警告を出す。
 */
const NETWORK_NODE_TYPE_BY_EXCEL_TYPE: Partial<Record<NodeRow['nodeType'], NetworkNodeType>> = {
  reservoir: 'reservoir',
  junction: 'junction',
}

function toNetworkPipe(pipe: PipeRow): Record<string, unknown> {
  return {
    id: pipe.id,
    upstreamNodeId: pipe.startNodeId,
    downstreamNodeId: pipe.endNodeId,
    innerDiameter: pipe.innerDiameter,
    length: pipe.length,
    roughnessC: pipe.roughnessCoeff,
  }
}

function toNetworkNode(node: NodeRow, warnings: string[]): Record<string, unknown> {
  const mappedType = NETWORK_NODE_TYPE_BY_EXCEL_TYPE[node.nodeType]
  if (!mappedType) {
    warnings.push(`節点 ${node.id}: 節点種別「${node.nodeType}」は管路網モデルに直接対応する種別がないため、junction として取り込みました。解析タブで確認してください。`)
  }
  const type = mappedType ?? 'junction'
  const result: Record<string, unknown> = { id: node.id, elevation: node.elevation, type }
  if (node.hydraulicGrade !== undefined) {
    result.head = node.hydraulicGrade
  } else if (type === 'reservoir') {
    warnings.push(`節点 ${node.id}: reservoir ですが動水位（hydraulic_grade）が未入力のため head を設定していません。解析タブで確認してください。`)
  }
  return result
}

/**
 * 読み取り済み Excel ワークブックを、各 RunKind の `runInputs` 候補に変換する。
 *
 * 部分データでも例外を投げない — 揃っている項目だけをマッピングし、
 * 省略・既定値化した項目は必ず `warnings` に理由を積む。
 */
export function mapWorkbookToRunInputs(data: WorkbookData): { runInputs: Partial<Record<RunKind, unknown>>; warnings: string[] } {
  const warnings: string[] = []
  const runInputs: Partial<Record<RunKind, unknown>> = {}

  const pipe = data.pipes[0]
  const calculationCase = data.cases[0]

  if (pipe) {
    runInputs.wave_speed = { pipe }
    if (calculationCase) {
      runInputs.joukowsky_allievi = { pipe, calculationCase }
    } else {
      warnings.push('ケース設定シートに計算ケースが1件もないため、joukowsky_allievi の入力は作成しませんでした。')
    }
  } else {
    warnings.push('管路・節点シートに管路データがないため、wave_speed / joukowsky_allievi の入力は作成しませんでした。')
  }

  if (data.measurementPoints.length > 0) {
    runInputs.longitudinal_hydraulics = { points: data.measurementPoints, staticWaterLevel: 0 }
    warnings.push('longitudinal_hydraulics の静水位（staticWaterLevel）は既定値 0 で作成しました。解析タブで実際の値を確認・入力してください。')
  }

  if (data.pipes.length > 0 && data.nodes.length > 0) {
    const network = {
      pipes: data.pipes.map(toNetworkPipe),
      nodes: data.nodes.map((node) => toNetworkNode(node, warnings)),
    }
    runInputs.steady_network_python = network
    runInputs.steady_network_epanet = network
  } else if (data.pipes.length > 0 || data.nodes.length > 0) {
    warnings.push('管路・節点シートに管路と節点の両方が揃っていないため、steady_network_python / steady_network_epanet の入力は作成しませんでした。')
  }

  return { runInputs, warnings }
}
