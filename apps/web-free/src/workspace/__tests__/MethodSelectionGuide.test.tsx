import { InMemoryWorkspaceRepository } from '@open-waterhammer/workspace'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'

import { AnalysisPanel } from '../tabs/AnalysisPanel'
import { MethodSelectionGuide } from '../MethodSelectionGuide'
import { buildSampleWorkspace } from '../sample-workspace'
import { WorkspaceProvider } from '../workspace-context'

function setupAnalysisPanel() {
  const data = buildSampleWorkspace('2026-08-23T01:02:03.000Z')
  const repository = new InMemoryWorkspaceRepository(data)
  const caseRecord = data.cases[0]!
  const scenarios = data.scenarios.filter(({ caseId }) => caseId === caseRecord.id)
  render(
    <WorkspaceProvider repository={repository} initialData={data}>
      <AnalysisPanel caseRecord={caseRecord} scenarios={scenarios} scenario={scenarios[0]} onScenarioSelect={() => {}} onRunSelected={() => {}} />
    </WorkspaceProvider>,
  )
  return { data, caseRecord }
}

describe('MethodSelectionGuide', () => {
  test('answering the sequence that leads to the empirical conclusion recommends empirical_pressure on click', async () => {
    const user = userEvent.setup()
    const onRecommend = vi.fn()
    render(<MethodSelectionGuide onRecommend={onRecommend} />)

    // Q1: 負圧（下降圧）の検討は不要
    await user.click(screen.getByRole('button', { name: 'いいえ' }))
    // Q2: オープンタイプである → 経験則による方法へ確定
    await user.click(screen.getByRole('button', { name: 'はい' }))

    expect(screen.getByText('経験則による方法（§8.3.2）')).toBeVisible()
    // The question wizard should be gone once a conclusion is reached.
    expect(screen.queryByRole('button', { name: 'はい' })).not.toBeInTheDocument()

    const empiricalButton = screen.getByRole('button', { name: /経験式による水撃圧/ })
    const joukowskyButton = screen.getByRole('button', { name: /Joukowsky \/ Allievi/ })
    expect(empiricalButton).toBeVisible()
    expect(joukowskyButton).toBeVisible()

    await user.click(empiricalButton)
    expect(onRecommend).toHaveBeenCalledExactlyOnceWith('empirical_pressure')
  })

  test('a pump-inclusive numerical path recommends transient_pump on click', async () => {
    const user = userEvent.setup()
    const onRecommend = vi.fn()
    render(<MethodSelectionGuide onRecommend={onRecommend} />)

    // Q1: 負圧（下降圧）の検討が必要 → 数値解法必須、Q4へ直行
    await user.click(screen.getByRole('button', { name: 'はい' }))
    // Q4: ポンプ急停止・起動のシナリオを含む
    await user.click(screen.getByRole('button', { name: 'はい' }))

    // Only the pump recommendation should be offered for this conclusion.
    expect(screen.queryByRole('button', { name: /経験式による水撃圧/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Transient single pipe/ })).not.toBeInTheDocument()

    const pumpButton = screen.getByRole('button', { name: /ポンプ過渡解析/ })
    await user.click(pumpButton)
    expect(onRecommend).toHaveBeenCalledExactlyOnceWith('transient_pump')
  })

  test('AnalysisPanel renders the guide collapsed by default and recommending switches the selected RunKind', async () => {
    const user = userEvent.setup()
    setupAnalysisPanel()

    expect(screen.getByRole('radio', { name: /波速/ })).toBeChecked()

    const summary = screen.getByText('計算方法の選び方（§8.3.2 参照）')
    const details = summary.closest('details')
    expect(details).not.toBeNull()
    expect(details).not.toHaveAttribute('open')

    await user.click(summary)
    expect(details).toHaveAttribute('open')

    // Drive the same empirical-conclusion path as above, scoped inside AnalysisPanel now.
    await user.click(screen.getByRole('button', { name: 'いいえ' }))
    await user.click(screen.getByRole('button', { name: 'はい' }))
    await user.click(screen.getByRole('button', { name: /経験式による水撃圧/ }))

    expect(screen.getByRole('radio', { name: /経験式による水撃圧/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /波速/ })).not.toBeChecked()
    expect(screen.getByRole('heading', { level: 2, name: '経験式による水撃圧' })).toBeVisible()
  })
})
