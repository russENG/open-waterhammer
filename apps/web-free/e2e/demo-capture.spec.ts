import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test, type Page } from '@playwright/test'

/**
 * デモ手順（docs/demo-plan.md の S0〜S9）を実機で通し、各手順の画面を撮る。
 *
 * 撮った PNG は `public/demo/img/` に置き、静的デモページ（`public/demo/*.html`）から参照する。
 * 「デモの画面写真が実装とずれていない」ことを、手作業ではなくこのテストで担保する。
 *
 * 実行:
 *   OWH_CAPTURE_DEMO=1 npx playwright test demo-capture --workers=1
 *
 * 通常のE2EとCIでは、画面写真や実測値で作業ツリーを変更しないようスキップする。
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const IMG_DIR = join(HERE, '..', 'public', 'demo', 'img')
const FACT_FILE = join(HERE, '..', 'public', 'demo', 'measured.json')

/** 静的ページ側で数値を埋めるために、実測値を書き出す。 */
const measured: Record<string, unknown> = {}

function record(key: string, value: unknown): void {
  measured[key] = value
}

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(IMG_DIR, { recursive: true })
  await page.screenshot({ path: join(IMG_DIR, `${name}.png`), fullPage: false })
}

/** 画面の状態が落ち着くまで待つ（Pyodide の読み込み・IndexedDB の書き込み）。 */
async function settle(page: Page, ms = 400): Promise<void> {
  await page.waitForTimeout(ms)
}

/** 左ツリーの「複製して編集」で、編集可能な比較案を作る。 */
async function forkCase(page: Page, reason: string): Promise<void> {
  await page.getByRole('button', { name: '複製して編集' }).first().click()
  const dialog = page.getByRole('dialog', { name: '固定済みの比較案を複製' })
  await dialog.getByRole('textbox').fill(reason)
  await dialog.getByRole('button', { name: '複製して編集' }).click()
  await expect(page.getByRole('link', { name: '解析' })).toBeVisible()
  await settle(page, 800)
}

/** 計算方法を選ぶ（ラジオは視覚的に隠れているので value で指定する）。 */
async function selectKind(page: Page, value: string): Promise<void> {
  await page.locator(`input[type=radio][value="${value}"]`).check()
  await settle(page, 500)
}

async function saveAndRun(page: Page): Promise<void> {
  await page.getByRole('button', { name: '入力条件を保存' }).click()
  await expect(page.getByText('入力条件を保存しました')).toBeVisible()
  await page.getByRole('button', { name: '計算を実行' }).click()
  await expect(page.getByText('計算が完了しました')).toBeVisible({ timeout: 120_000 })
}

test('デモ手順の画面を撮る', async ({ page }, testInfo) => {
  test.skip(process.env.OWH_CAPTURE_DEMO !== '1', 'OWH_CAPTURE_DEMO=1 の明示時だけ画面写真を更新する')
  testInfo.setTimeout(600_000)

  // ── S0 開始画面 ───────────────────────────────────────────────────────────
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '作業を始める' })).toBeVisible()
  await shot(page, 's0-start')

  // ── S1 入力テンプレートのダウンロード ────────────────────────────────────
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '入力テンプレートをダウンロード' }).click()
  const download = await downloadPromise
  const templatePath = join(testInfo.outputDir, download.suggestedFilename())
  await download.saveAs(templatePath)
  record('templateFileName', download.suggestedFilename())

  // ── S2 取込（テンプレートをそのまま渡す） ────────────────────────────────
  await page.setInputFiles('input[aria-label="Excelから開始するファイルを選択"]', templatePath)

  // 取込の注意事項レポート（既定値で補完した項目を見せる画面）
  await expect(page.getByRole('heading', { name: /取り込みました/ })).toBeVisible({ timeout: 60_000 })
  const reportHeading = await page.getByRole('heading', { name: /取り込みました/ }).innerText()
  record('importReportHeading', reportHeading)
  record('importWarnings', await page.locator('.import-report__list li').allInnerTexts())
  await shot(page, 's2-import-report')

  await page.getByRole('button', { name: /作業画面へ進む/ }).click()
  await expect(page.getByRole('link', { name: '概要' })).toBeVisible()
  await settle(page, 800)
  await shot(page, 's2-overview')

  // ── S3/S4 管路・シナリオの確認 ───────────────────────────────────────────
  await page.getByRole('link', { name: 'シナリオ' }).click()
  await settle(page, 600)
  await shot(page, 's4-scenario')

  await page.getByRole('link', { name: '解析' }).click()
  await settle(page, 600)
  await selectKind(page, 'joukowsky_allievi')
  await shot(page, 's5-analysis-form')

  // ── S5 A02 Joukowsky / Allievi ───────────────────────────────────────────
  await saveAndRun(page)
  await settle(page, 800)
  await shot(page, 's5-analysis-done')

  await page.getByRole('link', { name: '結果' }).click()
  await settle(page, 800)
  record('a02Summary', await page.locator('.result-summary-strip article').allInnerTexts())
  await shot(page, 's5-results')

  // ── S6 L01 縦断水理計算 ──────────────────────────────────────────────────
  await forkCase(page, '縦断水理計算')
  await page.getByRole('link', { name: '解析' }).click()
  await settle(page, 600)
  await selectKind(page, 'longitudinal_hydraulics')
  await shot(page, 's6-longitudinal-form')
  await saveAndRun(page)
  await page.getByRole('link', { name: '結果' }).click()
  await settle(page, 1000)
  record('l01Summary', await page.locator('.result-summary-strip article').allInnerTexts())
  await shot(page, 's6-longitudinal-results')

  // ── S7 帳票 ──────────────────────────────────────────────────────────────
  await page.getByRole('link', { name: '帳票' }).click()
  await settle(page, 800)
  record('reportNote', await page.locator('.export-actions .inline-message').first().innerText())
  await shot(page, 's7-reports')

  const deliverablePromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /水理計算書・検討書/ }).click()
  const deliverable = await deliverablePromise
  record('deliverableFileName', deliverable.suggestedFilename())
  await deliverable.saveAs(join(testInfo.outputDir, deliverable.suggestedFilename()))

  // ── S8 T01 単一管路の過渡解析 ────────────────────────────────────────────
  await forkCase(page, '単一管路の過渡解析')
  await page.getByRole('link', { name: '解析' }).click()
  await settle(page, 600)
  await selectKind(page, 'transient_single_pipe')
  await shot(page, 's8-transient-form')
  await saveAndRun(page)
  await page.getByRole('link', { name: '結果' }).click()
  await settle(page, 1200)
  record('t01Summary', await page.locator('.result-summary-strip article').allInnerTexts())
  await shot(page, 's8-transient-results')

  // ── 比較 ─────────────────────────────────────────────────────────────────
  const checkboxes = page.locator('.compare-check input[type=checkbox]')
  for (let index = 0; index < await checkboxes.count(); index++) {
    const box = checkboxes.nth(index)
    if (!(await box.isChecked())) await box.check()
  }
  await page.getByRole('link', { name: '比較' }).click()
  await settle(page, 800)
  await shot(page, 's7-compare')

  writeFileSync(FACT_FILE, `${JSON.stringify(measured, null, 2)}\n`, 'utf8')
})
