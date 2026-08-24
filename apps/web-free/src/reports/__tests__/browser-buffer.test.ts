import { describe, expect, test } from 'vitest'

import { ensureBrowserBuffer } from '../browser-buffer'

describe('ensureBrowserBuffer', () => {
  test('installs globalThis.Buffer when absent', async () => {
    const browserGlobal = globalThis as typeof globalThis & { Buffer?: unknown }
    const original = browserGlobal.Buffer
    delete browserGlobal.Buffer
    try {
      expect(browserGlobal.Buffer).toBeUndefined()
      await ensureBrowserBuffer()
      expect(browserGlobal.Buffer).toBeDefined()
      expect(typeof browserGlobal.Buffer).toBe('function')
    } finally {
      browserGlobal.Buffer = original
    }
  })

  test('does not replace an existing Buffer implementation', async () => {
    const browserGlobal = globalThis as typeof globalThis & { Buffer?: unknown }
    const original = browserGlobal.Buffer
    const sentinel = { marker: 'existing-buffer' }
    browserGlobal.Buffer = sentinel
    try {
      await ensureBrowserBuffer()
      expect(browserGlobal.Buffer).toBe(sentinel)
    } finally {
      browserGlobal.Buffer = original
    }
  })
})
