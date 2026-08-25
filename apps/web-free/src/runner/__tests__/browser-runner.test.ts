import {
  RUN_KINDS,
  alternativeFixture,
  caseFixture,
  projectFixture,
  scenarioFixture,
  type RunKind,
} from '@open-waterhammer/contracts'
import { runCalculation } from '@open-waterhammer/runner'
import { InMemoryWorkspaceRepository } from '@open-waterhammer/workspace'
import { describe, expect, test, vi } from 'vitest'

import { createBrowserExecutorRegistry, createBrowserPythonExecutor } from '../browser-runner'

const successProtocol = vi.fn(async (request: { kind: RunKind }) => ({
  protocolVersion: 1 as const,
  ok: true as const,
  pythonVersion: '3.13.5',
  inputHash: 'canonical-hash',
  result: {
    method: request.kind,
    numericParameters: { source: 'python' },
    boundaryParameters: { event: 'test' },
    summary: { peakPressureMpa: 1.23 },
    assessment: { status: 'needs_review' as const, findings: [] },
    warnings: [],
  },
}))

describe('browser CalculationRunner adapter', () => {
  test('maps a Pyodide success envelope into the public runner executor contract', async () => {
    const executor = createBrowserPythonExecutor(successProtocol)
    const output = await executor({
      kind: 'wave_speed',
      caseSnapshot: caseFixture,
      scenarioSnapshot: scenarioFixture,
      calculationInputHash: 'canonical-hash',
    })

    expect(output).toMatchObject({
      engine: 'open-waterhammer-core-py',
      runtime: 'pyodide-3.13.5',
      method: 'wave_speed',
      inputHash: 'canonical-hash',
      summary: { peakPressureMpa: 1.23 },
    })
  })

  test('normalizes a Pyodide protocol failure to the structured error read by the runner', async () => {
    const executor = createBrowserPythonExecutor(async () => ({
      protocolVersion: 1,
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'Missing required field: pipe' },
    }))

    await expect(executor({
      kind: 'wave_speed',
      caseSnapshot: caseFixture,
      scenarioSnapshot: scenarioFixture,
      calculationInputHash: 'hash',
    })).rejects.toMatchObject({ code: 'INVALID_INPUT', message: 'Missing required field: pipe' })
  })

  test('all eleven RunKinds execute through the real common runner and its persistence authority', async () => {
    const registry = createBrowserExecutorRegistry({
      callProtocol: async (request) => ({
        protocolVersion: 1,
        ok: true,
        pythonVersion: '3.13.5',
        inputHash: request.inputHash,
        result: {
          method: request.kind,
          numericParameters: request.model,
          boundaryParameters: request.scenario,
          summary: { kind: request.kind },
          assessment: { status: 'needs_review', findings: [] },
          warnings: [],
        },
      }),
      epanetExecutor: async ({ kind, calculationInputHash }) => ({
        engine: 'epanet-js',
        runtime: 'javascript-wasm',
        method: kind,
        numericParameters: {},
        boundaryParameters: {},
        summary: { kind },
        assessment: { status: 'needs_review', findings: [] },
        inputHash: calculationInputHash,
      }),
      epanetInitialSolver: async () => ({
        caseName: 'initial',
        pipeResults: [{
          pipeId: 'P-1', flow: 0.03, velocity: 0.42, velocityHead: 0.01,
          frictionLoss: 1, minorLoss: 0, totalLoss: 1, hydraulicGradient: 0.01,
        }],
        nodeResults: [
          { nodeId: 'R', head: 80, hydraulicGradeLine: 80, pressureHead: 80, pressureMpa: 0.78 },
          { nodeId: 'V', head: 79, hydraulicGradeLine: 79, pressureHead: 79, pressureMpa: 0.77 },
        ],
        maxVelocity: 0.42,
        maxPressureHead: 80,
        warnings: [],
      }),
    })

    const transientModel = {
      network: {
        pipes: [{
          id: 'P-1',
          pipe: {
            id: 'P-1', startNodeId: 'R', endNodeId: 'V', pipeType: 'ductile_iron',
            innerDiameter: 0.3, wallThickness: 0.01, length: 100, roughnessCoeff: 130,
          },
          waveSpeed: 1000, nReaches: 2, upstreamNodeId: 'R', downstreamNodeId: 'V', initialFlow: 0.02,
        }],
        nodes: {
          R: { type: 'reservoir', head: 80 },
          V: { type: 'valve', Q0: 0.02, H0v: 70, closeTime: 2 },
        },
      },
      options: { tMax: 2, initialFlow: 0.02 },
    }

    for (const [index, kind] of RUN_KINDS.entries()) {
      const currentCase = {
        ...caseFixture,
        id: `33333333-3333-4333-8333-${String(index + 1).padStart(12, '0')}`,
        modelSnapshot: kind === 'transient_network' || kind === 'transient_protection_device'
          ? transientModel
          : caseFixture.modelSnapshot,
      }
      const currentScenario = { ...scenarioFixture, id: `44444444-4444-4444-8444-${String(index + 1).padStart(12, '0')}`, caseId: currentCase.id }
      const repository = new InMemoryWorkspaceRepository({
        projects: [projectFixture], alternatives: [alternativeFixture], cases: [currentCase],
        scenarios: [currentScenario], runs: [], legacyArtifacts: [],
      })
      const run = await runCalculation({
        repository,
        project: projectFixture,
        caseSnapshot: currentCase,
        scenarioSnapshot: currentScenario,
        kind,
        executors: registry,
        createRunId: () => `55555555-5555-4555-8555-${String(index + 1).padStart(12, '0')}`,
        now: () => '2026-08-23T01:02:03.000Z',
      })

      expect(run.status, kind).toBe('succeeded')
      expect((await repository.snapshot()).runs, kind).toHaveLength(1)
      expect((await repository.snapshot()).cases[0]!.state, kind).toBe('locked')
    }
  })
})
