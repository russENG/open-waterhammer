import { beforeEach, describe, expect, test, vi } from 'vitest'

// pyodide-bridge.ts caches its runtime promise / status at module scope, so each test
// re-imports a fresh instance of the module (via vi.resetModules + dynamic import) —
// same isolation pattern as pyodide-prefetch.test.ts.
const loadPyodideMock = vi.fn()

vi.mock('pyodide', () => ({
  loadPyodide: (...args: unknown[]) => loadPyodideMock(...args),
}))

describe('runCalculationProtocolPy envelope parity with protocol.py main()', () => {
  beforeEach(() => {
    vi.resetModules()
    loadPyodideMock.mockReset()
  })

  test('the generated Python snippet builds the exact same ProtocolError/ENGINE_ERROR envelope as main(), and the parsed result matches PythonProtocolResponse', async () => {
    let capturedCode = ''
    const canned = { protocolVersion: 1, ok: false, error: { code: 'INVALID_INPUT', message: 'boom' } }
    const runtime = {
      FS: { mkdirTree: vi.fn(), writeFile: vi.fn() },
      runPython: vi.fn((code: string) => {
        capturedCode = code
        // Stand-in for what real CPython would return for this exact snippet — the
        // point under test is the *shape* of the snippet itself (asserted below),
        // not Pyodide's own JSON serialization.
        return JSON.stringify(canned)
      }),
    }
    loadPyodideMock.mockResolvedValueOnce(runtime)

    const { runCalculationProtocolPy } = await import('../pyodide-bridge')
    const response = await runCalculationProtocolPy({
      protocolVersion: 1,
      kind: 'wave_speed',
      model: {},
      scenario: { boundaryConditions: {}, eventSettings: {}, protectionSettings: {} },
    })

    // Whitespace-insensitive so reformatting the template literal doesn't break this —
    // only a real change to the envelope shape should.
    const normalized = capturedCode.replace(/\s+/g, ' ').trim()

    // protocolVersion must come from the same PROTOCOL_VERSION the success path (and
    // ProtocolError/execute_request) import from — never a hardcoded literal that could
    // silently drift from packages/core-py/open_waterhammer/protocol.py.
    expect(normalized).toContain(
      'from open_waterhammer.protocol import execute_request, ProtocolError, PROTOCOL_VERSION',
    )

    // ProtocolError branch — must match protocol.py main()'s:
    //   response = {"protocolVersion": PROTOCOL_VERSION, "ok": False,
    //               "error": {"code": error.code, "message": str(error)}}
    expect(normalized).toContain('except ProtocolError as _protocol_error:')
    expect(normalized).toContain(
      '"error": {"code": _protocol_error.code, "message": str(_protocol_error)},',
    )

    // Catch-all Exception branch — must match protocol.py main()'s ENGINE_ERROR fallback:
    //   response = {"protocolVersion": PROTOCOL_VERSION, "ok": False,
    //               "error": {"code": "ENGINE_ERROR", "message": str(error)}}
    expect(normalized).toContain('except Exception as _engine_error:')
    expect(normalized).toContain(
      '"error": {"code": "ENGINE_ERROR", "message": str(_engine_error)},',
    )

    // Both branches carry the same two envelope fields main() sets before "error".
    expect(normalized.match(/"protocolVersion": PROTOCOL_VERSION,/g)).toHaveLength(2)
    expect(normalized.match(/"ok": False,/g)).toHaveLength(2)

    // Serialized with the exact same json.dumps options as protocol.py (main() and
    // run_protocol_json both use ensure_ascii=False, separators=(",", ":"), sort_keys=True).
    expect(normalized).toContain(
      'json.dumps(_browser_response, ensure_ascii=False, separators=(",", ":"), sort_keys=True)',
    )

    // And the round trip through JSON.parse yields a PythonProtocolFailure-shaped value.
    expect(response).toEqual(canned)
  })
})
