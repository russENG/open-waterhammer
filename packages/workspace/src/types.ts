import type {
  Alternative,
  Case,
  ForkCaseInput,
  LegacyArtifact,
  Project,
  Run,
  Scenario,
} from "@open-waterhammer/contracts";

export interface LegacyArtifactRecord {
  id: string;
  caseId: string;
  sourceId: string;
  artifact: LegacyArtifact;
}

export interface WorkspaceData {
  projects: Project[];
  alternatives: Alternative[];
  cases: Case[];
  scenarios: Scenario[];
  runs: Run[];
  legacyArtifacts: LegacyArtifactRecord[];
}

export interface LegacyStorage {
  getItem(key: string): string | null;
}

export interface LegacyMigrationResult {
  imported: number;
  skipped: number;
}

export interface BundleInspection {
  bundleFormatVersion: number;
  project: Project;
  alternatives: Alternative[];
  cases: Case[];
  scenarios: Scenario[];
  runs: Run[];
  legacyArtifacts: LegacyArtifactRecord[];
  members: string[];
}

export interface WorkspaceRepository {
  saveDraftCase(caseRecord: Case, scenarios?: Scenario[]): Promise<void>;
  forkCase(caseId: string, input: ForkCaseInput): Promise<Case>;
  appendRun(run: Run): Promise<void>;
  exportBundle(projectId: string): Promise<Uint8Array>;
  importBundle(bytes: Uint8Array): Promise<Project>;
  migrateLegacy(storage?: LegacyStorage): Promise<LegacyMigrationResult>;
}
