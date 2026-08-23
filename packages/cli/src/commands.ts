import { readFile, writeFile } from "node:fs/promises";

import type { RunKind } from "@open-waterhammer/contracts";
import {
  createCpythonExecutor,
  createDefaultExecutorRegistry,
  isRunKind,
  runCalculation,
} from "@open-waterhammer/runner";
import {
  InMemoryWorkspaceRepository,
  inspectProjectBundle,
  validateProjectBundle,
} from "@open-waterhammer/workspace";

import type { CliCommand } from "./arguments.js";
import { assertNewOutputPath } from "./paths.js";

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

export class CliCommandError extends Error {
  constructor(message: string, readonly exitCode = 1) {
    super(message);
  }
}

function runKindFromScenario(eventSettings: unknown): RunKind {
  if (!eventSettings || typeof eventSettings !== "object" || Array.isArray(eventSettings)) {
    throw new CliCommandError("Scenario eventSettings must define a supported runKind", 2);
  }
  const value = (eventSettings as Record<string, unknown>).runKind;
  if (!isRunKind(value)) {
    throw new CliCommandError(`Unsupported Scenario runKind: ${String(value)}`, 2);
  }
  return value;
}

export async function executeCommand(command: CliCommand, io: CliIo): Promise<number> {
  const bytes = await readFile(command.bundle);
  if (command.name === "validate") {
    await validateProjectBundle(bytes);
    io.stdout(`Valid bundle: ${command.bundle}\n`);
    return 0;
  }

  const inspection = await inspectProjectBundle(bytes);
  if (command.name === "inspect") {
    io.stdout(`${JSON.stringify({
      bundleFormatVersion: inspection.bundleFormatVersion,
      project: { id: inspection.project.id, name: inspection.project.name },
      counts: {
        alternatives: inspection.alternatives.length,
        cases: inspection.cases.length,
        scenarios: inspection.scenarios.length,
        runs: inspection.runs.length,
        legacyArtifacts: inspection.legacyArtifacts.length,
      },
    }, null, 2)}\n`);
    return 0;
  }

  await assertNewOutputPath(command.bundle, command.output);
  const caseSnapshot = inspection.cases.find((record) => record.id === command.caseId);
  if (!caseSnapshot) throw new CliCommandError(`Case not found: ${command.caseId}`, 2);
  const scenarioSnapshot = inspection.scenarios.find((record) => record.id === command.scenarioId);
  if (!scenarioSnapshot) throw new CliCommandError(`Scenario not found: ${command.scenarioId}`, 2);
  if (scenarioSnapshot.caseId !== caseSnapshot.id) {
    throw new CliCommandError("Scenario does not belong to the selected Case", 2);
  }
  const kind = runKindFromScenario(scenarioSnapshot.eventSettings);
  const repository = new InMemoryWorkspaceRepository();
  await repository.importBundle(bytes);
  const pythonExecutor = createCpythonExecutor({
    ...(command.pythonPath === undefined ? {} : { pythonPath: command.pythonPath }),
    onStderr: (text) => io.stderr(text),
  });
  const run = await runCalculation({
    repository,
    project: inspection.project,
    caseSnapshot,
    scenarioSnapshot,
    kind,
    executors: createDefaultExecutorRegistry({ pythonExecutor }),
  });
  const output = await repository.exportBundle(inspection.project.id);
  await writeFile(command.output, output, { flag: "wx" });

  if (run.status !== "succeeded") {
    throw new CliCommandError(run.error?.message ?? "Calculation failed", 3);
  }
  io.stdout(`Run ${run.id} succeeded: ${command.output}\n`);
  return 0;
}
