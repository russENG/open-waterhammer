import {
  PRODUCT_VERSION,
  SCHEMA_VERSION,
  validateAutomatedAssessment,
  validateCase,
  validateProject,
  validateRun,
  validateScenario,
} from "@open-waterhammer/contracts";
import type { AutomatedAssessment, JsonValue, Run, RunError, RunManifest } from "@open-waterhammer/contracts";

import {
  buildInputHashes,
  buildOutputHashes,
  scenarioCalculationInput,
  successfulManifest,
} from "./manifest.js";
import { isRunKind } from "./registry.js";
import type { RunCalculationInput, RunCalculationResult } from "./types.js";

function needsReview(): AutomatedAssessment {
  return { status: "needs_review", findings: [] };
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value && typeof value === "object" && !seen.has(value)) {
    seen.add(value);
    for (const child of Object.values(value)) deepFreeze(child, seen);
    Object.freeze(value);
  }
  return value;
}

function assertValid(label: string, valid: unknown): void {
  if (valid !== true) throw new Error(`Invalid ${label} schema`);
}

function engineError(error: unknown): RunError {
  if (error instanceof Error) {
    const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
    return code === undefined ? { message: error.message } : { message: error.message, code };
  }
  return { message: String(error), code: "ENGINE_ERROR" };
}

async function failedRun(
  input: RunCalculationInput,
  runId: string,
  createdAt: string,
  completedAt: string,
  hashes: Awaited<ReturnType<typeof buildInputHashes>>,
  error: RunError,
): Promise<Run> {
  const summary: JsonValue = {};
  const assessment = needsReview();
  const outputHashes = await buildOutputHashes(summary, assessment);
  const manifest: RunManifest = {
    schemaVersion: SCHEMA_VERSION,
    productVersion: PRODUCT_VERSION,
    runId,
    caseId: input.caseSnapshot.id,
    scenarioId: input.scenarioSnapshot.id,
    createdAt,
    completedAt,
    engine: "open-waterhammer-runner",
    runtime: "local",
    gitSha: input.gitSha ?? "unknown",
    inputHashes: hashes,
    method: input.kind,
    numericParameters: input.caseSnapshot.modelSnapshot,
    boundaryParameters: scenarioCalculationInput(input.scenarioSnapshot),
    standard: input.project.standardSelection,
    rulesVersion: input.project.standardSelection.version,
    outputHashes,
    warnings: [],
    errors: [error.message],
    finalStatus: "failed",
  };
  return {
    id: runId,
    caseId: input.caseSnapshot.id,
    scenarioId: input.scenarioSnapshot.id,
    kind: input.kind,
    status: "failed",
    manifest,
    summary,
    assessment,
    error,
    createdAt,
    updatedAt: completedAt,
  };
}

export async function runCalculation(input: RunCalculationInput): Promise<RunCalculationResult> {
  assertValid("Project", validateProject(input.project));
  assertValid("Case", validateCase(input.caseSnapshot));
  assertValid("Scenario", validateScenario(input.scenarioSnapshot));
  if (input.scenarioSnapshot.caseId !== input.caseSnapshot.id) {
    throw new Error("Scenario does not belong to the Case");
  }
  if (!isRunKind(input.kind)) throw new Error(`Unsupported Run kind: ${String(input.kind)}`);
  const executor = input.executors.get(input.kind);
  if (!executor) throw new Error(`Unsupported Run kind: ${input.kind}`);

  const runId = (input.createRunId ?? (() => globalThis.crypto.randomUUID()))();
  const timestamp = input.now ?? (() => new Date().toISOString());
  const createdAt = timestamp();
  const hashes = await buildInputHashes(input.kind, input.caseSnapshot, input.scenarioSnapshot);

  let run: Run;
  try {
    const output = await executor({
      kind: input.kind,
      caseSnapshot: deepFreeze(structuredClone(input.caseSnapshot)),
      scenarioSnapshot: deepFreeze(structuredClone(input.scenarioSnapshot)),
      calculationInputHash: hashes.calculation,
    });
    if (output.inputHash !== undefined && output.inputHash !== hashes.calculation) {
      const mismatch = new Error("Engine input hash does not match the canonical runner input") as Error & { code: string };
      mismatch.code = "INPUT_HASH_MISMATCH";
      throw mismatch;
    }
    const assessment = output.assessment ?? needsReview();
    assertValid("AutomatedAssessment", validateAutomatedAssessment(assessment));
    const completedAt = timestamp();
    const outputHashes = await buildOutputHashes(output.summary, assessment, output.timeSeries);
    const manifest = successfulManifest({
      runId,
      project: input.project,
      caseSnapshot: input.caseSnapshot,
      scenarioSnapshot: input.scenarioSnapshot,
      createdAt,
      completedAt,
      gitSha: input.gitSha ?? "unknown",
      inputHashes: hashes,
      outputHashes,
      output,
    });
    run = {
      id: runId,
      caseId: input.caseSnapshot.id,
      scenarioId: input.scenarioSnapshot.id,
      kind: input.kind,
      status: "succeeded",
      manifest,
      summary: output.summary,
      ...(output.timeSeries === undefined ? {} : { timeSeries: output.timeSeries }),
      assessment,
      error: null,
      createdAt,
      updatedAt: completedAt,
    };
  } catch (error) {
    run = await failedRun(input, runId, createdAt, timestamp(), hashes, engineError(error));
  }

  assertValid("Run", validateRun(run));
  await input.repository.appendRun(run);
  return run;
}
