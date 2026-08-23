import { PRODUCT_VERSION, SCHEMA_VERSION } from "@open-waterhammer/contracts";
import type {
  AutomatedAssessment,
  Case,
  JsonValue,
  Project,
  RunManifest,
  Scenario,
} from "@open-waterhammer/contracts";

import { canonicalSha256 } from "./hashes.js";
import type { CalculationEngineOutput } from "./types.js";

export interface InputHashes extends Record<string, string> {
  calculation: string;
  model: string;
  scenario: string;
}

export function scenarioCalculationInput(scenario: Scenario): JsonValue {
  return {
    boundaryConditions: scenario.boundaryConditions,
    eventSettings: scenario.eventSettings,
    protectionSettings: scenario.protectionSettings,
  };
}

export async function buildInputHashes(
  kind: import("@open-waterhammer/contracts").RunKind,
  caseSnapshot: Case,
  scenarioSnapshot: Scenario,
): Promise<InputHashes> {
  const scenario = scenarioCalculationInput(scenarioSnapshot);
  const [model, scenarioHash, calculation] = await Promise.all([
    canonicalSha256(caseSnapshot.modelSnapshot),
    canonicalSha256(scenario),
    canonicalSha256({ kind, model: caseSnapshot.modelSnapshot, scenario }),
  ]);
  return { calculation, model, scenario: scenarioHash };
}

export async function buildOutputHashes(
  summary: JsonValue,
  assessment: AutomatedAssessment,
  timeSeries?: JsonValue,
): Promise<Record<string, string>> {
  const entries = await Promise.all([
    canonicalSha256(summary).then((hash) => ["summary", hash] as const),
    canonicalSha256(assessment).then((hash) => ["assessment", hash] as const),
    ...(timeSeries === undefined
      ? []
      : [canonicalSha256(timeSeries).then((hash) => ["timeSeries", hash] as const)]),
  ]);
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

export interface SuccessfulManifestInput {
  runId: string;
  project: Project;
  caseSnapshot: Case;
  scenarioSnapshot: Scenario;
  createdAt: string;
  completedAt: string;
  gitSha: string;
  inputHashes: InputHashes;
  outputHashes: Record<string, string>;
  output: CalculationEngineOutput;
}

export function successfulManifest(input: SuccessfulManifestInput): RunManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    productVersion: PRODUCT_VERSION,
    runId: input.runId,
    caseId: input.caseSnapshot.id,
    scenarioId: input.scenarioSnapshot.id,
    createdAt: input.createdAt,
    completedAt: input.completedAt,
    engine: input.output.engine,
    runtime: input.output.runtime,
    gitSha: input.gitSha,
    inputHashes: input.inputHashes,
    method: input.output.method,
    numericParameters: input.output.numericParameters,
    boundaryParameters: input.output.boundaryParameters,
    standard: input.project.standardSelection,
    rulesVersion: input.project.standardSelection.version,
    outputHashes: input.outputHashes,
    warnings: input.output.warnings ?? [],
    errors: [],
    finalStatus: "succeeded",
  };
}
