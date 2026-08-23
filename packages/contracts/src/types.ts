export const PRODUCT_VERSION = "0.2.0-alpha.1" as const;
export const SCHEMA_VERSION = "1.0.0" as const;
export const RUN_KIND = "transient" as const;

export const AUTOMATED_ASSESSMENT_STATUSES = [
  "pass",
  "warning",
  "fail",
  "needs_review",
  "not_applicable",
] as const;

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type Uuid = string;
export type UtcTimestamp = string;
export type CaseState = "draft" | "locked" | "archived";
export type CaseLockProvenance = "successful_run" | "legacy_import" | null;
export type RunKind = typeof RUN_KIND;
export type RunStatus = "pending" | "running" | "succeeded" | "failed" | "interrupted";
export type FinalRunStatus = Extract<RunStatus, "succeeded" | "failed" | "interrupted">;
export type AutomatedAssessmentStatus = (typeof AUTOMATED_ASSESSMENT_STATUSES)[number];

export interface StandardSelection {
  profileId: string;
  version: string;
}

export interface Project {
  id: Uuid;
  name: string;
  standardSelection: StandardSelection;
  crs: string;
  createdAt: UtcTimestamp;
  updatedAt: UtcTimestamp;
}

export interface Alternative {
  id: Uuid;
  projectId: Uuid;
  name: string;
  description: string;
  createdAt: UtcTimestamp;
  updatedAt: UtcTimestamp;
}

export interface Case {
  id: Uuid;
  alternativeId: Uuid;
  parentCaseId: Uuid | null;
  revisionReason?: string;
  modelSnapshot: JsonValue;
  state: CaseState;
  lockProvenance: CaseLockProvenance;
  createdAt: UtcTimestamp;
  updatedAt: UtcTimestamp;
}

export interface Scenario {
  id: Uuid;
  caseId: Uuid;
  name: string;
  boundaryConditions: JsonValue;
  eventSettings: JsonValue;
  protectionSettings: JsonValue;
  state: CaseState;
  createdAt: UtcTimestamp;
  updatedAt: UtcTimestamp;
}

export interface RunManifest {
  schemaVersion: typeof SCHEMA_VERSION;
  productVersion: typeof PRODUCT_VERSION;
  runId: Uuid;
  caseId: Uuid;
  scenarioId: Uuid;
  createdAt: UtcTimestamp;
  completedAt?: UtcTimestamp;
  engine: string;
  runtime: string;
  gitSha: string;
  inputHashes: Record<string, string>;
  method: string;
  numericParameters: JsonValue;
  boundaryParameters: JsonValue;
  standard: StandardSelection;
  rulesVersion: string;
  outputHashes: Record<string, string>;
  warnings: string[];
  errors: string[];
  finalStatus: FinalRunStatus;
}

export interface AssessmentFinding {
  targetRef: string;
  location?: string;
  observedValue: JsonValue;
  threshold: JsonValue;
  unit: string;
  ruleId: string;
}

export interface AutomatedAssessment {
  status: AutomatedAssessmentStatus;
  findings: AssessmentFinding[];
}

export interface RunError {
  message: string;
  code?: string;
  details?: JsonValue;
}

export interface Run {
  id: Uuid;
  caseId: Uuid;
  scenarioId: Uuid;
  kind: RunKind;
  status: RunStatus;
  manifest: RunManifest;
  summary: JsonValue;
  timeSeries?: JsonValue;
  assessment: AutomatedAssessment;
  error: RunError | null;
  createdAt: UtcTimestamp;
  updatedAt: UtcTimestamp;
}

export interface LegacyArtifact {
  rawSession: JsonValue;
  provenance: "incomplete";
}

export interface CreateCaseInput {
  id: Uuid;
  alternativeId: Uuid;
  modelSnapshot: JsonValue;
  timestamp: UtcTimestamp;
}

export interface ForkCaseInput {
  id: Uuid;
  revisionReason: string;
  timestamp: UtcTimestamp;
}
