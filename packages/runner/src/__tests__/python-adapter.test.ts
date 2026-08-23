import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { caseFixture, RUN_KINDS, scenarioFixture } from "@open-waterhammer/contracts";

import {
  canonicalSha256,
  createCpythonExecutor,
  createDefaultExecutorRegistry,
  createEpanetExecutor,
  scenarioCalculationInput,
} from "../index.js";

const pipe = {
  id: "P-1",
  startNodeId: "R",
  endNodeId: "D",
  pipeType: "ductile_iron",
  innerDiameter: 0.3,
  wallThickness: 0.01,
  length: 100,
  roughnessCoeff: 130,
};

describe("CPython calculation adapter", () => {
  test("uses JSON stdin/stdout and returns the canonical input hash and numeric result", async () => {
    const caseSnapshot = { ...caseFixture, modelSnapshot: { pipe } };
    const scenarioSnapshot = {
      ...scenarioFixture,
      boundaryConditions: {},
      eventSettings: { closeTime: 2 },
      protectionSettings: {},
    };
    const scenario = scenarioCalculationInput(scenarioSnapshot);
    const calculationInputHash = await canonicalSha256({
      kind: "wave_speed",
      model: caseSnapshot.modelSnapshot,
      scenario,
    });

    const output = await createCpythonExecutor()({
      kind: "wave_speed",
      caseSnapshot,
      scenarioSnapshot,
      calculationInputHash,
    });

    assert.equal(output.engine, "open-waterhammer-python");
    assert.match(output.runtime, /^cpython-/);
    assert.equal(output.inputHash, calculationInputHash);
    assert.equal(output.method, "wave-speed");
    assert.ok(Math.abs((output.summary as { waveSpeed: number }).waveSpeed - 1212.579306278724) < 1e-9);
  });

  test("reports a missing configured Python executable with an actionable code", async () => {
    const executor = createCpythonExecutor({ pythonPath: "definitely-missing-python-for-owh" });
    await assert.rejects(executor({
      kind: "wave_speed",
      caseSnapshot: { ...caseFixture, modelSnapshot: { pipe } },
      scenarioSnapshot: {
        ...scenarioFixture,
        boundaryConditions: {},
        eventSettings: { closeTime: 2 },
        protectionSettings: {},
      },
      calculationInputHash: "unused",
    }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Python executable not found/i);
      assert.equal((error as Error & { code?: string }).code, "PYTHON_NOT_FOUND");
      return true;
    });
  });

  test("default registry routes Python-owned kinds to Python and EPANET to its JavaScript adapter", async () => {
    const pythonKinds: string[] = [];
    const epanetKinds: string[] = [];
    const output = {
      engine: "test",
      runtime: "test",
      method: "test",
      numericParameters: {},
      boundaryParameters: {},
      summary: {},
    };
    const registry = createDefaultExecutorRegistry({
      pythonExecutor: async ({ kind }) => {
        pythonKinds.push(kind);
        return output;
      },
      epanetExecutor: async ({ kind }) => {
        epanetKinds.push(kind);
        return output;
      },
    });

    for (const kind of RUN_KINDS) {
      await registry.get(kind)!({
        kind,
        caseSnapshot: caseFixture,
        scenarioSnapshot: scenarioFixture,
        calculationInputHash: "hash",
      });
    }

    assert.deepEqual(epanetKinds, ["steady_network_epanet"]);
    assert.deepEqual(pythonKinds, RUN_KINDS.filter((kind) => kind !== "steady_network_epanet"));
  });

  test("turns an EPANET solver error result into an engine error instead of a succeeded calculation", async () => {
    const executor = createEpanetExecutor(async () => ({
      caseName: "broken",
      pipeResults: [],
      nodeResults: [],
      maxVelocity: 0,
      maxPressureHead: 0,
      warnings: ["EPANET solveH エラー: singular network"],
    }));

    await assert.rejects(executor({
      kind: "steady_network_epanet",
      caseSnapshot: caseFixture,
      scenarioSnapshot: scenarioFixture,
      calculationInputHash: "hash",
    }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /singular network/);
      assert.equal((error as Error & { code?: string }).code, "EPANET_ENGINE_ERROR");
      return true;
    });
  });
});
