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

/**
 * Builds the subprocess environment for the CPython adapter's own `spawn` call. Exported as a
 * pure, dependency-free function so this exact merging logic is unit-testable without mocking
 * `child_process.spawn` (see `__tests__/python-adapter.test.ts`).
 *
 * PYTHONUTF8 / PYTHONIOENCODING are forced to UTF-8 because this adapter always talks to
 * CPython over piped (non-console) stdio (`stdio: ["pipe", "pipe", "pipe"]` below): with no
 * attached console, CPython falls back to `locale.getpreferredencoding()` for its stdin/stdout
 * text streams — UTF-8 on typical Ubuntu CI runners, but the Windows ANSI codepage (cp932 on a
 * Japanese-locale Windows box) on Windows, which cannot round-trip the JSON protocol payload's
 * Japanese text (pipe names, case names, ...) and crashes with a UnicodeEncodeError on the
 * response write. Forcing UTF-8 here makes every consumer of `createCpythonExecutor` (the CLI,
 * this package's own tests, any future caller) correct by construction, instead of relying on
 * each caller to inject these vars itself — previously true only of scripts/acceptance.mjs's
 * own UTF8_SUBPROCESS_ENV, which stays in place as a now-redundant defense.
 */
export function buildPythonSpawnEnv(
  baseEnv: NodeJS.ProcessEnv,
  corePythonPath: string,
): NodeJS.ProcessEnv {
  const existingPythonPath = baseEnv.PYTHONPATH;
  return {
    ...baseEnv,
    PYTHONPATH: existingPythonPath
      ? `${corePythonPath}${delimiter}${existingPythonPath}`
      : corePythonPath,
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
  };
}

function runPython(
  pythonPath: string,
  corePythonPath: string,
  request: PythonCalculationRequest,
  onStderr?: (text: string) => void,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonPath, ["-m", "open_waterhammer.protocol"], {
      cwd: corePythonPath,
      env: buildPythonSpawnEnv(process.env, corePythonPath),
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
