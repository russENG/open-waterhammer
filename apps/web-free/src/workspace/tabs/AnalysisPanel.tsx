import { RUN_KINDS, type Case, type JsonValue, type Run, type RunKind } from '@open-waterhammer/contracts'
import { useMemo, useState } from 'react'

import { validateHydraulicDrafts, type HydraulicDraft } from '../../gis/import-model'
import {
  ENGINEERING_FIELDS,
  readEngineeringValue,
  updateEngineeringValue,
  validateEngineeringState,
  type EngineeringField,
  type EngineeringState,
} from '../engineering-fields'
import { useWorkspace } from '../workspace-context'

const KIND_COPY: Record<RunKind, { code: string; title: string; note: string }> = {
  wave_speed: { code: 'A01', title: 'Wave speed', note: '管材・管厚・拘束条件' },
  joukowsky_allievi: { code: 'A02', title: 'Joukowsky / Allievi', note: '急閉・緩閉の比較式' },
  empirical_pressure: { code: 'A03', title: 'Empirical pressure', note: '経験則による概略値' },
  steady_single_pipe: { code: 'S01', title: 'Steady single pipe', note: '損失水頭と動水位' },
  steady_network_python: { code: 'S02', title: 'Steady network / Python', note: '節点・管路網の定常解' },
  steady_network_epanet: { code: 'S03', title: 'Steady network / EPANET', note: 'JavaScript WASM adapter' },
  longitudinal_hydraulics: { code: 'L01', title: 'Longitudinal hydraulics', note: '縦断・設計内圧' },
  transient_single_pipe: { code: 'T01', title: 'Transient single pipe', note: '特性曲線法・単一路線' },
  transient_network: { code: 'T02', title: 'Transient network', note: '分岐・合流の過渡解析' },
  transient_pump: { code: 'T03', title: 'Pump transient', note: '停止・始動イベント' },
  transient_protection_device: { code: 'T04', title: 'Protection device', note: '空気室・サージタンク' },
}

function root(caseRecord: Case): Record<string, JsonValue> {
  const model = caseRecord.modelSnapshot
  return model && typeof model === 'object' && !Array.isArray(model) ? model as Record<string, JsonValue> : {}
}

export function AnalysisPanel({ caseRecord, onRunSelected }: { caseRecord: Case; onRunSelected(run: Run): void }) {
  const { data, run, saveModel, busy, lastError } = useWorkspace()
  const scenario = data.scenarios.find(({ caseId }) => caseId === caseRecord.id)
  const [kind, setKind] = useState<RunKind>('wave_speed')
  const modelRoot = root(caseRecord)
  const inputs = modelRoot.runInputs && typeof modelRoot.runInputs === 'object' && !Array.isArray(modelRoot.runInputs)
    ? modelRoot.runInputs as Record<string, JsonValue> : {}
  const initialEngineering = (): EngineeringState => ({
    model: inputs[kind] ?? {},
    event: scenario?.eventSettings ?? {},
    boundary: scenario?.boundaryConditions ?? {},
    protection: scenario?.protectionSettings ?? {},
  })
  const [engineering, setEngineering] = useState<EngineeringState>(initialEngineering)
  const [modelText, setModelText] = useState(() => JSON.stringify(engineering.model, null, 2))
  const [status, setStatus] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const hasHydraulicDrafts = Array.isArray(modelRoot.geoDrafts) && modelRoot.geoDrafts.length > 0
  const validation = useMemo(() => validateHydraulicDrafts(
    Array.isArray(modelRoot.geoDrafts) ? modelRoot.geoDrafts as unknown as HydraulicDraft[] : [],
  ), [modelRoot.geoDrafts])

  function selectKind(next: RunKind) {
    setKind(next)
    const nextEngineering: EngineeringState = {
      model: inputs[next] ?? {}, event: scenario?.eventSettings ?? {},
      boundary: scenario?.boundaryConditions ?? {}, protection: scenario?.protectionSettings ?? {},
    }
    setEngineering(nextEngineering)
    setModelText(JSON.stringify(nextEngineering.model, null, 2))
    setDirty(false)
    setStatus(null)
  }

  function updateField(field: EngineeringField, raw: string) {
    const value: JsonValue = field.kind === 'number' ? (raw === '' ? '' : Number(raw)) : raw
    const next = updateEngineeringValue(engineering, field, value)
    setEngineering(next)
    setModelText(JSON.stringify(next.model, null, 2))
    setDirty(true)
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
      setStatus('Input saved')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function execute() {
    if (dirty) {
      setStatus('Save input before Run')
      return
    }
    if (!validation.canRun) {
      setStatus('Model validation blocks Run')
      return
    }
    const fieldErrors = validateEngineeringState(kind, engineering)
    if (fieldErrors.length) {
      setStatus(fieldErrors[0]!.message)
      return
    }
    try {
      const result = await run(caseRecord.id, kind)
      onRunSelected(result)
      setStatus(result.status === 'succeeded' ? 'Run succeeded' : `Run ${result.status}: ${result.error?.message ?? ''}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  return <div className="panel-stack analysis-panel">
    <div className="panel-title-row"><div><span className="eyebrow">LOCAL CALCULATION / 04</span><h1>Analysis</h1><p>11種類の計算は共通 CalculationRunner を経由し、完了した Run が Case を固定します。</p></div><span className="offline-ticket">LOCAL / OFFLINE</span></div>
    <div className="analysis-layout">
      <div className="run-kind-list" role="radiogroup" aria-label="Run kind">
        {RUN_KINDS.map((item) => <label key={item} className={item === kind ? 'run-kind-card run-kind-card--active' : 'run-kind-card'}>
          <input type="radio" name="run-kind" value={item} checked={item === kind} onChange={() => selectKind(item)} />
          <span>{KIND_COPY[item].code}</span><div><strong>{KIND_COPY[item].title}</strong><small>{KIND_COPY[item].note}</small></div>
        </label>)}
      </div>
      <section className="analysis-editor notebook-card">
        <div className="analysis-editor-heading"><div><span className="eyebrow">{KIND_COPY[kind].code} INPUT</span><h2>{KIND_COPY[kind].title}</h2></div><span className={`validation-badge ${validation.canRun ? 'validation-badge--ok' : 'validation-badge--ng'}`}>{validation.canRun ? 'MODEL READY' : hasHydraulicDrafts ? `${Object.keys(validation.errorsByFeature).length} INVALID` : 'GIS / TOPOLOGY REQUIRED'}</span></div>
        <p className="field-help">方式別の主要設計値を単位付きで編集します。Scenario に属する操作条件も同じ保存操作で記録されます。</p>
        <div className="engineering-field-grid">{ENGINEERING_FIELDS[kind].map((field) => {
          const value = readEngineeringValue(engineering, field)
          const id = `engineering-${field.target}-${field.path.replace(/[^a-zA-Z0-9]/g, '-')}`
          return <label key={`${field.target}.${field.path}`} htmlFor={id}><span>{field.label}{field.unit && <b>{field.unit}</b>}</span>{field.kind === 'select'
            ? <select id={id} value={typeof value === 'string' ? value : ''} onChange={(event) => updateField(field, event.target.value)} disabled={caseRecord.state !== 'draft'}>{field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            : <input id={id} type={field.kind === 'number' ? 'number' : 'text'} step={field.kind === 'number' ? 'any' : undefined} value={typeof value === 'string' || typeof value === 'number' ? value : ''} onChange={(event) => updateField(field, event.target.value)} disabled={caseRecord.state !== 'draft'} />}</label>
        })}</div>
        <details className="advanced-json"><summary>Advanced · canonical JSON</summary><label className="model-editor"><span>Model input</span><textarea value={modelText} onChange={(event) => { setModelText(event.target.value); setDirty(true); try { setEngineering({ ...engineering, model: JSON.parse(event.target.value) as JsonValue }) } catch { /* Retain invalid draft text until save. */ } }} disabled={caseRecord.state !== 'draft'} spellCheck={false} /></label></details>
        <div className="analysis-actions"><button onClick={() => void saveInput()} disabled={busy || caseRecord.state !== 'draft'}>Save input</button><button className="run-button" onClick={() => void execute()} disabled={busy || dirty || caseRecord.state !== 'draft' || !validation.canRun} aria-label="Run calculation"><span>▶</span>{busy ? 'Running…' : dirty ? 'Save before Run' : 'Run calculation'}</button></div>
        {(status || lastError) && <p className="inline-message" role="status">{status ?? lastError}</p>}
      </section>
    </div>
  </div>
}
