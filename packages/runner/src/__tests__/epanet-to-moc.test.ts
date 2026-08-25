import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { caseFixture, scenarioFixture } from "@open-waterhammer/contracts";

import {
  applyEpanetInitialState,
  buildEpanetInitialInput,
  createEpanetInitializedMocExecutor,
} from "../epanet-to-moc.js";

const pipe = {
  id: "P-1",
  startNodeId: "R",
  endNodeId: "V",
  pipeType: "ductile_iron",
  innerDiameter: 0.3,
  wallThickness: 0.01,
  length: 500,
  roughnessCoeff: 130,
};

const model = {
  network: {
    pipes: [{
      id: "P-1", pipe, waveSpeed: 1000, nReaches: 5,
      upstreamNodeId: "R", downstreamNodeId: "V", initialFlow: 0.07,
    }],
    nodes: {
      R: { type: "reservoir", head: 80 },
      V: { type: "valve", Q0: 0.07, H0v: 30, closeTime: 2 },
    },
  },
  options: { tMax: 5, initialFlow: 0.07 },
};

const steady = {
  caseName: "initial",
  pipeResults: [{
    pipeId: "P-1", flow: 0.031, velocity: 0.44, velocityHead: 0.01,
    frictionLoss: 1.5, minorLoss: 0, totalLoss: 1.5, hydraulicGradient: 0.003,
  }],
  nodeResults: [
    { nodeId: "R", head: 80, hydraulicGradeLine: 80, pressureHead: 80, pressureMpa: 0.78 },
    { nodeId: "V", head: 78.5, hydraulicGradeLine: 78.5, pressureHead: 78.5, pressureMpa: 0.77 },
  ],
  maxVelocity: 0.44,
  maxPressureHead: 80,
  warnings: [],
};

describe("EPANET initial state to MOC", () => {
  test("builds one EPANET link per physical MOC pipe, not per characteristic grid cell", () => {
    const input = buildEpanetInitialInput(model);
    assert.equal(input.pipes.length, 1);
    assert.equal(input.pipes[0]!.length, 500);
    assert.equal(input.nodes.find((node) => node.id === "V")!.demand, 0.07);
  });

  test("passes pipe flow and node head while removing the global initial-flow override", () => {
    const initialized = applyEpanetInitialState(model, steady) as typeof model & {
      options: { initialNodeHeads: Record<string, number>; initialFlow?: number };
    };
    assert.equal(initialized.network.pipes[0]!.initialFlow, 0.031);
    assert.equal(initialized.network.nodes.V.Q0, 0.031);
    assert.equal(initialized.network.nodes.V.H0v, 78.5);
    assert.equal(initialized.options.initialNodeHeads.V, 78.5);
    assert.equal(initialized.options.initialFlow, undefined);
  });

  test("runs EPANET before MOC and records the combined method", async () => {
    let receivedModel: unknown;
    const executor = createEpanetInitializedMocExecutor(
      async ({ caseSnapshot }) => {
        receivedModel = caseSnapshot.modelSnapshot;
        return {
          engine: "python",
          runtime: "cpython",
          method: "moc-network",
          numericParameters: {},
          boundaryParameters: {},
          summary: {},
        };
      },
      async () => steady,
    );
    const output = await executor({
      kind: "transient_network",
      caseSnapshot: { ...caseFixture, modelSnapshot: model },
      scenarioSnapshot: scenarioFixture,
      calculationInputHash: "hash",
    });
    assert.match(output.method, /steady-network-epanet -> moc-network/);
    assert.match(output.engine, /epanet-js -> python/);
    assert.equal(output.inputHash, "hash");
    assert.equal(
      (receivedModel as typeof model).network.pipes[0]!.initialFlow,
      0.031,
    );
  });
});
