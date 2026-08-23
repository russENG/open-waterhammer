import type { WorkspaceData } from "./types.js";

export interface WorkspaceStorage {
  read(): Promise<WorkspaceData>;
  transaction<T>(mutate: (draft: WorkspaceData) => T): Promise<T>;
}

export function emptyWorkspaceData(): WorkspaceData {
  return {
    projects: [],
    alternatives: [],
    cases: [],
    scenarios: [],
    runs: [],
    legacyArtifacts: [],
  };
}

export function cloneWorkspaceData(data: WorkspaceData): WorkspaceData {
  return structuredClone(data);
}

export function sortWorkspaceData(data: WorkspaceData): WorkspaceData {
  const byId = <T extends { id: string }>(left: T, right: T) => left.id.localeCompare(right.id);
  return {
    projects: [...data.projects].sort(byId),
    alternatives: [...data.alternatives].sort(byId),
    cases: [...data.cases].sort(byId),
    scenarios: [...data.scenarios].sort(byId),
    runs: [...data.runs].sort(byId),
    legacyArtifacts: [...data.legacyArtifacts].sort(byId),
  };
}

export class InMemoryWorkspaceStorage implements WorkspaceStorage {
  #data: WorkspaceData;

  constructor(initialData: WorkspaceData = emptyWorkspaceData()) {
    this.#data = cloneWorkspaceData(initialData);
  }

  async read(): Promise<WorkspaceData> {
    return cloneWorkspaceData(this.#data);
  }

  async transaction<T>(mutate: (draft: WorkspaceData) => T): Promise<T> {
    const draft = cloneWorkspaceData(this.#data);
    const result = mutate(draft);
    this.#data = draft;
    return result;
  }
}
