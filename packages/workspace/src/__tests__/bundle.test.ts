import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";

import {
  alternativeFixture,
  caseFixture,
  legacyArtifactFixture,
  projectFixture,
  runFixture,
  scenarioFixture,
} from "@open-waterhammer/contracts";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import {
  InMemoryWorkspaceRepository,
  inspectProjectBundle,
  validateProjectBundle,
} from "../index.js";
import type { WorkspaceData } from "../index.js";

const lockedCase = {
  ...caseFixture,
  state: "locked" as const,
  lockProvenance: "successful_run" as const,
  updatedAt: runFixture.updatedAt,
};

const runWithTimeSeries = {
  ...runFixture,
  timeSeries: { timeSeconds: [0, 1], pressureMpa: [0.4, 1.24] },
};

const workspace: WorkspaceData = {
  projects: [projectFixture],
  alternatives: [alternativeFixture],
  cases: [lockedCase],
  scenarios: [scenarioFixture],
  runs: [runWithTimeSeries],
  legacyArtifacts: [{
    id: "99999999-9999-4999-8999-999999999999",
    caseId: caseFixture.id,
    sourceId: "legacy-session-12",
    artifact: legacyArtifactFixture,
  }],
};

function repack(
  bytes: Uint8Array,
  change: (files: Record<string, Uint8Array>) => void,
  refreshChecksums = false,
): Uint8Array {
  const files = unzipSync(bytes);
  change(files);
  if (refreshChecksums) {
    const checksums: Record<string, string> = {};
    for (const name of Object.keys(files).filter((name) => name !== "checksums.json").sort()) {
      const member = files[name];
      assert.ok(member);
      checksums[name] = createHash("sha256").update(member).digest("hex");
    }
    files["checksums.json"] = strToU8(JSON.stringify(checksums));
  }
  const sorted = Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right)));
  return zipSync(sorted, { level: 9, mtime: new Date("1980-01-01T00:00:00.000Z") });
}

describe("deterministic .owhproj bundles", () => {
  test("exports byte-identical archives with the exact sorted member layout", async () => {
    const repository = new InMemoryWorkspaceRepository(workspace);

    const first = await repository.exportBundle(projectFixture.id);
    const second = await repository.exportBundle(projectFixture.id);

    assert.deepEqual(first, second);
    assert.deepEqual(Object.keys(unzipSync(first)), [
      "alternatives/22222222-2222-4222-8222-222222222222.json",
      "bundle.json",
      "cases/33333333-3333-4333-8333-333333333333/case.json",
      "cases/33333333-3333-4333-8333-333333333333/model.json",
      "cases/33333333-3333-4333-8333-333333333333/scenarios/44444444-4444-4444-8444-444444444444.json",
      "checksums.json",
      "legacy/99999999-9999-4999-8999-999999999999.json",
      "project.json",
      "runs/55555555-5555-4555-8555-555555555555/assessment.json",
      "runs/55555555-5555-4555-8555-555555555555/manifest.json",
      "runs/55555555-5555-4555-8555-555555555555/run.json",
      "runs/55555555-5555-4555-8555-555555555555/summary.json",
      "runs/55555555-5555-4555-8555-555555555555/timeseries.json",
    ]);
    const inspection = await inspectProjectBundle(first);
    assert.equal(inspection.bundleFormatVersion, 1);
    assert.deepEqual(inspection.project, projectFixture);
    assert.deepEqual(inspection.runs, [runWithTimeSeries]);
  });

  test("round-trips a valid bundle into an empty repository", async () => {
    const source = new InMemoryWorkspaceRepository(workspace);
    const target = new InMemoryWorkspaceRepository();

    const importedProject = await target.importBundle(await source.exportBundle(projectFixture.id));

    assert.deepEqual(importedProject, projectFixture);
    assert.deepEqual(await target.snapshot(), workspace);
  });

  test("refuses to export workspace records that violate canonical schemas", async () => {
    const invalid = new InMemoryWorkspaceRepository({
      ...workspace,
      projects: [{ ...projectFixture, id: "not-a-uuid" }],
      alternatives: [{ ...alternativeFixture, projectId: "not-a-uuid" }],
    });

    await assert.rejects(invalid.exportBundle("not-a-uuid"), /Project schema/i);
  });

  test("rejects checksum corruption before an import writes any store", async () => {
    const source = new InMemoryWorkspaceRepository(workspace);
    const target = new InMemoryWorkspaceRepository({
      projects: [{ ...projectFixture, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
      alternatives: [], cases: [], scenarios: [], runs: [], legacyArtifacts: [],
    });
    const before = await target.snapshot();
    const corrupted = repack(await source.exportBundle(projectFixture.id), (files) => {
      files["project.json"] = strToU8(strFromU8(files["project.json"]!).replace("North canal", "South canal"));
    });

    await assert.rejects(target.importBundle(corrupted), /checksum mismatch/i);
    assert.deepEqual(await target.snapshot(), before);
  });

  test("rejects unknown bundle versions, invalid schemas, missing members, and duplicate ids", async () => {
    const repository = new InMemoryWorkspaceRepository(workspace);
    const valid = await repository.exportBundle(projectFixture.id);

    const unknownVersion = repack(valid, (files) => {
      const manifest = JSON.parse(strFromU8(files["bundle.json"]!));
      manifest.bundleFormatVersion = 2;
      files["bundle.json"] = strToU8(JSON.stringify(manifest));
    }, true);
    await assert.rejects(validateProjectBundle(unknownVersion), /bundle format version/i);

    const invalidSchema = repack(valid, (files) => {
      const project = JSON.parse(strFromU8(files["project.json"]!));
      project.id = "not-a-uuid";
      files["project.json"] = strToU8(JSON.stringify(project));
    }, true);
    await assert.rejects(validateProjectBundle(invalidSchema), /Project schema/i);

    const missing = repack(valid, (files) => {
      delete files[`cases/${caseFixture.id}/model.json`];
    }, true);
    await assert.rejects(validateProjectBundle(missing), /missing bundle member/i);

    const duplicated = repack(valid, (files) => {
      const manifest = JSON.parse(strFromU8(files["bundle.json"]!));
      manifest.alternativeIds.push(alternativeFixture.id);
      files["bundle.json"] = strToU8(JSON.stringify(manifest));
    }, true);
    await assert.rejects(validateProjectBundle(duplicated), /duplicate Alternative id/i);

    const duplicatedAcrossTypes = repack(valid, (files) => {
      const manifest = JSON.parse(strFromU8(files["bundle.json"]!));
      manifest.caseIds.push(alternativeFixture.id);
      files["bundle.json"] = strToU8(JSON.stringify(manifest));
    }, true);
    await assert.rejects(validateProjectBundle(duplicatedAcrossTypes), /duplicate entity id/i);
  });

  test("rejects traversal and absolute ZIP paths before reading bundle content", async () => {
    for (const unsafeName of ["../escape.json", "/absolute.json", "C:/drive.json", "safe\\..\\escape.json"]) {
      const archive = zipSync({ [unsafeName]: strToU8("{}") }, {
        mtime: new Date("1980-01-01T00:00:00.000Z"),
      });
      await assert.rejects(validateProjectBundle(archive), /unsafe ZIP path/i, unsafeName);
    }
  });
});
