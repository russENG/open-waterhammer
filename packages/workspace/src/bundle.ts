import {
  PRODUCT_VERSION,
  SCHEMA_VERSION,
  validateAlternative,
  validateCase,
  validateLegacyArtifact,
  validateProject,
  validateRun,
  validateScenario,
} from "@open-waterhammer/contracts";
import type {
  Alternative,
  Case,
  JsonValue,
  Project,
  Run,
  Scenario,
} from "@open-waterhammer/contracts";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import type { BundleInspection, LegacyArtifactRecord, WorkspaceData } from "./types.js";

const BUNDLE_FORMAT_VERSION = 1;
const FIXED_ZIP_TIME = new Date(1980, 0, 1, 0, 0, 0, 0);

interface BundleManifest {
  bundleFormatVersion: number;
  schemaVersion: string;
  productVersion: string;
  projectId: string;
  alternativeIds: string[];
  caseIds: string[];
  scenarioIds: string[];
  runIds: string[];
  legacyArtifactIds: string[];
}

function canonicalize(value: unknown, seen: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical JSON cannot contain non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error("Canonical JSON cannot contain cycles");
    seen.add(value);
    const result = `[${value.map((item) => canonicalize(item, seen)).join(",")}]`;
    seen.delete(value);
    return result;
  }
  if (typeof value === "object") {
    if (seen.has(value)) throw new Error("Canonical JSON cannot contain cycles");
    seen.add(value);
    const object = value as Record<string, unknown>;
    const members = Object.keys(object).sort().map((key) => {
      if (object[key] === undefined) throw new Error("Canonical JSON cannot contain undefined");
      return `${JSON.stringify(key)}:${canonicalize(object[key], seen)}`;
    });
    seen.delete(value);
    return `{${members.join(",")}}`;
  }
  throw new Error(`Canonical JSON cannot contain ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  return canonicalize(value, new Set());
}

function jsonBytes(value: unknown): Uint8Array {
  return strToU8(canonicalJson(value));
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const input = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(input).set(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readUint16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function readZipEntryNames(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimumEocdOffset = Math.max(0, bytes.byteLength - 65_557);
  let eocdOffset = -1;
  for (let offset = bytes.byteLength - 22; offset >= minimumEocdOffset; offset -= 1) {
    if (readUint32(view, offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("Invalid ZIP archive");

  const entryCount = readUint16(view, eocdOffset + 10);
  let offset = readUint32(view, eocdOffset + 16);
  const names: string[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.byteLength || readUint32(view, offset) !== 0x02014b50) {
      throw new Error("Invalid ZIP central directory");
    }
    const nameLength = readUint16(view, offset + 28);
    const extraLength = readUint16(view, offset + 30);
    const commentLength = readUint16(view, offset + 32);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > bytes.byteLength) throw new Error("Invalid ZIP member name");
    names.push(strFromU8(bytes.subarray(nameStart, nameEnd)));
    offset = nameEnd + extraLength + commentLength;
  }
  return names;
}

function assertSafeZipPath(name: string): void {
  const normalized = name.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (
    name.includes("\\") || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)
    || segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`Unsafe ZIP path: ${name}`);
  }
}

function parseJsonMember(files: Record<string, Uint8Array>, name: string): unknown {
  const bytes = files[name];
  if (!bytes) throw new Error(`Missing bundle member: ${name}`);
  try {
    return JSON.parse(strFromU8(bytes));
  } catch {
    throw new Error(`Invalid JSON member: ${name}`);
  }
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
}

function assertStringArray(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Invalid ${label}`);
  }
}

function assertUnique(ids: string[], label: string): void {
  if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${label} id`);
}

function parseManifest(value: unknown): BundleManifest {
  assertObject(value, "bundle manifest");
  const expectedKeys = [
    "alternativeIds", "bundleFormatVersion", "caseIds", "legacyArtifactIds", "productVersion",
    "projectId", "runIds", "scenarioIds", "schemaVersion",
  ];
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson(expectedKeys)) {
    throw new Error("Invalid bundle manifest schema");
  }
  if (typeof value.bundleFormatVersion !== "number") throw new Error("Invalid bundle format version");
  if (typeof value.schemaVersion !== "string" || typeof value.productVersion !== "string" || typeof value.projectId !== "string") {
    throw new Error("Invalid bundle manifest schema");
  }
  assertStringArray(value.alternativeIds, "Alternative ids");
  assertStringArray(value.caseIds, "Case ids");
  assertStringArray(value.scenarioIds, "Scenario ids");
  assertStringArray(value.runIds, "Run ids");
  assertStringArray(value.legacyArtifactIds, "LegacyArtifact ids");
  assertUnique(value.alternativeIds, "Alternative");
  assertUnique(value.caseIds, "Case");
  assertUnique(value.scenarioIds, "Scenario");
  assertUnique(value.runIds, "Run");
  assertUnique(value.legacyArtifactIds, "LegacyArtifact");
  const allEntityIds = [
    value.projectId,
    ...value.alternativeIds,
    ...value.caseIds,
    ...value.scenarioIds,
    ...value.runIds,
    ...value.legacyArtifactIds,
  ];
  if (new Set(allEntityIds).size !== allEntityIds.length) throw new Error("Duplicate entity id across bundle types");
  return value as unknown as BundleManifest;
}

function assertSchema(label: string, valid: unknown): void {
  if (valid !== true) throw new Error(`Invalid ${label} schema`);
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function expectedMemberNames(manifest: BundleManifest, runs: Run[]): string[] {
  const names = ["bundle.json", "project.json"];
  names.push(...manifest.alternativeIds.map((id) => `alternatives/${id}.json`));
  for (const id of manifest.caseIds) {
    names.push(`cases/${id}/case.json`, `cases/${id}/model.json`);
  }
  names.push(...manifest.runIds.flatMap((id) => {
    const base = `runs/${id}`;
    const run = runs.find((candidate) => candidate.id === id);
    return [
      `${base}/run.json`, `${base}/manifest.json`, `${base}/summary.json`,
      ...(run?.timeSeries === undefined ? [] : [`${base}/timeseries.json`]),
      `${base}/assessment.json`,
    ];
  }));
  names.push(...manifest.legacyArtifactIds.map((id) => `legacy/${id}.json`));
  return names;
}

function selectProjectData(data: WorkspaceData, projectId: string): WorkspaceData {
  const projects = data.projects.filter((project) => project.id === projectId);
  if (projects.length !== 1) throw new Error(`Project not found: ${projectId}`);
  const alternatives = data.alternatives.filter((alternative) => alternative.projectId === projectId);
  const alternativeIds = new Set(alternatives.map(({ id }) => id));
  const cases = data.cases.filter((caseRecord) => alternativeIds.has(caseRecord.alternativeId));
  const caseIds = new Set(cases.map(({ id }) => id));
  const scenarios = data.scenarios.filter((scenario) => caseIds.has(scenario.caseId));
  const runs = data.runs.filter((run) => caseIds.has(run.caseId));
  const legacyArtifacts = data.legacyArtifacts.filter((record) => caseIds.has(record.caseId));
  return { projects, alternatives, cases, scenarios, runs, legacyArtifacts };
}

export async function exportProjectBundle(data: WorkspaceData, projectId: string): Promise<Uint8Array> {
  const selected = selectProjectData(data, projectId);
  const project = selected.projects[0];
  if (!project) throw new Error(`Project not found: ${projectId}`);
  const sortIds = <T extends { id: string }>(records: T[]) => records.map(({ id }) => id).sort();
  const manifest: BundleManifest = {
    bundleFormatVersion: BUNDLE_FORMAT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    productVersion: PRODUCT_VERSION,
    projectId,
    alternativeIds: sortIds(selected.alternatives),
    caseIds: sortIds(selected.cases),
    scenarioIds: sortIds(selected.scenarios),
    runIds: sortIds(selected.runs),
    legacyArtifactIds: sortIds(selected.legacyArtifacts),
  };
  const members = new Map<string, Uint8Array>();
  members.set("bundle.json", jsonBytes(manifest));
  members.set("project.json", jsonBytes(project));
  for (const alternative of selected.alternatives) members.set(`alternatives/${alternative.id}.json`, jsonBytes(alternative));
  for (const caseRecord of selected.cases) {
    members.set(`cases/${caseRecord.id}/case.json`, jsonBytes(caseRecord));
    members.set(`cases/${caseRecord.id}/model.json`, jsonBytes(caseRecord.modelSnapshot));
  }
  for (const scenario of selected.scenarios) {
    members.set(`cases/${scenario.caseId}/scenarios/${scenario.id}.json`, jsonBytes(scenario));
  }
  for (const run of selected.runs) {
    const base = `runs/${run.id}`;
    members.set(`${base}/run.json`, jsonBytes(run));
    members.set(`${base}/manifest.json`, jsonBytes(run.manifest));
    members.set(`${base}/summary.json`, jsonBytes(run.summary));
    if (run.timeSeries !== undefined) members.set(`${base}/timeseries.json`, jsonBytes(run.timeSeries));
    members.set(`${base}/assessment.json`, jsonBytes(run.assessment));
  }
  for (const record of selected.legacyArtifacts) members.set(`legacy/${record.id}.json`, jsonBytes(record));

  const checksums: Record<string, string> = {};
  for (const [name, bytes] of [...members].sort(([left], [right]) => left.localeCompare(right))) {
    checksums[name] = await sha256(bytes);
  }
  members.set("checksums.json", jsonBytes(checksums));
  const zippable = Object.fromEntries([...members].sort(([left], [right]) => left.localeCompare(right)));
  const archive = zipSync(zippable, { level: 9, mtime: FIXED_ZIP_TIME });
  await validateProjectBundle(archive);
  return archive;
}

export async function inspectProjectBundle(bytes: Uint8Array): Promise<BundleInspection> {
  const rawNames = readZipEntryNames(bytes);
  for (const name of rawNames) assertSafeZipPath(name);
  if (new Set(rawNames).size !== rawNames.length) throw new Error("Duplicate ZIP member");

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("Invalid ZIP archive");
  }
  const checksumsValue = parseJsonMember(files, "checksums.json");
  assertObject(checksumsValue, "checksums schema");
  const contentNames = Object.keys(files).filter((name) => name !== "checksums.json").sort();
  if (!sameJson(Object.keys(checksumsValue).sort(), contentNames)) throw new Error("Checksums do not cover every bundle member");
  for (const name of contentNames) {
    if (typeof checksumsValue[name] !== "string" || await sha256(files[name]!) !== checksumsValue[name]) {
      throw new Error(`Checksum mismatch: ${name}`);
    }
  }

  const manifest = parseManifest(parseJsonMember(files, "bundle.json"));
  if (manifest.bundleFormatVersion !== BUNDLE_FORMAT_VERSION) throw new Error(`Unknown bundle format version: ${manifest.bundleFormatVersion}`);
  // schemaVersion is the sole compatibility gate here — productVersion is deliberately NOT
  // compared against the running PRODUCT_VERSION (controller ruling, Task "final review wave"
  // finding I1): a bundle exported by an older or newer release must stay importable, and an
  // already-exported workspace must not lose the ability to re-export itself, at the next
  // version bump. bundleFormatVersion above is unaffected and remains a hard gate.
  if (manifest.schemaVersion !== SCHEMA_VERSION) {
    throw new Error("Unsupported bundle schema version");
  }
  const project = parseJsonMember(files, "project.json") as Project;
  assertSchema("Project", validateProject(project));
  if (project.id !== manifest.projectId) throw new Error("Project id does not match bundle manifest");

  const alternatives = manifest.alternativeIds.map((id) => {
    const record = parseJsonMember(files, `alternatives/${id}.json`) as Alternative;
    assertSchema("Alternative", validateAlternative(record));
    if (record.id !== id) throw new Error(`Alternative id does not match member path: ${id}`);
    return record;
  });
  const cases = manifest.caseIds.map((id) => {
    const record = parseJsonMember(files, `cases/${id}/case.json`) as Case;
    assertSchema("Case", validateCase(record));
    if (record.id !== id) throw new Error(`Case id does not match member path: ${id}`);
    const model = parseJsonMember(files, `cases/${id}/model.json`) as JsonValue;
    if (!sameJson(record.modelSnapshot, model)) throw new Error(`Case model does not match model member: ${id}`);
    return record;
  });
  const caseIds = new Set(cases.map(({ id }) => id));
  const scenarios = manifest.scenarioIds.map((id) => {
    const matchingNames = Object.keys(files).filter((name) => name.endsWith(`/scenarios/${id}.json`));
    if (matchingNames.length !== 1) throw new Error(`Missing bundle member for Scenario: ${id}`);
    const record = parseJsonMember(files, matchingNames[0]!) as Scenario;
    assertSchema("Scenario", validateScenario(record));
    if (record.id !== id) throw new Error(`Scenario id does not match member path: ${id}`);
    return record;
  });
  const runs = manifest.runIds.map((id) => {
    const base = `runs/${id}`;
    const record = parseJsonMember(files, `${base}/run.json`) as Run;
    assertSchema("Run", validateRun(record));
    if (record.id !== id) throw new Error(`Run id does not match member path: ${id}`);
    if (!sameJson(record.manifest, parseJsonMember(files, `${base}/manifest.json`))) throw new Error(`Run manifest member mismatch: ${id}`);
    if (!sameJson(record.summary, parseJsonMember(files, `${base}/summary.json`))) throw new Error(`Run summary member mismatch: ${id}`);
    if (!sameJson(record.assessment, parseJsonMember(files, `${base}/assessment.json`))) throw new Error(`Run assessment member mismatch: ${id}`);
    const timeseriesName = `${base}/timeseries.json`;
    if (record.timeSeries === undefined && files[timeseriesName]) throw new Error(`Unexpected Run time series member: ${id}`);
    if (record.timeSeries !== undefined && !sameJson(record.timeSeries, parseJsonMember(files, timeseriesName))) {
      throw new Error(`Run time series member mismatch: ${id}`);
    }
    return record;
  });
  const legacyArtifactWrapperKeys = ["artifact", "caseId", "id", "sourceId"];
  const legacyArtifacts = manifest.legacyArtifactIds.map((id) => {
    const value = parseJsonMember(files, `legacy/${id}.json`);
    assertObject(value, "LegacyArtifact record schema");
    if (canonicalJson(Object.keys(value).sort()) !== canonicalJson(legacyArtifactWrapperKeys)) {
      throw new Error("Invalid LegacyArtifact record schema");
    }
    const record = value as unknown as LegacyArtifactRecord;
    if (record.id !== id || typeof record.caseId !== "string" || typeof record.sourceId !== "string" || !record.sourceId.trim()) {
      throw new Error("Invalid LegacyArtifact record schema");
    }
    assertSchema("LegacyArtifact", validateLegacyArtifact(record.artifact));
    return record;
  });

  const expected = [...expectedMemberNames(manifest, runs),
    ...scenarios.map((scenario) => `cases/${scenario.caseId}/scenarios/${scenario.id}.json`),
    "checksums.json"].sort();
  const actual = Object.keys(files).sort();
  for (const name of expected) if (!files[name]) throw new Error(`Missing bundle member: ${name}`);
  if (!sameJson(actual, expected)) throw new Error("Bundle contains unexpected or missing members");

  const alternativeIds = new Set(alternatives.map(({ id }) => id));
  for (const alternative of alternatives) if (alternative.projectId !== project.id) throw new Error("Alternative does not belong to Project");
  for (const caseRecord of cases) if (!alternativeIds.has(caseRecord.alternativeId)) throw new Error("Case does not belong to an Alternative");
  for (const scenario of scenarios) if (!caseIds.has(scenario.caseId)) throw new Error("Scenario does not belong to a Case");
  for (const run of runs) {
    const scenario = scenarios.find((candidate) => candidate.id === run.scenarioId);
    if (!caseIds.has(run.caseId) || scenario?.caseId !== run.caseId) throw new Error("Run relationships are invalid");
    if (run.status !== run.manifest.finalStatus || run.id !== run.manifest.runId || run.caseId !== run.manifest.caseId || run.scenarioId !== run.manifest.scenarioId) {
      throw new Error("Run manifest relationships are invalid");
    }
  }
  for (const record of legacyArtifacts) {
    const caseRecord = cases.find((candidate) => candidate.id === record.caseId);
    if (!caseRecord) throw new Error("LegacyArtifact does not belong to a Case");
    if (caseRecord.state !== "locked" || caseRecord.lockProvenance !== "legacy_import") {
      throw new Error("LegacyArtifact must reference a Case locked with legacy_import provenance");
    }
  }
  for (const caseRecord of cases) {
    const succeeded = runs.some((run) => run.caseId === caseRecord.id && run.status === "succeeded");
    if (succeeded && (caseRecord.state !== "locked" || caseRecord.lockProvenance !== "successful_run")) {
      throw new Error("Successful Run must lock its Case");
    }
    if (caseRecord.state === "locked" && caseRecord.lockProvenance === "successful_run" && !succeeded) {
      throw new Error("Successfully locked Case is missing its successful Run");
    }
    if (caseRecord.state === "locked" && caseRecord.lockProvenance === "legacy_import") {
      const artifactCount = legacyArtifacts.filter((record) => record.caseId === caseRecord.id).length;
      if (artifactCount !== 1) throw new Error("A legacy_import Case must have exactly one LegacyArtifact");
    }
  }

  return {
    bundleFormatVersion: manifest.bundleFormatVersion,
    project,
    alternatives,
    cases,
    scenarios,
    runs,
    legacyArtifacts,
    members: actual,
  };
}

export async function validateProjectBundle(bytes: Uint8Array): Promise<void> {
  await inspectProjectBundle(bytes);
}

export async function importProjectBundle(bytes: Uint8Array): Promise<WorkspaceData> {
  const inspection = await inspectProjectBundle(bytes);
  return {
    projects: [inspection.project],
    alternatives: inspection.alternatives,
    cases: inspection.cases,
    scenarios: inspection.scenarios,
    runs: inspection.runs,
    legacyArtifacts: inspection.legacyArtifacts,
  };
}
