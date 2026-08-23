import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, test } from "node:test";

import {
  alternativeFixture,
  caseFixture,
  projectFixture,
  scenarioFixture,
} from "@open-waterhammer/contracts";
import {
  InMemoryWorkspaceRepository,
  inspectProjectBundle,
} from "@open-waterhammer/workspace";

import { runCli } from "../index.js";

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

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: (text: string) => stdout.push(text),
      stderr: (text: string) => stderr.push(text),
    },
  };
}

async function createBundle(directory: string, runKind = "wave_speed"): Promise<string> {
  const repository = new InMemoryWorkspaceRepository({
    projects: [projectFixture],
    alternatives: [alternativeFixture],
    cases: [{ ...caseFixture, modelSnapshot: { pipe } }],
    scenarios: [{
      ...scenarioFixture,
      boundaryConditions: {},
      eventSettings: { runKind, closeTime: 2 },
      protectionSettings: {},
    }],
    runs: [],
    legacyArtifacts: [],
  });
  const path = join(directory, "input.owhproj");
  await writeFile(path, await repository.exportBundle(projectFixture.id));
  return path;
}

describe("owh CLI", () => {
  test("validate and inspect accept a valid bundle and emit concise local results", async () => {
    const directory = await mkdtemp(join(tmpdir(), "owh-cli-"));
    const bundle = await createBundle(directory);
    const validateOutput = capture();
    const inspectOutput = capture();

    assert.equal(await runCli(["validate", bundle], validateOutput.io), 0);
    assert.match(validateOutput.stdout.join(""), /valid bundle/i);
    assert.equal(await runCli(["inspect", bundle], inspectOutput.io), 0);
    assert.deepEqual(JSON.parse(inspectOutput.stdout.join("")), {
      bundleFormatVersion: 1,
      project: { id: projectFixture.id, name: projectFixture.name },
      counts: { alternatives: 1, cases: 1, scenarios: 1, runs: 0, legacyArtifacts: 0 },
    });
  });

  test("run executes CPython, appends a succeeded Run, and locks the Case in a new bundle", async () => {
    const directory = await mkdtemp(join(tmpdir(), "owh-cli-"));
    const bundle = await createBundle(directory);
    const output = join(directory, "result.owhproj");
    const captured = capture();

    const exitCode = await runCli([
      "run", bundle,
      "--case", caseFixture.id,
      "--scenario", scenarioFixture.id,
      "--out", output,
    ], captured.io);

    assert.equal(exitCode, 0);
    const inspection = await inspectProjectBundle(await readFile(output));
    assert.equal(inspection.runs.length, 1);
    assert.equal(inspection.runs[0]?.kind, "wave_speed");
    assert.equal(inspection.runs[0]?.status, "succeeded");
    assert.equal(inspection.cases[0]?.state, "locked");
    assert.equal(inspection.cases[0]?.lockProvenance, "successful_run");
    assert.match(captured.stdout.join(""), /succeeded/i);
  });

  test("refuses input overwrite through a normalized path alias and preserves exact bytes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "owh-cli-"));
    const bundle = await createBundle(directory);
    const before = await readFile(bundle);
    const alias = join(directory, "nested", "..", basename(bundle));
    const captured = capture();

    const exitCode = await runCli([
      "run", bundle,
      "--case", caseFixture.id,
      "--scenario", scenarioFixture.id,
      "--out", alias,
    ], captured.io);

    assert.notEqual(exitCode, 0);
    assert.match(captured.stderr.join(""), /refusing to overwrite input/i);
    assert.deepEqual(await readFile(bundle), before);
  });

  test("rejects an existing output collision without changing either file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "owh-cli-"));
    const bundle = await createBundle(directory);
    const output = join(directory, "existing.owhproj");
    await writeFile(output, "keep me");
    const captured = capture();

    const exitCode = await runCli([
      "run", bundle,
      "--case", caseFixture.id,
      "--scenario", scenarioFixture.id,
      "--out", output,
    ], captured.io);

    assert.notEqual(exitCode, 0);
    assert.match(captured.stderr.join(""), /output already exists/i);
    assert.equal(await readFile(output, "utf8"), "keep me");
  });

  test("invalid ids, corrupted bundles, unsupported engines, and usage errors exit non-zero", async () => {
    const directory = await mkdtemp(join(tmpdir(), "owh-cli-"));
    const bundle = await createBundle(directory);
    const unsupportedBundle = await createBundle(await mkdtemp(join(tmpdir(), "owh-cli-")), "not-a-run-kind");
    const corrupt = join(directory, "corrupt.owhproj");
    await writeFile(corrupt, "not a zip");
    const cases = [
      ["run", bundle, "--case", "missing", "--scenario", scenarioFixture.id, "--out", join(directory, "missing.owhproj")],
      ["validate", corrupt],
      ["run", unsupportedBundle, "--case", caseFixture.id, "--scenario", scenarioFixture.id, "--out", join(directory, "unsupported.owhproj")],
      ["run", bundle, "--case", caseFixture.id],
    ];

    for (const args of cases) {
      const captured = capture();
      assert.notEqual(await runCli(args, captured.io), 0, args.join(" "));
      assert.ok(captured.stderr.join("").trim().length > 0);
    }
  });

  test("--python takes precedence and a missing interpreter writes a failed Run bundle then exits non-zero", async () => {
    const directory = await mkdtemp(join(tmpdir(), "owh-cli-"));
    const bundle = await createBundle(directory);
    const output = join(directory, "failed.owhproj");
    const captured = capture();

    const exitCode = await runCli([
      "run", bundle,
      "--case", caseFixture.id,
      "--scenario", scenarioFixture.id,
      "--out", output,
      "--python", "definitely-missing-python-for-owh",
    ], captured.io);

    assert.notEqual(exitCode, 0);
    assert.match(captured.stderr.join(""), /Python executable not found/i);
    const inspection = await inspectProjectBundle(await readFile(output));
    assert.equal(inspection.runs[0]?.status, "failed");
    assert.equal(inspection.runs[0]?.error?.code, "PYTHON_NOT_FOUND");
    assert.equal(inspection.cases[0]?.state, "draft");
  });
});
