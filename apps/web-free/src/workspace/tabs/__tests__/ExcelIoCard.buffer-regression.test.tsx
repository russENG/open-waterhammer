import { InMemoryWorkspaceRepository } from '@open-waterhammer/workspace'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

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

describe('ExcelIoCard template download without a pre-existing globalThis.Buffer', () => {
  let originalBuffer: unknown

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
      // Explicit timeout: this repo's own precedent (WorkspaceApp.test.tsx's findByText calls)
      // hardens async assertions to 5s because the default ~1s window can starve under
      // full-suite parallel load even though the underlying behavior is correct (verified
      // passing reliably, twice, in isolation before this hardening was added).
      await vi.waitFor(() => expect(createObjectURL).toHaveBeenCalled(), { timeout: 5_000 })
      const [blob] = createObjectURL.mock.calls[0]!
      expect(blob).toBeInstanceOf(Blob)
      expect((blob as Blob).size).toBeGreaterThan(1_000)
    } finally {
      createObjectURL.mockRestore()
    }
  })
})
