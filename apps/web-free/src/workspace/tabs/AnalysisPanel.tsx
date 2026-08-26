import type { Case, JsonValue, Run, RunKind, Scenario } from '@open-waterhammer/contracts'
import { useMemo, useState } from 'react'

import {
  ENGINEERING_COLLECTIONS,
  addEngineeringCollectionItem,
  createEngineeringState,
  engineeringFieldsFor,
  readEngineeringValue,
  removeEngineeringCollectionItem,
  renameEngineeringRecordKey,
  updateEngineeringFieldFromInput,
  validateEngineeringState,
  type EngineeringField,
  type EngineeringState,
} from '../engineering-fields'
import { engineeringFieldKey, isAdvancedEngineeringField } from '../analysis-methods'
import { MethodSelectionGuide } from '../MethodSelectionGuide'
import { evaluateRunGate, TOPOLOGY_REQUIRED_KINDS } from '../run-policy'
import { useWorkspace } from '../workspace-context'
import { AnalysisMethodSelector } from './AnalysisMethodSelector'
import { EngineeringFieldControl } from './EngineeringFieldControl'
import './AnalysisPanel.css'

const KIND_COPY: Record<RunKind, { code: string; title: string; note: string }> = {
  wave_speed: { code: 'A01', title: '波速', note: '管材・管厚・拘束条件' },
  joukowsky_allievi: { code: 'A02', title: 'Joukowsky / Allievi', note: '急閉・緩閉の比較式' },
  empirical_pressure: { code: 'A03', title: '経験式による水撃圧', note: '経験則による概略値' },
  steady_single_pipe: { code: 'S01', title: '単一管路の定常解析', note: '損失水頭と動水位' },
  steady_network_python: { code: 'S02', title: '管路網の定常解析 / Python', note: '節点・管路網の定常解' },
  steady_network_epanet: { code: 'S03', title: '管路網の定常解析 / EPANET', note: 'EPANETによる定常解' },
  longitudinal_hydraulics: { code: 'L01', title: '縦断水理計算', note: '縦断・設計内圧' },
  transient_single_pipe: { code: 'T01', title: '単一管路の過渡解析', note: '特性曲線法・単一路線' },
  transient_network: { code: 'T02', title: '管路網の過渡解析', note: 'EPANET定常状態から開始・分岐・合流' },
  transient_pump: { code: 'T03', title: 'ポンプ過渡解析', note: '停止・始動イベント' },
  transient_protection_device: { code: 'T04', title: '水撃圧対策設備', note: 'EPANET定常状態から開始・空気室・サージタンク' },
}

function root(caseRecord: Case): Record<string, JsonValue> {
  const model = caseRecord.modelSnapshot
  return model && typeof model === 'object' && !Array.isArray(model) ? model as Record<string, JsonValue> : {}
}

export function AnalysisPanel({
  caseRecord,
  scenarios,
  scenario,
  onScenarioSelect,
  onRunSelected,
  onFork,
}: {
  caseRecord: Case
  scenarios: Scenario[]
  scenario?: Scenario
  onScenarioSelect(scenarioId: string): void
  onRunSelected(run: Run): void
  /** 固定済みの比較案を複製するダイアログを開く。ロック中の復帰導線をこのタブにも置くため。 */
  onFork(): void
}) {
  const { run, saveModel, busy, lastError } = useWorkspace()
  // 既定は主要解析。以前の既定 wave_speed は準備計算で、時系列も圧力包絡も出力しない
  // ため、「サンプルを開く → 計算を実行 → 結果」をそのまま辿ると結果タブが空欄ばかりに
  // なり、計算が失敗したのか方式の違いなのか読み取れなかった。
  // 推奨は管路網の過渡解析だが、これはトポロジ必須なので、まだモデルの無い新規比較案では
  // 開いた瞬間に実行できない状態から始まってしまう。その場合はフォーム入力だけで完結する
  // 単一管路の過渡解析（同じ主要解析グループ）に倒す。
  const [kind, setKind] = useState<RunKind>(() => (
    evaluateRunGate('transient_network', caseRecord).canRun ? 'transient_network' : 'transient_single_pipe'
  ))
  const modelRoot = root(caseRecord)
  const inputs = modelRoot.runInputs && typeof modelRoot.runInputs === 'object' && !Array.isArray(modelRoot.runInputs)
    ? modelRoot.runInputs as Record<string, JsonValue> : {}
  const initialEngineering = (): EngineeringState => createEngineeringState(kind, inputs[kind], scenario)
  const [engineering, setEngineering] = useState<EngineeringState>(initialEngineering)
  const [modelText, setModelText] = useState(() => JSON.stringify(engineering.model, null, 2))
  const [status, setStatus] = useState<string | null>(null)
  const [dirty, setDirty] = useState(inputs[kind] === undefined)
  const [recordKeyDrafts, setRecordKeyDrafts] = useState<Record<string, string>>({})
  const hasHydraulicDrafts = Array.isArray(modelRoot.geoDrafts) && modelRoot.geoDrafts.length > 0
  const gate = useMemo(() => evaluateRunGate(kind, caseRecord), [caseRecord, kind])
  const isTopologyKind = TOPOLOGY_REQUIRED_KINDS.has(kind)
  const draftsBrokenNonBlocking = !isTopologyKind && hasHydraulicDrafts && Object.keys(gate.errorsByFeature).length > 0
  const fields = engineeringFieldsFor(kind, engineering)
  const primaryFields = fields.filter((field) => !isAdvancedEngineeringField(kind, field))
  const advancedFields = fields.filter((field) => isAdvancedEngineeringField(kind, field))
  const collections = ENGINEERING_COLLECTIONS[kind]
  // 計算が成功すると比較案は locked になり、入力も実行もできなくなる。
  // 理由と復帰手段をこのタブに出さないと、利用者は次に何をすればよいか分からない。
  const locked = caseRecord.state !== 'draft'
  // この計算方法の入力が保存されていない = 画面の値は組み込みの既定値であって、
  // Excel から取り込んだ値ではない。黙って計算させると出所を誤解する。
  const usingDefaults = inputs[kind] === undefined
  const hasExcelImport = modelRoot.excelImport !== undefined

  function selectKind(next: RunKind) {
    setKind(next)
    const nextEngineering = createEngineeringState(next, inputs[next], scenario)
    setEngineering(nextEngineering)
    setModelText(JSON.stringify(nextEngineering.model, null, 2))
    setDirty(inputs[next] === undefined)
    setRecordKeyDrafts({})
    setStatus(null)
  }

  function updateField(field: EngineeringField, raw: string | boolean) {
    const next = updateEngineeringFieldFromInput(engineering, field, raw, kind)
    setEngineering(next)
    setModelText(JSON.stringify(next.model, null, 2))
    setDirty(true)
  }

  function addCollection(collection: typeof collections[number]) {
    const next = addEngineeringCollectionItem(engineering, collection)
    setEngineering(next)
    setModelText(JSON.stringify(next.model, null, 2))
    setDirty(true)
    setStatus(null)
  }

  function removeCollection(collection: typeof collections[number], index: number | string) {
    try {
      const next = removeEngineeringCollectionItem(engineering, collection, index)
      setEngineering(next)
      setModelText(JSON.stringify(next.model, null, 2))
      setDirty(true)
      setStatus(null)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  function renameCollectionKey(collection: typeof collections[number], from: string) {
    try {
      const draftKey = `${collection.target}.${collection.path}.${from}`
      const next = renameEngineeringRecordKey(engineering, collection, from, recordKeyDrafts[draftKey] ?? from)
      setEngineering(next)
      setModelText(JSON.stringify(next.model, null, 2))
      setDirty(true)
      setRecordKeyDrafts((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== draftKey)))
      setStatus(null)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function saveInput() {
    try {
      const parsedModel = JSON.parse(modelText) as JsonValue
      const next = { ...engineering, model: parsedModel }
      const errors = validateEngineeringState(kind, next)
      if (errors.length) throw new Error(errors[0]!.message)
      await saveModel(caseRecord.id, kind, parsedModel, scenario ? {
        ...scenario,
        boundaryConditions: next.boundary,
        eventSettings: next.event,
        protectionSettings: next.protection,
      } : undefined)
      setEngineering(next)
      setDirty(false)
      setStatus('入力条件を保存しました')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function execute() {
    if (dirty) {
      setStatus('入力条件を保存してから計算を実行してください')
      return
    }
    if (!gate.canRun) {
      setStatus('モデルの検証エラーにより計算できません')
      return
    }
    const fieldErrors = validateEngineeringState(kind, engineering)
    if (fieldErrors.length) {
      setStatus(fieldErrors[0]!.message)
      return
    }
    try {
      const result = await run(caseRecord.id, kind, scenario?.id)
      onRunSelected(result)
      setStatus(result.status === 'succeeded' ? '計算が完了しました' : `計算に失敗しました：${result.error?.message ?? result.status}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  return <div className="panel-stack analysis-panel">
    <div className="panel-title-row"><div><span className="eyebrow">ローカル計算 / 04</span><h1>解析</h1><p>主要解析は特性曲線法による数値解析です。準備計算で条件を確認し、簡易式は概算・検算に使います。</p></div><label><span>計算するシナリオ</span><select aria-label="計算するシナリオ" value={scenario?.id ?? ''} onChange={(event) => onScenarioSelect(event.target.value)}>{scenarios.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
    <ol className="analysis-sequence" aria-label="推奨する解析順序">
      <li><b>1</b><span><strong>入力確認</strong>管路・節点・測点とシナリオを確認</span></li>
      <li><b>2</b><span><strong>準備計算</strong>波速・定常状態・縦断条件を確認</span></li>
      <li className="analysis-sequence--primary"><b>3</b><span><strong>主要解析</strong>特性曲線法で上昇圧・下降圧と防護効果を評価</span></li>
      <li><b>4</b><span><strong>簡易確認</strong>概算式と比較し採用値を検討</span></li>
    </ol>
    <details className="method-selection-guide"><summary>計算方法の選び方（§8.3.2 参照）</summary><MethodSelectionGuide onRecommend={selectKind} /></details>
    <div className="analysis-layout">
      <AnalysisMethodSelector selectedKind={kind} locked={caseRecord.state !== 'draft'} copy={KIND_COPY} onSelect={selectKind} />
      <section className="analysis-editor notebook-card">
        <div className="analysis-editor-heading"><div><span className="eyebrow">{KIND_COPY[kind].code} 入力</span><h2>{KIND_COPY[kind].title}</h2></div><span className={`validation-badge ${gate.canRun ? 'validation-badge--ok' : 'validation-badge--ng'}`}>{!isTopologyKind ? 'フォーム入力のみ' : gate.canRun ? 'モデル準備完了' : gate.reason === 'topology_invalid' ? `不正要素 ${Object.keys(gate.errorsByFeature).length}件` : 'GIS / 管路網データが必要'}</span></div>
        <p className="field-help">方式別の主要設計値を単位付きで編集します。シナリオに属する操作条件も同じ保存操作で記録されます。</p>
        {locked && <div className="analysis-notice analysis-notice--locked" role="note">
          <div><strong>この比較案は計算済みで固定されています</strong><p>入力条件と計算結果を証跡として残すため、変更できません。条件を変えて計算し直すには、変更理由を残して編集可能な複製を作ります。</p></div>
          <button type="button" className="primary-button" onClick={onFork}>複製して編集</button>
        </div>}
        {!locked && usingDefaults && <div className="analysis-notice" role="note">
          <div><strong>この計算方法の入力はまだ保存されていません</strong><p>{hasExcelImport
            ? 'Excelから作成されるのは 波速 / Joukowsky・Allievi / 縦断水理計算 の入力だけです。この方法の欄は組み込みの既定値なので、実際の管路諸元に置き換えてから保存してください。'
            : '欄の値は組み込みの既定値です。実際の設計値に置き換えてから保存してください。'}</p></div>
        </div>}
        {draftsBrokenNonBlocking && <p className="inline-message">GISの編集中データに不正要素が {Object.keys(gate.errorsByFeature).length} 件あります。この計算では使用しないため、実行を妨げません。</p>}
        {collections.length > 0 && <div className="engineering-collections">{collections.map((collection) => {
          const rows = readEngineeringValue(engineering, collection)
          const recordKeys = collection.kind === 'record' && rows && typeof rows === 'object' && !Array.isArray(rows) ? Object.keys(rows) : []
          const count = collection.kind === 'array' ? Array.isArray(rows) ? rows.length : 0 : recordKeys.length
          return <section key={`${collection.target}.${collection.path}`} className="engineering-collection"><div><strong>{collection.label}</strong><span>{count}件</span><button type="button" onClick={() => addCollection(collection)} disabled={caseRecord.state !== 'draft'} aria-label={`${collection.label}を追加`}>＋ 追加</button></div><ol>{collection.kind === 'array'
            ? Array.from({ length: count }, (_, index) => <li key={index}><span>{collection.label} {index + 1}</span><button type="button" onClick={() => removeCollection(collection, index)} disabled={caseRecord.state !== 'draft' || count <= collection.minimumItems} aria-label={`${collection.label} ${index + 1}を削除`}>削除</button></li>)
            : recordKeys.map((key) => {
                const draftKey = `${collection.target}.${collection.path}.${key}`
                return <li key={key} className="engineering-record-row"><label className="engineering-record-id"><span>{collection.label} ID</span><input aria-label={`${collection.label} ${key}の新しいID`} value={recordKeyDrafts[draftKey] ?? key} onChange={(event) => setRecordKeyDrafts((current) => ({ ...current, [draftKey]: event.target.value }))} disabled={caseRecord.state !== 'draft'} /></label><button type="button" onClick={() => renameCollectionKey(collection, key)} disabled={caseRecord.state !== 'draft' || (recordKeyDrafts[draftKey] ?? key) === key} aria-label={`${collection.label} ${key}のIDを変更`}>変更</button><button type="button" onClick={() => removeCollection(collection, key)} disabled={caseRecord.state !== 'draft' || count <= collection.minimumItems} aria-label={`${collection.label} ${key}を削除`}>削除</button></li>
              })}</ol></section>
        })}</div>}
        <div className="engineering-field-grid">{primaryFields.map((field) => <EngineeringFieldControl key={engineeringFieldKey(field)} field={field} value={readEngineeringValue(engineering, field)} locked={caseRecord.state !== 'draft'} onChange={(raw) => updateField(field, raw)} />)}</div>
        {advancedFields.length > 0 && <details className="advanced-engineering-fields"><summary>詳細な計算条件（{advancedFields.length}項目）</summary><p>通常は初期値を使います。式固有の条件や許容値を確認するときに開いてください。</p><div className="engineering-field-grid">{advancedFields.map((field) => <EngineeringFieldControl key={engineeringFieldKey(field)} field={field} value={readEngineeringValue(engineering, field)} locked={caseRecord.state !== 'draft'} onChange={(raw) => updateField(field, raw)} />)}</div></details>}
        <details className="advanced-json"><summary>詳細設定 · 正準JSON</summary><label className="model-editor"><span>モデル入力</span><textarea value={modelText} onChange={(event) => { setModelText(event.target.value); setDirty(true); try { setEngineering({ ...engineering, model: JSON.parse(event.target.value) as JsonValue }) } catch { /* Retain invalid draft text until save. */ } }} disabled={caseRecord.state !== 'draft'} spellCheck={false} /></label></details>
        <div className="analysis-actions"><button onClick={() => void saveInput()} disabled={busy || locked}>入力条件を保存</button><button className="run-button" onClick={() => void execute()} disabled={busy || dirty || locked || !gate.canRun} aria-label="計算を実行"><span>▶</span>{busy ? '計算中…' : locked ? '計算済み・固定' : dirty ? '入力条件の保存が必要' : '計算を実行'}</button></div>
        {(status || lastError) && <p className="inline-message" role="status">{status ?? lastError}</p>}
      </section>
    </div>
  </div>
}
