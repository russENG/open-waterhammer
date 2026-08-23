import { beforeEach, describe, expect, test, vi } from 'vitest'

// pyodide-bridge.ts caches its runtime promise / status at module scope, so each test
// re-imports a fresh instance of the module (via vi.resetModules + dynamic import)
// to avoid state leaking between assertions.
const loadPyodideMock = vi.fn()

vi.mock('pyodide', () => ({
  loadPyodide: (...args: unknown[]) => loadPyodideMock(...args),
}))

function fakeRuntime() {
  return { FS: { mkdirTree: vi.fn(), writeFile: vi.fn() }, runPython: vi.fn() }
}

describe('prefetchPyodide', () => {
  beforeEach(() => {
    vi.resetModules()
    loadPyodideMock.mockReset()
  })

  test('is a fire-and-forget call that does not throw or reject when the load fails', async () => {
    const { prefetchPyodide } = await import('../pyodide-bridge')
    loadPyodideMock.mockRejectedValueOnce(new Error('network down'))

    expect(() => prefetchPyodide()).not.toThrow()
    // Give the swallowed rejection's microtask a chance to run; an unhandled
    // rejection would otherwise surface as a test failure.
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  test('does not cache the rejected load — a later loadPyodideOnce call retries from scratch', async () => {
    const { prefetchPyodide, loadPyodideOnce, getPyodideStatus } = await import('../pyodide-bridge')
    loadPyodideMock.mockRejectedValueOnce(new Error('network down'))

    prefetchPyodide()
    await vi.waitFor(() => expect(getPyodideStatus()).toBe('error'))
    expect(loadPyodideMock).toHaveBeenCalledTimes(1)

    loadPyodideMock.mockResolvedValueOnce(fakeRuntime())
    await expect(loadPyodideOnce()).resolves.toBeDefined()
    expect(loadPyodideMock).toHaveBeenCalledTimes(2)
    expect(getPyodideStatus()).toBe('ready')
  })

  test('a concurrent prefetch during an in-flight load does not start a second load', async () => {
    const { prefetchPyodide, loadPyodideOnce } = await import('../pyodide-bridge')
    let resolveLoad!: (value: unknown) => void
    loadPyodideMock.mockReturnValueOnce(new Promise((resolve) => { resolveLoad = resolve }))

    const inFlight = loadPyodideOnce()
    prefetchPyodide()
    resolveLoad(fakeRuntime())
    await inFlight

    expect(loadPyodideMock).toHaveBeenCalledTimes(1)
  })
})
