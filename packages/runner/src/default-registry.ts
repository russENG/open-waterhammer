import { RUN_KINDS } from "@open-waterhammer/contracts";
import type { RunKind } from "@open-waterhammer/contracts";

import { createEpanetExecutor } from "./epanet.js";
import { createCpythonExecutor } from "./python-cpython.js";
import { createExecutorRegistry } from "./registry.js";
import type { CalculationExecutor, CalculationExecutorRegistry } from "./types.js";

export interface DefaultExecutorRegistryOptions {
  pythonExecutor?: CalculationExecutor;
  epanetExecutor?: CalculationExecutor;
}

export function createDefaultExecutorRegistry(
  options: DefaultExecutorRegistryOptions = {},
): CalculationExecutorRegistry {
  const python = options.pythonExecutor ?? createCpythonExecutor();
  const epanet = options.epanetExecutor ?? createEpanetExecutor();
  return createExecutorRegistry(Object.fromEntries(RUN_KINDS.map((kind) => [
    kind,
    kind === "steady_network_epanet" ? epanet : python,
  ])) as Record<RunKind, CalculationExecutor>);
}
