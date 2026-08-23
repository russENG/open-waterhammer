import { RUN_KINDS } from "@open-waterhammer/contracts";
import type { RunKind } from "@open-waterhammer/contracts";

import type { CalculationExecutor, CalculationExecutorRegistry } from "./types.js";

export function isRunKind(value: unknown): value is RunKind {
  return typeof value === "string" && (RUN_KINDS as readonly string[]).includes(value);
}

export function createExecutorRegistry(
  executors: Record<RunKind, CalculationExecutor>,
): CalculationExecutorRegistry {
  const registered = new Map<RunKind, CalculationExecutor>();
  for (const kind of RUN_KINDS) {
    const executor = executors[kind];
    if (typeof executor !== "function") {
      throw new Error(`Missing executor for RunKind: ${kind}`);
    }
    registered.set(kind, executor);
  }

  return {
    get: (kind) => registered.get(kind),
    kinds: () => [...RUN_KINDS],
  };
}
