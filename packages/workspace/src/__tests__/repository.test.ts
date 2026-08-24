import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  alternativeFixture,
  caseFixture,
  projectFixture,
  runFixture,
  scenarioFixture,
} from "@open-waterhammer/contracts";
import type { Case, Run } from "@open-waterhammer/contracts";

import { InMemoryWorkspaceRepository } from "../index.js";

function createRepository() {
  return new InMemoryWorkspaceRepository({
    projects: [projectFixture],
    alternatives: [alternativeFixture],
    cases: [caseFixture],
    scenarios: [scenarioFixture],
    runs: [],
    legacyArtifacts: [],
  });
}

describe("in-memory WorkspaceRepository", () => {
  test("saves edits only while a Case is draft and keeps Scenario state derived", async () => {
    const repository = createRepository();
    const edited: Case = {
      ...caseFixture,
      modelSnapshot: { pipes: [{ id: "P-1", lengthM: 1300 }] },
      updatedAt: "2026-08-23T02:02:03.000Z",
    };

    await repository.saveDraftCase(edited, [{
      ...scenarioFixture,
      name: "Valve closure",
      updatedAt: "2026-08-23T02:02:03.000Z",
    }]);

    const saved = await repository.snapshot();
    assert.deepEqual(saved.cases, [edited]);
    assert.equal(saved.scenarios[0]?.name, "Valve closure");
    assert.equal(await repository.scenarioState(scenarioFixture.id), "draft");

    await repository.appendRun(runFixture);
    await assert.rejects(
      repository.saveDraftCase({ ...edited, updatedAt: "2026-08-23T03:02:03.000Z" }),
      /not editable/i,
    );
    assert.equal((await repository.snapshot()).cases[0]?.updatedAt, runFixture.updatedAt);
  });

  test("forks a locked Case through the contract lifecycle helper", async () => {
    const repository = createRepository();
    await repository.appendRun(runFixture);

    const child = await repository.forkCase(caseFixture.id, {
      id: "66666666-6666-4666-8666-666666666666",
      revisionReason: "Increase air valve size",
      timestamp: "2026-08-23T03:02:03.000Z",
    });

    assert.deepEqual(child, {
      ...caseFixture,
      id: "66666666-6666-4666-8666-666666666666",
      parentCaseId: caseFixture.id,
      revisionReason: "Increase air valve size",
      state: "draft",
      lockProvenance: null,
      createdAt: "2026-08-23T03:02:03.000Z",
      updatedAt: "2026-08-23T03:02:03.000Z",
    });
  });

  test("archives only a draft Case through the contract lifecycle helper", async () => {
    const repository = createRepository();

    const archived = await repository.archiveCase(caseFixture.id, "2026-08-23T03:02:03.000Z");
    assert.equal(archived.state, "archived");
    assert.equal((await repository.snapshot()).cases[0]?.state, "archived");
    await assert.rejects(
      repository.archiveCase(caseFixture.id, "2026-08-23T04:02:03.000Z"),
      /not editable/i,
    );
  });

  test("atomically persists a successful Run and locks its draft Case", async () => {
    const repository = createRepository();

    await repository.appendRun(runFixture);

    const saved = await repository.snapshot();
    assert.deepEqual(saved.runs, [runFixture]);
    assert.equal(saved.cases[0]?.state, "locked");
    assert.equal(saved.cases[0]?.lockProvenance, "successful_run");
    assert.equal(saved.cases[0]?.updatedAt, runFixture.updatedAt);
    assert.equal(await repository.scenarioState(scenarioFixture.id), "locked");
  });

  test("persists failed and interrupted Runs without locking their Case", async () => {
    for (const status of ["failed", "interrupted"] as const) {
      const repository = createRepository();
      const finalRun: Run = {
        ...runFixture,
        id: status === "failed"
          ? "77777777-7777-4777-8777-777777777777"
          : "88888888-8888-4888-8888-888888888888",
        status,
        manifest: {
          ...runFixture.manifest,
          runId: status === "failed"
            ? "77777777-7777-4777-8777-777777777777"
            : "88888888-8888-4888-8888-888888888888",
          finalStatus: status,
        },
        error: { message: status === "failed" ? "Solver diverged" : "Cancelled" },
      };

      await repository.appendRun(finalRun);

      const saved = await repository.snapshot();
      assert.equal(saved.runs[0]?.status, status);
      assert.equal(saved.cases[0]?.state, "draft");
      assert.equal(saved.cases[0]?.lockProvenance, null);
    }
  });

  test("rejects inconsistent Runs without partially persisting them", async () => {
    const repository = createRepository();
    const inconsistent: Run = {
      ...runFixture,
      manifest: { ...runFixture.manifest, finalStatus: "failed" },
    };

    await assert.rejects(repository.appendRun(inconsistent), /status/i);

    const saved = await repository.snapshot();
    assert.deepEqual(saved.runs, []);
    assert.deepEqual(saved.cases, [caseFixture]);
  });

  test("rejects an imported id that collides with any existing entity type before writing", async () => {
    const source = createRepository();
    const target = new InMemoryWorkspaceRepository({
      projects: [],
      alternatives: [],
      cases: [{ ...caseFixture, id: projectFixture.id }],
      scenarios: [],
      runs: [],
      legacyArtifacts: [],
    });
    const before = await target.snapshot();

    await assert.rejects(
      target.importBundle(await source.exportBundle(projectFixture.id)),
      /duplicate workspace entity id/i,
    );
    assert.deepEqual(await target.snapshot(), before);
  });

  test("rejects changing an existing Scenario id to a different owning Case", async () => {
    const lockedOwner: Case = {
      ...caseFixture,
      state: "locked",
      lockProvenance: "successful_run",
    };
    const draftCase: Case = {
      ...caseFixture,
      id: "66666666-6666-4666-8666-666666666666",
    };
    const repository = new InMemoryWorkspaceRepository({
      projects: [projectFixture],
      alternatives: [alternativeFixture],
      cases: [lockedOwner, draftCase],
      scenarios: [scenarioFixture],
      runs: [],
      legacyArtifacts: [],
    });
    const before = await repository.snapshot();

    await assert.rejects(repository.saveDraftCase(draftCase, [{
      ...scenarioFixture,
      caseId: draftCase.id,
    }]), /cannot change its owning Case/i);
    assert.deepEqual(await repository.snapshot(), before);
  });
});
