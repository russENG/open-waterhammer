import type { Alternative, Case, Project, Run, Scenario } from "@open-waterhammer/contracts";
import { openDB } from "idb";
import type { DBSchema, IDBPDatabase } from "idb";

import { WorkspaceRepositoryBase } from "./repository.js";
import type { WorkspaceStorage } from "./storage.js";
import type { LegacyArtifactRecord, LegacyStorage, WorkspaceData } from "./types.js";

interface WorkspaceDb extends DBSchema {
  projects: { key: string; value: Project };
  alternatives: { key: string; value: Alternative };
  cases: { key: string; value: Case };
  scenarios: { key: string; value: Scenario };
  runs: { key: string; value: Run };
  legacyArtifacts: { key: string; value: LegacyArtifactRecord };
}

const STORE_NAMES = ["projects", "alternatives", "cases", "scenarios", "runs", "legacyArtifacts"] as const;

class IndexedDBWorkspaceStorage implements WorkspaceStorage {
  readonly database: IDBPDatabase<WorkspaceDb>;

  constructor(database: IDBPDatabase<WorkspaceDb>) {
    this.database = database;
  }

  async read(): Promise<WorkspaceData> {
    const [projects, alternatives, cases, scenarios, runs, legacyArtifacts] = await Promise.all([
      this.database.getAll("projects"),
      this.database.getAll("alternatives"),
      this.database.getAll("cases"),
      this.database.getAll("scenarios"),
      this.database.getAll("runs"),
      this.database.getAll("legacyArtifacts"),
    ]);
    return { projects, alternatives, cases, scenarios, runs, legacyArtifacts };
  }

  async transaction<T>(mutate: (draft: WorkspaceData) => T): Promise<T> {
    const transaction = this.database.transaction(STORE_NAMES, "readwrite");
    try {
      const draft: WorkspaceData = {
        projects: await transaction.objectStore("projects").getAll(),
        alternatives: await transaction.objectStore("alternatives").getAll(),
        cases: await transaction.objectStore("cases").getAll(),
        scenarios: await transaction.objectStore("scenarios").getAll(),
        runs: await transaction.objectStore("runs").getAll(),
        legacyArtifacts: await transaction.objectStore("legacyArtifacts").getAll(),
      };
      const result = mutate(draft);
      await Promise.all(STORE_NAMES.map((name) => transaction.objectStore(name).clear()));
      await Promise.all([
        ...draft.projects.map((record) => transaction.objectStore("projects").put(record)),
        ...draft.alternatives.map((record) => transaction.objectStore("alternatives").put(record)),
        ...draft.cases.map((record) => transaction.objectStore("cases").put(record)),
        ...draft.scenarios.map((record) => transaction.objectStore("scenarios").put(record)),
        ...draft.runs.map((record) => transaction.objectStore("runs").put(record)),
        ...draft.legacyArtifacts.map((record) => transaction.objectStore("legacyArtifacts").put(record)),
      ]);
      await transaction.done;
      return result;
    } catch (error) {
      try { transaction.abort(); } catch { /* transaction already aborted */ }
      await transaction.done.catch(() => undefined);
      throw error;
    }
  }
}

export interface OpenIndexedDBWorkspaceOptions {
  databaseName?: string;
  legacyStorage?: LegacyStorage;
}

export class IndexedDBWorkspaceRepository extends WorkspaceRepositoryBase {
  readonly #database: IDBPDatabase<WorkspaceDb>;

  private constructor(storage: IndexedDBWorkspaceStorage, legacyStorage?: LegacyStorage) {
    super(storage, legacyStorage);
    this.#database = storage.database;
  }

  static async open(options: OpenIndexedDBWorkspaceOptions = {}): Promise<IndexedDBWorkspaceRepository> {
    const database = await openDB<WorkspaceDb>(options.databaseName ?? "open-waterhammer-workspace", 1, {
      upgrade(upgradeDatabase) {
        for (const name of STORE_NAMES) {
          if (!upgradeDatabase.objectStoreNames.contains(name)) upgradeDatabase.createObjectStore(name, { keyPath: "id" });
        }
      },
    });
    const implicitLegacyStorage = (globalThis as { localStorage?: LegacyStorage }).localStorage;
    const legacyStorage = options.legacyStorage ?? implicitLegacyStorage;
    const repository = new IndexedDBWorkspaceRepository(new IndexedDBWorkspaceStorage(database), legacyStorage);
    try {
      await repository.migrateLegacy(legacyStorage);
      return repository;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  close(): void {
    this.#database.close();
  }
}
