import type { Case, JsonValue, RunKind } from '@open-waterhammer/contracts'

import { validateHydraulicDrafts, type HydraulicDraft } from '../gis/import-model'

/**
 * ネットワーク（節点・管路グラフ）を実際に消費する RunKind の集合。
 *
 * 根拠 (2026-08 時点、実装時に再確認):
 * - `packages/core-py/open_waterhammer/protocol.py` の `HANDLERS`:
 *   `steady_network_python` → `_steady_network` は `model.pipes` / `model.nodes`
 *   を必須で読む（`_required(model, "pipes")` / `_required(model, "nodes")`）。
 *   `transient_network` と `transient_protection_device` はどちらも
 *   `_transient_network` にマップされ、`_network()` 経由で
 *   `model.network.pipes` / `model.network.nodes` を必須で読む。
 * - `packages/runner/src/epanet.ts` の `createEpanetExecutor` は
 *   `caseSnapshot.modelSnapshot` をそのまま `@open-waterhammer/core` の
 *   `SteadyNetworkInput`（`{ pipes: NetworkPipeDef[]; nodes: NetworkNodeDef[] }`）
 *   として EPANET アダプタへ渡す — `steady_network_epanet` も同じ節点・管路
 *   グラフを消費する。
 * 他の 7 種類（wave_speed / joukowsky_allievi / empirical_pressure /
 * steady_single_pipe / longitudinal_hydraulics / transient_single_pipe /
 * transient_pump）は単一管路 (`model.pipe`) や測点列 (`model.points`) のみを
 * 読み、節点・管路グラフを一切参照しない — 純粋なフォーム計算。
 */
export const TOPOLOGY_REQUIRED_KINDS: ReadonlySet<RunKind> = new Set<RunKind>([
  'steady_network_python',
  'steady_network_epanet',
  'transient_network',
  'transient_protection_device',
])

export interface RunGate {
  canRun: boolean
  reason: 'topology_required' | 'topology_invalid' | null
  errorsByFeature: Record<string, string[]>
}

function asRecord(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, JsonValue> : undefined
}

function geoDraftsOf(caseRecord: Case): HydraulicDraft[] {
  const snapshot = asRecord(caseRecord.modelSnapshot)
  return snapshot && Array.isArray(snapshot.geoDrafts) ? snapshot.geoDrafts as unknown as HydraulicDraft[] : []
}

function savedModelFor(caseRecord: Case, kind: RunKind): Record<string, JsonValue> | undefined {
  const snapshot = asRecord(caseRecord.modelSnapshot)
  const runInputs = snapshot && asRecord(snapshot.runInputs)
  return asRecord(runInputs?.[kind])
}

function hasNonEmptyArray(value: JsonValue | undefined): boolean {
  return Array.isArray(value) && value.length > 0
}

/**
 * Case に保存済みの Run 入力 (`runInputs[kind]`) だけを見て、その kind のネットワーク
 * トポロジ（節点・管路）が空でないかを判定する。GIS drafts の状態とは無関係に、
 * フォーム（将来的には Excel 取込等）で完結させた入力を許容するための
 * 「構造的完全性」チェック。参照整合性（存在しない節点 ID の参照など）はここでは
 * 見ない — それは `validateEngineeringState` と、最終的には Python プロトコルの
 * `_required()` / `ProtocolError` が担う（binding constraint: 不完全なネットワークが
 * Python に届いた場合は Run failed として記録される、というバックストップ）。
 */
function hasStructurallyCompleteNetwork(kind: RunKind, caseRecord: Case): boolean {
  const model = savedModelFor(caseRecord, kind)
  if (!model) return false
  if (kind === 'transient_network' || kind === 'transient_protection_device') {
    const network = asRecord(model.network)
    const nodes = network && asRecord(network.nodes)
    return network !== undefined && hasNonEmptyArray(network.pipes) && nodes !== undefined && Object.keys(nodes).length > 0
  }
  return hasNonEmptyArray(model.pipes) && hasNonEmptyArray(model.nodes)
}

/**
 * Run 実行可否ゲート。
 *
 * controller の裁定「ゲートは計算が実際に消費するものを基準にする」に基づき
 * kind ごとに判定する（Step 0 調査結果 = Outcome A: GIS drafts は検証・表示専用の
 * 並行データで、Run が消費する `runInputs[kind]` へは決して合流しない。フォーム
 * `saveModel` だけが `runInputs[kind]` を書く）:
 *
 * - トポロジ不要 (フォーム単独) kind は常に `canRun: true` — 新規 Case でも
 *   即座に実行できる。GIS drafts が壊れていてもブロックしない。ただし
 *   `errorsByFeature` は常に返し、呼び出し側 (UI) が非ブロッキングな注意書きを
 *   表示できるようにする。
 * - トポロジ必須 kind (`TOPOLOGY_REQUIRED_KINDS`) は
 *   「有効な GIS drafts が永続化されている」OR
 *   「その kind の `runInputs` が構造的に完結したネットワークを保持している」
 *   のいずれかで実行可能 (Outcome A の OR 分岐)。どちらも満たさない場合、
 *   GIS drafts が一件もなければ `topology_required`、
 *   GIS drafts はあるが検証エラーを含む場合は `topology_invalid` を返す。
 */
export function evaluateRunGate(kind: RunKind, caseRecord: Case): RunGate {
  const drafts = geoDraftsOf(caseRecord)
  const { canRun: draftsValid, errorsByFeature } = validateHydraulicDrafts(drafts)

  if (!TOPOLOGY_REQUIRED_KINDS.has(kind)) {
    return { canRun: true, reason: null, errorsByFeature }
  }
  if (draftsValid || hasStructurallyCompleteNetwork(kind, caseRecord)) {
    return { canRun: true, reason: null, errorsByFeature }
  }
  return { canRun: false, reason: drafts.length > 0 ? 'topology_invalid' : 'topology_required', errorsByFeature }
}
