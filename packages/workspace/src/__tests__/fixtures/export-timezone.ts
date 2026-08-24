import {
  alternativeFixture,
  caseFixture,
  projectFixture,
  scenarioFixture,
} from "@open-waterhammer/contracts";

import { InMemoryWorkspaceRepository } from "../../index.js";

const repository = new InMemoryWorkspaceRepository({
  projects: [projectFixture],
  alternatives: [alternativeFixture],
  cases: [caseFixture],
  scenarios: [scenarioFixture],
  runs: [],
  legacyArtifacts: [],
});

const bytes = await repository.exportBundle(projectFixture.id);
process.stdout.write(Buffer.from(bytes).toString("base64"));
