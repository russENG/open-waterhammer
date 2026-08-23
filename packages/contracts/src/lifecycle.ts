import type { Case, CreateCaseInput, ForkCaseInput, Run, UtcTimestamp } from "./types.js";

function assertEditable(caseRecord: Case): void {
  if (caseRecord.state !== "draft") {
    throw new Error("Case is not editable");
  }
}

export function createCase(input: CreateCaseInput): Case {
  return {
    id: input.id,
    alternativeId: input.alternativeId,
    parentCaseId: null,
    modelSnapshot: input.modelSnapshot,
    state: "draft",
    lockProvenance: null,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  };
}

export function forkCase(caseRecord: Case, input: ForkCaseInput): Case {
  assertEditable(caseRecord);
  if (!input.revisionReason.trim()) {
    throw new Error("A non-blank revision reason is required");
  }

  return {
    ...caseRecord,
    id: input.id,
    parentCaseId: caseRecord.id,
    revisionReason: input.revisionReason,
    state: "draft",
    lockProvenance: null,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  };
}

export function archiveCase(caseRecord: Case, timestamp: UtcTimestamp): Case {
  assertEditable(caseRecord);
  return { ...caseRecord, state: "archived", updatedAt: timestamp };
}

export function applyFinalRun(caseRecord: Case, run: Run): Case {
  if (run.status !== "succeeded" || caseRecord.state !== "draft") {
    return caseRecord;
  }

  return {
    ...caseRecord,
    state: "locked",
    lockProvenance: "successful_run",
    updatedAt: run.updatedAt,
  };
}
