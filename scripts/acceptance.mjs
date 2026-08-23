#!/usr/bin/env node
// Task 5d — golden `.owhproj` acceptance script.
//
// Plain Node (>=20), no new dependencies: only node: builtins plus the already-built
// @open-waterhammer/contracts and @open-waterhammer/workspace workspace packages, and a
// subprocess call to the built @open-waterhammer/cli binary.
//
// BUILD PREREQUISITE (documented, not automated by this script): this script REQUIRES the
// workspaces to already be built (`npm run build` at the repo root) — it does not build them
// itself. Rationale: CI already runs `npm run build` as its own earlier step (see
// .github/workflows/ci.yml), so building again here would double the work and blur which
// step actually failed (a build break should show up as a build-step failure, not an
// acceptance-step failure). Locally: run `npm run build` once, then `npm run acceptance`.
// This script fails fast with a clear message if the dist/ outputs it directly touches are
// missing, rather than failing with an opaque module-resolution stack trace.
//
// Steps (matches task-5d-brief.md Part A 1-7). Each prints a PASS/FAIL line; the first
// failure exits the process non-zero immediately (no later steps run).
//   1. Golden workspace       — 11 RunKinds, literal sample-workspace.ts shapes, replicated
//                                 verbatim (not imported: apps/web-free/src/workspace/
//                                 sample-workspace.ts is TS source with no standalone JS
//                                 build output a plain Node script could import — see the
//                                 note above GOLDEN_MODELS below).
//   2. Deterministic bundles  — exportProjectBundle x2 byte-identical; import -> re-export
//                                 byte-identical.
//   3. CPython runs via the real CLI — `node packages/cli/dist/bin.js run ...`, once per kind.
//   4. Numeric parity          — 6 kinds vs literal recorded goldens (tolerance 1e-9).
//   5. Cross-runtime hash consistency — golden joukowsky_allievi calculation hash.
//   6. Legacy migration idempotence.
//   7. Worktree cleanliness   — `git status --porcelain` empty at the end.

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  RUN_KINDS,
  validateCase,
  validateProject,
  validateRun,
  validateScenario,
} from "@open-waterhammer/contracts";
import {
  InMemoryWorkspaceRepository,
  exportProjectBundle,
  importProjectBundle,
  inspectProjectBundle,
} from "@open-waterhammer/workspace";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI_BIN = join(ROOT, "packages", "cli", "dist", "bin.js");
const CORE_PY_ROOT = join(ROOT, "packages", "core-py");

// ─── prerequisite: built workspaces ────────────────────────────────────────────────────────

const REQUIRED_BUILD_OUTPUTS = [
  join(ROOT, "packages", "contracts", "dist", "index.js"),
  join(ROOT, "packages", "workspace", "dist", "index.js"),
  join(ROOT, "packages", "runner", "dist", "index.js"),
  CLI_BIN,
];
for (const file of REQUIRED_BUILD_OUTPUTS) {
  if (!existsSync(file)) {
    console.error(`FAIL: prerequisite — missing build output: ${file}`);
    console.error('Run "npm run build" first. This script requires prebuilt workspaces; it does not build them itself (see header comment).');
    process.exit(1);
  }
}

// ─── golden model/scenario shapes ──────────────────────────────────────────────────────────
//
// Replicated verbatim from apps/web-free/src/workspace/sample-workspace.ts's `pipe`,
// `network`, `transientNetwork`, `protectionNetwork`, and `SAMPLE_RUN_INPUTS` consts (as of
// commit 40a40da). Not imported directly: that file is TS source bundled only into the Vite
// SPA — there is no standalone Node-importable JS build of it, and this repo's Node baseline
// (>=20) predates any stable native TS execution, so a plain Node script cannot import it.
// Per task-5d-brief.md Part A step 1's documented fallback ("otherwise replicate its literal
// model/scenario shapes"), these are copied literally, not recomputed.
//
// These are the canonical demo inputs (the brief: "keep values literal — never compute
// expected values through the implementation").

const PIPE = {
  id: "P-01", name: "第1号幹線", startNodeId: "R-01", endNodeId: "J-01",
  pipeType: "ductile_iron", innerDiameter: 0.3, wallThickness: 0.007,
  length: 500, roughnessCoeff: 130,
};

const NETWORK = {
  caseName: "取水支線 定常解析",
  pipes: [{
    id: "P-01", upstreamNodeId: "R-01", downstreamNodeId: "J-01",
    innerDiameter: 0.3, length: 500, roughnessC: 130, minorLossCoeff: 0,
  }],
  nodes: [
    { id: "R-01", elevation: 100, type: "reservoir", head: 142 },
    { id: "J-01", elevation: 88, type: "demand", demand: 0.03 },
  ],
};

const TRANSIENT_NETWORK = {
  pipes: [{
    id: "P-01", pipe: PIPE, nReaches: 10, upstreamNodeId: "R-01", downstreamNodeId: "V-01", initialFlow: 0.07,
  }],
  nodes: {
    "R-01": { type: "reservoir", head: 80 },
    "V-01": { type: "valve", Q0: 0.07, H0v: 30, closeTime: 2, operation: "close" },
  },
};

// Own network (not shared with TRANSIENT_NETWORK): a junction node J-01 sits between the
// reservoir and the closing valve V-01 so the protectionSettings device below can target it
// (a device may not target V-01 itself — it carries the closure event; see sample-workspace.ts).
const PROTECTION_NETWORK = {
  pipes: [
    {
      id: "P-01",
      pipe: {
        id: "P-01", name: "第1号幹線", startNodeId: "R-01", endNodeId: "J-01",
        pipeType: "ductile_iron", innerDiameter: 0.3, wallThickness: 0.007,
        length: 400, roughnessCoeff: 130,
      },
      nReaches: 8, upstreamNodeId: "R-01", downstreamNodeId: "J-01", initialFlow: 0.07,
    },
    {
      id: "P-02",
      pipe: {
        id: "P-02", name: "第2号幹線", startNodeId: "J-01", endNodeId: "V-01",
        pipeType: "ductile_iron", innerDiameter: 0.3, wallThickness: 0.007,
        length: 100, roughnessCoeff: 130,
      },
      nReaches: 2, upstreamNodeId: "J-01", downstreamNodeId: "V-01", initialFlow: 0.07,
    },
  ],
  nodes: {
    "R-01": { type: "reservoir", head: 80 },
    "J-01": { type: "junction" },
    "V-01": { type: "valve", Q0: 0.07, H0v: 30, closeTime: 2, operation: "close" },
  },
};

// SAMPLE_RUN_INPUTS, verbatim (sample-workspace.ts lines 75-110).
const GOLDEN_MODELS = {
  wave_speed: { pipe: PIPE },
  joukowsky_allievi: {
    pipe: PIPE,
    calculationCase: {
      id: "CALC-01", name: "末端弁閉鎖", operationType: "valve_close",
      targetFacilityId: "V-01", initialVelocity: 1, initialHead: 30,
    },
    allowablePressureMpa: 0.75,
  },
  empirical_pressure: { systemType: "gravity_open", staticPressureMpa: 0.42, allowablePressureMpa: 0.75 },
  steady_single_pipe: {
    method: "hazen-williams", innerDiameter: 0.3, length: 500, flowRate: 0.03,
    upstreamElevation: 100, downstreamElevation: 88, roughnessC: 130,
  },
  steady_network_python: NETWORK,
  steady_network_epanet: NETWORK,
  longitudinal_hydraulics: {
    caseName: "取水支線縦断", staticWaterLevel: 142, waterhammerRatio: 0.2,
    points: [
      { id: "STA-000", horizontalDistance: 0, groundLevel: 100, pipeCenterHeight: 98, pipeLength: 0, flowRate: 0.03, diameter: 0.3, roughnessC: 130, bendLossCoeff: 0, valveLossCoeff: 0, branchLossCoeff: 0 },
      { id: "STA-500", horizontalDistance: 500, groundLevel: 90, pipeCenterHeight: 88, pipeLength: 500, flowRate: 0.03, diameter: 0.3, roughnessC: 130, bendLossCoeff: 0.2, valveLossCoeff: 0, branchLossCoeff: 0 },
    ],
    allowablePressureMpa: 0.75,
  },
  transient_single_pipe: { pipe: PIPE },
  transient_network: { network: TRANSIENT_NETWORK, options: { tMax: 8, initialFlow: 0.07 } },
  transient_pump: { pipe: PIPE },
  transient_protection_device: { network: PROTECTION_NETWORK, options: { tMax: 8, initialFlow: 0.07 } },
};

// Shared eventSettings, verbatim (sample-workspace.ts buildSampleWorkspace(), scenario index 0:
// "末端弁 2秒閉鎖" — closeTime 2, not the index-1 "閉鎖時間延長" variant with closeTime 8). A
// superset of fields; each kind's Python handler only reads what it needs (see
// packages/core-py/open_waterhammer/protocol.py HANDLERS), so one literal object is reused for
// every golden Scenario below, with only `runKind` varying per kind.
const SHARED_EVENT_SETTINGS = {
  closeTime: 2, waveSpeed: 1100, initialVelocity: 1,
  initialDownstreamHead: 30, nReaches: 10, tMax: 8, operation: "close",
  mode: "trip", Q0: 0.07, pumpHead: 50, shutdownTime: 0.5,
};
const BOUNDARY_CONDITIONS = { upstream: "reservoir", downstream: "valve" };
// Matches PROTECTION_TEMPLATES.transient_protection_device in
// apps/web-free/src/workspace/engineering-fields.ts, and buildSampleWorkspace()'s index-2
// ("空気室追加") scenario — the only seeded scenario with an enabled protection device.
const PROTECTION_DEVICE_SETTINGS = {
  devices: [{ id: "J-01", type: "surge_tank", enabled: true, tankArea: 4, initialLevel: 78.7 }],
};

// ─── literal numeric goldens (Part A step 4) ───────────────────────────────────────────────
//
// Derived ONCE from the current engine (packages/core-py/open_waterhammer/protocol.py
// execute_request()), invoked directly against the exact model/scenario shapes above —
// reproducible via:
//   python -c "
//   import sys; sys.path.insert(0, 'packages/core-py')
//   from open_waterhammer.protocol import execute_request, PROTOCOL_VERSION
//   # ... build {protocolVersion, kind, model, scenario} per GOLDEN_MODELS/SHARED_EVENT_SETTINGS
//   # above and call execute_request(request)
//   "
// Recorded as literals per the brief ("never compute expected values through the
// implementation"); NOT recomputed at check time. Tolerance 1e-9 (see assertClose).
const GOLDEN_NUMERICS = {
  wave_speed: {
    waveSpeed: 1146.7256677536352,
    vibrationPeriod: 1.7440963050193832,
    alpha: 1.1467256677536353,
  },
  joukowsky_allievi: {
    closureType: "slow",
    hmaxAllieviClose: 43.21817395617996,
    k1: 0.8503401360544217,
    assessmentStatus: "pass", // golden allowablePressureMpa 0.75 (SAMPLE_RUN_INPUTS.joukowsky_allievi)
  },
  steady_single_pipe: {
    velocity: 0.42441318157838753,
    frictionLoss: 0.3459881005698211,
    totalHead: -11.654011899430179,
  },
  longitudinal_hydraulics: {
    maxDesignPressure: 0.6308414888222368,
    maxVelocity: 0.42441318157838753,
    assessmentStatus: "pass",
  },
  transient_single_pipe: {
    dt: 0.045454545454545456,
    vibrationPeriod: 1.8181818181818181,
    // Peak surge head: pipe "pipe_0" (the single-pipe MOC engine's synthetic id, independent
    // of the input Pipe.id "P-01" — see packages/core-py/open_waterhammer/moc.py), reach index
    // 10 (nReaches=10 -> 11 samples, index 0..10) of Hmax.
    peakHmax: 74.1054816939722,
  },
  transient_protection_device: {
    // summary.protection.reductionRate for the golden PROTECTION_NETWORK + PROTECTION_DEVICE_
    // SETTINGS above (surge_tank at J-01, tankArea 4, initialLevel 78.7) — matches the ≈46.5%
    // figure already documented in docs/design-workspace.md §8. Pins the mitigation math
    // (baseline vs. protected MOC comparison) cross-runtime, the same way every other kind's
    // numeric goldens do.
    reductionRate: 0.4653186845288916,
  },
};

// Golden `manifest.inputHashes.calculation` for the joukowsky_allievi golden Case+Scenario —
// cross-checked equal between packages/runner/src/hashes.ts (JS, via
// packages/workspace/src/bundle.ts canonicalJson) and
// packages/core-py/open_waterhammer/protocol.py (_canonical_json) at derivation time (both
// canonicalize {kind, model, scenario} the same way; the CLI run in step 3 recomputes the JS
// side fresh and step 5 below re-asserts equality against this literal).
const GOLDEN_JOUKOWSKY_INPUT_HASH = "affa81c82002e8a4c7c3d86b7467d8fdca10b17c0fddb60b5e22277b321d4dc3";

// ─── helpers ────────────────────────────────────────────────────────────────────────────────

let checkCount = 0;
function pass(label) {
  checkCount += 1;
  console.log(`PASS: ${label}`);
}
function fail(label, error) {
  console.error(`FAIL: ${label}`);
  if (error) console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  if (error && error.stdout) console.error(`--- stdout ---\n${error.stdout}`);
  if (error && error.stderr) console.error(`--- stderr ---\n${error.stderr}`);
  process.exit(1);
}
async function check(label, fn) {
  try {
    await fn();
    pass(label);
  } catch (error) {
    fail(label, error);
  }
}
function assertClose(actual, expected, label, tol = 1e-9) {
  const diff = Math.abs(actual - expected);
  assert.ok(diff <= tol, `${label}: expected ${expected}, got ${actual} (|diff|=${diff} > tol=${tol})`);
}
function bytesEqual(a, b) {
  return Buffer.from(a).equals(Buffer.from(b));
}

console.log("=== Task 5d acceptance ===");
const startedAt = Date.now();
const workDir = await mkdtemp(join(tmpdir(), "owh-acceptance-"));
// Cleanup must run on every exit path, not just the happy one: fail() below calls
// process.exit(1) directly on the first failure (steps 3-7 never get a chance to run their own
// cleanup code), so a plain try/finally around the step sequence would miss it. `process.on
// ("exit", ...)` fires for every way this process ends — normal completion, an explicit
// process.exit() (from fail() or the prerequisite check above), or an uncaught exception — so
// registering it here, right after workDir exists, is the one place that covers all of them.
// The handler must be synchronous (Node ignores async work queued from an "exit" listener),
// hence rmSync rather than the promise-based fs/promises rm used everywhere else in this file.
process.on("exit", () => {
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    // Best-effort: never let cleanup itself change the process's exit code.
  }
});

// ─── Step 1: golden workspace ───────────────────────────────────────────────────────────────

/** @type {{ projectId: string, alternativeId: string, data: import("@open-waterhammer/workspace").WorkspaceData, byKind: Record<string, { caseId: string, scenarioId: string }> }} */
let golden;
await check("1. Golden workspace (11/11 RunKinds, every Scenario carries eventSettings.runKind)", () => {
  const timestamp = new Date().toISOString();
  const projectId = randomUUID();
  const alternativeId = randomUUID();
  const project = {
    id: projectId, name: "Task 5d acceptance — golden project",
    standardSelection: { profileId: "nochi_pipeline_2021", version: "2021-06" },
    crs: "EPSG:6677", createdAt: timestamp, updatedAt: timestamp,
  };
  const alternative = {
    id: alternativeId, projectId, name: "Golden baseline",
    description: "Task 5d acceptance golden fixtures", createdAt: timestamp, updatedAt: timestamp,
  };
  assert.equal(validateProject(project), true, "golden Project schema");
  assert.equal(RUN_KINDS.length, 11, "expected exactly 11 RunKinds in @open-waterhammer/contracts");

  const byKind = {};
  const cases = [];
  const scenarios = [];
  for (const kind of RUN_KINDS) {
    const caseId = randomUUID();
    const scenarioId = randomUUID();
    const caseRecord = {
      id: caseId, alternativeId, parentCaseId: null,
      modelSnapshot: GOLDEN_MODELS[kind],
      state: "draft", lockProvenance: null,
      createdAt: timestamp, updatedAt: timestamp,
    };
    const scenario = {
      id: scenarioId, caseId, name: `golden — ${kind}`,
      boundaryConditions: BOUNDARY_CONDITIONS,
      eventSettings: { ...SHARED_EVENT_SETTINGS, runKind: kind },
      protectionSettings: kind === "transient_protection_device" ? PROTECTION_DEVICE_SETTINGS : {},
      createdAt: timestamp, updatedAt: timestamp,
    };
    assert.equal(validateCase(caseRecord), true, `golden Case schema (${kind})`);
    assert.equal(validateScenario(scenario), true, `golden Scenario schema (${kind})`);
    assert.equal(scenario.eventSettings.runKind, kind, `Scenario eventSettings.runKind must equal its kind (${kind})`);
    cases.push(caseRecord);
    scenarios.push(scenario);
    byKind[kind] = { caseId, scenarioId };
  }

  const data = { projects: [project], alternatives: [alternative], cases, scenarios, runs: [], legacyArtifacts: [] };
  assert.equal(cases.length, 11);
  assert.equal(scenarios.length, 11);
  assert.equal(new Set(scenarios.map((s) => s.eventSettings.runKind)).size, 11, "11 distinct runKinds covered");
  for (const kind of RUN_KINDS) {
    assert.ok(scenarios.some((s) => s.eventSettings.runKind === kind), `RunKind not covered: ${kind}`);
  }
  golden = { projectId, alternativeId, data, byKind };
});

// ─── Step 2: deterministic bundles ──────────────────────────────────────────────────────────

/** @type {Uint8Array} */
let goldenBundleBytes;
await check("2. Deterministic bundles (export x2 byte-identical; import -> re-export byte-identical)", async () => {
  const first = await exportProjectBundle(golden.data, golden.projectId);
  const second = await exportProjectBundle(golden.data, golden.projectId);
  assert.ok(bytesEqual(first, second), "exportProjectBundle called twice on identical input must be byte-identical");

  const imported = await importProjectBundle(first);
  const reExported = await exportProjectBundle(imported, golden.projectId);
  assert.ok(bytesEqual(first, reExported), "importProjectBundle -> exportProjectBundle must reproduce the original bytes");

  goldenBundleBytes = first;
});

const goldenBundlePath = join(workDir, "golden.owhproj");
await writeFile(goldenBundlePath, goldenBundleBytes, { flag: "wx" });

// ─── Step 3: CPython runs via the real CLI ──────────────────────────────────────────────────
//
// Python resolution mirrors the CLI's own --python flag -> "python" from PATH default
// (packages/cli/src/python-cpython.ts / packages/runner/src/python-cpython.ts), with one
// additional tier this script adds on top: an OWH_PYTHON env var (or --python script arg),
// so CI/local runs can pin an interpreter without needing to pass a flag through to every one
// of the 11 CLI invocations below.
const scriptArgs = process.argv.slice(2);
const scriptPythonFlagIndex = scriptArgs.indexOf("--python");
const resolvedPython = scriptPythonFlagIndex >= 0
  ? scriptArgs[scriptPythonFlagIndex + 1]
  : (process.env.OWH_PYTHON ?? process.env.PYTHON ?? undefined);
const pythonForDisplay = resolvedPython ?? "python";

// The golden fixtures replicate sample-workspace.ts's literal Japanese text verbatim (pipe
// names, case names, ...). packages/runner/src/python-cpython.ts spawns CPython with piped
// (non-console) stdio and no explicit PYTHONUTF8/PYTHONIOENCODING, so CPython falls back to
// `locale.getpreferredencoding()` for its stdin/stdout text streams — UTF-8 on typical Ubuntu
// CI runners, but the Windows ANSI codepage (cp932 on a Japanese-locale Windows box, as here)
// on Windows, which cannot round-trip the JSON payload's Japanese text and crashes with a
// UnicodeEncodeError on the response write. This is an environment/locale concern, not
// application logic, and is squarely this script's call to make (no package source changes):
// force UTF-8 stdio for every subprocess this script spawns, exactly as CI's Ubuntu runners
// already get for free from their locale.
const UTF8_SUBPROCESS_ENV = { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" };

await check(`3.0 Python availability (resolved: ${pythonForDisplay}; core-py importable)`, () => {
  try {
    execFileSync(pythonForDisplay, ["-c", "import open_waterhammer.protocol"], {
      cwd: CORE_PY_ROOT,
      env: { ...UTF8_SUBPROCESS_ENV, PYTHONPATH: CORE_PY_ROOT },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error(
      `CPython interpreter "${pythonForDisplay}" or packages/core-py's open_waterhammer.protocol module is unavailable. `
      + `Set --python <path> or OWH_PYTHON=<path> to point at a working CPython with no extra deps beyond the standard library. `
      + `Underlying error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
});

/** @type {Record<string, import("@open-waterhammer/contracts").Run>} */
const runsByKind = {};
for (const kind of RUN_KINDS) {
  await check(`3. CLI run — ${kind}`, async () => {
    const { caseId, scenarioId } = golden.byKind[kind];
    const outPath = join(workDir, `run-${kind}.owhproj`);
    const args = ["run", goldenBundlePath, "--case", caseId, "--scenario", scenarioId, "--out", outPath];
    if (resolvedPython) args.push("--python", resolvedPython);

    execFileSync(process.execPath, [CLI_BIN, ...args], { cwd: ROOT, encoding: "utf8", env: UTF8_SUBPROCESS_ENV });

    const outBytes = await readFile(outPath);
    const inspection = await inspectProjectBundle(outBytes);
    const run = inspection.runs.find((candidate) => candidate.caseId === caseId);
    assert.ok(run, `output bundle must contain a Run for Case ${caseId} (${kind})`);
    assert.equal(validateRun(run), true, `output Run must pass validateRun (${kind})`);
    assert.equal(run.status, "succeeded", `Run must succeed (${kind})`);
    assert.equal(run.kind, kind, `Run.kind must equal ${kind}`);
    assert.ok(Object.keys(run.manifest.inputHashes).length > 0, `manifest.inputHashes must be non-empty (${kind})`);
    assert.ok(Object.keys(run.manifest.outputHashes).length > 0, `manifest.outputHashes must be non-empty (${kind})`);
    assert.match(run.manifest.gitSha, /^[0-9a-f]{7,40}$/, `manifest.gitSha must look like a git SHA (${kind}), got: ${run.manifest.gitSha}`);
    const lockedCase = inspection.cases.find((candidate) => candidate.id === caseId);
    assert.equal(lockedCase?.state, "locked", `Case must be locked after a successful Run (${kind})`);
    assert.equal(lockedCase?.lockProvenance, "successful_run", `Case lockProvenance must be successful_run (${kind})`);

    runsByKind[kind] = run;
  });
}

// ─── Step 4: numeric parity vs literal goldens ──────────────────────────────────────────────

await check("4. Numeric parity — wave_speed", () => {
  const { summary } = runsByKind.wave_speed;
  const expected = GOLDEN_NUMERICS.wave_speed;
  assertClose(summary.waveSpeed, expected.waveSpeed, "wave_speed.summary.waveSpeed");
  assertClose(summary.vibrationPeriod, expected.vibrationPeriod, "wave_speed.summary.vibrationPeriod");
  assertClose(summary.alpha, expected.alpha, "wave_speed.summary.alpha");
});

await check("4. Numeric parity — joukowsky_allievi (incl. assessment status @ allowable 0.75)", () => {
  const run = runsByKind.joukowsky_allievi;
  const expected = GOLDEN_NUMERICS.joukowsky_allievi;
  assert.equal(run.summary.closureType, expected.closureType, "joukowsky_allievi.summary.closureType");
  assertClose(run.summary.hmaxAllieviClose, expected.hmaxAllieviClose, "joukowsky_allievi.summary.hmaxAllieviClose");
  assertClose(run.summary.k1, expected.k1, "joukowsky_allievi.summary.k1");
  assert.equal(run.assessment.status, expected.assessmentStatus, "joukowsky_allievi.assessment.status @ allowablePressureMpa 0.75");
});

await check("4. Numeric parity — steady_single_pipe", () => {
  const { summary } = runsByKind.steady_single_pipe;
  const expected = GOLDEN_NUMERICS.steady_single_pipe;
  assertClose(summary.velocity, expected.velocity, "steady_single_pipe.summary.velocity");
  assertClose(summary.frictionLoss, expected.frictionLoss, "steady_single_pipe.summary.frictionLoss");
  assertClose(summary.totalHead, expected.totalHead, "steady_single_pipe.summary.totalHead");
});

await check("4. Numeric parity — longitudinal_hydraulics", () => {
  const run = runsByKind.longitudinal_hydraulics;
  const expected = GOLDEN_NUMERICS.longitudinal_hydraulics;
  assertClose(run.summary.maxDesignPressure, expected.maxDesignPressure, "longitudinal_hydraulics.summary.maxDesignPressure");
  assertClose(run.summary.maxVelocity, expected.maxVelocity, "longitudinal_hydraulics.summary.maxVelocity");
  assert.equal(run.assessment.status, expected.assessmentStatus, "longitudinal_hydraulics.assessment.status");
});

await check("4. Numeric parity — transient_single_pipe", () => {
  const { summary } = runsByKind.transient_single_pipe;
  const expected = GOLDEN_NUMERICS.transient_single_pipe;
  assertClose(summary.dt, expected.dt, "transient_single_pipe.summary.dt");
  const pipe = summary.pipes.pipe_0;
  assert.ok(pipe, "transient_single_pipe.summary.pipes.pipe_0 must exist");
  assertClose(pipe.vibrationPeriod, expected.vibrationPeriod, "transient_single_pipe.summary.pipes.pipe_0.vibrationPeriod");
  assertClose(pipe.Hmax[10], expected.peakHmax, "transient_single_pipe.summary.pipes.pipe_0.Hmax[10]");
});

await check("4. Numeric parity — transient_protection_device (mitigation reductionRate)", () => {
  const { summary } = runsByKind.transient_protection_device;
  const expected = GOLDEN_NUMERICS.transient_protection_device;
  assertClose(summary.protection.reductionRate, expected.reductionRate, "transient_protection_device.summary.protection.reductionRate");
});

// ─── Step 5: cross-runtime hash consistency ─────────────────────────────────────────────────

await check("5. Cross-runtime hash consistency (joukowsky_allievi manifest.inputHashes.calculation)", () => {
  const { manifest } = runsByKind.joukowsky_allievi;
  assert.equal(
    manifest.inputHashes.calculation,
    GOLDEN_JOUKOWSKY_INPUT_HASH,
    "CLI-produced manifest.inputHashes.calculation must equal the literal recorded hash (canonical-JSON stability across runtimes)",
  );
});

// ─── Step 6: legacy migration idempotence ───────────────────────────────────────────────────

await check("6. Legacy migration idempotence (migrateLegacy x2 -> same counts, no duplicates)", async () => {
  const legacySessions = [
    { id: "legacy-session-1", createdAt: "2020-04-01T00:00:00.000Z", pipe: { lengthM: 300 }, note: "旧UIセッション1" },
    { id: "legacy-session-2", pipe: { lengthM: 450 } }, // no createdAt -> fallback timestamp path
  ];
  const legacyStorage = {
    getItem: (key) => (key === "owh_sessions" ? JSON.stringify(legacySessions) : null),
  };
  const repository = new InMemoryWorkspaceRepository();

  const firstRun = await repository.migrateLegacy(legacyStorage);
  assert.deepEqual(firstRun, { imported: 2, skipped: 0 }, "first migration imports both legacy sessions");
  const secondRun = await repository.migrateLegacy(legacyStorage);
  assert.deepEqual(secondRun, { imported: 0, skipped: 2 }, "second migration is a no-op (idempotent)");

  const snapshot = await repository.snapshot();
  const legacyCases = snapshot.cases.filter((candidate) => candidate.lockProvenance === "legacy_import");
  assert.equal(legacyCases.length, 2, "exactly one Case per legacy session, no duplicates");
  assert.equal(snapshot.legacyArtifacts.length, 2, "exactly one LegacyArtifact per legacy session, no duplicates");
  assert.equal(new Set(legacyCases.map((candidate) => candidate.id)).size, 2, "Case ids must be unique");
});

// ─── Step 7: worktree cleanliness ───────────────────────────────────────────────────────────

await check("7. Worktree cleanliness (git status --porcelain empty)", () => {
  const status = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(status, "", `git status --porcelain must be empty; got:\n${status}`);
});

const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`=== ACCEPTANCE PASSED (${checkCount} checks, ${elapsedSeconds}s) ===`);
