import { InMemoryWorkspaceRepository } from '@open-waterhammer/workspace'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

import { buildSampleWorkspace } from '../../sample-workspace'
import { WorkspaceProvider } from '../../workspace-context'
import { ExcelIoCard } from '../ExcelIoCard'

/**
 * Fix round 1 (task 4b-4 review, Critical finding): unlike `ExcelIoCard.test.tsx`, this file
 * deliberately does NOT mock `@open-waterhammer/excel-io` — it exercises the REAL
 * `generateTemplate` -> exceljs `wb.xlsx.writeBuffer()` path, which a mocked `generateTemplate`
 * can never catch. Mirrors `deliverable-reports.test.ts`'s `generateDeliverableExcel` real-module
 * regression test: delete `globalThis.Buffer`, invoke the real code path through the component's
 * only public entry point (clicking the template-download button, since `downloadTemplate` itself
 * is not exported), and assert it completes without throwing and actually produces a blob.
 *
 * `downloadTemplate()` must call `ensureBrowserBuffer()` before `generateTemplate()`, exactly like
 * `handleFile()` already does before `parseWorkbook()` — a unit test with excel-io mocked out
 * cannot see this, because the mock never touches `Buffer` at all.
 */
function setup() {
  const data = buildSampleWorkspace('2026-08-23T01:02:03.000Z')
  const repository = new InMemoryWorkspaceRepository(data)
  const caseRecord = data.cases[0]!
  render(
    <WorkspaceProvider repository={repository} initialData={data}>
      <ExcelIoCard caseRecord={caseRecord} />
    </WorkspaceProvider>,
  )
}

const EMPTY_TEMPLATE = { meta: { projectName: 'buffer-regression' }, pipes: [], nodes: [], cases: [], measurementPoints: [] }

describe('ExcelIoCard template download without a pre-existing globalThis.Buffer', () => {
  let originalBuffer: unknown

  /**
   * Load the heavy dynamic imports up front, while `Buffer` still exists.
   *
   * `downloadTemplate()` calls `import('@open-waterhammer/excel-io')` at click time. Under Vitest
   * that first load also transforms exceljs plus the excel-io/core/contracts sources, measured here
   * at ~6.3s — against ~60ms for `generateTemplate()` itself and ~1ms for the Blob. Leaving that
   * inside the assertion window made the test measure "how fast can Vitest load exceljs", which is
   * a property of the machine, not of the code: it passed on CI (Linux) and timed out locally.
   *
   * Warming the module here does not weaken the regression. exceljs reads `Buffer` when it runs,
   * not when it loads, so a module imported while `Buffer` existed still fails once `Buffer` is
   * gone. The "reads Buffer at call time" test below pins that assumption in place, so this
   * warm-up cannot quietly turn the guard into a no-op.
   */
  beforeAll(async () => {
    await import('@open-waterhammer/excel-io')
    await import('buffer')
  }, 60_000)

  beforeEach(() => {
    const browserGlobal = globalThis as typeof globalThis & { Buffer?: unknown }
    originalBuffer = browserGlobal.Buffer
    delete browserGlobal.Buffer
  })

  afterEach(() => {
    (globalThis as typeof globalThis & { Buffer?: unknown }).Buffer = originalBuffer
  })

  test('does not throw and produces a downloadable blob (real exceljs, no Buffer polyfill present)', async () => {
    const user = userEvent.setup()
    // Call-through spy (Vitest's default): observes the real `URL.createObjectURL` call without
    // changing its behavior, so `download()`'s subsequent `anchor.click()`/`revokeObjectURL()`
    // still run against a real blob: URL.
    const createObjectURL = vi.spyOn(URL, 'createObjectURL')
    try {
      setup()
      await user.click(screen.getByRole('button', { name: /テンプレート/ }))
      // With the modules warmed in beforeAll, the work left inside this window is the component's
      // own logic (~100ms). The 5s budget is here to fail a hang, not to assert a speed.
      await vi.waitFor(() => expect(createObjectURL).toHaveBeenCalled(), { timeout: 5_000 })
      const [blob] = createObjectURL.mock.calls[0]!
      expect(blob).toBeInstanceOf(Blob)
      expect((blob as Blob).size).toBeGreaterThan(1_000)
    } finally {
      createObjectURL.mockRestore()
    }
  })

  /**
   * Negative control for the beforeAll warm-up.
   *
   * The warm-up is only safe while exceljs resolves `Buffer` at call time. Should a future exceljs
   * capture it at load time instead, the test above would keep passing while guarding nothing —
   * it would be running against a module that closed over the real `Buffer` before it was deleted.
   * This test fails first in that case, and says why.
   */
  test('exceljs reads Buffer when it runs, not when it loads (keeps the warm-up honest)', async () => {
    const { generateTemplate } = await import('@open-waterhammer/excel-io')
    await expect(generateTemplate(EMPTY_TEMPLATE)).rejects.toThrow(/Buffer/)
  })
})
