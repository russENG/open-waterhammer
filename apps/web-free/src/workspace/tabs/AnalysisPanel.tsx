import { RUN_KINDS, type Case, type JsonValue, type Run, type RunKind } from '@open-waterhammer/contracts'
import { useMemo, useState } from 'react'

import { validateHydraulicDrafts, type HydraulicDraft } from '../../gis/import-model'
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
  const { run, saveModel, busy, lastError } = useWorkspace()
  const [kind, setKind] = useState<RunKind>('wave_speed')
  const modelRoot = root(caseRecord)
  const inputs = modelRoot.runInputs && typeof modelRoot.runInputs === 'object' && !Array.isArray(modelRoot.runInputs)
    ? modelRoot.runInputs as Record<string, JsonValue> : {}
  const [modelText, setModelText] = useState(() => JSON.stringify(inputs[kind] ?? {}, null, 2))
  const [status, setStatus] = useState<string | null>(null)
  const validation = useMemo(() => Array.isArray(modelRoot.geoDrafts)
    ? validateHydraulicDrafts(modelRoot.geoDrafts as unknown as HydraulicDraft[])
    : { canRun: true, errorsByFeature: {} }, [modelRoot.geoDrafts])

  function selectKind(next: RunKind) {
    setKind(next)
    setModelText(JSON.stringify(inputs[next] ?? {}, null, 2))
    setStatus(null)
  }

  async function saveInput() {
    try {
      await saveModel(caseRecord.id, kind, JSON.parse(modelText))
      setStatus('Input saved')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function execute() {
    if (!validation.canRun) {
      setStatus('Model validation blocks Run')
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
        <div className="analysis-editor-heading"><div><span className="eyebrow">{KIND_COPY[kind].code} INPUT</span><h2>{KIND_COPY[kind].title}</h2></div><span className={`validation-badge ${validation.canRun ? 'validation-badge--ok' : 'validation-badge--ng'}`}>{validation.canRun ? 'MODEL READY' : `${Object.keys(validation.errorsByFeature).length} INVALID`}</span></div>
        <p className="field-help">単位付き入力フォームの正準値を JSON で確認・編集します。各方式のフィールドは Case に保存され、Runner が選択した方式だけを読み取ります。</p>
        <label className="model-editor"><span>Canonical model input</span><textarea value={modelText} onChange={(event) => setModelText(event.target.value)} disabled={caseRecord.state !== 'draft'} spellCheck={false} /></label>
        <div className="analysis-actions"><button onClick={() => void saveInput()} disabled={busy || caseRecord.state !== 'draft'}>Save input</button><button className="run-button" onClick={() => void execute()} disabled={busy || caseRecord.state !== 'draft' || !validation.canRun} aria-label="Run calculation"><span>▶</span>{busy ? 'Running…' : 'Run calculation'}</button></div>
        {(status || lastError) && <p className="inline-message" role="status">{status ?? lastError}</p>}
      </section>
    </div>
  </div>
}
