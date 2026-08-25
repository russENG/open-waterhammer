import { RUN_KINDS } from "@open-waterhammer/contracts";
import type { RunKind } from "@open-waterhammer/contracts";
import type { SteadyNetworkInput, SteadyNetworkResult } from "@open-waterhammer/epanet-adapter";

import { createEpanetExecutor } from "./epanet.js";
import { createEpanetInitializedMocExecutor } from "./epanet-to-moc.js";
import { createCpythonExecutor } from "./python-cpython.js";
import { createExecutorRegistry } from "./registry.js";
import type { CalculationExecutor, CalculationExecutorRegistry } from "./types.js";

export interface DefaultExecutorRegistryOptions {
  pythonExecutor?: CalculationExecutor;
  epanetExecutor?: CalculationExecutor;
  epanetInitialSolver?: (input: SteadyNetworkInput) => Promise<SteadyNetworkResult>;
}

export function createDefaultExecutorRegistry(
  options: DefaultExecutorRegistryOptions = {},
): CalculationExecutorRegistry {
  const python = options.pythonExecutor ?? createCpythonExecutor();
  const epanet = options.epanetExecutor ?? createEpanetExecutor();
  const epanetInitializedMoc = createEpanetInitializedMocExecutor(
    python,
    options.epanetInitialSolver,
  );
  return createExecutorRegistry(Object.fromEntries(RUN_KINDS.map((kind) => [
    kind,
    kind === "steady_network_epanet"
      ? epanet
      : kind === "transient_network" || kind === "transient_protection_device"
        ? epanetInitializedMoc
        : python,
  ])) as Record<RunKind, CalculationExecutor>);
}
