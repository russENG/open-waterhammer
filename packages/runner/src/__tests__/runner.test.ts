import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";

import {
  RUN_KINDS,
  alternativeFixture,
  caseFixture,
  projectFixture,
  scenarioFixture,
  validateRun,
} from "@open-waterhammer/contracts";
import type { AutomatedAssessment, RunKind } from "@open-waterhammer/contracts";
import { canonicalJson, InMemoryWorkspaceRepository } from "@open-waterhammer/workspace";

import {
  createExecutorRegistry,
  runCalculation,
} from "../index.js";
import type { CalculationExecutor, CalculationExecutorRegistry } from "../index.js";

const startedAt = "2026-08-23T01:02:03.000Z";
const completedAt = "2026-08-23T01:02:13.000Z";

function repository() {
  return new InMemoryWorkspaceRepository({
    projects: [projectFixture],
    alternatives: [alternativeFixture],
    cases: [caseFixture],
    scenarios: [scenarioFixture],
    runs: [],
    legacyArtifacts: [],
  });
}

function clock(): () => string {
  const values = [startedAt, completedAt];
  return () => values.shift() ?? completedAt;
}

function successfulExecutor(
  assessment: AutomatedAssessment = { status: "pass", findings: [] },
): CalculationExecutor {
  return async ({ kind, caseSnapshot, scenarioSnapshot }) => ({
    engine: "test-engine",
    runtime: "test-runtime",
    method: `method:${kind}`,
    numericParameters: caseSnapshot.modelSnapshot,
    boundaryParameters: scenarioSnapshot.boundaryConditions,
    summary: { kind, peak: 12.5 },
    timeSeries: { seconds: [0, 1], values: [10, 12.5] },
    assessment,
    warnings: ["test warning"],
  });
}

function registry(executor: CalculationExecutor): CalculationExecutorRegistry {
  return createExecutorRegistry(Object.fromEntries(
    RUN_KINDS.map((kind) => [kind, executor]),
  ) as Record<RunKind, CalculationExecutor>);
}

describe("calculation runner", () => {
  test("dispatches every exact contracts RunKind to its registered executor", async (context) => {
    for (const [index, kind] of RUN_KINDS.entries()) {
      await context.test(kind, async () => {
        const seen: RunKind[] = [];
        const executors = registry(async (input) => {
          seen.push(input.kind);
          return successfulExecutor()(input);
        });

        const run = await runCalculation({
          repository: repository(),
          project: projectFixture,
          caseSnapshot: caseFixture,
          scenarioSnapshot: scenarioFixture,
          kind,
          executors,
          createRunId: () => `55555555-5555-4555-8555-${String(index).padStart(12, "0")}`,
          now: clock(),
          gitSha: "abc1234",
        });

        assert.deepEqual(seen, [kind]);
        assert.equal(run.kind, kind);
        assert.equal(run.status, "succeeded");
      });
    }
  });

  test("builds a schema-valid complete manifest with canonical input and output hashes", async () => {
    const beforeCase = structuredClone(caseFixture);
    const beforeScenario = structuredClone(scenarioFixture);
    const mutatingExecutor: CalculationExecutor = async (input) => {
      assert.equal(Object.isFrozen(input.caseSnapshot), true);
      assert.equal(Object.isFrozen(input.caseSnapshot.modelSnapshot), true);
      assert.equal(Object.isFrozen(input.scenarioSnapshot.boundaryConditions), true);
      assert.throws(() => {
        (input.caseSnapshot.modelSnapshot as { pipes: Array<{ lengthM: number }> }).pipes[0]!.lengthM = 9999;
      }, TypeError);
      assert.throws(() => {
        (input.scenarioSnapshot.boundaryConditions as { upstream: string }).upstream = "mutated";
      }, TypeError);
      return successfulExecutor()(input);
    };

    const run = await runCalculation({
      repository: repository(),
      project: projectFixture,
      caseSnapshot: caseFixture,
      scenarioSnapshot: scenarioFixture,
      kind: "wave_speed",
      executors: registry(mutatingExecutor),
      createRunId: () => "55555555-5555-4555-8555-555555555555",
      now: clock(),
      gitSha: "abc1234",
    });

    const scenarioInput = {
      boundaryConditions: scenarioFixture.boundaryConditions,
      eventSettings: scenarioFixture.eventSettings,
      protectionSettings: scenarioFixture.protectionSettings,
    };
    const sha256 = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");

    assert.equal(validateRun(run), true);
    assert.deepEqual(run.manifest.inputHashes, {
      calculation: sha256({ kind: "wave_speed", model: caseFixture.modelSnapshot, scenario: scenarioInput }),
      model: sha256(caseFixture.modelSnapshot),
      scenario: sha256(scenarioInput),
    });
    assert.deepEqual(run.manifest.outputHashes, {
      assessment: sha256(run.assessment),
      summary: sha256(run.summary),
      timeSeries: sha256(run.timeSeries),
    });
    assert.deepEqual(run.manifest, {
      schemaVersion: "1.0.0",
      productVersion: "0.2.0-alpha.1",
      runId: run.id,
      caseId: caseFixture.id,
      scenarioId: scenarioFixture.id,
      createdAt: startedAt,
      completedAt,
      engine: "test-engine",
      runtime: "test-runtime",
      gitSha: "abc1234",
      inputHashes: run.manifest.inputHashes,
      method: "method:wave_speed",
      numericParameters: caseFixture.modelSnapshot,
      boundaryParameters: scenarioFixture.boundaryConditions,
      standard: projectFixture.standardSelection,
      rulesVersion: projectFixture.standardSelection.version,
      outputHashes: run.manifest.outputHashes,
      warnings: ["test warning"],
      errors: [],
      finalStatus: "succeeded",
    });
    assert.deepEqual(caseFixture, beforeCase);
    assert.deepEqual(scenarioFixture, beforeScenario);
  });

  test("persists an executed result as succeeded and locks the Case even when assessment fails", async () => {
    const workspace = repository();
    const run = await runCalculation({
      repository: workspace,
      project: projectFixture,
      caseSnapshot: caseFixture,
      scenarioSnapshot: scenarioFixture,
      kind: "empirical_pressure",
      executors: registry(successfulExecutor({
        status: "fail",
        findings: [{
          targetRef: "P-1",
          observedValue: 1.2,
          threshold: 1.0,
          unit: "MPa",
          ruleId: "pressure-limit",
        }],
      })),
      createRunId: () => "55555555-5555-4555-8555-555555555555",
      now: clock(),
      gitSha: "abc1234",
    });

    assert.equal(run.status, "succeeded");
    assert.equal(run.assessment.status, "fail");
    assert.equal((await workspace.snapshot()).cases[0]?.state, "locked");
  });

  test("persists an actionable failed Run without locking when the engine throws", async () => {
    const workspace = repository();
    const failing: CalculationExecutor = async () => {
      const error = new Error("solver did not converge") as Error & { code?: string };
      error.code = "SOLVER_DIVERGED";
      throw error;
    };

    const run = await runCalculation({
      repository: workspace,
      project: projectFixture,
      caseSnapshot: caseFixture,
      scenarioSnapshot: scenarioFixture,
      kind: "transient_network",
      executors: registry(failing),
      createRunId: () => "55555555-5555-4555-8555-555555555555",
      now: clock(),
      gitSha: "abc1234",
    });

    assert.equal(run.status, "failed");
    assert.deepEqual(run.error, {
      message: "solver did not converge",
      code: "SOLVER_DIVERGED",
    });
    assert.deepEqual(run.manifest.errors, ["solver did not converge"]);
    const saved = await workspace.snapshot();
    assert.deepEqual(saved.runs, [run]);
    assert.equal(saved.cases[0]?.state, "draft");
  });

  test("rejects malformed snapshots and unregistered RunKinds before execution", async () => {
    let calls = 0;
    const executors = registry(async (input) => {
      calls += 1;
      return successfulExecutor()(input);
    });
    await assert.rejects(runCalculation({
      repository: repository(),
      project: projectFixture,
      caseSnapshot: { ...caseFixture, id: "not-a-uuid" },
      scenarioSnapshot: scenarioFixture,
      kind: "wave_speed",
      executors,
    }), /invalid case schema/i);
    await assert.rejects(runCalculation({
      repository: repository(),
      project: projectFixture,
      caseSnapshot: caseFixture,
      scenarioSnapshot: scenarioFixture,
      kind: "unknown_kind" as RunKind,
      executors,
    }), /unsupported run kind/i);
    assert.equal(calls, 0);
  });
});
