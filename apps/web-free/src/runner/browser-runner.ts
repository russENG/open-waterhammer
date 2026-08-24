import { RUN_KINDS, type JsonValue, type RunKind } from '@open-waterhammer/contracts'
import {
  createEpanetExecutor,
  createExecutorRegistry,
  type CalculationExecutor,
  type PythonProtocolResponse,
} from '@open-waterhammer/runner/browser'

import { runCalculationProtocolPy } from '../lib/pyodide-bridge'

export interface BrowserProtocolRequest {
  protocolVersion: 1
  kind: RunKind
  model: JsonValue
  scenario: {
    boundaryConditions: JsonValue
    eventSettings: JsonValue
    protectionSettings: JsonValue
  }
  inputHash: string
}

export type BrowserProtocolCaller = (request: BrowserProtocolRequest) => Promise<PythonProtocolResponse>

export function createBrowserPythonExecutor(
  callProtocol: BrowserProtocolCaller = runCalculationProtocolPy,
): CalculationExecutor {
  return async ({ kind, caseSnapshot, scenarioSnapshot, calculationInputHash }) => {
    const scenario = {
      boundaryConditions: scenarioSnapshot.boundaryConditions,
      eventSettings: scenarioSnapshot.eventSettings,
      protectionSettings: scenarioSnapshot.protectionSettings,
    }
    const response = await callProtocol({
      protocolVersion: 1,
      kind,
      model: caseSnapshot.modelSnapshot,
      scenario,
      inputHash: calculationInputHash,
    })
    if (!response.ok) {
      const error = new Error(response.error.message) as Error & { code: string }
      error.code = response.error.code
      throw error
    }
    return {
      engine: 'open-waterhammer-core-py',
      runtime: `pyodide-${response.pythonVersion}`,
      method: response.result.method,
      numericParameters: response.result.numericParameters,
      boundaryParameters: response.result.boundaryParameters,
      summary: response.result.summary,
      ...(response.result.timeSeries === undefined ? {} : { timeSeries: response.result.timeSeries }),
      assessment: response.result.assessment,
      warnings: response.result.warnings,
      inputHash: response.inputHash,
    }
  }
}

export function createBrowserExecutorRegistry(options: {
  callProtocol?: BrowserProtocolCaller
  epanetExecutor?: CalculationExecutor
} = {}) {
  const pythonExecutor = createBrowserPythonExecutor(options.callProtocol)
  const epanetExecutor = options.epanetExecutor ?? createEpanetExecutor()
  return createExecutorRegistry(Object.fromEntries(RUN_KINDS.map((kind) => [
    kind,
    kind === 'steady_network_epanet' ? epanetExecutor : pythonExecutor,
  ])) as Record<RunKind, CalculationExecutor>)
}
