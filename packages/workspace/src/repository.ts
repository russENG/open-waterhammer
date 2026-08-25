import {
  applyFinalRun,
  archiveCase as archiveContractCase,
  deriveScenarioState,
  forkCase as forkContractCase,
  validateCase,
  validateRun,
  validateScenario,
} from "@open-waterhammer/contracts";
import type { Case, ForkCaseInput, Run, Scenario } from "@open-waterhammer/contracts";

import { InMemoryWorkspaceStorage, sortWorkspaceData } from "./storage.js";
import type { WorkspaceStorage } from "./storage.js";
import type { LegacyMigrationResult, LegacyStorage, WorkspaceData, WorkspaceRepository } from "./types.js";
import { exportProjectBundle, importProjectBundle } from "./bundle.js";
import { migrateLegacySessions } from "./migration.js";

function assertValid(label: string, valid: unknown): void {
  if (valid !== true) {
    throw new Error(`Invalid ${label} schema`);
  }
}

function replaceById<T extends { id: string }>(records: T[], record: T): void {
  const index = records.findIndex((candidate) => candidate.id === record.id);
  if (index < 0) {
    records.push(record);
  } else {
    records[index] = record;
  }
}

export class WorkspaceRepositoryBase implements WorkspaceRepository {
  protected readonly storage: WorkspaceStorage;
  readonly #legacyStorage: LegacyStorage | undefined;

  constructor(storage: WorkspaceStorage, legacyStorage?: LegacyStorage) {
    this.storage = storage;
    this.#legacyStorage = legacyStorage;
  }

  async snapshot(): Promise<WorkspaceData> {
    return sortWorkspaceData(await this.storage.read());
  }

  async saveDraftCase(caseRecord: Case, scenarios: Scenario[] = []): Promise<void> {
    assertValid("Case", validateCase(caseRecord));
    if (caseRecord.state !== "draft") {
      throw new Error("Case is not editable");
    }
    for (const scenario of scenarios) {
      assertValid("Scenario", validateScenario(scenario));
      if (scenario.caseId !== caseRecord.id) {
        throw new Error("Scenario does not belong to the Case");
      }
    }

    await this.storage.transaction((draft) => {
      const current = draft.cases.find((candidate) => candidate.id === caseRecord.id);
      if (current && current.state !== "draft") {
        throw new Error("Case is not editable");
      }
      if (!draft.alternatives.some((alternative) => alternative.id === caseRecord.alternativeId)) {
        throw new Error("Case Alternative does not exist");
      }
      replaceById(draft.cases, structuredClone(caseRecord));
      for (const scenario of scenarios) {
        const existingScenario = draft.scenarios.find((candidate) => candidate.id === scenario.id);
        if (existingScenario && existingScenario.caseId !== scenario.caseId) {
          throw new Error(`Scenario ${scenario.id} cannot change its owning Case`);
        }
        replaceById(draft.scenarios, structuredClone(scenario));
      }
    });
  }

  async forkCase(caseId: string, input: ForkCaseInput): Promise<Case> {
    return this.storage.transaction((draft) => {
      const parent = draft.cases.find((candidate) => candidate.id === caseId);
      if (!parent) {
        throw new Error(`Case not found: ${caseId}`);
      }
      if (draft.cases.some((candidate) => candidate.id === input.id)) {
        throw new Error(`Duplicate Case id: ${input.id}`);
      }
      const child = forkContractCase(parent, input);
      assertValid("Case", validateCase(child));
      draft.cases.push(structuredClone(child));
      return structuredClone(child);
    });
  }

  async archiveCase(caseId: string, timestamp: string): Promise<Case> {
    return this.storage.transaction((draft) => {
      const index = draft.cases.findIndex((candidate) => candidate.id === caseId);
      if (index < 0) throw new Error(`Case not found: ${caseId}`);
      const archived = archiveContractCase(draft.cases[index]!, timestamp);
      assertValid("Case", validateCase(archived));
      draft.cases[index] = structuredClone(archived);
      return structuredClone(archived);
    });
  }

  async appendRun(run: Run): Promise<void> {
    assertValid("Run", validateRun(run));
    if (run.status !== "succeeded" && run.status !== "failed" && run.status !== "interrupted") {
      throw new Error("Run must have a final status");
    }
    if (run.manifest.finalStatus !== run.status) {
      throw new Error("Run status does not match manifest final status");
    }
    if (run.id !== run.manifest.runId || run.caseId !== run.manifest.caseId || run.scenarioId !== run.manifest.scenarioId) {
      throw new Error("Run ids do not match its manifest");
    }

    await this.storage.transaction((draft) => {
      if (draft.runs.some((candidate) => candidate.id === run.id)) {
        throw new Error(`Duplicate Run id: ${run.id}`);
      }
      const caseIndex = draft.cases.findIndex((candidate) => candidate.id === run.caseId);
      if (caseIndex < 0) {
        throw new Error(`Run Case not found: ${run.caseId}`);
      }
      const caseRecord = draft.cases[caseIndex];
      if (!caseRecord || caseRecord.state !== "draft") {
        throw new Error("Case is not editable");
      }
      const scenario = draft.scenarios.find((candidate) => candidate.id === run.scenarioId);
      if (!scenario || scenario.caseId !== run.caseId) {
        throw new Error("Run Scenario does not belong to the Case");
      }

      draft.runs.push(structuredClone(run));
      draft.cases[caseIndex] = applyFinalRun(caseRecord, run);
    });
  }

  async scenarioState(scenarioId: string): Promise<Case["state"]> {
    const data = await this.storage.read();
    const scenario = data.scenarios.find((candidate) => candidate.id === scenarioId);
    if (!scenario) {
      throw new Error(`Scenario not found: ${scenarioId}`);
    }
    const caseRecord = data.cases.find((candidate) => candidate.id === scenario.caseId);
    if (!caseRecord) {
      throw new Error(`Scenario Case not found: ${scenario.caseId}`);
    }
    return deriveScenarioState(caseRecord, scenario);
  }

  async exportBundle(projectId: string): Promise<Uint8Array> {
    return exportProjectBundle(await this.storage.read(), projectId);
  }

  async importBundle(bytes: Uint8Array): Promise<import("@open-waterhammer/contracts").Project> {
    const imported = await importProjectBundle(bytes);
    return this.storage.transaction((draft) => {
      const existingIds = new Set([
        ...draft.projects, ...draft.alternatives, ...draft.cases,
        ...draft.scenarios, ...draft.runs, ...draft.legacyArtifacts,
      ].map(({ id }) => id));
      const duplicate = [
        ...imported.projects, ...imported.alternatives, ...imported.cases,
        ...imported.scenarios, ...imported.runs, ...imported.legacyArtifacts,
      ].find(({ id }) => existingIds.has(id));
      if (duplicate) throw new Error(`Duplicate workspace entity id: ${duplicate.id}`);
      draft.projects.push(...structuredClone(imported.projects));
      draft.alternatives.push(...structuredClone(imported.alternatives));
      draft.cases.push(...structuredClone(imported.cases));
      draft.scenarios.push(...structuredClone(imported.scenarios));
      draft.runs.push(...structuredClone(imported.runs));
      draft.legacyArtifacts.push(...structuredClone(imported.legacyArtifacts));
      const project = imported.projects[0];
      if (!project) throw new Error("Imported bundle has no Project");
      return structuredClone(project);
    });
  }

  async replaceBundle(bytes: Uint8Array): Promise<import("@open-waterhammer/contracts").Project> {
    // Validate the complete archive before opening the write transaction. A corrupt
    // bundle therefore leaves the currently open Project untouched.
    const imported = await importProjectBundle(bytes);
    const project = imported.projects[0];
    if (!project) throw new Error("Imported bundle has no Project");
    return this.storage.transaction((draft) => {
      draft.projects = structuredClone(imported.projects);
      draft.alternatives = structuredClone(imported.alternatives);
      draft.cases = structuredClone(imported.cases);
      draft.scenarios = structuredClone(imported.scenarios);
      draft.runs = structuredClone(imported.runs);
      draft.legacyArtifacts = structuredClone(imported.legacyArtifacts);
      return structuredClone(project);
    });
  }

  async migrateLegacy(storage: LegacyStorage | undefined = this.#legacyStorage): Promise<LegacyMigrationResult> {
    return migrateLegacySessions(this.storage, storage);
  }

}

export class InMemoryWorkspaceRepository extends WorkspaceRepositoryBase {
  constructor(initialData?: WorkspaceData) {
    super(new InMemoryWorkspaceStorage(initialData));
  }
}
