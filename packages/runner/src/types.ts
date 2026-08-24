import type {
  AutomatedAssessment,
  Case,
  JsonValue,
  Project,
  Run,
  RunKind,
  Scenario,
  UtcTimestamp,
} from "@open-waterhammer/contracts";
import type { WorkspaceRepository } from "@open-waterhammer/workspace";

export interface EngineExecutionContext {
  kind: RunKind;
  caseSnapshot: Case;
  scenarioSnapshot: Scenario;
  calculationInputHash: string;
}

export interface CalculationEngineOutput {
  engine: string;
  runtime: string;
  method: string;
  numericParameters: JsonValue;
  boundaryParameters: JsonValue;
  summary: JsonValue;
  timeSeries?: JsonValue;
  assessment?: AutomatedAssessment;
  warnings?: string[];
  inputHash?: string;
}

export type CalculationExecutor = (
  context: EngineExecutionContext,
) => Promise<CalculationEngineOutput>;

export interface CalculationExecutorRegistry {
  get(kind: RunKind): CalculationExecutor | undefined;
  kinds(): readonly RunKind[];
}

export interface RunCalculationInput {
  repository: WorkspaceRepository;
  project: Project;
  caseSnapshot: Case;
  scenarioSnapshot: Scenario;
  kind: RunKind;
  executors: CalculationExecutorRegistry;
  createRunId?: () => string;
  now?: () => UtcTimestamp;
  gitSha?: string;
}

export type RunCalculationResult = Run;
