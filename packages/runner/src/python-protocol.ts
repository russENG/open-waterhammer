import type { JsonValue, RunKind } from "@open-waterhammer/contracts";

export const PYTHON_PROTOCOL_VERSION = 1 as const;

export interface PythonCalculationRequest {
  protocolVersion: typeof PYTHON_PROTOCOL_VERSION;
  kind: RunKind;
  model: JsonValue;
  scenario: JsonValue;
}

export interface PythonProtocolSuccess {
  protocolVersion: typeof PYTHON_PROTOCOL_VERSION;
  ok: true;
  pythonVersion: string;
  inputHash: string;
  result: {
    method: string;
    numericParameters: JsonValue;
    boundaryParameters: JsonValue;
    summary: JsonValue;
    timeSeries?: JsonValue;
    assessment: import("@open-waterhammer/contracts").AutomatedAssessment;
    warnings: string[];
  };
}

export interface PythonProtocolFailure {
  protocolVersion: typeof PYTHON_PROTOCOL_VERSION;
  ok: false;
  error: { code: string; message: string };
}

export type PythonProtocolResponse = PythonProtocolSuccess | PythonProtocolFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parsePythonProtocolResponse(stdout: string): PythonProtocolResponse {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new Error("Python protocol returned invalid JSON");
  }
  if (!isRecord(value) || value.protocolVersion !== PYTHON_PROTOCOL_VERSION || typeof value.ok !== "boolean") {
    throw new Error("Python protocol returned an invalid response envelope");
  }
  if (value.ok === false) {
    if (!isRecord(value.error) || typeof value.error.code !== "string" || typeof value.error.message !== "string") {
      throw new Error("Python protocol returned an invalid error envelope");
    }
    return value as unknown as PythonProtocolFailure;
  }
  if (
    typeof value.pythonVersion !== "string" || typeof value.inputHash !== "string"
    || !isRecord(value.result) || typeof value.result.method !== "string"
    || !Array.isArray(value.result.warnings)
  ) {
    throw new Error("Python protocol returned an invalid success envelope");
  }
  return value as unknown as PythonProtocolSuccess;
}
