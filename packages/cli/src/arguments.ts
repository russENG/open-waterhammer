export type CliCommand =
  | { name: "validate"; bundle: string }
  | { name: "inspect"; bundle: string }
  | {
      name: "run";
      bundle: string;
      caseId: string;
      scenarioId: string;
      output: string;
      pythonPath?: string;
    };

export class CliUsageError extends Error {
  readonly exitCode = 2;
}

const USAGE = [
  "Usage:",
  "  owh validate <bundle>",
  "  owh inspect <bundle>",
  "  owh run <bundle> --case <id> --scenario <id> --out <new-bundle> [--python <path>]",
].join("\n");

function usage(message: string): never {
  throw new CliUsageError(`${message}\n${USAGE}`);
}

export function parseCliArguments(args: readonly string[]): CliCommand {
  const [name, bundle, ...options] = args;
  if (name === "validate" || name === "inspect") {
    if (!bundle || options.length > 0) usage(`Invalid ${name} arguments`);
    return { name, bundle };
  }
  if (name !== "run" || !bundle) usage("Unknown or incomplete command");
  if (options.length % 2 !== 0) usage("Every run option requires a value");

  const values = new Map<string, string>();
  const allowed = new Set(["--case", "--scenario", "--out", "--python"]);
  for (let index = 0; index < options.length; index += 2) {
    const option = options[index]!;
    const value = options[index + 1]!;
    if (!allowed.has(option)) usage(`Unknown option: ${option}`);
    if (values.has(option)) usage(`Duplicate option: ${option}`);
    if (!value.trim()) usage(`Missing value for ${option}`);
    values.set(option, value);
  }
  const caseId = values.get("--case");
  const scenarioId = values.get("--scenario");
  const output = values.get("--out");
  if (!caseId || !scenarioId || !output) usage("run requires --case, --scenario, and --out");
  const pythonPath = values.get("--python");
  return {
    name: "run",
    bundle,
    caseId,
    scenarioId,
    output,
    ...(pythonPath === undefined ? {} : { pythonPath }),
  };
}
