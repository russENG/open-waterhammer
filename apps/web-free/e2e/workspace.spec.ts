import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

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

  await page.locator('.case-row').filter({ hasText: 'locked' }).getByRole('button').click()
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

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('complementary', { name: 'Project Alternative Case tree' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Run Inspector' })).toBeVisible()
  const narrow = await new AxeBuilder({ page }).analyze()
  expect(narrow.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious')).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('workspace-narrow.png'), fullPage: true })
})

test('a Python-owned RunKind crosses the real lazy Pyodide protocol boundary', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Analysis' }).click()
  await expect(page.getByRole('radio', { name: /Wave speed/ })).toBeChecked()
  await page.getByRole('button', { name: 'Run calculation' }).click()
  await expect(page.getByRole('status')).toHaveText('Run succeeded', { timeout: 120_000 })
  await expect(page.getByRole('complementary', { name: 'Run Inspector' })).toContainText('open-waterhammer-core-py')
  await expect(page.getByRole('complementary', { name: 'Run Inspector' })).toContainText('pyodide-')
})
