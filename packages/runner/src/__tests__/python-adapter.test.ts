import assert from "node:assert/strict";
import { delimiter } from "node:path";
import { describe, test } from "node:test";

import { caseFixture, RUN_KINDS, scenarioFixture } from "@open-waterhammer/contracts";

import {
  buildPythonSpawnEnv,
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

describe("buildPythonSpawnEnv", () => {
  test("forces UTF-8 stdio so Japanese text survives piped (non-console) stdio on any locale", () => {
    // createCpythonExecutor always talks to CPython over piped stdio (spawn's default,
    // stdio: ["pipe", "pipe", "pipe"]) — with no attached console, CPython falls back to
    // locale.getpreferredencoding() for stdin/stdout text streams, which is UTF-8 on typical
    // Ubuntu CI runners but the Windows ANSI codepage (cp932 on a Japanese-locale Windows box)
    // on Windows, unable to round-trip the JSON protocol payload's Japanese text (pipe names,
    // case names, ...). Forcing both vars here makes every consumer of createCpythonExecutor
    // correct by construction instead of relying on the caller to inject them (previously true
    // only of scripts/acceptance.mjs's own UTF8_SUBPROCESS_ENV).
    const result = buildPythonSpawnEnv({ PATH: "/usr/bin" }, "/core-py");

    assert.equal(result.PYTHONUTF8, "1");
    assert.equal(result.PYTHONIOENCODING, "utf-8");
  });

  test("prepends corePythonPath onto an existing PYTHONPATH without mutating the base env", () => {
    const base = { PATH: "/usr/bin", PYTHONPATH: "/existing/path" };

    const result = buildPythonSpawnEnv(base, "/core-py");

    assert.equal(result.PYTHONPATH, `/core-py${delimiter}/existing/path`);
    assert.equal(result.PATH, "/usr/bin");
    assert.deepEqual(base, { PATH: "/usr/bin", PYTHONPATH: "/existing/path" });
  });

  test("uses corePythonPath alone when the base env has no PYTHONPATH yet", () => {
    const result = buildPythonSpawnEnv({}, "/core-py");

    assert.equal(result.PYTHONPATH, "/core-py");
  });
});

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

  test("matches CPython hashes for literal small numbers and ECMAScript exponent boundaries", async () => {
    const caseSnapshot = {
      ...caseFixture,
      modelSnapshot: {
        pipe,
        canonicalNumbers: {
          smallPlain: 0.00001,
          smallBoundary: 0.000001,
          smallExponent: 1e-7,
          largePlain: 1e20,
          largeExponent: 1e21,
        },
      },
    };
    const scenarioSnapshot = {
      ...scenarioFixture,
      boundaryConditions: {},
      eventSettings: { closeTime: 2 },
      protectionSettings: {},
    };
    const calculationInputHash = await canonicalSha256({
      kind: "wave_speed",
      model: caseSnapshot.modelSnapshot,
      scenario: scenarioCalculationInput(scenarioSnapshot),
    });

    const output = await createCpythonExecutor()({
      kind: "wave_speed",
      caseSnapshot,
      scenarioSnapshot,
      calculationInputHash,
    });

    assert.equal(output.inputHash, calculationInputHash);
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
    let epanetInitialRuns = 0;
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
      epanetInitialSolver: async () => {
        epanetInitialRuns += 1;
        return {
          caseName: "initial",
          pipeResults: [{
            pipeId: "P-1", flow: 0.03, velocity: 0.42, velocityHead: 0.01,
            frictionLoss: 1, minorLoss: 0, totalLoss: 1, hydraulicGradient: 0.01,
          }],
          nodeResults: [
            { nodeId: "R", head: 80, hydraulicGradeLine: 80, pressureHead: 80, pressureMpa: 0.78 },
            { nodeId: "V", head: 79, hydraulicGradeLine: 79, pressureHead: 79, pressureMpa: 0.77 },
          ],
          maxVelocity: 0.42,
          maxPressureHead: 80,
          warnings: [],
        };
      },
    });

    const transientModel = {
      network: {
        pipes: [{
          id: "P-1", pipe, waveSpeed: 1000, nReaches: 2,
          upstreamNodeId: "R", downstreamNodeId: "V", initialFlow: 0.02,
        }],
        nodes: {
          R: { type: "reservoir", head: 80 },
          V: { type: "valve", Q0: 0.02, H0v: 70, closeTime: 2 },
        },
      },
      options: { tMax: 2, initialFlow: 0.02 },
    };

    for (const kind of RUN_KINDS) {
      await registry.get(kind)!({
        kind,
        caseSnapshot: {
          ...caseFixture,
          modelSnapshot: kind === "transient_network" || kind === "transient_protection_device"
            ? transientModel
            : caseFixture.modelSnapshot,
        },
        scenarioSnapshot: scenarioFixture,
        calculationInputHash: "hash",
      });
    }

    assert.deepEqual(epanetKinds, ["steady_network_epanet"]);
    assert.deepEqual(pythonKinds, RUN_KINDS.filter((kind) => kind !== "steady_network_epanet"));
    assert.equal(epanetInitialRuns, 2);
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
