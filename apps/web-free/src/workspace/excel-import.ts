import type { RunKind } from '@open-waterhammer/contracts'
import {
  buildCanonicalHydraulicModel,
  canonicalToLongitudinalInput,
  canonicalToSteadyNetwork,
  type CanonicalHydraulicModel,
  type CanonicalModelIssue,
} from '@open-waterhammer/core'
import type { WorkbookData } from '@open-waterhammer/excel-io'

/**
 * Excel 取込 → runInputs マッピング（純粋関数）
 *
 * `WorkbookData.pipes[]` / `.cases[]` / `.measurementPoints[]` は
 * `@open-waterhammer/core` の `Pipe` / `CalculationCase` / `MeasurementPoint`
 * 型そのもの（packages/excel-io/src/types.ts）であり、これは
 * `workspace/sample-workspace.ts` の `SAMPLE_RUN_INPUTS` および
 * `packages/core-py/open_waterhammer/protocol.py` の
 * `_wave_speed` / `_joukowsky_allievi` が読む
 * `model.pipe` / `model.calculationCase` / `model.points[]` と
 * フィールド名が一致する。縦断入力は測点表を直接使わず、
 * 正準水理モデルから管路の正本値を参照して導出する。
 *
 * 管路網（steady_network_python / steady_network_epanet）のノード種別は
 * Excel の `Node.nodeType`
 * (`reservoir|junction|tank|pump_node|valve_node`) と
 * `NetworkNodeDef.type` (`reservoir|demand|junction`,
 * packages/core/src/steady-network.ts) は別の enum。
 */

type NodeRow = WorkbookData['nodes'][number]

export interface ExcelScenarioInput {
  sourceCaseId: string
  name: string
  eventSettings: Record<string, unknown>
}

/**
 * 読み取り済み Excel ワークブックを、各 RunKind の `runInputs` 候補に変換する。
 *
 * 部分データでも例外を投げない — 揃っている項目だけをマッピングし、
 * 省略・既定値化した項目は必ず `warnings` に理由を積む。
 */
export function mapWorkbookToRunInputs(data: WorkbookData): {
  runInputs: Partial<Record<RunKind, unknown>>
  eventSettings: Record<string, unknown>
  scenarios: ExcelScenarioInput[]
  canonicalModel: CanonicalHydraulicModel
  canonicalIssues: CanonicalModelIssue[]
  warnings: string[]
} {
  const warnings: string[] = []
  const runInputs: Partial<Record<RunKind, unknown>> = {}
  // 操作条件はモデル側ではなくシナリオの eventSettings に入る
  // （core-py の protocol.py は closeTime をここから読む）。
  const eventSettings: Record<string, unknown> = {}
  const scenarios = data.cases.map((item) => ({
    sourceCaseId: item.id,
    name: item.name,
    eventSettings: {
      sourceExcelCaseId: item.id,
      calculationCaseId: item.id,
      calculationCaseName: item.name,
      operationType: item.operationType,
      targetFacilityId: item.targetFacilityId,
      initialVelocity: item.initialVelocity,
      initialHead: item.initialHead,
      ...(item.closeTime !== undefined ? { closeTime: item.closeTime } : {}),
    },
  }))
  const canonical = buildCanonicalHydraulicModel({
    source: 'excel',
    nodes: data.nodes,
    pipes: data.pipes,
    measurementPoints: data.measurementPoints,
  })
  warnings.push(...canonical.issues.map(({ message }) => message))

  const pipe = data.pipes[0]
  const calculationCase = data.cases[0]

  if (calculationCase?.closeTime !== undefined) {
    eventSettings.closeTime = calculationCase.closeTime
  } else if (calculationCase && (calculationCase.operationType === 'valve_close' || calculationCase.operationType === 'valve_open')) {
    warnings.push(`ケース ${calculationCase.id}: 等価閉そく時間（close_time）が未入力のため、閉鎖時間は既定値のままにしました。解析タブで確認・入力してください。`)
  }

  if (pipe) {
    runInputs.wave_speed = { pipe }
    if (calculationCase) {
      // 許容圧力（呼び圧力）は管路が持つ。値があれば設計水圧の判定が走る
      // （core-py protocol.py の _joukowsky_allievi）。未入力なら判定しない。
      runInputs.joukowsky_allievi = {
        pipe,
        calculationCase,
        ...(pipe.allowablePressureMpa !== undefined ? { allowablePressureMpa: pipe.allowablePressureMpa } : {}),
      }
      if (pipe.allowablePressureMpa === undefined) {
        warnings.push(`管路 ${pipe.id}: 許容圧力（呼び圧力）が未入力のため、設計水圧の判定は行いません。解析タブで入力すると判定できます。`)
      }
    } else {
      warnings.push('シナリオ設定シートにシナリオが1件もないため、簡易水撃圧計算の入力は作成しませんでした。')
    }
  } else {
    warnings.push('管路・節点シートに管路データがないため、wave_speed / joukowsky_allievi の入力は作成しませんでした。')
  }

  if (data.measurementPoints.length > 0) {
    // 静水位は案件情報シートの static_water_level を正本にする。未入力のときだけ、
    // reservoir 節点の固定水頭で補い、それも無ければ 0 に落として警告を出す。
    const reservoirHead = data.nodes.find((node) => node.nodeType === 'reservoir')?.hydraulicGrade
    const staticWaterLevel = data.meta.staticWaterLevel ?? reservoirHead ?? 0
    if (data.meta.staticWaterLevel === undefined) {
      warnings.push(reservoirHead !== undefined
        ? `静水位（static_water_level）が未入力のため、reservoir 節点の固定水頭 ${reservoirHead} m を使いました。案件情報シートで確認してください。`
        : '静水位（static_water_level）が未入力のため、縦断水理計算の静水位は 0 で作成しました。このままでは全区間が負圧になります。案件情報シートまたは解析タブで入力してください。')
    }
    const longitudinal = canonicalToLongitudinalInput(canonical.model, staticWaterLevel)
    const allowable = pipe?.allowablePressureMpa
    runInputs.longitudinal_hydraulics = {
      ...(longitudinal.value ?? { points: data.measurementPoints, staticWaterLevel }),
      ...(allowable !== undefined ? { allowablePressureMpa: allowable } : {}),
    }
    if (!longitudinal.value) warnings.push('測点と管路の対応を解決できないため、後方互換用に測点表の重複値を使って縦断入力を作成しました。')
  }

  if (data.pipes.length > 0 && data.nodes.length > 0) {
    for (const node of data.nodes) {
      if (!(['reservoir', 'junction'] as NodeRow['nodeType'][]).includes(node.nodeType)) warnings.push(`節点 ${node.id}: 節点種別「${node.nodeType}」は定常管路網で junction として扱います。`)
      if (node.nodeType === 'reservoir' && node.hydraulicGrade === undefined) warnings.push(`節点 ${node.id}: reservoir の固定水頭が未入力です。解析タブで確認してください。`)
    }
    const network = canonicalToSteadyNetwork(canonical.model)
    if (network.value) {
      runInputs.steady_network_python = network.value
      runInputs.steady_network_epanet = network.value
    } else {
      warnings.push(...network.issues.map(({ message }) => message))
    }
  } else if (data.pipes.length > 0 || data.nodes.length > 0) {
    warnings.push('管路・節点シートに管路と節点の両方が揃っていないため、steady_network_python / steady_network_epanet の入力は作成しませんでした。')
  }

  return { runInputs, eventSettings, scenarios, canonicalModel: canonical.model, canonicalIssues: canonical.issues, warnings }
}
