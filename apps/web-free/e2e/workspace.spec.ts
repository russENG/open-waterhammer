import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

// Form-only Run kinds never read GIS drafts (per-RunKind topology gate), so a blank Case
// can go straight to Analysis without importing any GIS topology first.
async function createBlankCase(page: Page) {
  await page.getByRole('button', { name: '新しい比較案' }).click()
  await page.getByRole('link', { name: '解析' }).click()
}

async function openSample(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '作業を始める' })).toBeVisible()
  await expect(page.getByText('実在する路線・施設とは関係ありません')).toBeVisible()
  await page.getByRole('button', { name: 'このサンプルを開く' }).click()
  await expect(page.getByRole('heading', { name: 'サンプル：N地区東部幹線水路' })).toBeVisible()
}

test('global navigation moves between the workspace and documentation pages', async ({ page }) => {
  await openSample(page)

  await page.getByRole('link', { name: '設計基準' }).click()
  await expect(page).toHaveURL(/#\/docs\/reference$/)
  await expect(page.getByRole('heading', { name: '基準照会' })).toBeVisible()

  await page.getByRole('link', { name: '計算ライブラリ' }).click()
  await expect(page).toHaveURL(/#\/docs\/library$/)
  await expect(page.getByRole('heading', { name: '計算ライブラリ' })).toBeVisible()

  await page.getByRole('link', { name: '作業画面' }).click()
  await expect(page.getByRole('navigation', { name: '作業タブ' })).toBeVisible()
})

test('create, edit, execute, lock, fork, compare, reload, export, and import', async ({ page }) => {
  await openSample(page)
  await expect(page.getByText('alpha', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('設計比較支援', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('contentinfo')).toContainText('適用限界')

  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: '作業内容へ移動' })).toBeFocused()

  await page.getByRole('button', { name: '新しい比較案' }).click()
  await expect.poll(() => page.locator('.case-row').count()).toBe(5)
  await page.getByRole('link', { name: '解析' }).click()
  await expect(page.getByText('フォーム入力のみ')).toBeVisible()

  // A topology-required kind on this untouched Case stays blocked: no GIS drafts and no
  // saved network input for this kind exist yet.
  await page.getByRole('radio', { name: /管路網の定常解析 \/ Python/ }).check()
  await expect(page.getByText('GIS / 管路網データが必要')).toBeVisible()
  await expect(page.getByRole('button', { name: '計算を実行' })).toBeDisabled()
  await expect(page.getByLabel('解析ケース名')).toHaveValue('取水支線 定常解析')
  await page.getByLabel('解析ケース名').fill('E2E form-only blank Case')
  await page.getByRole('button', { name: '入力条件を保存' }).click()
  await expect(page.getByRole('status')).toHaveText('入力条件を保存しました')

  // A form-only kind on the very same Case needs no GIS topology at all: save its input and
  // Run succeeds immediately (reachability regression fixed by the per-RunKind topology gate).
  await page.getByRole('radio', { name: /波速/ }).check()
  await expect(page.getByText('フォーム入力のみ')).toBeVisible()
  await page.getByRole('button', { name: '入力条件を保存' }).click()
  await expect(page.getByRole('status')).toHaveText('入力条件を保存しました')
  await expect(page.getByRole('button', { name: '計算を実行' })).toBeEnabled()
  await page.getByRole('button', { name: '計算を実行' }).click()
  await expect(page.getByRole('status')).toHaveText('計算が完了しました', { timeout: 60_000 })

  await page.locator('.case-row').filter({ hasText: '基準案' }).getByRole('button').click()

  await page.getByRole('link', { name: 'シナリオ' }).click()
  await page.getByLabel('シナリオ名').fill('E2E valve closure comparison')
  await page.getByRole('button', { name: 'シナリオを保存' }).click()
  await expect(page.getByRole('status')).toHaveText('シナリオを保存しました')

  await page.getByRole('link', { name: '解析' }).click()
  await page.getByRole('radio', { name: /管路網の定常解析 \/ EPANET/ }).check()
  await page.getByRole('button', { name: '計算を実行' }).click()
  await expect(page.getByRole('status')).toHaveText('計算が完了しました', { timeout: 60_000 })
  await expect(page.locator('.state-pill')).toHaveText('計算済み・固定')

  await page.getByRole('button', { name: '複製して編集' }).click()
  const fork = page.getByRole('dialog', { name: '固定済みの比較案を複製' })
  await fork.getByLabel('変更理由').fill('E2E 防護工比較')
  await fork.getByRole('button', { name: '複製して編集' }).click()
  await expect(page.locator('.workspace-breadcrumb').getByText('E2E 防護工比較', { exact: true })).toBeVisible()

  await page.getByRole('link', { name: '比較' }).click()
  await expect(page.getByRole('table', { name: '比較案の比較表' })).toBeVisible()
  await expect(page.getByText('2件')).toBeVisible()

  await page.reload()
  await expect(page.locator('.workspace-breadcrumb').getByText('E2E 防護工比較', { exact: true })).toBeVisible()
  await expect(page.locator('.state-pill')).toHaveText('編集中')

  await page.getByRole('link', { name: 'モデル＋GIS' }).click()
  await page.getByRole('button', { name: 'GeoJSONを読み込む' }).click()
  const importDialog = page.getByRole('dialog', { name: 'GeoJSON読み込み設定' })
  await importDialog.getByLabel('GeoJSON').fill(JSON.stringify({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature', id: 'import-e2e',
      properties: { id: 'N-E2E', elevation: 77 },
      geometry: { type: 'Point', coordinates: [139.71, 35.69] },
    }],
  }))
  await importDialog.getByRole('button', { name: '編集中データとして読み込む' }).click()
  await expect(page.getByText('N-E2E')).toBeVisible()
  const geojsonDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'WGS84で書き出す' }).click()
  await expect((await geojsonDownload).suggestedFilename()).toMatch(/-wgs84\.geojson$/)

  await page.reload()
  await page.getByRole('link', { name: 'モデル＋GIS' }).click()
  await expect(page.getByText('N-E2E')).toBeVisible()

  // Task 4b-4: this fork inherited 基準案's SAMPLE_RUN_INPUTS (fork preserves modelSnapshot
  // verbatim), so joukowsky_allievi's input — pipe/calculationCase/allowablePressureMpa — is
  // already saved; selecting the kind starts non-dirty and "Run calculation" is enabled
  // immediately, same as the untouched Steady network / EPANET run above needed no fresh Save.
  await page.getByRole('link', { name: '解析' }).click()
  await page.getByRole('radio', { name: /Joukowsky \/ Allievi/ }).check()
  await page.getByRole('button', { name: '計算を実行' }).click()
  await expect(page.getByRole('status')).toHaveText('計算が完了しました', { timeout: 60_000 })

  // The deliverable 水理計算書・検討書 button (Part (b)) only enables once a succeeded
  // joukowsky_allievi or longitudinal_hydraulics Run exists for the Case; verify it end-to-end
  // (buildReportInput -> generateDeliverableExcel, no recalculation) with a real download.
  await page.getByRole('link', { name: '帳票' }).click()
  const deliverableButton = page.getByRole('button', { name: /水理計算書・検討書/ })
  await expect(deliverableButton).toBeEnabled()
  const deliverableDownload = page.waitForEvent('download')
  await deliverableButton.click()
  await expect((await deliverableDownload).suggestedFilename()).toMatch(/^waterhammer-report-.+\.xlsx$/)
  await expect(page.getByRole('status')).toHaveText(/水理計算書・検討書を書き出しました/)

  // Disambiguated by label: the blank Case (from the wave_speed Run earlier in this test) and
  // this fork (from the joukowsky_allievi Run just above) are also fixed by now, so the state
  // alone would match three rows.
  await page.locator('.case-row').filter({ hasText: '計算済み・固定' }).filter({ hasText: '基準案' }).getByRole('button').click()
  await expect(page.locator('.state-pill')).toHaveText('計算済み・固定')
  await page.getByRole('link', { name: '帳票' }).click()
  const jsonDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: /計算記録JSON/ }).click()
  await expect((await jsonDownload).suggestedFilename()).toMatch(/^run-.+\.json$/)
  const excelDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: /Excel帳票/ }).click()
  await expect((await excelDownload).suggestedFilename()).toMatch(/^run-.+\.xlsx$/)
  await expect(page.getByRole('status')).toHaveText('保存済みの計算結果からExcel帳票を書き出しました')

  // Task 4b-10: project bundle export/import (.owhproj) — the browser workspace's counterpart
  // to the CLI's exportProjectBundle/importProjectBundle round trip (packages/workspace).
  await page.getByRole('link', { name: '概要' }).click()
  const projectDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: /プロジェクトを書き出し/ }).click()
  const download = await projectDownload
  expect(download.suggestedFilename()).toMatch(/\.owhproj$/)
  const bundlePath = await download.path()
  expect(bundlePath).toBeTruthy()

  // The browser opens one Project at a time. Re-opening this exported file therefore asks for
  // explicit confirmation and atomically replaces (rather than merges with) the current data.
  page.once('dialog', (dialog) => void dialog.accept())
  await page.locator('.project-transfer-card input[type="file"]').setInputFiles(bundlePath!)
  await expect(page.locator('.project-transfer-card [role="status"]')).toContainText('を読み込みました')
  await expect(page.getByRole('heading', { name: 'サンプル：N地区東部幹線水路' })).toBeVisible()
})

test('desktop and narrow workspace keep semantic landmarks without serious accessibility violations', async ({ page }, testInfo) => {
  await openSample(page)
  await expect(page.getByRole('navigation', { name: '作業タブ' })).toBeVisible()
  const desktop = await new AxeBuilder({ page }).analyze()
  expect(desktop.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious')).toEqual([])

  await page.getByRole('link', { name: '解析' }).click()
  await page.getByRole('radio', { name: /管路網の定常解析 \/ Python/ }).check()
  await expect(page.getByLabel('解析ケース名')).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('complementary', { name: 'プロジェクト・代替案・比較案ツリー' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: '計算記録の詳細' })).toBeVisible()
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
  const runKindLabels: Record<(typeof runKinds)[number], string> = {
    wave_speed: '波速',
    joukowsky_allievi: 'Joukowsky / Allievi',
    empirical_pressure: '経験式による水撃圧',
    steady_single_pipe: '単一管路の定常解析',
    steady_network_python: '管路網の定常解析 / Python',
    steady_network_epanet: '管路網の定常解析 / EPANET',
    longitudinal_hydraulics: '縦断水理計算',
    transient_single_pipe: '単一管路の過渡解析',
    transient_network: '管路網の過渡解析',
    transient_pump: 'ポンプ過渡解析',
    transient_protection_device: '水撃圧対策設備',
  }
  const externalRequests = new Set<string>()
  const pyodideRequests = new Set<string>()
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/pyodide/')) pyodideRequests.add(url.pathname)
    if (url.origin !== 'http://127.0.0.1:4173') externalRequests.add(url.origin)
  })

  await openSample(page)
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
  expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'")
  expect(csp).not.toContain("'unsafe-eval'")
  expect(csp).not.toContain('cdn.jsdelivr.net')

  await page.getByRole('button', { name: '新しい比較案' }).click()
  await page.getByRole('link', { name: 'モデル＋GIS' }).click()
  await page.getByRole('button', { name: 'GeoJSONを読み込む' }).click()
  const importDialog = page.getByRole('dialog', { name: 'GeoJSON読み込み設定' })
  await importDialog.getByLabel('GeoJSON').fill(JSON.stringify({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { id: 'R-01', elevation: 100 }, geometry: { type: 'Point', coordinates: [139.7, 35.68] } },
      { type: 'Feature', properties: { id: 'J-01', elevation: 88 }, geometry: { type: 'Point', coordinates: [139.708, 35.684] } },
      { type: 'Feature', properties: { id: 'P-01', startNodeId: 'R-01', endNodeId: 'J-01', innerDiameter: 0.3 }, geometry: { type: 'LineString', coordinates: [[139.7, 35.68], [139.708, 35.684]] } },
    ],
  }))
  await importDialog.getByRole('button', { name: '編集中データとして読み込む' }).click()
  await expect(page.getByText('GIS接続：有効', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: '解析' }).click()
  for (const [index, kind] of runKinds.entries()) {
    await page.locator(`input[type="radio"][value="${kind}"]`).check()
    await expect(page.getByRole('button', { name: '計算を実行' })).toContainText('入力条件の保存が必要')
    await expect(page.getByRole('button', { name: '計算を実行' })).toBeDisabled()
    await expect(page.locator('details.advanced-json')).not.toHaveAttribute('open', '')
    if (kind === 'joukowsky_allievi') {
      // Fresh drafts deliberately omit 許容圧力 (withoutDemoOnlyAllowablePressure strips the
      // demo-only threshold from ENGINEERING_TEMPLATES), so enter it the way an engineer
      // would; the assessment assertion below depends on this typed-in threshold.
      await page.locator('details.advanced-engineering-fields').getByText(/詳細な計算条件/).click()
      await page.getByLabel(/許容圧力/).fill('0.75')
    }
    await page.getByRole('button', { name: '入力条件を保存' }).click()
    await expect(page.getByRole('status')).toHaveText('入力条件を保存しました')
    await expect(page.getByRole('button', { name: '計算を実行' })).toBeEnabled()
    await page.getByRole('button', { name: '計算を実行' }).click()
    await expect(page.getByRole('status')).toHaveText('計算が完了しました', { timeout: 120_000 })
    await expect(page.locator('.state-pill')).toHaveText('計算済み・固定')
    const inspector = page.getByRole('complementary', { name: '計算記録の詳細' })
    await expect(inspector).toContainText(runKindLabels[kind])
    await expect(inspector).toContainText(kind === 'steady_network_epanet' ? 'epanet-js' : 'open-waterhammer-core-py')
    await expect(inspector.getByRole('heading', { name: '結果項目' }).locator('..').locator('dd').first()).not.toHaveText('')
    if (kind === 'joukowsky_allievi') {
      // With 許容圧力 typed in before the save above, the Python protocol computes a real
      // judge_design_pressure assessment (pass/warning/fail) instead of the needs_review
      // default — confirms the wiring end-to-end through Pyodide.
      await expect(inspector.locator('p.assessment')).toHaveClass(/assessment--(pass|warning|fail)/)
    }

    if (index < runKinds.length - 1) {
      await page.getByRole('button', { name: '複製して編集' }).click()
      const fork = page.getByRole('dialog', { name: '固定済みの比較案を複製' })
      await fork.getByLabel('変更理由').fill(`E2E next exact RunKind ${runKinds[index + 1]}`)
      await fork.getByRole('button', { name: '複製して編集' }).click()
      await expect(page.locator('.state-pill')).toHaveText('編集中')
    }
  }

  expect([...pyodideRequests]).toEqual(expect.arrayContaining([
    '/pyodide/pyodide-lock.json',
    '/pyodide/pyodide.asm.wasm',
    '/pyodide/python_stdlib.zip',
  ]))
  expect([...externalRequests]).toEqual([])
  await page.reload()
  await expect(page.locator('.state-pill')).toHaveText('計算済み・固定')
  await expect(page.getByRole('complementary', { name: '計算記録の詳細' })).toContainText('水撃圧対策設備')
})

test('blank form-only Darcy and pump-start branches execute through the real production Runner', async ({ page }) => {
  test.setTimeout(180_000)
  const externalRequests = new Set<string>()
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.origin !== 'http://127.0.0.1:4173') externalRequests.add(url.origin)
  })
  await openSample(page)

  await createBlankCase(page)
  await page.locator('input[type="radio"][value="steady_single_pipe"]').check()
  await page.getByLabel('計算方式').selectOption('darcy-weisbach')
  await expect(page.getByLabel(/Darcy 摩擦係数/)).toHaveValue('0.02')
  await expect(page.getByLabel(/Hazen–Williams C/)).toHaveCount(0)
  await expect(page.locator('details.advanced-json')).not.toHaveAttribute('open', '')
  await page.getByRole('button', { name: '入力条件を保存' }).click()
  await expect(page.getByRole('status')).toHaveText('入力条件を保存しました')
  await page.getByRole('button', { name: '計算を実行' }).click()
  await expect(page.getByRole('status')).toHaveText('計算が完了しました', { timeout: 120_000 })
  await expect(page.getByRole('complementary', { name: '計算記録の詳細' })).toContainText('単一管路の定常解析')

  await createBlankCase(page)
  await page.locator('input[type="radio"][value="transient_pump"]').check()
  await page.getByLabel('ポンプ操作').selectOption('start')
  await expect(page.getByLabel(/定格流量/)).toHaveValue('0.07')
  await expect(page.getByLabel(/起動時間/)).toHaveValue('0.5')
  await expect(page.getByLabel(/停止時間/)).toHaveCount(0)
  await expect(page.locator('details.advanced-json')).not.toHaveAttribute('open', '')
  await page.getByRole('button', { name: '入力条件を保存' }).click()
  await expect(page.getByRole('status')).toHaveText('入力条件を保存しました')
  await page.getByRole('button', { name: '計算を実行' }).click()
  await expect(page.getByRole('status')).toHaveText('計算が完了しました', { timeout: 120_000 })
  await expect(page.getByRole('complementary', { name: '計算記録の詳細' })).toContainText('ポンプ過渡解析')
  expect([...externalRequests]).toEqual([])
})
