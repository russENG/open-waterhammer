import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  AUTOMATED_ASSESSMENT_STATUSES,
  PRODUCT_VERSION,
  RUN_KINDS,
  SCHEMA_VERSION,
  applyFinalRun,
  archiveCase,
  createCase,
  forkCase,
  synchronizeScenarioState,
  validateAlternative,
  validateAutomatedAssessment,
  validateCase,
  validateLegacyArtifact,
  validateProject,
  validateRun,
  validateRunManifest,
  validateScenario,
  alternativeFixture,
  caseFixture,
  legacyArtifactFixture,
  runFixture,
  runManifestFixture,
  scenarioFixture,
} from "../index.js";
import type { Case, Run, RunManifest, Scenario } from "../index.js";

const project = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "North canal rehabilitation",
  standardSelection: {
    profileId: "nochi_pipeline_2021",
    version: "2021-06",
  },
  crs: "EPSG:6677",
  createdAt: "2026-08-23T01:02:03.000Z",
  updatedAt: "2026-08-23T01:02:03.000Z",
};

const alternative = {
  id: "22222222-2222-4222-8222-222222222222",
  projectId: project.id,
  name: "Baseline",
  description: "Existing pipe alignment",
  createdAt: "2026-08-23T01:02:03.000Z",
  updatedAt: "2026-08-23T01:02:03.000Z",
};

const draftCase: Case = {
  id: "33333333-3333-4333-8333-333333333333",
  alternativeId: alternative.id,
  parentCaseId: null,
  modelSnapshot: { pipes: [{ id: "P-1", lengthM: 1200 }] },
  state: "draft",
  lockProvenance: null,
  createdAt: "2026-08-23T01:02:03.000Z",
  updatedAt: "2026-08-23T01:02:03.000Z",
};

const scenario = {
  id: "44444444-4444-4444-8444-444444444444",
  caseId: draftCase.id,
  name: "Pump trip",
  boundaryConditions: { upstream: "reservoir", downstream: "closed_valve" },
  eventSettings: { kind: "pump_trip", atSeconds: 1 },
  protectionSettings: { airValve: { enabled: true } },
  state: "draft",
  createdAt: "2026-08-23T01:02:03.000Z",
  updatedAt: "2026-08-23T01:02:03.000Z",
};

const manifest: RunManifest = {
  schemaVersion: "1.0.0",
  productVersion: "0.2.0-alpha.1",
  runId: "55555555-5555-4555-8555-555555555555",
  caseId: draftCase.id,
  scenarioId: scenario.id,
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

const succeededRun: Run = {
  id: manifest.runId,
  caseId: draftCase.id,
  scenarioId: scenario.id,
  kind: "transient_single_pipe",
  status: "succeeded",
  manifest,
  summary: { peakPressureMpa: 1.24 },
  assessment: { status: "pass", findings: [] },
  error: null,
  createdAt: "2026-08-23T01:02:03.000Z",
  updatedAt: "2026-08-23T01:02:13.000Z",
};

describe("canonical JSON schema validators", () => {
  test("accept literal valid fixtures for every canonical entity", () => {
    assert.equal(validateProject(project), true);
    assert.equal(validateAlternative(alternative), true);
    assert.equal(validateCase(draftCase), true);
    assert.equal(validateScenario(scenario), true);
    assert.equal(validateRunManifest(manifest), true);
    assert.equal(validateRun(succeededRun), true);
    assert.equal(validateAutomatedAssessment(succeededRun.assessment), true);
    assert.equal(
      validateLegacyArtifact({ rawSession: { legacyCase: 12 }, provenance: "incomplete" }),
      true,
    );
  });

  test("rejects invalid UUIDs, non-UTC timestamps, child cases without reasons, and unrecognized RunKinds", () => {
    assert.equal(validateProject({ ...project, id: "project-1" }), false);
    assert.equal(validateProject({ ...project, createdAt: "2026-08-23T10:02:03+09:00" }), false);
    assert.equal(validateProject({ ...project, createdAt: "2026-02-30T01:02:03.000Z" }), false);
    assert.equal(validateCase({ ...draftCase, parentCaseId: draftCase.id }), false);
    assert.equal(validateRun({ ...succeededRun, kind: "steady" }), false);
  });

  test("accepts every supported RunKind", () => {
    const expectedRunKinds = [
      "wave_speed",
      "joukowsky_allievi",
      "empirical_pressure",
      "steady_single_pipe",
      "steady_network_python",
      "steady_network_epanet",
      "longitudinal_hydraulics",
      "transient_single_pipe",
      "transient_network",
      "transient_pump",
      "transient_protection_device",
    ];

    assert.deepEqual(RUN_KINDS, expectedRunKinds);
    for (const kind of expectedRunKinds) {
      assert.equal(validateRun({ ...succeededRun, kind }), true, kind);
    }
  });

  test("rejects an unrecognized assessment status and a legacy artifact shaped as a Run", () => {
    assert.deepEqual(AUTOMATED_ASSESSMENT_STATUSES, ["pass", "warning", "fail", "needs_review", "not_applicable"]);
    assert.equal(validateAutomatedAssessment({ status: "approved", findings: [] }), false);
    assert.equal(validateLegacyArtifact({ ...succeededRun, provenance: "incomplete" }), false);
  });

  test("pins every run manifest to the canonical schema and product versions", () => {
    assert.equal(SCHEMA_VERSION, "1.0.0");
    assert.equal(PRODUCT_VERSION, "0.2.0-alpha.1");
    assert.equal(validateRunManifest({ ...manifest, schemaVersion: "2.0.0" }), false);
    assert.equal(validateRunManifest({ ...manifest, productVersion: "0.2.0" }), false);
  });

  test("exports complete literal fixtures for every canonical entity", () => {
    assert.equal(validateAlternative(alternativeFixture), true);
    assert.equal(validateCase(caseFixture), true);
    assert.equal(validateScenario(scenarioFixture), true);
    assert.equal(validateRunManifest(runManifestFixture), true);
    assert.equal(validateRun(runFixture), true);
    assert.equal(validateLegacyArtifact(legacyArtifactFixture), true);
  });
});

describe("Case lifecycle", () => {
  test("creates a draft root Case", () => {
    const created = createCase({
      id: draftCase.id,
      alternativeId: alternative.id,
      modelSnapshot: draftCase.modelSnapshot,
      timestamp: draftCase.createdAt,
    });

    assert.deepEqual(created, draftCase);
  });

  test("forks draft and locked Cases with a non-blank reason", () => {
    assert.throws(() => forkCase(draftCase, {
      id: "66666666-6666-4666-8666-666666666666",
      revisionReason: "   ",
      timestamp: "2026-08-23T02:02:03.000Z",
    }), /revision reason/i);

    const child = forkCase(draftCase, {
      id: "66666666-6666-4666-8666-666666666666",
      revisionReason: "Increase air valve size",
      timestamp: "2026-08-23T02:02:03.000Z",
    });

    assert.deepEqual(child, {
      ...draftCase,
      id: "66666666-6666-4666-8666-666666666666",
      parentCaseId: draftCase.id,
      revisionReason: "Increase air valve size",
      state: "draft",
      lockProvenance: null,
      createdAt: "2026-08-23T02:02:03.000Z",
      updatedAt: "2026-08-23T02:02:03.000Z",
    });

    const lockedParent: Case = { ...draftCase, state: "locked", lockProvenance: "successful_run" };
    assert.deepEqual(forkCase(lockedParent, {
      id: "77777777-7777-4777-8777-777777777777",
      revisionReason: "Revise pressure control strategy",
      timestamp: "2026-08-23T03:02:03.000Z",
    }), {
      ...draftCase,
      id: "77777777-7777-4777-8777-777777777777",
      parentCaseId: lockedParent.id,
      revisionReason: "Revise pressure control strategy",
      state: "draft",
      lockProvenance: null,
      createdAt: "2026-08-23T03:02:03.000Z",
      updatedAt: "2026-08-23T03:02:03.000Z",
    });
  });

  test("archives editable Cases and rejects archived Case changes", () => {
    const archived = archiveCase(draftCase, "2026-08-23T02:02:03.000Z");
    assert.equal(archived.state, "archived");
    assert.equal(archived.updatedAt, "2026-08-23T02:02:03.000Z");
    assert.throws(() => archiveCase(archived, "2026-08-23T03:02:03.000Z"), /not editable/i);
    assert.throws(() => forkCase(archived, {
      id: "66666666-6666-4666-8666-666666666666",
      revisionReason: "New analysis",
      timestamp: "2026-08-23T02:02:03.000Z",
    }), /not editable/i);
  });

  test("synchronizes Scenario state from its owning Case", () => {
    const lockedCase: Case = { ...draftCase, state: "locked", lockProvenance: "successful_run", updatedAt: "2026-08-23T02:02:03.000Z" };
    const staleScenario: Scenario = { ...scenario, state: "draft", updatedAt: "2026-08-23T01:02:03.000Z" };

    assert.deepEqual(synchronizeScenarioState(lockedCase, staleScenario), {
      ...staleScenario,
      state: "locked",
      updatedAt: "2026-08-23T02:02:03.000Z",
    });
    assert.throws(() => synchronizeScenarioState(lockedCase, {
      ...staleScenario,
      caseId: "99999999-9999-4999-8999-999999999999",
    }), /does not belong/i);
  });

  test("locks a Case only when its first final Run succeeds", () => {
    const failedRun: Run = {
      ...succeededRun,
      id: "77777777-7777-4777-8777-777777777777",
      status: "failed",
      manifest: { ...manifest, runId: "77777777-7777-4777-8777-777777777777", finalStatus: "failed" },
      error: { message: "Solver diverged" },
    };
    const interruptedRun: Run = {
      ...failedRun,
      id: "88888888-8888-4888-8888-888888888888",
      status: "interrupted",
      manifest: { ...failedRun.manifest, runId: "88888888-8888-4888-8888-888888888888", finalStatus: "interrupted" },
    };

    assert.deepEqual(applyFinalRun(draftCase, failedRun), draftCase);
    assert.deepEqual(applyFinalRun(draftCase, interruptedRun), draftCase);
    assert.deepEqual(applyFinalRun(draftCase, succeededRun), {
      ...draftCase,
      state: "locked",
      lockProvenance: "successful_run",
      updatedAt: succeededRun.updatedAt,
    });
  });

  test("preserves the sole legacy import exception when a final Run has not succeeded", () => {
    const imported: Case = { ...draftCase, state: "locked", lockProvenance: "legacy_import" };
    assert.deepEqual(applyFinalRun(imported, {
      ...succeededRun,
      status: "failed",
      manifest: { ...manifest, finalStatus: "failed" },
    }), imported);
  });
});
