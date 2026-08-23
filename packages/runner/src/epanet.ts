import { calcSteadyNetworkEpanet } from "@open-waterhammer/epanet-adapter";
import type { SteadyNetworkInput } from "@open-waterhammer/epanet-adapter";

import { scenarioCalculationInput } from "./manifest.js";
import type { CalculationExecutor } from "./types.js";

export function createEpanetExecutor(
  solve: (input: SteadyNetworkInput) => Promise<Awaited<ReturnType<typeof calcSteadyNetworkEpanet>>>
    = calcSteadyNetworkEpanet,
): CalculationExecutor {
  return async ({ caseSnapshot, scenarioSnapshot }) => {
    const output = await solve(caseSnapshot.modelSnapshot as unknown as SteadyNetworkInput);
    const engineError = output.warnings.find((warning) => warning.startsWith("EPANET solveH エラー:"));
    if (engineError) {
      const error = new Error(engineError) as Error & { code: string };
      error.code = "EPANET_ENGINE_ERROR";
      throw error;
    }
    return {
      engine: "epanet-js",
      runtime: "javascript-wasm",
      method: "steady-network-epanet",
      numericParameters: caseSnapshot.modelSnapshot,
      boundaryParameters: scenarioCalculationInput(scenarioSnapshot),
      summary: output as unknown as import("@open-waterhammer/contracts").JsonValue,
      assessment: { status: "needs_review", findings: [] },
      warnings: output.warnings,
    };
  };
}
