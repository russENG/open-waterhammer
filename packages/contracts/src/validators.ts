import { Ajv } from "ajv";
import * as addFormatsModule from "ajv-formats";
import type { FormatsPlugin } from "ajv-formats";

import {
  alternativeSchema,
  automatedAssessmentSchema,
  caseSchema,
  legacyArtifactSchema,
  projectSchema,
  runManifestSchema,
  runSchema,
  scenarioSchema,
} from "./schemas.js";
import type { Alternative, AutomatedAssessment, Case, LegacyArtifact, Project, Run, RunManifest, Scenario } from "./types.js";

const ajv = new Ajv({ allErrors: true, strict: true });
const addFormats = addFormatsModule.default as unknown as FormatsPlugin;
addFormats(ajv);

export const validateProject = ajv.compile<Project>(projectSchema);
export const validateAlternative = ajv.compile<Alternative>(alternativeSchema);
export const validateCase = ajv.compile<Case>(caseSchema);
export const validateScenario = ajv.compile<Scenario>(scenarioSchema);
export const validateRunManifest = ajv.compile<RunManifest>(runManifestSchema);
export const validateAutomatedAssessment = ajv.compile<AutomatedAssessment>(automatedAssessmentSchema);
export const validateRun = ajv.compile<Run>(runSchema);
export const validateLegacyArtifact = ajv.compile<LegacyArtifact>(legacyArtifactSchema);
