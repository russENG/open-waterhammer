import { spawn } from "node:child_process";
import { delimiter } from "node:path";
import { fileURLToPath } from "node:url";

import { scenarioCalculationInput } from "./manifest.js";
import {
  PYTHON_PROTOCOL_VERSION,
  parsePythonProtocolResponse,
} from "./python-protocol.js";
import type { PythonCalculationRequest } from "./python-protocol.js";
import type { CalculationExecutor } from "./types.js";

export interface CpythonExecutorOptions {
  pythonPath?: string;
  corePythonPath?: string;
  onStderr?: (text: string) => void;
}

class CpythonExecutionError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CpythonExecutionError";
    this.code = code;
  }
}

interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runPython(
  pythonPath: string,
  corePythonPath: string,
  request: PythonCalculationRequest,
  onStderr?: (text: string) => void,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const existingPythonPath = process.env.PYTHONPATH;
    const child = spawn(pythonPath, ["-m", "open_waterhammer.protocol"], {
      cwd: corePythonPath,
      env: {
        ...process.env,
        PYTHONPATH: existingPythonPath
          ? `${corePythonPath}${delimiter}${existingPythonPath}`
          : corePythonPath,
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      onStderr?.(chunk);
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(new CpythonExecutionError("PYTHON_NOT_FOUND", `Python executable not found: ${pythonPath}`));
      } else {
        reject(new CpythonExecutionError("PYTHON_PROCESS_ERROR", error.message));
      }
    });
    child.once("close", (exitCode) => resolve({ exitCode: exitCode ?? 1, stdout, stderr }));
    child.stdin.end(JSON.stringify(request));
  });
}

export function createCpythonExecutor(options: CpythonExecutorOptions = {}): CalculationExecutor {
  const pythonPath = options.pythonPath ?? "python";
  const corePythonPath = options.corePythonPath
    ?? fileURLToPath(new URL("../../core-py", import.meta.url));

  return async ({ kind, caseSnapshot, scenarioSnapshot }) => {
    const request: PythonCalculationRequest = {
      protocolVersion: PYTHON_PROTOCOL_VERSION,
      kind,
      model: caseSnapshot.modelSnapshot,
      scenario: scenarioCalculationInput(scenarioSnapshot),
    };
    const processResult = await runPython(pythonPath, corePythonPath, request, options.onStderr);
    let response;
    try {
      response = parsePythonProtocolResponse(processResult.stdout);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CpythonExecutionError("PYTHON_PROTOCOL_ERROR", message);
    }
    if (!response.ok) {
      throw new CpythonExecutionError(response.error.code, response.error.message);
    }
    if (processResult.exitCode !== 0) {
      throw new CpythonExecutionError(
        "PYTHON_PROCESS_ERROR",
        processResult.stderr.trim() || `Python exited with code ${processResult.exitCode}`,
      );
    }
    return {
      engine: "open-waterhammer-python",
      runtime: `cpython-${response.pythonVersion}`,
      method: response.result.method,
      numericParameters: response.result.numericParameters,
      boundaryParameters: response.result.boundaryParameters,
      summary: response.result.summary,
      ...(response.result.timeSeries === undefined ? {} : { timeSeries: response.result.timeSeries }),
      assessment: response.result.assessment,
      warnings: response.result.warnings,
      inputHash: response.inputHash,
    };
  };
}
