import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

// Form-only Run kinds never read GIS drafts (per-RunKind topology gate), so a blank Case
// can go straight to Analysis without importing any GIS topology first.
async function createBlankCase(page: Page) {
  await page.getByRole('button', { name: 'New Case' }).click()
  await page.getByRole('link', { name: 'Analysis' }).click()
}

test('create, edit, execute, lock, fork, compare, reload, export, and import', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '東部幹線 水撃圧比較' })).toBeVisible()
  await expect(page.getByText('alpha', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('設計比較支援', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('contentinfo')).toContainText('適用限界')

  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to workspace' })).toBeFocused()

  await page.getByRole('button', { name: 'New Case' }).click()
  await expect.poll(() => page.locator('.case-row').count()).toBe(5)
  await page.getByRole('link', { name: 'Analysis' }).click()
  await expect(page.getByText('FORM INPUT ONLY')).toBeVisible()

  // A topology-required kind on this untouched Case stays blocked: no GIS drafts and no
  // saved network input for this kind exist yet.
  await page.getByRole('radio', { name: /Steady network \/ Python/ }).check()
  await expect(page.getByText('GIS / TOPOLOGY REQUIRED')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Run calculation' })).toBeDisabled()
  await expect(page.getByLabel('解析ケース名')).toHaveValue('取水支線 定常解析')
  await page.getByLabel('解析ケース名').fill('E2E form-only blank Case')
  await page.getByRole('button', { name: 'Save input' }).click()
  await expect(page.getByRole('status')).toHaveText('Input saved')

  // A form-only kind on the very same Case needs no GIS topology at all: save its input and
  // Run succeeds immediately (reachability regression fixed by the per-RunKind topology gate).
  await page.getByRole('radio', { name: /Wave speed/ }).check()
  await expect(page.getByText('FORM INPUT ONLY')).toBeVisible()
  await page.getByRole('button', { name: 'Save input' }).click()
  await expect(page.getByRole('status')).toHaveText('Input saved')
  await expect(page.getByRole('button', { name: 'Run calculation' })).toBeEnabled()
  await page.getByRole('button', { name: 'Run calculation' }).click()
  await expect(page.getByRole('status')).toHaveText('Run succeeded', { timeout: 60_000 })

  await page.locator('.case-row').filter({ hasText: '基準案' }).getByRole('button').click()

  await page.getByRole('link', { name: 'Scenario' }).click()
  await page.getByLabel('Scenario name').fill('E2E valve closure comparison')
  await page.getByRole('button', { name: 'Save scenario' }).click()
  await expect(page.getByRole('status')).toHaveText('Scenario saved')

  await page.getByRole('link', { name: 'Analysis' }).click()
  await page.getByRole('radio', { name: /Steady network \/ EPANET/ }).check()
  await page.getByRole('button', { name: 'Run calculation' }).click()
  await expect(page.getByRole('status')).toHaveText('Run succeeded', { timeout: 60_000 })
  await expect(page.locator('.state-pill')).toHaveText('locked')

  await page.getByRole('button', { name: 'Fork Case' }).click()
  const fork = page.getByRole('dialog', { name: 'Fork locked Case' })
  await fork.getByLabel('分岐理由').fill('E2E 防護工比較')
  await fork.getByRole('button', { name: 'Create fork' }).click()
  await expect(page.locator('.workspace-breadcrumb').getByText('E2E 防護工比較', { exact: true })).toBeVisible()

  await page.getByRole('link', { name: 'Compare' }).click()
  await expect(page.getByRole('table', { name: 'Case comparison' })).toBeVisible()
  await expect(page.getByText('2 Cases')).toBeVisible()

  await page.reload()
  await expect(page.locator('.workspace-breadcrumb').getByText('E2E 防護工比較', { exact: true })).toBeVisible()
  await expect(page.locator('.state-pill')).toHaveText('draft')

  await page.getByRole('link', { name: 'Model＋GIS' }).click()
  await page.getByRole('button', { name: 'Import GeoJSON' }).click()
  const importDialog = page.getByRole('dialog', { name: 'GeoJSON import wizard' })
  await importDialog.getByLabel('GeoJSON').fill(JSON.stringify({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature', id: 'import-e2e',
      properties: { id: 'N-E2E', elevation: 77 },
      geometry: { type: 'Point', coordinates: [139.71, 35.69] },
    }],
  }))
  await importDialog.getByRole('button', { name: 'Import as drafts' }).click()
  await expect(page.getByText('N-E2E')).toBeVisible()
  const geojsonDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export WGS84' }).click()
  await expect((await geojsonDownload).suggestedFilename()).toMatch(/-wgs84\.geojson$/)

  await page.reload()
  await page.getByRole('link', { name: 'Model＋GIS' }).click()
  await expect(page.getByText('N-E2E')).toBeVisible()

  // Task 4b-4: this fork inherited 基準案's SAMPLE_RUN_INPUTS (fork preserves modelSnapshot
  // verbatim), so joukowsky_allievi's input — pipe/calculationCase/allowablePressureMpa — is
  // already saved; selecting the kind starts non-dirty and "Run calculation" is enabled
  // immediately, same as the untouched Steady network / EPANET run above needed no fresh Save.
  await page.getByRole('link', { name: 'Analysis' }).click()
  await page.getByRole('radio', { name: /Joukowsky \/ Allievi/ }).check()
  await page.getByRole('button', { name: 'Run calculation' }).click()
  await expect(page.getByRole('status')).toHaveText('Run succeeded', { timeout: 60_000 })

  // The deliverable 水理計算書・検討書 button (Part (b)) only enables once a succeeded
  // joukowsky_allievi or longitudinal_hydraulics Run exists for the Case; verify it end-to-end
  // (buildReportInput -> generateDeliverableExcel, no recalculation) with a real download.
  await page.getByRole('link', { name: 'Reports' }).click()
  const deliverableButton = page.getByRole('button', { name: /水理計算書・検討書/ })
  await expect(deliverableButton).toBeEnabled()
  const deliverableDownload = page.waitForEvent('download')
  await deliverableButton.click()
  await expect((await deliverableDownload).suggestedFilename()).toMatch(/^waterhammer-report-.+\.xlsx$/)
  await expect(page.getByRole('status')).toHaveText(/水理計算書・検討書を出力しました/)

  // Disambiguated by label: the blank Case (from the wave_speed Run earlier in this test) and
  // this fork (from the joukowsky_allievi Run just above) are also locked by now, so 'locked'
  // alone would match three rows.
  await page.locator('.case-row').filter({ hasText: 'locked' }).filter({ hasText: '基準案' }).getByRole('button').click()
  await expect(page.locator('.state-pill')).toHaveText('locked')
  await page.getByRole('link', { name: 'Reports' }).click()
  const jsonDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: /Run JSON/ }).click()
  await expect((await jsonDownload).suggestedFilename()).toMatch(/^run-.+\.json$/)
  const excelDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: /Excel report/ }).click()
  await expect((await excelDownload).suggestedFilename()).toMatch(/^run-.+\.xlsx$/)
  await expect(page.getByRole('status')).toHaveText('Excel report exported from persisted Run')
})

test('desktop and narrow workspace keep semantic landmarks without serious accessibility violations', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Workspace tabs' })).toBeVisible()
  const desktop = await new AxeBuilder({ page }).analyze()
  expect(desktop.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious')).toEqual([])

  await page.getByRole('link', { name: 'Analysis' }).click()
  await page.getByRole('radio', { name: /Steady network \/ Python/ }).check()
  await expect(page.getByLabel('解析ケース名')).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('complementary', { name: 'Project Alternative Case tree' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Run Inspector' })).toBeVisible()
  const narrow = await new AxeBuilder({ page }).analyze()
  expect(narrow.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious')).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('workspace-narrow.png'), fullPage: true })
})

test('all exact RunKinds execute and persist through the production browser registry without calculation-network access', async ({ page }) => {
  test.setTimeout(360_000)
  const runKinds = [
    'wave_speed',
    'joukowsky_allievi',
    'empirical_pressure',
    'steady_single_pipe',
    'steady_network_python',
    'steady_network_epanet',
    'longitudinal_hydraulics',
    'transient_single_pipe',
    'transient_network',
    'transient_pump',
    'transient_protection_device',
  ] as const
  const externalRequests = new Set<string>()
  const pyodideRequests = new Set<string>()
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/pyodide/')) pyodideRequests.add(url.pathname)
    if (url.origin !== 'http://127.0.0.1:4173') externalRequests.add(url.origin)
  })

  await page.goto('/')
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
  expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'")
  expect(csp).not.toContain("'unsafe-eval'")
  expect(csp).not.toContain('cdn.jsdelivr.net')

  await page.getByRole('button', { name: 'New Case' }).click()
  await page.getByRole('link', { name: 'Model＋GIS' }).click()
  await page.getByRole('button', { name: 'Import GeoJSON' }).click()
  const importDialog = page.getByRole('dialog', { name: 'GeoJSON import wizard' })
  await importDialog.getByLabel('GeoJSON').fill(JSON.stringify({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { id: 'R-01', elevation: 100 }, geometry: { type: 'Point', coordinates: [139.7, 35.68] } },
      { type: 'Feature', properties: { id: 'J-01', elevation: 88 }, geometry: { type: 'Point', coordinates: [139.708, 35.684] } },
      { type: 'Feature', properties: { id: 'P-01', startNodeId: 'R-01', endNodeId: 'J-01', innerDiameter: 0.3 }, geometry: { type: 'LineString', coordinates: [[139.7, 35.68], [139.708, 35.684]] } },
    ],
  }))
  await importDialog.getByRole('button', { name: 'Import as drafts' }).click()
  await expect(page.getByText('HYDRAULICS VALID', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Analysis' }).click()
  for (const [index, kind] of runKinds.entries()) {
    await page.locator(`input[type="radio"][value="${kind}"]`).check()
    await expect(page.getByRole('button', { name: 'Run calculation' })).toContainText('Save before Run')
    await expect(page.getByRole('button', { name: 'Run calculation' })).toBeDisabled()
    await expect(page.locator('details.advanced-json')).not.toHaveAttribute('open', '')
    if (kind === 'joukowsky_allievi') {
      // Fresh drafts deliberately omit 許容圧力 (withoutDemoOnlyAllowablePressure strips the
      // demo-only threshold from ENGINEERING_TEMPLATES), so enter it the way an engineer
      // would; the assessment assertion below depends on this typed-in threshold.
      await page.getByLabel(/許容圧力/).fill('0.75')
    }
    await page.getByRole('button', { name: 'Save input' }).click()
    await expect(page.getByRole('status')).toHaveText('Input saved')
    await expect(page.getByRole('button', { name: 'Run calculation' })).toBeEnabled()
    await page.getByRole('button', { name: 'Run calculation' }).click()
    await expect(page.getByRole('status')).toHaveText('Run succeeded', { timeout: 120_000 })
    await expect(page.locator('.state-pill')).toHaveText('locked')
    const inspector = page.getByRole('complementary', { name: 'Run Inspector' })
    await expect(inspector).toContainText(kind)
    await expect(inspector).toContainText(kind === 'steady_network_epanet' ? 'epanet-js' : 'open-waterhammer-core-py')
    await expect(inspector.getByRole('heading', { name: 'Summary fields' }).locator('..').locator('dd').first()).not.toHaveText('')
    if (kind === 'joukowsky_allievi') {
      // With 許容圧力 typed in before the save above, the Python protocol computes a real
      // judge_design_pressure assessment (pass/warning/fail) instead of the needs_review
      // default — confirms the wiring end-to-end through Pyodide.
      await expect(inspector.locator('p.assessment')).toHaveClass(/assessment--(pass|warning|fail)/)
    }

    if (index < runKinds.length - 1) {
      await page.getByRole('button', { name: 'Fork Case' }).click()
      const fork = page.getByRole('dialog', { name: 'Fork locked Case' })
      await fork.getByLabel('分岐理由').fill(`E2E next exact RunKind ${runKinds[index + 1]}`)
      await fork.getByRole('button', { name: 'Create fork' }).click()
      await expect(page.locator('.state-pill')).toHaveText('draft')
    }
  }

  expect([...pyodideRequests]).toEqual(expect.arrayContaining([
    '/pyodide/pyodide-lock.json',
    '/pyodide/pyodide.asm.wasm',
    '/pyodide/python_stdlib.zip',
  ]))
  expect([...externalRequests]).toEqual([])
  await page.reload()
  await expect(page.locator('.state-pill')).toHaveText('locked')
  await expect(page.getByRole('complementary', { name: 'Run Inspector' })).toContainText('transient_protection_device')
})

test('blank form-only Darcy and pump-start branches execute through the real production Runner', async ({ page }) => {
  test.setTimeout(180_000)
  const externalRequests = new Set<string>()
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.origin !== 'http://127.0.0.1:4173') externalRequests.add(url.origin)
  })
  await page.goto('/')

  await createBlankCase(page)
  await page.locator('input[type="radio"][value="steady_single_pipe"]').check()
  await page.getByLabel('計算方式').selectOption('darcy-weisbach')
  await expect(page.getByLabel(/Darcy 摩擦係数/)).toHaveValue('0.02')
  await expect(page.getByLabel(/Hazen–Williams C/)).toHaveCount(0)
  await expect(page.locator('details.advanced-json')).not.toHaveAttribute('open', '')
  await page.getByRole('button', { name: 'Save input' }).click()
  await expect(page.getByRole('status')).toHaveText('Input saved')
  await page.getByRole('button', { name: 'Run calculation' }).click()
  await expect(page.getByRole('status')).toHaveText('Run succeeded', { timeout: 120_000 })
  await expect(page.getByRole('complementary', { name: 'Run Inspector' })).toContainText('steady_single_pipe')

  await createBlankCase(page)
  await page.locator('input[type="radio"][value="transient_pump"]').check()
  await page.getByLabel('ポンプ操作').selectOption('start')
  await expect(page.getByLabel(/定格流量/)).toHaveValue('0.07')
  await expect(page.getByLabel(/起動時間/)).toHaveValue('0.5')
  await expect(page.getByLabel(/停止時間/)).toHaveCount(0)
  await expect(page.locator('details.advanced-json')).not.toHaveAttribute('open', '')
  await page.getByRole('button', { name: 'Save input' }).click()
  await expect(page.getByRole('status')).toHaveText('Input saved')
  await page.getByRole('button', { name: 'Run calculation' }).click()
  await expect(page.getByRole('status')).toHaveText('Run succeeded', { timeout: 120_000 })
  await expect(page.getByRole('complementary', { name: 'Run Inspector' })).toContainText('transient_pump')
  expect([...externalRequests]).toEqual([])
})
