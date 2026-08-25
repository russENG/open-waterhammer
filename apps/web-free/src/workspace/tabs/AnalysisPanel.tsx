import { RUN_KINDS, type Case, type JsonValue, type Run, type RunKind, type Scenario } from '@open-waterhammer/contracts'
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
import { MethodSelectionGuide } from '../MethodSelectionGuide'
import { evaluateRunGate, TOPOLOGY_REQUIRED_KINDS } from '../run-policy'
import { useWorkspace } from '../workspace-context'

const KIND_COPY: Record<RunKind, { code: string; title: string; note: string }> = {
  wave_speed: { code: 'A01', title: '波速', note: '管材・管厚・拘束条件' },
  joukowsky_allievi: { code: 'A02', title: 'Joukowsky / Allievi', note: '急閉・緩閉の比較式' },
  empirical_pressure: { code: 'A03', title: '経験式による水撃圧', note: '経験則による概略値' },
  steady_single_pipe: { code: 'S01', title: '単一管路の定常解析', note: '損失水頭と動水位' },
  steady_network_python: { code: 'S02', title: '管路網の定常解析 / Python', note: '節点・管路網の定常解' },
  steady_network_epanet: { code: 'S03', title: '管路網の定常解析 / EPANET', note: 'EPANETによる定常解' },
  longitudinal_hydraulics: { code: 'L01', title: '縦断水理計算', note: '縦断・設計内圧' },
  transient_single_pipe: { code: 'T01', title: '単一管路の過渡解析', note: '特性曲線法・単一路線' },
  transient_network: { code: 'T02', title: '管路網の過渡解析', note: '分岐・合流の過渡解析' },
  transient_pump: { code: 'T03', title: 'ポンプ過渡解析', note: '停止・始動イベント' },
  transient_protection_device: { code: 'T04', title: '水撃圧対策設備', note: '空気室・サージタンク' },
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
}: {
  caseRecord: Case
  scenarios: Scenario[]
  scenario?: Scenario
  onScenarioSelect(scenarioId: string): void
  onRunSelected(run: Run): void
}) {
  const { run, saveModel, busy, lastError } = useWorkspace()
  const [kind, setKind] = useState<RunKind>('wave_speed')
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
  const collections = ENGINEERING_COLLECTIONS[kind]

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
    <div className="panel-title-row"><div><span className="eyebrow">ローカル計算 / 04</span><h1>解析</h1><p>選択した比較案とシナリオの組合せで計算し、成功時に入力条件を固定します。</p></div><label><span>計算するシナリオ</span><select aria-label="計算するシナリオ" value={scenario?.id ?? ''} onChange={(event) => onScenarioSelect(event.target.value)}>{scenarios.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
    <details className="method-selection-guide"><summary>計算方法の選び方（§8.3.2 参照）</summary><MethodSelectionGuide onRecommend={selectKind} /></details>
    <div className="analysis-layout">
      <div className="run-kind-list" role="radiogroup" aria-label="計算の種類">
        {RUN_KINDS.map((item) => <label key={item} className={item === kind ? 'run-kind-card run-kind-card--active' : 'run-kind-card'}>
          <input type="radio" name="run-kind" value={item} checked={item === kind} onChange={() => selectKind(item)} />
          <span>{KIND_COPY[item].code}</span><div><strong>{KIND_COPY[item].title}</strong><small>{KIND_COPY[item].note}</small></div>
        </label>)}
      </div>
      <section className="analysis-editor notebook-card">
        <div className="analysis-editor-heading"><div><span className="eyebrow">{KIND_COPY[kind].code} 入力</span><h2>{KIND_COPY[kind].title}</h2></div><span className={`validation-badge ${gate.canRun ? 'validation-badge--ok' : 'validation-badge--ng'}`}>{!isTopologyKind ? 'フォーム入力のみ' : gate.canRun ? 'モデル準備完了' : gate.reason === 'topology_invalid' ? `不正要素 ${Object.keys(gate.errorsByFeature).length}件` : 'GIS / 管路網データが必要'}</span></div>
        <p className="field-help">方式別の主要設計値を単位付きで編集します。シナリオに属する操作条件も同じ保存操作で記録されます。</p>
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
        <div className="engineering-field-grid">{fields.map((field) => {
          const value = readEngineeringValue(engineering, field)
          const id = `engineering-${field.target}-${field.path.replace(/[^a-zA-Z0-9]/g, '-')}`
          return <label key={`${field.target}.${field.path}`} htmlFor={id}><span>{field.label}{field.unit && <b>{field.unit}</b>}</span>{field.kind === 'select'
            ? <select id={id} value={typeof value === 'string' ? value : ''} onChange={(event) => updateField(field, event.target.value)} disabled={caseRecord.state !== 'draft'}><option value="">選択してください</option>{field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            : field.kind === 'boolean'
              ? <input id={id} type="checkbox" checked={value === true} onChange={(event) => updateField(field, event.target.checked)} disabled={caseRecord.state !== 'draft'} />
              : <input id={id} type={field.kind === 'number' ? 'number' : 'text'} step={field.kind === 'number' ? 'any' : undefined} value={typeof value === 'string' || typeof value === 'number' ? value : ''} onChange={(event) => updateField(field, event.target.value)} disabled={caseRecord.state !== 'draft'} />}</label>
        })}</div>
        <details className="advanced-json"><summary>詳細設定 · 正準JSON</summary><label className="model-editor"><span>モデル入力</span><textarea value={modelText} onChange={(event) => { setModelText(event.target.value); setDirty(true); try { setEngineering({ ...engineering, model: JSON.parse(event.target.value) as JsonValue }) } catch { /* Retain invalid draft text until save. */ } }} disabled={caseRecord.state !== 'draft'} spellCheck={false} /></label></details>
        <div className="analysis-actions"><button onClick={() => void saveInput()} disabled={busy || caseRecord.state !== 'draft'}>入力条件を保存</button><button className="run-button" onClick={() => void execute()} disabled={busy || dirty || caseRecord.state !== 'draft' || !gate.canRun} aria-label="計算を実行"><span>▶</span>{busy ? '計算中…' : dirty ? '入力条件の保存が必要' : '計算を実行'}</button></div>
        {(status || lastError) && <p className="inline-message" role="status">{status ?? lastError}</p>}
      </section>
    </div>
  </div>
}
