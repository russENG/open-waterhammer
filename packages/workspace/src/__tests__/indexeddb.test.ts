import assert from "node:assert/strict";
import { after, describe, test } from "node:test";

import {
  alternativeFixture,
  caseFixture,
  projectFixture,
  runFixture,
  scenarioFixture,
} from "@open-waterhammer/contracts";
import "fake-indexeddb/auto";
import { deleteDB, openDB } from "idb";

import { InMemoryWorkspaceRepository, IndexedDBWorkspaceRepository } from "../index.js";

const databaseNames: string[] = [];
let sequence = 0;

function databaseName(label: string): string {
  const name = `owh-workspace-${label}-${sequence++}`;
  databaseNames.push(name);
  return name;
}

class PreservedLegacyStorage {
  readonly raw: string;
  writes = 0;
  removals = 0;

  constructor(value: unknown) {
    this.raw = JSON.stringify(value);
  }

  getItem(key: string): string | null {
    return key === "owh_sessions" ? this.raw : null;
  }

  setItem(): void {
    this.writes += 1;
  }

  removeItem(): void {
    this.removals += 1;
  }
}

after(async () => {
  for (const name of databaseNames) await deleteDB(name);
});

describe("IndexedDB workspace and legacy migration", () => {
  test("persists each entity type in a separate store and applies atomic Run locking", async () => {
    const name = databaseName("stores");
    const repository = await IndexedDBWorkspaceRepository.open({ databaseName: name });
    const source = new InMemoryWorkspaceRepository({
      projects: [projectFixture], alternatives: [alternativeFixture], cases: [caseFixture],
      scenarios: [scenarioFixture], runs: [], legacyArtifacts: [],
    });
    await repository.importBundle(await source.exportBundle(projectFixture.id));

    await repository.appendRun(runFixture);
    const beforeRejectedEdit = await repository.snapshot();
    await assert.rejects(repository.saveDraftCase({
      ...caseFixture,
      updatedAt: "2026-08-23T04:02:03.000Z",
    }), /not editable/i);
    assert.deepEqual(await repository.snapshot(), beforeRejectedEdit);
    repository.close();

    const database = await openDB(name);
    assert.deepEqual(Array.from(database.objectStoreNames), [
      "alternatives", "cases", "legacyArtifacts", "projects", "runs", "scenarios",
    ]);
    assert.equal((await database.getAll("runs")).length, 1);
    assert.equal((await database.getAll("cases") as Array<{ state: string }>)[0]?.state, "locked");
    database.close();
  });

  test("automatically migrates every legacy session once without changing localStorage", async () => {
    const name = databaseName("legacy");
    const legacyStorage = new PreservedLegacyStorage([
      {
        id: "session-a",
        name: "Baseline pump trip",
        createdAt: "2025-01-02T03:04:05.000Z",
        pipes: [{ id: "P-1", length: 1200 }],
        mocSummary: { maxPressure: 1.1 },
      },
      {
        id: "session-b",
        name: "Valve closure",
        pipes: [{ id: "P-2", length: 800 }],
      },
    ]);

    const first = await IndexedDBWorkspaceRepository.open({ databaseName: name, legacyStorage });
    const firstSnapshot = await first.snapshot();
    assert.equal(firstSnapshot.projects.length, 1);
    assert.equal(firstSnapshot.alternatives.length, 1);
    assert.equal(firstSnapshot.cases.length, 2);
    assert.equal(firstSnapshot.legacyArtifacts.length, 2);
    assert.deepEqual(firstSnapshot.legacyArtifacts.map(({ sourceId }) => sourceId), ["session-a", "session-b"]);
    assert.deepEqual(firstSnapshot.legacyArtifacts[0]?.artifact.rawSession, {
      id: "session-a",
      name: "Baseline pump trip",
      createdAt: "2025-01-02T03:04:05.000Z",
      pipes: [{ id: "P-1", length: 1200 }],
      mocSummary: { maxPressure: 1.1 },
    });
    assert.ok(firstSnapshot.cases.every(({ state, lockProvenance }) => state === "locked" && lockProvenance === "legacy_import"));
    assert.deepEqual(firstSnapshot.runs, []);
    first.close();

    const second = await IndexedDBWorkspaceRepository.open({ databaseName: name, legacyStorage });
    const repeated = await second.migrateLegacy(legacyStorage);
    const secondSnapshot = await second.snapshot();
    assert.deepEqual(secondSnapshot, firstSnapshot);
    assert.deepEqual(repeated, { imported: 0, skipped: 2 });
    assert.equal(legacyStorage.getItem("owh_sessions"), legacyStorage.raw);
    assert.equal(legacyStorage.writes, 0);
    assert.equal(legacyStorage.removals, 0);
    second.close();
  });

  test("treats missing or malformed legacy storage as no data without rewriting it", async () => {
    const missing = { getItem: () => null };
    const repository = await IndexedDBWorkspaceRepository.open({
      databaseName: databaseName("empty-legacy"),
      legacyStorage: missing,
    });
    assert.deepEqual(await repository.migrateLegacy(missing), { imported: 0, skipped: 0 });
    assert.deepEqual(await repository.snapshot(), {
      projects: [], alternatives: [], cases: [], scenarios: [], runs: [], legacyArtifacts: [],
    });
    repository.close();

    const malformed = { getItem: () => "{not-json" };
    const malformedRepository = await IndexedDBWorkspaceRepository.open({
      databaseName: databaseName("malformed-legacy"),
      legacyStorage: malformed,
    });
    assert.deepEqual(await malformedRepository.migrateLegacy(malformed), { imported: 0, skipped: 0 });
    malformedRepository.close();
  });
});
