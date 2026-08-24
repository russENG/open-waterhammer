import type { ValidateFunction } from "ajv";
import type { Alternative, AutomatedAssessment, Case, LegacyArtifact, Project, Run, RunManifest, Scenario } from "./types.js";
import * as generated from "./generated/validators.js";

function valueAt(data: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, data);
}

function isRealUtcTimestamp(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/);
  if (!match) return false;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!, hour!, minute!, second!));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day
    && date.getUTCHours() === hour && date.getUTCMinutes() === minute && date.getUTCSeconds() === second;
}

function withUtcTimestamps<T>(compiled: ValidateFunction<T>, paths: string[]): ValidateFunction<T> {
  const validate = ((data: unknown) => {
    if (!compiled(data)) {
      validate.errors = compiled.errors ?? null;
      return false;
    }
    const invalid = paths.find((path) => {
      const value = valueAt(data, path);
      return value !== undefined && !isRealUtcTimestamp(value);
    });
    validate.errors = invalid ? [{ instancePath: `/${invalid.replaceAll(".", "/")}`, schemaPath: "#/format", keyword: "format", params: { format: "date-time" }, message: "must match format date-time" }] : null;
    return !invalid;
  }) as ValidateFunction<T>;
  validate.errors = null;
  return validate;
}

export const validateProject = withUtcTimestamps(generated.validateProject as ValidateFunction<Project>, ["createdAt", "updatedAt"]);
export const validateAlternative = withUtcTimestamps(generated.validateAlternative as ValidateFunction<Alternative>, ["createdAt", "updatedAt"]);
export const validateCase = withUtcTimestamps(generated.validateCase as ValidateFunction<Case>, ["createdAt", "updatedAt"]);
export const validateScenario = withUtcTimestamps(generated.validateScenario as ValidateFunction<Scenario>, ["createdAt", "updatedAt"]);
export const validateRunManifest = withUtcTimestamps(generated.validateRunManifest as ValidateFunction<RunManifest>, ["createdAt", "completedAt"]);
export const validateAutomatedAssessment = generated.validateAutomatedAssessment as ValidateFunction<AutomatedAssessment>;
export const validateRun = withUtcTimestamps(generated.validateRun as ValidateFunction<Run>, ["createdAt", "updatedAt", "manifest.createdAt", "manifest.completedAt"]);
export const validateLegacyArtifact = generated.validateLegacyArtifact as ValidateFunction<LegacyArtifact>;
