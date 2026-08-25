import {
  PRODUCT_VERSION,
  RUN_KINDS,
  type RunKind,
} from '@open-waterhammer/contracts'
import { createExecutorRegistry } from '@open-waterhammer/runner'
import { InMemoryWorkspaceRepository } from '@open-waterhammer/workspace'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { prefetchPyodide } from '../../lib/pyodide-bridge'
import { WorkspaceApp } from '../WorkspaceApp'
import { buildSampleWorkspace } from '../sample-workspace'

// Every scenario in this file injects an `executors` registry (below), which makes
// WorkspaceApp skip its real Pyodide prefetch (see the dedicated describe block at the
// bottom of this file). `prefetchPyodide` itself is still mocked out here so that the
// one scenario which intentionally omits `executors` never touches the real Pyodide/
// pyodide-bridge machinery — keeping this suite fast and network-free.
vi.mock('../../lib/pyodide-bridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/pyodide-bridge')>()
  return { ...actual, prefetchPyodide: vi.fn() }
})

const executor = async ({ kind, calculationInputHash }: { kind: RunKind; calculationInputHash: string }) => ({
  engine: 'integration-engine',
  runtime: 'browser-test',
  method: kind,
  numericParameters: {},
  boundaryParameters: {},
  summary: { maxPressureMpa: 1.24, minimumPressureMpa: 0.18 },
  timeSeries: { seconds: [0, 1, 2], pressureMpa: [0.8, 1.24, 0.9] },
  assessment: {
    status: 'warning' as const,
    findings: [{ targetRef: 'P-01', location: 'STA. 0+500', observedValue: 1.24, threshold: 1.2, unit: 'MPa', ruleId: 'NOCHI-8.3.4' }],
  },
  warnings: ['適用条件を確認してください。'],
  inputHash: calculationInputHash,
})

const executors = createExecutorRegistry(Object.fromEntries(
  RUN_KINDS.map((kind) => [kind, executor]),
) as Record<RunKind, typeof executor>)

function setup() {
  const data = buildSampleWorkspace('2026-08-23T01:02:03.000Z')
  const repository = new InMemoryWorkspaceRepository(data)
  render(<WorkspaceApp repository={repository} initialData={data} executors={executors} />)
  return { data, repository }
}

function setupWithoutExecutors() {
  const data = buildSampleWorkspace('2026-08-23T01:02:03.000Z')
  const repository = new InMemoryWorkspaceRepository(data)
  render(<WorkspaceApp repository={repository} initialData={data} />)
  return { data, repository }
}

async function waitForNewCase(repository: InMemoryWorkspaceRepository, originalIds: Set<string>) {
  let createdId = ''
  await waitFor(async () => {
    const created = (await repository.snapshot()).cases.find(({ id }) => !originalIds.has(id))
    expect(created).toBeDefined()
    createdId = created!.id
    expect(window.location.hash).toContain(`/cases/${createdId}/`)
    expect(document.querySelector('.workspace-tabs a')?.getAttribute('href')).toContain(`/cases/${createdId}/`)
  })
  return createdId
}

beforeEach(() => {
  localStorage.clear()
  window.location.hash = '#/projects/missing/cases/missing/not-a-tab'
})

afterEach(() => {
  window.location.hash = ''
})

describe('full workspace application', () => {
  test('falls back from an invalid hash route and exposes permanent product and limitations language', async () => {
    const { data } = setup()

    expect(await screen.findByRole('banner')).toHaveTextContent('alpha')
    expect(screen.getByRole('banner')).toHaveTextContent('設計比較支援')
    // Asserted against the imported constant (never a literal) so this test tracks
    // WorkspaceLayout's PRODUCT_VERSION display and would fail if it ever reverted to a
    // hardcoded string that drifted from @open-waterhammer/contracts.
    expect(screen.getByRole('banner')).toHaveTextContent(`v${PRODUCT_VERSION}`)
    expect(screen.getByRole('contentinfo')).toHaveTextContent('適用限界')
    expect(screen.getByRole('navigation', { name: '作業タブ' })).toBeVisible()
    expect(screen.getByRole('complementary', { name: '計算記録の詳細' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '差分' })).toBeVisible()
    await waitFor(() => expect(window.location.hash).toContain(`/projects/${data.projects[0]!.id}/cases/`))
  })

  test('hands documentation routes to the parent app without redirecting back to the workspace', async () => {
    const user = userEvent.setup()
    setup()

    await user.click(await screen.findByRole('link', { name: '設計基準' }))

    await waitFor(() => expect(window.location.hash).toBe('#/docs/reference'))
  })

  test('shows the seven approved workspace tabs and enforces a two-to-four Case comparison', async () => {
    const user = userEvent.setup()
    setup()

    const tabs = screen.getByRole('navigation', { name: '作業タブ' })
    for (const label of ['概要', 'モデル＋GIS', 'シナリオ', '解析', '結果', '比較', '帳票']) {
      expect(within(tabs).getByRole('link', { name: label })).toBeVisible()
    }

    const selectors = await screen.findAllByRole('checkbox', { name: /比較に追加/ })
    expect(selectors).toHaveLength(4)
    await user.click(selectors[0]!)
    await user.click(selectors[1]!)
    await user.click(within(tabs).getByRole('link', { name: '比較' }))
    expect(await screen.findByRole('table', { name: '比較案の比較表' })).toBeVisible()
    expect(screen.getByText(/比較案 2件/)).toBeVisible()
  })

  test('marks the active workspace tab with aria-current for assistive technology', async () => {
    const user = userEvent.setup()
    setup()
    const tabs = screen.getByRole('navigation', { name: '作業タブ' })

    expect(await within(tabs).findByRole('link', { name: '概要' })).toHaveAttribute('aria-current', 'page')
    expect(within(tabs).getByRole('link', { name: 'シナリオ' })).not.toHaveAttribute('aria-current')

    await user.click(within(tabs).getByRole('link', { name: 'シナリオ' }))

    expect(await within(tabs).findByRole('link', { name: 'シナリオ' })).toHaveAttribute('aria-current', 'page')
    expect(within(tabs).getByRole('link', { name: '概要' })).not.toHaveAttribute('aria-current')
  })

  test('新しい比較案 creates an independent empty draft instead of cloning the selected snapshot', async () => {
    const user = userEvent.setup()
    const { data, repository } = setup()
    await user.click(screen.getByRole('button', { name: '新しい比較案' }))

    await waitForNewCase(repository, new Set(data.cases.map(({ id }) => id)))
    const snapshot = await repository.snapshot()
    const created = snapshot.cases.find(({ id }) => !data.cases.some((record) => record.id === id))!
    const scenario = snapshot.scenarios.find(({ caseId }) => caseId === created.id)!
    expect(created.parentCaseId).toBeNull()
    expect(created.revisionReason).toBeUndefined()
    expect(created.modelSnapshot).toEqual({ runInputs: {}, geoDrafts: [], geoSourceCrs: data.projects[0]!.crs })
    expect(scenario).toMatchObject({
      name: '新規シナリオ', boundaryConditions: {}, eventSettings: {}, protectionSettings: {},
    })

    await user.click(within(screen.getByRole('navigation', { name: '作業タブ' })).getByRole('link', { name: '解析' }))
    expect(await screen.findByText('フォーム入力のみ', {}, { timeout: 5_000 })).toBeVisible()
    expect(screen.getByRole('button', { name: '計算を実行' })).toBeDisabled()

    await user.click(screen.getByRole('radio', { name: /管路網の定常解析 \/ Python/ }))
    expect(await screen.findByText('GIS / 管路網データが必要', {}, { timeout: 5_000 })).toBeVisible()
    expect(screen.getByRole('button', { name: '計算を実行' })).toBeDisabled()
  })

  test('a blank Case with no GIS topology runs a form-only kind end-to-end while a topology kind stays blocked', async () => {
    const user = userEvent.setup()
    const { data, repository } = setup()
    await user.click(screen.getByRole('button', { name: '新しい比較案' }))
    const createdId = await waitForNewCase(repository, new Set(data.cases.map(({ id }) => id)))
    await user.click(within(screen.getByRole('navigation', { name: '作業タブ' })).getByRole('link', { name: '解析' }))
    await waitFor(() => expect(window.location.hash).toContain(`/cases/${createdId}/analysis`))

    // Default kind (wave_speed) is a form-only calculation: no GIS topology needed at all.
    expect(await screen.findByText('フォーム入力のみ', {}, { timeout: 5_000 })).toBeVisible()

    // A network kind on the very same untouched Case is correctly identified as topology-required
    // and stays blocked — it is not yet saved and there is no persisted GIS topology.
    await user.click(screen.getByRole('radio', { name: /管路網の過渡解析/ }))
    expect(await screen.findByText('GIS / 管路網データが必要', {}, { timeout: 5_000 })).toBeVisible()
    expect(screen.getByRole('button', { name: '計算を実行' })).toBeDisabled()

    // Switching back to the form-only kind, saving its (prefilled) input, and running it succeeds
    // end-to-end through the common runner — this used to throw regardless of kind (reachability
    // regression fixed by the per-RunKind topology gate).
    await user.click(screen.getByRole('radio', { name: /波速/ }))
    expect(await screen.findByText('フォーム入力のみ', {}, { timeout: 5_000 })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '入力条件を保存' }))
    expect(await screen.findByRole('status')).toHaveTextContent('入力条件を保存しました')
    expect(screen.getByRole('button', { name: '計算を実行' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '計算を実行' }))
    expect(await screen.findByRole('status')).toHaveTextContent('計算が完了しました')
    expect((await repository.snapshot()).cases.some(({ state }) => state === 'locked')).toBe(true)
  })

  test('initializes and saves a complete blank-Case network template using only visible form controls', async () => {
    const user = userEvent.setup()
    const { data, repository } = setup()
    await user.click(screen.getByRole('button', { name: '新しい比較案' }))
    const createdId = await waitForNewCase(repository, new Set(data.cases.map(({ id }) => id)))
    await user.click(within(screen.getByRole('navigation', { name: '作業タブ' })).getByRole('link', { name: '解析' }))
    await waitFor(() => expect(window.location.hash).toContain(`/cases/${createdId}/analysis`))
    await user.click(await screen.findByRole('radio', { name: /管路網の定常解析 \/ Python/ }))

    const caseName = screen.getByLabelText('解析ケース名')
    expect(caseName).toHaveValue('取水支線 定常解析')
    expect(screen.getAllByLabelText(/管路 1 · 管路 ID/)).toHaveLength(1)
    expect(screen.getAllByLabelText(/節点 1 · 節点 ID/)).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: '管路を追加' }))
    expect(screen.getAllByLabelText(/管路 \d+ · 管路 ID/)).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: '管路 2を削除' }))
    expect(screen.getAllByLabelText(/管路 \d+ · 管路 ID/)).toHaveLength(1)
    await user.clear(caseName)
    await user.type(caseName, 'フォーム入力のみ')
    await user.click(screen.getByRole('button', { name: '入力条件を保存' }))
    expect(await screen.findByText('入力条件を保存しました')).toBeVisible()

    const snapshot = await repository.snapshot()
    const created = snapshot.cases.find(({ id }) => id === createdId)!
    const input = (created.modelSnapshot as { runInputs: Record<string, { caseName: string; pipes: unknown[]; nodes: unknown[] }> }).runInputs.steady_network_python!
    expect(input.caseName).toBe('フォーム入力のみ')
    expect(input.pipes).toHaveLength(1)
    expect(input.nodes).toHaveLength(2)
  })

  test('adds, renames, and safely removes object-keyed MOC nodes without Advanced JSON', async () => {
    const user = userEvent.setup()
    const { data, repository } = setup()
    await user.click(within(screen.getByRole('navigation', { name: '作業タブ' })).getByRole('link', { name: '解析' }))
    await user.click(await screen.findByRole('radio', { name: /管路網の過渡解析/ }))

    const rename = screen.getByLabelText('節点 V-01の新しいID')
    await user.clear(rename)
    await user.type(rename, 'V-02')
    await user.click(screen.getByRole('button', { name: '節点 V-01のIDを変更' }))
    expect(screen.getByLabelText(/管路 1 · 下流節点 ID/)).toHaveValue('V-02')
    expect(screen.getByLabelText('節点 V-02の新しいID')).toBeVisible()

    await user.click(screen.getByRole('button', { name: '節点 V-02を削除' }))
    expect(await screen.findByRole('status')).toHaveTextContent(/管路から参照されているため削除できません/)
    expect(screen.getByLabelText('節点 V-02の新しいID')).toBeVisible()

    await user.click(screen.getByRole('button', { name: '節点を追加' }))
    expect(screen.getByLabelText('節点 R-02の新しいID')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '節点 R-02を削除' }))
    expect(screen.queryByLabelText('節点 R-02の新しいID')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '入力条件を保存' }))
    expect(await screen.findByRole('status')).toHaveTextContent('入力条件を保存しました')
    let selected = (await repository.snapshot()).cases.find(({ id }) => id === data.cases.at(-1)!.id)!
    let network = (selected.modelSnapshot as { runInputs: Record<string, { network: { nodes: Record<string, unknown>; pipes: Array<{ downstreamNodeId: string }> } }> }).runInputs.transient_network!.network
    expect(Object.keys(network.nodes).sort()).toEqual(['R-01', 'V-02'])
    expect(network.pipes[0]!.downstreamNodeId).toBe('V-02')

    const downstream = screen.getByLabelText(/管路 1 · 下流節点 ID/)
    await user.clear(downstream)
    await user.type(downstream, 'MISSING')
    await user.click(screen.getByRole('button', { name: '入力条件を保存' }))
    expect(await screen.findByRole('status')).toHaveTextContent('MISSING に対応する節点がありません。')
    selected = (await repository.snapshot()).cases.find(({ id }) => id === data.cases.at(-1)!.id)!
    network = (selected.modelSnapshot as { runInputs: Record<string, { network: { nodes: Record<string, unknown>; pipes: Array<{ downstreamNodeId: string }> } }> }).runInputs.transient_network!.network
    expect(network.pipes[0]!.downstreamNodeId).toBe('V-02')
  })

  test('initializes and saves every exact RunKind from one blank Case using only closed form controls', async () => {
    const user = userEvent.setup()
    const { data, repository } = setup()
    await user.click(screen.getByRole('button', { name: '新しい比較案' }))
    const createdId = await waitForNewCase(repository, new Set(data.cases.map(({ id }) => id)))
    await user.click(within(screen.getByRole('navigation', { name: '作業タブ' })).getByRole('link', { name: '解析' }))
    await waitFor(() => expect(window.location.hash).toContain(`/cases/${createdId}/analysis`))

    for (const kind of RUN_KINDS) {
      await user.click(document.querySelector<HTMLInputElement>(`input[type="radio"][value="${kind}"]`)!)
      const runButton = screen.getByRole('button', { name: '計算を実行' })
      await waitFor(() => expect(runButton).toHaveTextContent('入力条件の保存が必要'))
      expect(screen.getByText('詳細設定 · 正準JSON').closest('details')).not.toHaveAttribute('open')
      await user.click(screen.getByRole('button', { name: '入力条件を保存' }))
      expect(await screen.findByRole('status')).toHaveTextContent('入力条件を保存しました')
      expect(runButton).toHaveTextContent('計算を実行')
    }

    const snapshot = await repository.snapshot()
    const created = snapshot.cases.find(({ id }) => id === createdId)!
    const inputs = (created.modelSnapshot as { runInputs: Record<string, unknown> }).runInputs
    expect(Object.keys(inputs).sort()).toEqual([...RUN_KINDS].sort())
    expect(Object.values(inputs).every((input) => input && typeof input === 'object')).toBe(true)
  })

  test('switches blank form-only Cases to Darcy and pump-start branches before persistence', async () => {
    const user = userEvent.setup()
    const { data, repository } = setup()
    await user.click(screen.getByRole('button', { name: '新しい比較案' }))
    const createdId = await waitForNewCase(repository, new Set(data.cases.map(({ id }) => id)))
    await user.click(within(screen.getByRole('navigation', { name: '作業タブ' })).getByRole('link', { name: '解析' }))
    await waitFor(() => expect(window.location.hash).toContain(`/cases/${createdId}/analysis`))

    await user.click(await screen.findByRole('radio', { name: /単一管路の定常解析/ }))
    await user.selectOptions(screen.getByLabelText('計算方式'), 'darcy-weisbach')
    expect(screen.getByLabelText(/Darcy 摩擦係数/)).toHaveValue(0.02)
    expect(screen.queryByLabelText(/Hazen–Williams C/)).not.toBeInTheDocument()
    expect(screen.getByText('詳細設定 · 正準JSON').closest('details')).not.toHaveAttribute('open')
    await user.click(screen.getByRole('button', { name: '入力条件を保存' }))
    expect(await screen.findByRole('status')).toHaveTextContent('入力条件を保存しました')

    await user.click(screen.getByRole('radio', { name: /ポンプ過渡解析/ }))
    await user.selectOptions(screen.getByLabelText('ポンプ操作'), 'start')
    expect(screen.getByLabelText(/定格流量/)).toHaveValue(0.07)
    expect(screen.getByLabelText(/起動時間/)).toHaveValue(0.5)
    expect(screen.queryByLabelText(/停止時間/)).not.toBeInTheDocument()
    expect(screen.getByText('詳細設定 · 正準JSON').closest('details')).not.toHaveAttribute('open')
    await user.click(screen.getByRole('button', { name: '入力条件を保存' }))
    expect(await screen.findByRole('status')).toHaveTextContent('入力条件を保存しました')

    const snapshot = await repository.snapshot()
    const created = snapshot.cases.find(({ id }) => id === createdId)!
    const inputs = (created.modelSnapshot as { runInputs: Record<string, Record<string, unknown>> }).runInputs
    expect(inputs.steady_single_pipe).toMatchObject({ method: 'darcy-weisbach', frictionFactor: 0.02 })
    expect(inputs.steady_single_pipe).not.toHaveProperty('roughnessC')
    expect(snapshot.scenarios.find(({ caseId }) => caseId === created.id)?.eventSettings).toMatchObject({ mode: 'start', Q_rated: 0.07, startupTime: 0.5 })
    expect(snapshot.scenarios.find(({ caseId }) => caseId === created.id)?.eventSettings).not.toHaveProperty('Q0')
  })

  test('executes through the common runner, locks the Case, and requires a reason to fork', async () => {
    const user = userEvent.setup()
    const { repository } = setup()
    const tabs = screen.getByRole('navigation', { name: '作業タブ' })

    await user.click(within(tabs).getByRole('link', { name: '解析' }))
    const diameter = await screen.findByLabelText(/管内径/)
    await user.clear(diameter)
    await user.type(diameter, '0.31')
    expect(screen.getByRole('button', { name: '計算を実行' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '入力条件を保存' }))
    expect(await screen.findByText('入力条件を保存しました')).toBeVisible()
    expect(screen.getByRole('button', { name: '計算を実行' })).toBeEnabled()
    await user.click(await screen.findByRole('button', { name: '計算を実行' }))
    expect(await screen.findByText('計算が完了しました')).toBeVisible()
    expect((await repository.snapshot()).cases.some(({ state }) => state === 'locked')).toBe(true)

    await user.click(screen.getByRole('button', { name: '複製して編集' }))
    const dialog = await screen.findByRole('dialog', { name: '固定済みの比較案を複製' })
    await user.click(within(dialog).getByRole('button', { name: '複製して編集' }))
    expect(within(dialog).getByText('変更理由を入力してください。')).toBeVisible()
    await user.type(within(dialog).getByLabelText('変更理由'), '空気室容量を比較するため')
    await user.click(within(dialog).getByRole('button', { name: '複製して編集' }))

    await waitFor(async () => expect((await repository.snapshot()).cases).toHaveLength(5))
    expect(await screen.findByRole('button', { name: /空気室容量を比較するため/ })).toBeVisible()
  })

  test('removes a cleared optional numeric input and refuses to persist a cleared required numeric input', async () => {
    const user = userEvent.setup()
    const { data, repository } = setup()
    const tabs = screen.getByRole('navigation', { name: '作業タブ' })
    await user.click(within(tabs).getByRole('link', { name: '解析' }))
    await user.click(await screen.findByRole('radio', { name: /経験式による水撃圧/ }))

    const optional = screen.getByLabelText(/通水圧/)
    await user.type(optional, '0.3')
    await user.clear(optional)
    await user.click(screen.getByRole('button', { name: '入力条件を保存' }))
    expect(await screen.findByText('入力条件を保存しました')).toBeVisible()
    let current = (await repository.snapshot()).cases.find(({ id }) => id === data.cases.at(-1)!.id)!
    let empirical = (current.modelSnapshot as { runInputs: Record<string, Record<string, unknown>> }).runInputs.empirical_pressure!
    expect(empirical).not.toHaveProperty('operatingPressureMpa')

    const required = screen.getByLabelText(/静水圧/)
    await user.clear(required)
    await user.click(screen.getByRole('button', { name: '入力条件を保存' }))
    expect(await screen.findByRole('status')).toHaveTextContent('静水圧は必須です。')
    current = (await repository.snapshot()).cases.find(({ id }) => id === data.cases.at(-1)!.id)!
    empirical = (current.modelSnapshot as { runInputs: Record<string, Record<string, unknown>> }).runInputs.empirical_pressure!
    expect(empirical.staticPressureMpa).toBe(0.42)
  })

  test('persists explicitly mapped GeoJSON drafts into the selected Case', async () => {
    const user = userEvent.setup()
    const { repository } = setup()
    const tabs = screen.getByRole('navigation', { name: '作業タブ' })

    await user.click(within(tabs).getByRole('link', { name: 'モデル＋GIS' }))
    await user.click(await screen.findByRole('button', { name: 'GeoJSONを読み込む' }, { timeout: 10_000 }))
    const dialog = await screen.findByRole('dialog', { name: 'GeoJSON読み込み設定' })
    await user.selectOptions(within(dialog).getByLabelText('読み込み元の座標系（自動推定しません）'), 'LOCAL:XY')
    await user.type(within(dialog).getByLabelText('ローカルXYのProj4定義'), '+proj=tmerc +lat_0=35 +lon_0=139 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs')
    fireEvent.change(within(dialog).getByLabelText('GeoJSON'), { target: { value: JSON.stringify({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature', id: 'feature-new',
        properties: { id: 'N-NEW', elevation: 91 },
        geometry: { type: 'Point', coordinates: [0, 0] },
      }],
    }) } })
    await user.click(within(dialog).getByRole('button', { name: '編集中データとして読み込む' }))

    await waitFor(async () => {
      const latest = await repository.snapshot()
      const selected = latest.cases.at(-1)!
      const snapshot = selected.modelSnapshot as { geoDrafts?: Array<{ id: string }>; geoSourceCrs?: string; geoLocalTransform?: { proj4?: string } }
      expect(snapshot.geoDrafts?.map(({ id }) => id)).toEqual(['N-NEW'])
      expect(snapshot.geoSourceCrs).toBe('LOCAL:XY')
      expect(snapshot.geoLocalTransform?.proj4).toContain('+lat_0=35')
    })
  })

  test('persists Local XY drafts before a transform while blocking render/export until it is saved', async () => {
    const user = userEvent.setup()
    const { repository } = setup()
    const tabs = screen.getByRole('navigation', { name: '作業タブ' })
    await user.click(within(tabs).getByRole('link', { name: 'モデル＋GIS' }))
    await user.click(await screen.findByRole('button', { name: 'GeoJSONを読み込む' }, { timeout: 10_000 }))
    const dialog = await screen.findByRole('dialog', { name: 'GeoJSON読み込み設定' })
    await user.selectOptions(within(dialog).getByLabelText('読み込み元の座標系（自動推定しません）'), 'LOCAL:XY')
    fireEvent.change(within(dialog).getByLabelText('GeoJSON'), { target: { value: JSON.stringify({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature', id: 'local-node', properties: { id: 'N-LOCAL', elevation: 12 },
        geometry: { type: 'Point', coordinates: [100, 200] },
      }],
    }) } })
    await user.click(within(dialog).getByRole('button', { name: '編集中データとして読み込む' }))

    expect(await screen.findByRole('heading', { name: '座標変換の明示設定' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'WGS84で書き出す' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/ローカルXYのProj4定義を入力してください/)
    let selected = (await repository.snapshot()).cases.at(-1)!
    expect(selected.modelSnapshot).toMatchObject({ geoSourceCrs: 'LOCAL:XY', geoLocalTransform: null })

    await user.type(screen.getByLabelText('ローカルXYのProj4定義'), '+proj=tmerc +lat_0=35 +lon_0=139 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs')
    await user.click(screen.getByRole('button', { name: '座標変換を保存' }))
    await waitFor(async () => {
      selected = (await repository.snapshot()).cases.at(-1)!
      expect(selected.modelSnapshot).toMatchObject({ geoLocalTransform: { proj4: expect.stringContaining('+lat_0=35') } })
    })
  })
})

describe('pyodide prefetch on mount', () => {
  // The bridge mock above is created once for the whole file (module mocks are hoisted
  // and evaluated a single time), so its call history is not implicitly cleared between
  // these two tests the way per-test spies are — reset it explicitly for isolation.
  beforeEach(() => {
    vi.mocked(prefetchPyodide).mockClear()
  })

  test('mounting without an injected executor registry prefetches the Pyodide runtime exactly once', async () => {
    setupWithoutExecutors()

    await screen.findByRole('banner')
    await waitFor(() => expect(prefetchPyodide).toHaveBeenCalledTimes(1))
  })

  test('mounting with an injected executor registry (the test path) skips the prefetch', async () => {
    setup()

    await screen.findByRole('banner')
    // Give any deferred (requestIdleCallback/setTimeout) scheduling a chance to run before asserting the negative.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(prefetchPyodide).not.toHaveBeenCalled()
  })
})
