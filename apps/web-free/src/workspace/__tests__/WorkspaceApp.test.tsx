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
    expect(screen.getByRole('navigation', { name: 'Workspace tabs' })).toBeVisible()
    expect(screen.getByRole('complementary', { name: 'Run Inspector' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Differences' })).toBeVisible()
    await waitFor(() => expect(window.location.hash).toContain(`/projects/${data.projects[0]!.id}/cases/`))
  })

  test('shows the seven approved workspace tabs and enforces a two-to-four Case comparison', async () => {
    const user = userEvent.setup()
    setup()

    const tabs = screen.getByRole('navigation', { name: 'Workspace tabs' })
    for (const label of ['Overview', 'Model＋GIS', 'Scenario', 'Analysis', 'Results', 'Compare', 'Reports']) {
      expect(within(tabs).getByRole('link', { name: label })).toBeVisible()
    }

    const selectors = await screen.findAllByRole('checkbox', { name: /比較に追加/ })
    expect(selectors).toHaveLength(4)
    await user.click(selectors[0]!)
    await user.click(selectors[1]!)
    await user.click(within(tabs).getByRole('link', { name: 'Compare' }))
    expect(await screen.findByRole('table', { name: 'Case comparison' })).toBeVisible()
    expect(screen.getByText('2 Cases')).toBeVisible()
  })

  test('marks the active workspace tab with aria-current for assistive technology', async () => {
    const user = userEvent.setup()
    setup()
    const tabs = screen.getByRole('navigation', { name: 'Workspace tabs' })

    expect(await within(tabs).findByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
    expect(within(tabs).getByRole('link', { name: 'Scenario' })).not.toHaveAttribute('aria-current')

    await user.click(within(tabs).getByRole('link', { name: 'Scenario' }))

    expect(await within(tabs).findByRole('link', { name: 'Scenario' })).toHaveAttribute('aria-current', 'page')
    expect(within(tabs).getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current')
  })

  test('New Case creates an independent empty draft instead of cloning the selected snapshot', async () => {
    const user = userEvent.setup()
    const { data, repository } = setup()
    const tabs = screen.getByRole('navigation', { name: 'Workspace tabs' })
    await user.click(screen.getByRole('button', { name: 'New Case' }))

    await waitFor(async () => expect((await repository.snapshot()).cases).toHaveLength(5))
    const snapshot = await repository.snapshot()
    const created = snapshot.cases.find(({ id }) => !data.cases.some((record) => record.id === id))!
    const scenario = snapshot.scenarios.find(({ caseId }) => caseId === created.id)!
    expect(created.parentCaseId).toBeNull()
    expect(created.revisionReason).toBeUndefined()
    expect(created.modelSnapshot).toEqual({ runInputs: {}, geoDrafts: [], geoSourceCrs: data.projects[0]!.crs })
    expect(scenario).toMatchObject({
      name: '新規シナリオ', boundaryConditions: {}, eventSettings: {}, protectionSettings: {},
    })

    await user.click(within(tabs).getByRole('link', { name: 'Analysis' }))
    expect(await screen.findByText('FORM INPUT ONLY', {}, { timeout: 5_000 })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Run calculation' })).toBeDisabled()

    await user.click(screen.getByRole('radio', { name: /Steady network \/ Python/ }))
    expect(await screen.findByText('GIS / TOPOLOGY REQUIRED', {}, { timeout: 5_000 })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Run calculation' })).toBeDisabled()
  })

  test('a blank Case with no GIS topology runs a form-only kind end-to-end while a topology kind stays blocked', async () => {
    const user = userEvent.setup()
    const { repository } = setup()
    const tabs = screen.getByRole('navigation', { name: 'Workspace tabs' })
    await user.click(screen.getByRole('button', { name: 'New Case' }))
    await user.click(within(tabs).getByRole('link', { name: 'Analysis' }))

    // Default kind (wave_speed) is a form-only calculation: no GIS topology needed at all.
    expect(await screen.findByText('FORM INPUT ONLY', {}, { timeout: 5_000 })).toBeVisible()

    // A network kind on the very same untouched Case is correctly identified as topology-required
    // and stays blocked — it is not yet saved and there is no persisted GIS topology.
    await user.click(screen.getByRole('radio', { name: /Transient network/ }))
    expect(await screen.findByText('GIS / TOPOLOGY REQUIRED', {}, { timeout: 5_000 })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Run calculation' })).toBeDisabled()

    // Switching back to the form-only kind, saving its (prefilled) input, and running it succeeds
    // end-to-end through the common runner — this used to throw regardless of kind (reachability
    // regression fixed by the per-RunKind topology gate).
    await user.click(screen.getByRole('radio', { name: /Wave speed/ }))
    expect(await screen.findByText('FORM INPUT ONLY', {}, { timeout: 5_000 })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Save input' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Input saved')
    expect(screen.getByRole('button', { name: 'Run calculation' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Run calculation' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Run succeeded')
    expect((await repository.snapshot()).cases.some(({ state }) => state === 'locked')).toBe(true)
  })

  test('initializes and saves a complete blank-Case network template using only visible form controls', async () => {
    const user = userEvent.setup()
    const { data, repository } = setup()
    const tabs = screen.getByRole('navigation', { name: 'Workspace tabs' })
    await user.click(screen.getByRole('button', { name: 'New Case' }))
    await user.click(within(tabs).getByRole('link', { name: 'Analysis' }))
    await user.click(await screen.findByRole('radio', { name: /Steady network \/ Python/ }))

    const caseName = screen.getByLabelText('解析ケース名')
    expect(caseName).toHaveValue('取水支線 定常解析')
    expect(screen.getAllByLabelText(/管路 1 · 管路 ID/)).toHaveLength(1)
    expect(screen.getAllByLabelText(/節点 1 · 節点 ID/)).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Add 管路' }))
    expect(screen.getAllByLabelText(/管路 \d+ · 管路 ID/)).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Remove 管路 2' }))
    expect(screen.getAllByLabelText(/管路 \d+ · 管路 ID/)).toHaveLength(1)
    await user.clear(caseName)
    await user.type(caseName, 'フォーム入力のみ')
    await user.click(screen.getByRole('button', { name: 'Save input' }))
    expect(await screen.findByText('Input saved')).toBeVisible()

    const snapshot = await repository.snapshot()
    const created = snapshot.cases.find(({ id }) => !data.cases.some((record) => record.id === id))!
    const input = (created.modelSnapshot as { runInputs: Record<string, { caseName: string; pipes: unknown[]; nodes: unknown[] }> }).runInputs.steady_network_python!
    expect(input.caseName).toBe('フォーム入力のみ')
    expect(input.pipes).toHaveLength(1)
    expect(input.nodes).toHaveLength(2)
  })

  test('adds, renames, and safely removes object-keyed MOC nodes without Advanced JSON', async () => {
    const user = userEvent.setup()
    const { data, repository } = setup()
    const tabs = screen.getByRole('navigation', { name: 'Workspace tabs' })
    await user.click(within(tabs).getByRole('link', { name: 'Analysis' }))
    await user.click(await screen.findByRole('radio', { name: /Transient network/ }))

    const rename = screen.getByLabelText('New ID for 節点 V-01')
    await user.clear(rename)
    await user.type(rename, 'V-02')
    await user.click(screen.getByRole('button', { name: 'Rename 節点 V-01' }))
    expect(screen.getByLabelText(/管路 1 · 下流節点 ID/)).toHaveValue('V-02')
    expect(screen.getByLabelText('New ID for 節点 V-02')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Remove 節点 V-02' }))
    expect(await screen.findByRole('status')).toHaveTextContent(/referenced by a pipe/)
    expect(screen.getByLabelText('New ID for 節点 V-02')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Add 節点' }))
    expect(screen.getByLabelText('New ID for 節点 R-02')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Remove 節点 R-02' }))
    expect(screen.queryByLabelText('New ID for 節点 R-02')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save input' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Input saved')
    let selected = (await repository.snapshot()).cases.find(({ id }) => id === data.cases.at(-1)!.id)!
    let network = (selected.modelSnapshot as { runInputs: Record<string, { network: { nodes: Record<string, unknown>; pipes: Array<{ downstreamNodeId: string }> } }> }).runInputs.transient_network!.network
    expect(Object.keys(network.nodes).sort()).toEqual(['R-01', 'V-02'])
    expect(network.pipes[0]!.downstreamNodeId).toBe('V-02')

    const downstream = screen.getByLabelText(/管路 1 · 下流節点 ID/)
    await user.clear(downstream)
    await user.type(downstream, 'MISSING')
    await user.click(screen.getByRole('button', { name: 'Save input' }))
    expect(await screen.findByRole('status')).toHaveTextContent('MISSING に対応する節点がありません。')
    selected = (await repository.snapshot()).cases.find(({ id }) => id === data.cases.at(-1)!.id)!
    network = (selected.modelSnapshot as { runInputs: Record<string, { network: { nodes: Record<string, unknown>; pipes: Array<{ downstreamNodeId: string }> } }> }).runInputs.transient_network!.network
    expect(network.pipes[0]!.downstreamNodeId).toBe('V-02')
  })

  test('initializes and saves every exact RunKind from one blank Case using only closed form controls', async () => {
    const user = userEvent.setup()
    const { data, repository } = setup()
    const tabs = screen.getByRole('navigation', { name: 'Workspace tabs' })
    await user.click(screen.getByRole('button', { name: 'New Case' }))
    await user.click(within(tabs).getByRole('link', { name: 'Analysis' }))

    for (const kind of RUN_KINDS) {
      await user.click(document.querySelector<HTMLInputElement>(`input[type="radio"][value="${kind}"]`)!)
      const runButton = screen.getByRole('button', { name: 'Run calculation' })
      expect(runButton).toHaveTextContent('Save before Run')
      expect(screen.getByText('Advanced · canonical JSON').closest('details')).not.toHaveAttribute('open')
      await user.click(screen.getByRole('button', { name: 'Save input' }))
      expect(await screen.findByRole('status')).toHaveTextContent('Input saved')
      expect(runButton).toHaveTextContent('Run calculation')
    }

    const snapshot = await repository.snapshot()
    const created = snapshot.cases.find(({ id }) => !data.cases.some((record) => record.id === id))!
    const inputs = (created.modelSnapshot as { runInputs: Record<string, unknown> }).runInputs
    expect(Object.keys(inputs).sort()).toEqual([...RUN_KINDS].sort())
    expect(Object.values(inputs).every((input) => input && typeof input === 'object')).toBe(true)
  })

  test('switches blank form-only Cases to Darcy and pump-start branches before persistence', async () => {
    const user = userEvent.setup()
    const { data, repository } = setup()
    const tabs = screen.getByRole('navigation', { name: 'Workspace tabs' })
    await user.click(screen.getByRole('button', { name: 'New Case' }))
    await user.click(within(tabs).getByRole('link', { name: 'Analysis' }))

    await user.click(await screen.findByRole('radio', { name: /Steady single pipe/ }))
    await user.selectOptions(screen.getByLabelText('計算方式'), 'darcy-weisbach')
    expect(screen.getByLabelText(/Darcy 摩擦係数/)).toHaveValue(0.02)
    expect(screen.queryByLabelText(/Hazen–Williams C/)).not.toBeInTheDocument()
    expect(screen.getByText('Advanced · canonical JSON').closest('details')).not.toHaveAttribute('open')
    await user.click(screen.getByRole('button', { name: 'Save input' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Input saved')

    await user.click(screen.getByRole('radio', { name: /Pump transient/ }))
    await user.selectOptions(screen.getByLabelText('ポンプ操作'), 'start')
    expect(screen.getByLabelText(/定格流量/)).toHaveValue(0.07)
    expect(screen.getByLabelText(/起動時間/)).toHaveValue(0.5)
    expect(screen.queryByLabelText(/停止時間/)).not.toBeInTheDocument()
    expect(screen.getByText('Advanced · canonical JSON').closest('details')).not.toHaveAttribute('open')
    await user.click(screen.getByRole('button', { name: 'Save input' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Input saved')

    const snapshot = await repository.snapshot()
    const created = snapshot.cases.find(({ id }) => !data.cases.some((record) => record.id === id))!
    const inputs = (created.modelSnapshot as { runInputs: Record<string, Record<string, unknown>> }).runInputs
    expect(inputs.steady_single_pipe).toMatchObject({ method: 'darcy-weisbach', frictionFactor: 0.02 })
    expect(inputs.steady_single_pipe).not.toHaveProperty('roughnessC')
    expect(snapshot.scenarios.find(({ caseId }) => caseId === created.id)?.eventSettings).toMatchObject({ mode: 'start', Q_rated: 0.07, startupTime: 0.5 })
    expect(snapshot.scenarios.find(({ caseId }) => caseId === created.id)?.eventSettings).not.toHaveProperty('Q0')
  })

  test('executes through the common runner, locks the Case, and requires a reason to fork', async () => {
    const user = userEvent.setup()
    const { repository } = setup()
    const tabs = screen.getByRole('navigation', { name: 'Workspace tabs' })

    await user.click(within(tabs).getByRole('link', { name: 'Analysis' }))
    const diameter = await screen.findByLabelText(/管内径/)
    await user.clear(diameter)
    await user.type(diameter, '0.31')
    expect(screen.getByRole('button', { name: 'Run calculation' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Save input' }))
    expect(await screen.findByText('Input saved')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Run calculation' })).toBeEnabled()
    await user.click(await screen.findByRole('button', { name: 'Run calculation' }))
    expect(await screen.findByText('Run succeeded')).toBeVisible()
    expect((await repository.snapshot()).cases.some(({ state }) => state === 'locked')).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Fork Case' }))
    const dialog = await screen.findByRole('dialog', { name: 'Fork locked Case' })
    await user.click(within(dialog).getByRole('button', { name: 'Create fork' }))
    expect(within(dialog).getByText('分岐理由を入力してください。')).toBeVisible()
    await user.type(within(dialog).getByLabelText('分岐理由'), '空気室容量を比較するため')
    await user.click(within(dialog).getByRole('button', { name: 'Create fork' }))

    await waitFor(async () => expect((await repository.snapshot()).cases).toHaveLength(5))
    expect(await screen.findByRole('button', { name: /空気室容量を比較するため/ })).toBeVisible()
  })

  test('removes a cleared optional numeric input and refuses to persist a cleared required numeric input', async () => {
    const user = userEvent.setup()
    const { data, repository } = setup()
    const tabs = screen.getByRole('navigation', { name: 'Workspace tabs' })
    await user.click(within(tabs).getByRole('link', { name: 'Analysis' }))
    await user.click(await screen.findByRole('radio', { name: /Empirical pressure/ }))

    const optional = screen.getByLabelText(/通水圧/)
    await user.type(optional, '0.3')
    await user.clear(optional)
    await user.click(screen.getByRole('button', { name: 'Save input' }))
    expect(await screen.findByText('Input saved')).toBeVisible()
    let current = (await repository.snapshot()).cases.find(({ id }) => id === data.cases.at(-1)!.id)!
    let empirical = (current.modelSnapshot as { runInputs: Record<string, Record<string, unknown>> }).runInputs.empirical_pressure!
    expect(empirical).not.toHaveProperty('operatingPressureMpa')

    const required = screen.getByLabelText(/静水圧/)
    await user.clear(required)
    await user.click(screen.getByRole('button', { name: 'Save input' }))
    expect(await screen.findByRole('status')).toHaveTextContent('静水圧は必須です。')
    current = (await repository.snapshot()).cases.find(({ id }) => id === data.cases.at(-1)!.id)!
    empirical = (current.modelSnapshot as { runInputs: Record<string, Record<string, unknown>> }).runInputs.empirical_pressure!
    expect(empirical.staticPressureMpa).toBe(0.42)
  })

  test('persists explicitly mapped GeoJSON drafts into the selected Case', async () => {
    const user = userEvent.setup()
    const { repository } = setup()
    const tabs = screen.getByRole('navigation', { name: 'Workspace tabs' })

    await user.click(within(tabs).getByRole('link', { name: 'Model＋GIS' }))
    await user.click(await screen.findByRole('button', { name: 'Import GeoJSON' }, { timeout: 10_000 }))
    const dialog = await screen.findByRole('dialog', { name: 'GeoJSON import wizard' })
    await user.selectOptions(within(dialog).getByLabelText('Source CRS — never inferred'), 'LOCAL:XY')
    await user.type(within(dialog).getByLabelText('Local XY Proj4 definition'), '+proj=tmerc +lat_0=35 +lon_0=139 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs')
    fireEvent.change(within(dialog).getByLabelText('GeoJSON'), { target: { value: JSON.stringify({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature', id: 'feature-new',
        properties: { id: 'N-NEW', elevation: 91 },
        geometry: { type: 'Point', coordinates: [0, 0] },
      }],
    }) } })
    await user.click(within(dialog).getByRole('button', { name: 'Import as drafts' }))

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
    const tabs = screen.getByRole('navigation', { name: 'Workspace tabs' })
    await user.click(within(tabs).getByRole('link', { name: 'Model＋GIS' }))
    await user.click(await screen.findByRole('button', { name: 'Import GeoJSON' }, { timeout: 10_000 }))
    const dialog = await screen.findByRole('dialog', { name: 'GeoJSON import wizard' })
    await user.selectOptions(within(dialog).getByLabelText('Source CRS — never inferred'), 'LOCAL:XY')
    fireEvent.change(within(dialog).getByLabelText('GeoJSON'), { target: { value: JSON.stringify({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature', id: 'local-node', properties: { id: 'N-LOCAL', elevation: 12 },
        geometry: { type: 'Point', coordinates: [100, 200] },
      }],
    }) } })
    await user.click(within(dialog).getByRole('button', { name: 'Import as drafts' }))

    expect(await screen.findByRole('heading', { name: 'Explicit coordinate transform' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Export WGS84' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/Local XY Proj4 definition is required/)
    let selected = (await repository.snapshot()).cases.at(-1)!
    expect(selected.modelSnapshot).toMatchObject({ geoSourceCrs: 'LOCAL:XY', geoLocalTransform: null })

    await user.type(screen.getByLabelText('Local XY Proj4 definition'), '+proj=tmerc +lat_0=35 +lon_0=139 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs')
    await user.click(screen.getByRole('button', { name: 'Save transform' }))
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
