import type {
  Alternative,
  AutomatedAssessment,
  Case,
  LegacyArtifact,
  Project,
  Run,
  RunManifest,
  Scenario,
} from "./types.js";

export const projectFixture: Project = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "North canal rehabilitation",
  standardSelection: { profileId: "nochi_pipeline_2021", version: "2021-06" },
  crs: "EPSG:6677",
  createdAt: "2026-08-23T01:02:03.000Z",
  updatedAt: "2026-08-23T01:02:03.000Z",
};

export const automatedAssessmentFixture: AutomatedAssessment = {
  status: "pass",
  findings: [],
};

export const alternativeFixture: Alternative = {
  id: "22222222-2222-4222-8222-222222222222",
  projectId: projectFixture.id,
  name: "Baseline",
  description: "Existing pipe alignment",
  createdAt: "2026-08-23T01:02:03.000Z",
  updatedAt: "2026-08-23T01:02:03.000Z",
};

export const caseFixture: Case = {
  id: "33333333-3333-4333-8333-333333333333",
  alternativeId: alternativeFixture.id,
  parentCaseId: null,
  modelSnapshot: { pipes: [{ id: "P-1", lengthM: 1200 }] },
  state: "draft",
  lockProvenance: null,
  createdAt: "2026-08-23T01:02:03.000Z",
  updatedAt: "2026-08-23T01:02:03.000Z",
};

export const scenarioFixture: Scenario = {
  id: "44444444-4444-4444-8444-444444444444",
  caseId: caseFixture.id,
  name: "Pump trip",
  boundaryConditions: { upstream: "reservoir", downstream: "closed_valve" },
  eventSettings: { kind: "pump_trip", atSeconds: 1 },
  protectionSettings: { airValve: { enabled: true } },
  createdAt: "2026-08-23T01:02:03.000Z",
  updatedAt: "2026-08-23T01:02:03.000Z",
};

export const runManifestFixture: RunManifest = {
  schemaVersion: "1.0.0",
  productVersion: "0.2.0-alpha.1",
  runId: "55555555-5555-4555-8555-555555555555",
  caseId: caseFixture.id,
  scenarioId: scenarioFixture.id,
  createdAt: "2026-08-23T01:02:03.000Z",
  completedAt: "2026-08-23T01:02:13.000Z",
  engine: "open-waterhammer-core",
  runtime: "node-22",
  gitSha: "abc1234",
  inputHashes: { model: "sha256:model", scenario: "sha256:scenario" },
  method: "moc",
  numericParameters: { timeStepSeconds: 0.01 },
  boundaryParameters: { upstreamHeadM: 120 },
  standard: { profileId: "nochi_pipeline_2021", version: "2021-06" },
  rulesVersion: "2021-06",
  outputHashes: { summary: "sha256:summary" },
  warnings: [],
  errors: [],
  finalStatus: "succeeded",
};

export const runFixture: Run = {
  id: runManifestFixture.runId,
  caseId: caseFixture.id,
  scenarioId: scenarioFixture.id,
  kind: "transient_single_pipe",
  status: "succeeded",
  manifest: runManifestFixture,
  summary: { peakPressureMpa: 1.24 },
  assessment: automatedAssessmentFixture,
  error: null,
  createdAt: "2026-08-23T01:02:03.000Z",
  updatedAt: "2026-08-23T01:02:13.000Z",
};

export const legacyArtifactFixture: LegacyArtifact = {
  rawSession: { legacyCase: 12 },
  provenance: "incomplete",
};
