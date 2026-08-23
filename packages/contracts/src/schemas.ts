import type { AnySchemaObject } from "ajv";

import { AUTOMATED_ASSESSMENT_STATUSES, RUN_KINDS, SCHEMA_VERSION } from "./types.js";

const uuid = { type: "string", pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" } as const;
const utcTimestamp = { type: "string", format: "date-time", pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z$" } as const;
const nonBlank = { type: "string", pattern: "\\S" } as const;
const caseStates = ["draft", "locked", "archived"] as const;
const lockProvenances = ["successful_run", "legacy_import"] as const;
const finalRunStatuses = ["succeeded", "failed", "interrupted"] as const;

const standardSelection = {
  type: "object",
  additionalProperties: false,
  required: ["profileId", "version"],
  properties: { profileId: nonBlank, version: nonBlank },
} as const;

const timestamps = {
  createdAt: utcTimestamp,
  updatedAt: utcTimestamp,
} as const;

export const projectSchema: AnySchemaObject = {
  $id: "https://open-waterhammer.org/schemas/project/1.0.0",
  type: "object",
  additionalProperties: false,
  required: ["id", "name", "standardSelection", "crs", "createdAt", "updatedAt"],
  properties: {
    id: uuid,
    name: nonBlank,
    standardSelection,
    crs: nonBlank,
    ...timestamps,
  },
};

export const alternativeSchema: AnySchemaObject = {
  $id: "https://open-waterhammer.org/schemas/alternative/1.0.0",
  type: "object",
  additionalProperties: false,
  required: ["id", "projectId", "name", "description", "createdAt", "updatedAt"],
  properties: { id: uuid, projectId: uuid, name: nonBlank, description: { type: "string" }, ...timestamps },
};

export const caseSchema: AnySchemaObject = {
  $id: "https://open-waterhammer.org/schemas/case/1.0.0",
  type: "object",
  additionalProperties: false,
  required: ["id", "alternativeId", "parentCaseId", "modelSnapshot", "state", "lockProvenance", "createdAt", "updatedAt"],
  properties: {
    id: uuid,
    alternativeId: uuid,
    parentCaseId: { anyOf: [uuid, { type: "null" }] },
    revisionReason: nonBlank,
    modelSnapshot: {},
    state: { enum: caseStates },
    lockProvenance: { anyOf: [{ enum: lockProvenances }, { type: "null" }] },
    ...timestamps,
  },
  allOf: [
    {
      if: { properties: { parentCaseId: { type: "string" } }, required: ["parentCaseId"] },
      then: { properties: { revisionReason: nonBlank }, required: ["revisionReason"] },
    },
    {
      if: { properties: { state: { const: "locked" } }, required: ["state"] },
      then: { properties: { lockProvenance: { enum: lockProvenances } }, required: ["lockProvenance"] },
      else: { properties: { lockProvenance: { type: "null" } } },
    },
  ],
};

export const scenarioSchema: AnySchemaObject = {
  $id: "https://open-waterhammer.org/schemas/scenario/1.0.0",
  type: "object",
  additionalProperties: false,
  required: ["id", "caseId", "name", "boundaryConditions", "eventSettings", "protectionSettings", "createdAt", "updatedAt"],
  properties: {
    id: uuid,
    caseId: uuid,
    name: nonBlank,
    boundaryConditions: {},
    eventSettings: {},
    protectionSettings: {},
    ...timestamps,
  },
};

export const runManifestSchema: AnySchemaObject = {
  $id: "https://open-waterhammer.org/schemas/run-manifest/1.0.0",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion", "productVersion", "runId", "caseId", "scenarioId", "createdAt", "engine", "runtime", "gitSha",
    "inputHashes", "method", "numericParameters", "boundaryParameters", "standard", "rulesVersion", "outputHashes",
    "warnings", "errors", "finalStatus",
  ],
  properties: {
    schemaVersion: { const: SCHEMA_VERSION },
    // Not pinned to `{ const: PRODUCT_VERSION }`: a manifest read back from a bundle exported by
    // an older or newer release must still validate at the next version bump. schemaVersion
    // above remains the sole compatibility gate (see RunManifest.productVersion in types.ts).
    productVersion: nonBlank,
    runId: uuid,
    caseId: uuid,
    scenarioId: uuid,
    createdAt: utcTimestamp,
    completedAt: utcTimestamp,
    engine: nonBlank,
    runtime: nonBlank,
    gitSha: nonBlank,
    inputHashes: { type: "object", additionalProperties: { type: "string" } },
    method: nonBlank,
    numericParameters: {},
    boundaryParameters: {},
    standard: standardSelection,
    rulesVersion: nonBlank,
    outputHashes: { type: "object", additionalProperties: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } },
    errors: { type: "array", items: { type: "string" } },
    finalStatus: { enum: finalRunStatuses },
  },
};

export const automatedAssessmentSchema: AnySchemaObject = {
  $id: "https://open-waterhammer.org/schemas/automated-assessment/1.0.0",
  type: "object",
  additionalProperties: false,
  required: ["status", "findings"],
  properties: {
    status: { enum: AUTOMATED_ASSESSMENT_STATUSES },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["targetRef", "observedValue", "threshold", "unit", "ruleId"],
        properties: {
          targetRef: nonBlank,
          location: { type: "string" },
          observedValue: {},
          threshold: {},
          unit: nonBlank,
          ruleId: nonBlank,
        },
      },
    },
  },
};

export const runSchema: AnySchemaObject = {
  $id: "https://open-waterhammer.org/schemas/run/1.0.0",
  type: "object",
  additionalProperties: false,
  required: ["id", "caseId", "scenarioId", "kind", "status", "manifest", "summary", "assessment", "error", "createdAt", "updatedAt"],
  properties: {
    id: uuid,
    caseId: uuid,
    scenarioId: uuid,
    kind: { enum: RUN_KINDS },
    status: { enum: ["pending", "running", "succeeded", "failed", "interrupted"] },
    manifest: runManifestSchema,
    summary: {},
    timeSeries: {},
    assessment: automatedAssessmentSchema,
    error: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["message"],
          properties: { message: nonBlank, code: { type: "string" }, details: {} },
        },
      ],
    },
    ...timestamps,
  },
};

export const legacyArtifactSchema: AnySchemaObject = {
  $id: "https://open-waterhammer.org/schemas/legacy-artifact/1.0.0",
  type: "object",
  additionalProperties: false,
  required: ["rawSession", "provenance"],
  properties: { rawSession: {}, provenance: { const: "incomplete" } },
};
