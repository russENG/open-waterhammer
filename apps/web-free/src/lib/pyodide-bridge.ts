import type { JsonValue, RunKind } from '@open-waterhammer/contracts'
import type { PythonProtocolResponse } from '@open-waterhammer/runner/browser'

import initSrc from '@open-waterhammer-py/__init__.py?raw'
import formulasSrc from '@open-waterhammer-py/formulas.py?raw'
import longitudinalSrc from '@open-waterhammer-py/longitudinal_hydraulic.py?raw'
import mocSrc from '@open-waterhammer-py/moc.py?raw'
import pipeMaterialsSrc from '@open-waterhammer-py/pipe_materials.py?raw'
import protocolSrc from '@open-waterhammer-py/protocol.py?raw'
import simpleCalcSrc from '@open-waterhammer-py/simple_calculation.py?raw'
import steadyFlowSrc from '@open-waterhammer-py/steady_flow.py?raw'
import steadyNetworkSrc from '@open-waterhammer-py/steady_network.py?raw'
import steadyToMocSrc from '@open-waterhammer-py/steady_to_moc.py?raw'
import typesSrc from '@open-waterhammer-py/types.py?raw'

// Pyodide is loaded from its official distribution only when the first Python Run is requested.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PyodideRuntime = any

const PYODIDE_VERSION = '0.29.0'
const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`

export type PyodideStatus = 'idle' | 'loading' | 'ready' | 'error'

let status: PyodideStatus = 'idle'
let runtimePromise: Promise<PyodideRuntime> | null = null
const listeners = new Set<(next: PyodideStatus) => void>()

function updateStatus(next: PyodideStatus) {
  status = next
  listeners.forEach((listener) => listener(next))
}

export function getPyodideStatus(): PyodideStatus {
  return status
}

export function subscribePyodideStatus(listener: (next: PyodideStatus) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function loadPyodideOnce(): Promise<PyodideRuntime> {
  if (runtimePromise) return runtimePromise
  updateStatus('loading')
  runtimePromise = (async () => {
    try {
      const module = await import(/* @vite-ignore */ `${PYODIDE_INDEX_URL}pyodide.mjs`)
      const pyodide = await module.loadPyodide({ indexURL: PYODIDE_INDEX_URL })
      pyodide.FS.mkdirTree('/home/pyodide/open_waterhammer')
      const sources: Record<string, string> = {
        '__init__.py': initSrc,
        'types.py': typesSrc,
        'pipe_materials.py': pipeMaterialsSrc,
        'formulas.py': formulasSrc,
        'moc.py': mocSrc,
        'simple_calculation.py': simpleCalcSrc,
        'longitudinal_hydraulic.py': longitudinalSrc,
        'protocol.py': protocolSrc,
        'steady_flow.py': steadyFlowSrc,
        'steady_network.py': steadyNetworkSrc,
        'steady_to_moc.py': steadyToMocSrc,
      }
      for (const [name, source] of Object.entries(sources)) {
        pyodide.FS.writeFile(`/home/pyodide/open_waterhammer/${name}`, source)
      }
      pyodide.runPython('import open_waterhammer')
      updateStatus('ready')
      return pyodide
    } catch (error) {
      runtimePromise = null
      updateStatus('error')
      throw error
    }
  })()
  return runtimePromise
}

export interface PyodideCalculationRequest {
  protocolVersion: 1
  kind: RunKind
  model: JsonValue
  scenario: {
    boundaryConditions: JsonValue
    eventSettings: JsonValue
    protectionSettings: JsonValue
  }
  inputHash?: string
}

/** Execute the CPython-compatible protocol and always return its structured envelope. */
export async function runCalculationProtocolPy(
  request: PyodideCalculationRequest,
): Promise<PythonProtocolResponse> {
  const pyodide = await loadPyodideOnce()
  const serialized = JSON.stringify(request)
  const code = `
import json
from open_waterhammer.protocol import execute_request, ProtocolError, PROTOCOL_VERSION
try:
    _browser_response = execute_request(json.loads(${JSON.stringify(serialized)}))
except ProtocolError as _protocol_error:
    _browser_response = {
        "protocolVersion": PROTOCOL_VERSION,
        "ok": False,
        "error": {"code": _protocol_error.code, "message": str(_protocol_error)},
    }
except Exception as _engine_error:
    _browser_response = {
        "protocolVersion": PROTOCOL_VERSION,
        "ok": False,
        "error": {"code": "ENGINE_ERROR", "message": str(_engine_error)},
    }
json.dumps(_browser_response, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
`
  return JSON.parse(pyodide.runPython(code) as string) as PythonProtocolResponse
}
