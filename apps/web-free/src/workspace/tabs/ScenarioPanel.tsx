import type { Scenario } from '@open-waterhammer/contracts'
import { useState } from 'react'

import { useWorkspace } from '../workspace-context'

function objectText(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

export function ScenarioPanel({ scenario, locked }: { scenario?: Scenario; locked: boolean }) {
  const { saveScenario, busy } = useWorkspace()
  const [name, setName] = useState(scenario?.name ?? '')
  const [boundary, setBoundary] = useState(objectText(scenario?.boundaryConditions ?? {}))
  const [event, setEvent] = useState(objectText(scenario?.eventSettings ?? {}))
  const [protection, setProtection] = useState(objectText(scenario?.protectionSettings ?? {}))
  const [message, setMessage] = useState<string | null>(null)

  async function save() {
    if (!scenario) return
    try {
      await saveScenario({
        ...scenario, name,
        boundaryConditions: JSON.parse(boundary),
        eventSettings: JSON.parse(event),
        protectionSettings: JSON.parse(protection),
      })
      setMessage('シナリオを保存しました')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  return <div className="panel-stack">
    <div className="panel-title-row"><div><span className="eyebrow">境界条件の記録 / 03</span><h1>シナリオ</h1><p>境界条件、操作イベント、防護工条件を計算結果から独立したスナップショットとして記録します。</p></div>{locked && <span className="lock-note">計算済み・固定 · 複製して編集</span>}</div>
    <fieldset disabled={locked || busy} className="scenario-fieldset">
      <label className="field-wide"><span>シナリオ名</span><input value={name} onChange={(eventObject) => setName(eventObject.target.value)} /></label>
      <div className="json-editor-grid">
        <label><span>境界条件</span><textarea value={boundary} onChange={(eventObject) => setBoundary(eventObject.target.value)} spellCheck={false} /></label>
        <label><span>操作イベント</span><textarea value={event} onChange={(eventObject) => setEvent(eventObject.target.value)} spellCheck={false} /></label>
        <label><span>防護工条件</span><textarea value={protection} onChange={(eventObject) => setProtection(eventObject.target.value)} spellCheck={false} /></label>
      </div>
      <button className="primary-button" onClick={() => void save()} type="button">シナリオを保存</button>
    </fieldset>
    {message && <p className="inline-message" role="status">{message}</p>}
  </div>
}
