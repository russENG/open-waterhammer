import {
  validateAlternative,
  validateCase,
  validateLegacyArtifact,
  validateProject,
} from "@open-waterhammer/contracts";
import type { JsonValue } from "@open-waterhammer/contracts";

import { canonicalJson } from "./bundle.js";
import type { WorkspaceStorage } from "./storage.js";
import type { LegacyArtifactRecord, LegacyMigrationResult, LegacyStorage } from "./types.js";

const LEGACY_KEY = "owh_sessions";
const LEGACY_PROJECT_ID = "0a000000-0000-4000-8000-000000000001";
const LEGACY_ALTERNATIVE_ID = "0a000000-0000-4000-8000-000000000002";
const FALLBACK_TIMESTAMP = "1970-01-01T00:00:00.000Z";

async function sha256Bytes(value: string): Promise<Uint8Array> {
  const encoded = new TextEncoder().encode(value);
  const input = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(input).set(encoded);
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", input));
}

async function deterministicUuid(namespace: string, sourceId: string): Promise<string> {
  const bytes = (await sha256Bytes(`${namespace}:${sourceId}`)).slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function objectValue(value: JsonValue, key: string): JsonValue | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value[key] : undefined;
}

function sourceTimestamp(session: JsonValue): string {
  const candidate = objectValue(session, "createdAt");
  if (typeof candidate !== "string" || !candidate.endsWith("Z") || !Number.isFinite(Date.parse(candidate))) {
    return FALLBACK_TIMESTAMP;
  }
  return candidate;
}

async function sourceIdentity(session: JsonValue): Promise<string> {
  const candidate = objectValue(session, "id");
  if ((typeof candidate === "string" && candidate.trim()) || typeof candidate === "number") return String(candidate);
  const digest = await sha256Bytes(canonicalJson(session));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

interface PlannedLegacyRecord {
  sourceId: string;
  caseRecord: import("@open-waterhammer/contracts").Case;
  artifactRecord: LegacyArtifactRecord;
}

async function planRecord(session: JsonValue): Promise<PlannedLegacyRecord> {
  const sourceId = await sourceIdentity(session);
  const caseId = await deterministicUuid("legacy-case", sourceId);
  const artifactId = await deterministicUuid("legacy-artifact", sourceId);
  const timestamp = sourceTimestamp(session);
  const caseRecord: import("@open-waterhammer/contracts").Case = {
    id: caseId,
    alternativeId: LEGACY_ALTERNATIVE_ID,
    parentCaseId: null,
    modelSnapshot: session,
    state: "locked",
    lockProvenance: "legacy_import",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  if (!Boolean(validateCase(caseRecord))) {
    caseRecord.createdAt = FALLBACK_TIMESTAMP;
    caseRecord.updatedAt = FALLBACK_TIMESTAMP;
  }
  const artifactRecord: LegacyArtifactRecord = {
    id: artifactId,
    caseId,
    sourceId,
    artifact: { rawSession: session, provenance: "incomplete" },
  };
  if (validateCase(caseRecord) !== true || validateLegacyArtifact(artifactRecord.artifact) !== true) {
    throw new Error(`Legacy session cannot be migrated: ${sourceId}`);
  }
  return { sourceId, caseRecord, artifactRecord };
}

export async function migrateLegacySessions(
  storage: WorkspaceStorage,
  legacyStorage?: LegacyStorage,
): Promise<LegacyMigrationResult> {
  if (!legacyStorage) return { imported: 0, skipped: 0 };
  const raw = legacyStorage.getItem(LEGACY_KEY);
  if (!raw) return { imported: 0, skipped: 0 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { imported: 0, skipped: 0 };
  }
  if (!Array.isArray(parsed)) return { imported: 0, skipped: 0 };
  const planned = await Promise.all((parsed as JsonValue[]).map(planRecord));

  return storage.transaction((draft) => {
    const knownSources = new Set(draft.legacyArtifacts.map(({ sourceId }) => sourceId));
    let imported = 0;
    let skipped = 0;
    for (const record of planned) {
      if (knownSources.has(record.sourceId)) {
        skipped += 1;
        continue;
      }
      if (draft.cases.some(({ id }) => id === record.caseRecord.id) || draft.legacyArtifacts.some(({ id }) => id === record.artifactRecord.id)) {
        throw new Error(`Legacy migration id collision: ${record.sourceId}`);
      }
      draft.cases.push(record.caseRecord);
      draft.legacyArtifacts.push(record.artifactRecord);
      knownSources.add(record.sourceId);
      imported += 1;
    }
    if (imported > 0) {
      if (!draft.projects.some(({ id }) => id === LEGACY_PROJECT_ID)) {
        const project = {
          id: LEGACY_PROJECT_ID,
          name: "Imported legacy sessions",
          standardSelection: { profileId: "legacy_incomplete", version: "unknown" },
          crs: "local-xy",
          createdAt: FALLBACK_TIMESTAMP,
          updatedAt: FALLBACK_TIMESTAMP,
        };
        if (validateProject(project) !== true) throw new Error("Invalid legacy Project");
        draft.projects.push(project);
      }
      if (!draft.alternatives.some(({ id }) => id === LEGACY_ALTERNATIVE_ID)) {
        const alternative = {
          id: LEGACY_ALTERNATIVE_ID,
          projectId: LEGACY_PROJECT_ID,
          name: "Imported sessions",
          description: "Read-only records imported from owh_sessions",
          createdAt: FALLBACK_TIMESTAMP,
          updatedAt: FALLBACK_TIMESTAMP,
        };
        if (validateAlternative(alternative) !== true) throw new Error("Invalid legacy Alternative");
        draft.alternatives.push(alternative);
      }
    }
    return { imported, skipped };
  });
}
